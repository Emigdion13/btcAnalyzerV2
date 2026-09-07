import {
  aggregateCandles,
  CandleTracker,
  historyWindows,
  INTERVAL_SECONDS,
  isProductId,
  parseCandles,
  parseProducts,
  parseQuote,
  parseTrade,
} from '../shared/coinbase.ts'
import type {
  CoinbaseProduct,
  HistorySnapshot,
  Interval,
  MarketQuote,
  StreamPayload,
} from '../shared/coinbase.ts'
import { WhaleFlowTracker, type WhaleFlowOptions } from '../shared/whale-flow.ts'
import { CoinbaseRestClient, MarketError } from './rest-client.ts'

type ChartEntry = {
  product: string
  interval: Interval
  tracker: CandleTracker
  asOf: number
  revision: number
  lastReconciled: number
}
type Subscriber = {
  product: string
  interval: Interval
  products: string[]
  send: (payload: StreamPayload) => void
  revision: number
  needsReplace: boolean
}
export class CoinbaseService {
  private rest: CoinbaseRestClient
  private products: CoinbaseProduct[] = []
  private histories = new Map<string, ChartEntry>()
  private pendingHistories = new Map<string, Promise<HistorySnapshot>>()
  private quotes: Record<string, MarketQuote> = {}
  private subscribers = new Set<Subscriber>()
  private socket: WebSocket | null = null
  private subscribed = new Set<string>()
  private state: StreamPayload['state'] = 'connecting'
  private message = 'Connecting to Coinbase…'
  private lastMessage = 0
  private lastTradeIds = new Map<string, number>()
  /** Executed large-print flow, one tracker per subscribed product. */
  private whaleFlows = new Map<string, WhaleFlowTracker>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private pulseTimer: ReturnType<typeof setInterval> | undefined
  private failedReconciliations = new Set<string>()
  private closed = false
  private serial = 0
  private socketFactory: (url: string) => WebSocket
  /** Overrides for burst timing; exercised by tests that cannot wait out the real window. */
  private whaleFlowOptions: WhaleFlowOptions
  constructor(
    options: {
      rest?: CoinbaseRestClient
      socketFactory?: (url: string) => WebSocket
      whaleFlow?: WhaleFlowOptions
    } = {},
  ) {
    this.rest = options.rest ?? new CoinbaseRestClient()
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
    this.whaleFlowOptions = options.whaleFlow ?? {}
  }
  async getProducts() {
    const result = await this.rest.get('/products', 10 * 60 * 1000)
    this.products = parseProducts(result.value)
    return { source: 'coinbase' as const, products: this.products, asOf: result.at }
  }
  private async checkProduct(product: string) {
    if (!isProductId(product))
      throw new MarketError('Choose a valid Coinbase USD pair.', 400, 'INVALID_PAIR')
    const { products } = await this.getProducts()
    if (!products.some((p) => p.id === product))
      throw new MarketError(
        `${product} is not an available Coinbase USD pair.`,
        404,
        'PAIR_UNAVAILABLE',
      )
  }
  async getQuotes(products: string[]) {
    const catalog = await this.getProducts()
    const available = products.filter((id) => catalog.products.some((p) => p.id === id))
    const results = await Promise.allSettled(
      available.map(async (product) => {
        const result = await this.rest.get(`/products/${product}/stats`, 30000)
        const quote = parseQuote(result.value, result.at)
        if (!this.quotes[product] || this.quotes[product].updatedAt < quote.updatedAt)
          this.quotes[product] = quote
        return [product, this.quotes[product]] as const
      }),
    )
    const entries = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    if (available.length && !entries.length)
      throw new MarketError('Coinbase quotes are unavailable. Chart data is not a live quote.')
    return { source: 'coinbase' as const, quotes: Object.fromEntries(entries), asOf: Date.now() }
  }
  async getHistory(product: string, interval: Interval, limit = 300): Promise<HistorySnapshot> {
    await this.checkProduct(product)
    const key = `${product}:${interval}`,
      entry = this.histories.get(key)
    if (entry && entry.tracker.bars.length >= limit && Date.now() - entry.lastReconciled < 60000)
      return this.snapshot(entry, limit)
    const pendingKey = `${key}:${limit}`,
      pending = this.pendingHistories.get(pendingKey)
    if (pending) return pending
    const job = this.loadHistory(product, interval, limit).finally(() =>
      this.pendingHistories.delete(pendingKey),
    )
    this.pendingHistories.set(pendingKey, job)
    return job
  }
  private async loadHistory(product: string, interval: Interval, limit: number) {
    const now = Date.now(),
      { start, end, granularity, windows } = historyWindows(interval, limit, now)
    const pages = await Promise.all(
      windows.map(async (window) => {
        const params = new URLSearchParams({
          granularity: String(granularity),
          start: new Date(window.start * 1000).toISOString(),
          end: new Date(window.end * 1000).toISOString(),
        })
        const result = await this.rest.get(`/products/${product}/candles?${params}`, 15000)
        return parseCandles(result.value).filter((c) => c.time >= start && c.time <= end)
      }),
    )
    const bars = aggregateCandles(pages.flat(), interval).slice(-limit)
    if (!bars.length)
      throw new MarketError(
        'Coinbase has no candles for this pair and interval.',
        404,
        'NO_CANDLES',
      )
    const key = `${product}:${interval}`,
      current = this.histories.get(key),
      receivedAt = Date.now()
    const entry: ChartEntry = current ?? {
      product,
      interval,
      tracker: new CandleTracker([], interval, receivedAt),
      asOf: receivedAt,
      revision: 0,
      lastReconciled: 0,
    }
    entry.tracker.seed(bars, receivedAt)
    entry.asOf = receivedAt
    entry.lastReconciled = receivedAt
    entry.revision = ++this.serial
    this.histories.set(key, entry)
    this.failedReconciliations.delete(key)
    if (this.histories.size > 100) {
      const unused = [...this.histories.keys()].find(
        (key) => ![...this.subscribers].some((s) => `${s.product}:${s.interval}` === key),
      )
      if (unused) this.histories.delete(unused)
    }
    for (const sub of this.subscribers)
      if (sub.product === product && sub.interval === interval) sub.needsReplace = true
    return this.snapshot(entry, limit)
  }
  private snapshot(entry: ChartEntry, limit = 900): HistorySnapshot {
    return {
      source: 'coinbase',
      product: entry.product,
      interval: entry.interval,
      candles: entry.tracker.bars.slice(-limit),
      asOf: entry.asOf,
      revision: entry.revision,
      provisional: true,
    }
  }
  async subscribe(
    product: string,
    interval: Interval,
    products: string[],
    send: Subscriber['send'],
    limit = 300,
  ) {
    if (this.subscribers.size >= 64)
      throw new MarketError('Too many active chart connections. Please retry.', 503, 'BUSY')
    await this.getHistory(product, interval, limit)
    if (this.subscribers.size >= 64)
      throw new MarketError('Too many active chart connections. Please retry.', 503, 'BUSY')
    const accepted = products.filter((id) => this.products.some((p) => p.id === id))
    const sub: Subscriber = {
      product,
      interval,
      products: [...new Set([product, ...accepted])],
      send,
      revision: -1,
      needsReplace: true,
    }
    this.subscribers.add(sub)
    clearTimeout(this.idleTimer)
    if (!this.pulseTimer) this.pulseTimer = setInterval(() => this.pulse(), 1000)
    this.connect()
    this.updateSubscriptions()
    this.emit(sub)
    return () => {
      this.subscribers.delete(sub)
      this.updateSubscriptions()
      if (!this.subscribers.size)
        this.idleTimer = setTimeout(() => {
          if (this.subscribers.size) return
          clearInterval(this.pulseTimer)
          this.pulseTimer = undefined
          clearTimeout(this.reconnectTimer)
          const socket = this.socket
          this.socket = null
          socket?.close()
          this.subscribed.clear()
        }, 5000)
    }
  }
  private emit(sub: Subscriber) {
    const entry = this.histories.get(`${sub.product}:${sub.interval}`)
    if (!entry) return
    const replace = sub.needsReplace,
      changed = entry.revision !== sub.revision
    const payload: StreamPayload = {
      state: this.state,
      message: this.message,
      product: sub.product,
      interval: sub.interval,
      candles: changed ? (replace ? entry.tracker.bars : entry.tracker.bars.slice(-3)) : [],
      quotes: Object.fromEntries(
        sub.products.flatMap((id) => (this.quotes[id] ? [[id, this.quotes[id]]] : [])),
      ),
      revision: entry.revision,
      asOf: entry.asOf,
      replace,
      provisional: true,
      // Omitted entirely when no sweep is in progress, so the client clears rather than
      // holding a finished number on screen.
      whaleFlow: this.whaleFlows.get(sub.product)?.snapshot(Date.now() / 1000) ?? undefined,
    }
    sub.send(payload)
    sub.revision = entry.revision
    sub.needsReplace = false
  }
  private pulse() {
    if (this.socket?.readyState === 1 && Date.now() - this.lastMessage > 15000) {
      this.state = 'stale'
      this.message = 'Coinbase heartbeat lost. Reconnecting…'
      this.socket.close()
    }
    for (const sub of this.subscribers) this.emit(sub)
    const keys = new Set([...this.subscribers].map((s) => `${s.product}:${s.interval}`))
    for (const key of keys) {
      const entry = this.histories.get(key)
      if (entry && Date.now() - entry.lastReconciled > 60000) this.reconcile(entry)
    }
  }
  private reconcile(entry: ChartEntry) {
    entry.lastReconciled = Date.now()
    this.loadHistory(
      entry.product,
      entry.interval,
      Math.min(
        900,
        Math.max(
          3,
          Math.ceil((Date.now() - entry.asOf) / (INTERVAL_SECONDS[entry.interval] * 1000)) + 2,
        ),
      ),
    ).catch(() => {
      this.failedReconciliations.add(`${entry.product}:${entry.interval}`)
      this.state = 'stale'
      this.message = 'Candle reconciliation failed. Displayed bars may be incomplete.'
    })
  }
  private connect() {
    if (this.closed || !this.subscribers.size || this.socket || this.reconnectTimer) return
    this.state = 'connecting'
    this.message = 'Connecting to Coinbase live trades…'
    let socket: WebSocket
    try {
      socket = this.socketFactory('wss://ws-feed.exchange.coinbase.com')
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.subscribed.clear()
    this.lastMessage = Date.now()
    const timeout = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== 1) socket.close()
    }, 10000)
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      clearTimeout(timeout)
      this.lastMessage = Date.now()
      this.updateSubscriptions()
      // Canonical candles repair missed trades after any connection gap.
      for (const entry of this.histories.values()) {
        if (
          Date.now() - entry.lastReconciled > 3000 &&
          [...this.subscribers].some(
            (s) => s.product === entry.product && s.interval === entry.interval,
          )
        )
          this.reconcile(entry)
      }
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string' || event.data.length > 1000000)
        return
      try {
        this.onMessage(JSON.parse(event.data) as Record<string, unknown>)
      } catch {
        /* Ignore malformed upstream messages, never execute them. */
      }
    })
    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.state = 'reconnecting'
        this.message = 'Coinbase stream unavailable. Retrying…'
      }
    })
    socket.addEventListener('close', () => {
      clearTimeout(timeout)
      if (this.socket !== socket) return
      this.socket = null
      this.subscribed.clear()
      this.scheduleReconnect()
    })
  }
  private scheduleReconnect() {
    if (this.closed || !this.subscribers.size || this.reconnectTimer) return
    this.state = 'reconnecting'
    this.message = 'Coinbase disconnected. Retrying; prices are not live.'
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt++, 5))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }
  private updateSubscriptions() {
    if (this.socket?.readyState !== 1) return
    const desired = new Set([...this.subscribers].flatMap((s) => s.products))
    const add = [...desired].filter((id) => !this.subscribed.has(id)),
      remove = [...this.subscribed].filter((id) => !desired.has(id))
    for (const [type, product_ids] of [
      ['subscribe', add],
      ['unsubscribe', remove],
    ] as const) {
      if (product_ids.length)
        this.socket.send(
          JSON.stringify({ type, product_ids, channels: ['ticker', 'matches', 'heartbeat'] }),
        )
    }
    this.subscribed = desired
    // Release flow trackers for products nobody is watching any more.
    for (const product of this.whaleFlows.keys())
      if (!desired.has(product)) this.whaleFlows.delete(product)
  }
  private onMessage(message: Record<string, unknown>) {
    if (message.type === 'error') {
      this.state = 'stale'
      this.message = 'Coinbase rejected a subscription. Reconnecting…'
      this.socket?.close()
      return
    }
    if (message.type === 'subscriptions') return
    const product = message.product_id
    if (!isProductId(product) || !this.subscribed.has(product)) return
    this.lastMessage = Date.now()
    if (['heartbeat', 'ticker', 'match', 'last_match'].includes(String(message.type))) {
      this.state = this.failedReconciliations.size ? 'stale' : 'live'
      this.message = this.failedReconciliations.size
        ? 'Candle reconciliation pending. Some bars may be incomplete.'
        : 'Coinbase live · current candles are provisional'
      this.reconnectAttempt = 0
    }
    if (message.type === 'ticker') {
      try {
        this.quotes[product] = parseQuote(message, Date.now())
      } catch {
        /* Wait for a valid quote. */
      }
    }
    const trade = parseTrade(message)
    if (trade) {
      this.lastTradeIds.set(product, Math.max(this.lastTradeIds.get(product) ?? 0, trade.id))
      let flow = this.whaleFlows.get(product)
      if (!flow) {
        flow = new WhaleFlowTracker(product, this.whaleFlowOptions)
        this.whaleFlows.set(product, flow)
      }
      flow.apply(trade, Date.now() / 1000)
      for (const entry of this.histories.values())
        if (entry.product === product && entry.tracker.apply(trade)) {
          entry.revision = ++this.serial
          entry.asOf = Date.now()
        }
    }
    if (message.type === 'heartbeat' && typeof message.last_trade_id === 'number') {
      const last = this.lastTradeIds.get(product)
      if (last !== undefined && message.last_trade_id > last) {
        for (const entry of this.histories.values())
          if (entry.product === product && Date.now() - entry.lastReconciled > 15000)
            this.reconcile(entry)
      }
    }
  }
  close() {
    this.closed = true
    clearTimeout(this.idleTimer)
    clearTimeout(this.reconnectTimer)
    clearInterval(this.pulseTimer)
    this.subscribers.clear()
    this.whaleFlows.clear()
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.rest.close()
  }
}
