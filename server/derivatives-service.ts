import {
  ForcedFlowTracker,
  parseCoinbaseIntlInstrument,
  parseDeribitLiquidations,
  parseDeribitSummary,
  parseHyperliquidContexts,
  parseKrakenLiquidation,
  parseKrakenTickers,
  parseOkxCandleCloses,
  parseOkxFunding,
  parseOkxInstruments,
  parseOkxLiquidations,
  parseOkxMarks,
  parseOkxOpenInterest,
  parseOkxOpenInterestHistory,
  perpetualsFor,
  windowChanges,
  type ForcedFlow,
  type LiquidationVenue,
  type OkxContract,
} from '../shared/forced-flow.ts'

/**
 * Perpetual-futures positioning for the charted product: open interest, marks and funding polled
 * from five venues, and liquidations streamed from three. Feeds `ForcedFlowTracker`, whose
 * snapshot rides along on the chart's SSE payload.
 *
 * Every upstream is a fixed public market-data endpoint — no keys, no accounts, no order entry.
 * Binance and Bybit are deliberately absent: both refuse connections from this region (HTTP 451
 * and a CloudFront 403), so adding them would only add a permanently-down row.
 *
 * Nothing runs until a chart `watch`es a product, and everything stops a few seconds after the
 * last chart lets go.
 */
export const POLL_MS = 15_000
export const FUNDING_POLL_MS = 60_000
const REQUEST_TIMEOUT_MS = 8_000
const IDLE_MS = 5_000
/**
 * How long a released product's tracker is kept. A chart pauses its stream whenever its tab is
 * hidden; without this, every tab switch would throw away the calibration, the OI samples and the
 * event list, and the box would sit in "warming up" for five minutes after each return.
 */
export const RETAIN_MS = 15 * 60_000

const OKX = 'https://www.okx.com'
const KRAKEN = 'https://futures.kraken.com'
const DERIBIT = 'https://www.deribit.com'
const HYPERLIQUID = 'https://api.hyperliquid.xyz/info'
const COINBASE_INTL = 'https://api.international.coinbase.com'

const SOCKETS: Record<LiquidationVenue, string> = {
  okx: 'wss://ws.okx.com:8443/ws/v5/public',
  kraken: 'wss://futures.kraken.com/ws/v1',
  deribit: 'wss://www.deribit.com/ws/api/v2',
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

interface Watched {
  product: string
  refs: number
  tracker: ForcedFlowTracker
  lastFunding: number
}

export interface DerivativesFeed {
  watch(product: string): () => void
  snapshot(product: string, now: number): ForcedFlow | undefined
  close(): void
}

export class DerivativesService implements DerivativesFeed {
  private watched = new Map<string, Watched>()
  /** Released products, kept for `RETAIN_MS` so a returning chart resumes where it left off. */
  private dormant = new Map<string, { entry: Watched; until: number }>()
  private fetcher: Fetcher
  private socketFactory: (url: string) => WebSocket
  private sockets = new Map<LiquidationVenue, LiveSocket>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private okxContracts: Map<string, OkxContract> | null = null
  private okxContractsLoading: Promise<void> | null = null
  private closed = false
  private polling = false

  constructor(options: { fetcher?: Fetcher; socketFactory?: (url: string) => WebSocket } = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
  }

  watch(product: string): () => void {
    if (this.closed || !perpetualsFor(product)) return () => {}
    for (const [key, kept] of this.dormant) if (kept.until < Date.now()) this.dormant.delete(key)
    let entry = this.watched.get(product)
    if (!entry) {
      const kept = this.dormant.get(product)?.entry
      this.dormant.delete(product)
      entry = kept ?? {
        product,
        refs: 0,
        tracker: new ForcedFlowTracker(product),
        lastFunding: 0,
      }
      this.watched.set(product, entry)
      if (!kept) void this.seed(entry)
    }
    entry.refs++
    clearTimeout(this.idleTimer)
    this.start()
    this.resubscribe()
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.watched.get(product)
      if (!current) return
      current.refs--
      if (current.refs > 0) return
      this.watched.delete(product)
      this.dormant.set(product, { entry: current, until: Date.now() + RETAIN_MS })
      this.resubscribe()
      if (!this.watched.size)
        this.idleTimer = setTimeout(() => {
          if (!this.watched.size) this.stop()
        }, IDLE_MS)
    }
  }

  snapshot(product: string, now: number): ForcedFlow | undefined {
    const entry = this.watched.get(product)
    if (!entry) return undefined
    for (const [venue, socket] of this.sockets) entry.tracker.feeds[venue] = socket.state
    return entry.tracker.snapshot(now)
  }

  close() {
    this.closed = true
    this.watched.clear()
    this.dormant.clear()
    clearTimeout(this.idleTimer)
    this.stop()
  }

  private start() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS)
    void this.poll()
    for (const venue of Object.keys(SOCKETS) as LiquidationVenue[]) {
      if (this.sockets.has(venue)) continue
      const socket = new LiveSocket(venue, SOCKETS[venue], this.socketFactory, {
        onOpen: () => this.subscribeVenue(venue),
        onMessage: (data) => this.onSocketMessage(venue, data),
        keepalive: venue === 'okx' ? 'ping' : venue === 'deribit' ? DERIBIT_TEST : null,
      })
      this.sockets.set(venue, socket)
      socket.connect()
    }
  }

  private stop() {
    clearInterval(this.pollTimer)
    this.pollTimer = undefined
    for (const socket of this.sockets.values()) socket.close()
    this.sockets.clear()
  }

  private async getJson(url: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > 4_000_000) throw new Error('Upstream payload too large')
      return JSON.parse(text)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Five days of OKX five-minute OI and price windows, so the thresholds start calibrated. */
  private async seed(entry: Watched) {
    const okx = perpetualsFor(entry.product)?.okx[0]
    if (!okx) return
    try {
      const oiPoints: { time: number; value: number }[] = []
      const closes: { time: number; value: number }[] = []
      let oiEnd = ''
      let candleAfter = ''
      for (let page = 0; page < 15 && this.watched.get(entry.product) === entry; page++) {
        const [oi, candles] = await Promise.all([
          this.getJson(
            `${OKX}/api/v5/rubik/stat/contracts/open-interest-history?instId=${okx}&period=5m&limit=100${oiEnd ? `&end=${oiEnd}` : ''}`,
          ),
          this.getJson(
            `${OKX}/api/v5/market/history-candles?instId=${okx}&bar=5m&limit=100${candleAfter ? `&after=${candleAfter}` : ''}`,
          ),
        ])
        const oiRows = parseOkxOpenInterestHistory(oi)
        const candleRows = parseOkxCandleCloses(candles)
        if (!oiRows.length && !candleRows.length) break
        oiPoints.push(...oiRows)
        closes.push(...candleRows)
        const oldestOi = oiRows[oiRows.length - 1]?.time
        const oldestCandle = candleRows[candleRows.length - 1]?.time
        if (oldestOi) oiEnd = String(Math.round(oldestOi * 1000))
        if (oldestCandle) candleAfter = String(Math.round(oldestCandle * 1000))
        await delay(150)
      }
      entry.tracker.seed(windowChanges(closes), windowChanges(oiPoints))
    } catch {
      // Unseeded, the tracker calibrates from live windows instead; it says so until it has.
    }
  }

  private async loadOkxContracts() {
    if (this.okxContracts) return
    this.okxContractsLoading ??= this.getJson(`${OKX}/api/v5/public/instruments?instType=SWAP`)
      .then((payload) => {
        const contracts = parseOkxInstruments(payload)
        if (contracts.size) this.okxContracts = contracts
      })
      .catch(() => undefined)
      .finally(() => {
        this.okxContractsLoading = null
      })
    await this.okxContractsLoading
  }

  /** One round of OI, marks and (once a minute) funding for every watched product. */
  private async poll() {
    if (this.polling || !this.watched.size) return
    this.polling = true
    const now = () => Date.now() / 1000
    try {
      const entries = [...this.watched.values()]
      const pairs = entries.map((e) => ({ entry: e, perps: perpetualsFor(e.product)! }))
      const deribitCurrencies = [
        ...new Set(pairs.flatMap((p) => (p.perps.deribit ? [p.perps.base] : []))),
      ]
      const [okxOi, okxMarks, kraken, hyperliquid, ...rest] = await Promise.allSettled([
        this.getJson(`${OKX}/api/v5/public/open-interest?instType=SWAP`),
        this.getJson(`${OKX}/api/v5/public/mark-price?instType=SWAP`),
        this.getJson(`${KRAKEN}/derivatives/api/v3/tickers`),
        this.getJson(HYPERLIQUID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        }),
        ...deribitCurrencies.map((currency) =>
          this.getJson(
            `${DERIBIT}/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=future`,
          ),
        ),
        ...pairs.map((p) =>
          this.getJson(`${COINBASE_INTL}/api/v1/instruments/${p.perps.coinbaseIntl}`),
        ),
      ])
      const deribit = new Map(deribitCurrencies.map((c, i) => [c, rest[i]]))
      const coinbaseIntl = rest.slice(deribitCurrencies.length)
      const okxOiMap = okxOi.status === 'fulfilled' ? parseOkxOpenInterest(okxOi.value) : null
      const okxMarkMap = okxMarks.status === 'fulfilled' ? parseOkxMarks(okxMarks.value) : null
      const krakenMap = kraken.status === 'fulfilled' ? parseKrakenTickers(kraken.value) : null
      const hlMap =
        hyperliquid.status === 'fulfilled' ? parseHyperliquidContexts(hyperliquid.value) : null
      const at = now()
      pairs.forEach(({ entry, perps }, i) => {
        const tracker = entry.tracker
        if (okxOiMap && okxMarkMap) {
          // Both OKX books (USDT- and coin-margined) count as one venue's open interest.
          let oi = 0
          let mark: number | null = null
          for (const instId of perps.okx) {
            const value = okxOiMap.get(instId)
            if (value) oi += value
            mark ??= okxMarkMap.get(instId) ?? null
          }
          if (oi > 0 && mark)
            tracker.addOpenInterest({ venue: 'okx', time: at, openInterest: oi, mark })
        }
        const k = krakenMap?.get(perps.kraken)
        if (k) {
          tracker.addOpenInterest({
            venue: 'kraken',
            time: at,
            openInterest: k.openInterest,
            mark: k.mark,
          })
          if (k.rate8h !== null) tracker.addFunding({ venue: 'kraken', time: at, rate8h: k.rate8h })
        }
        const h = hlMap?.get(perps.hyperliquid)
        if (h) {
          tracker.addOpenInterest({
            venue: 'hyperliquid',
            time: at,
            openInterest: h.openInterest,
            mark: h.mark,
          })
          if (h.rate8h !== null)
            tracker.addFunding({ venue: 'hyperliquid', time: at, rate8h: h.rate8h })
        }
        const d = perps.deribit ? deribit.get(perps.base) : undefined
        if (d?.status === 'fulfilled' && perps.deribit) {
          const summary = parseDeribitSummary(d.value, perps.deribit)
          if (summary) {
            tracker.addOpenInterest({
              venue: 'deribit',
              time: at,
              openInterest: summary.openInterest,
              mark: summary.mark,
            })
            if (summary.rate8h !== null)
              tracker.addFunding({ venue: 'deribit', time: at, rate8h: summary.rate8h })
          }
        }
        const c = coinbaseIntl[i]
        if (c?.status === 'fulfilled') {
          const intl = parseCoinbaseIntlInstrument(c.value)
          if (intl) tracker.addOpenInterest({ venue: 'coinbase-intl', time: at, ...intl })
        }
      })
      // Funding moves slowly; once a minute per product is plenty.
      await Promise.allSettled(
        pairs
          .filter((p) => Date.now() - p.entry.lastFunding >= FUNDING_POLL_MS)
          .map(async ({ entry, perps }) => {
            entry.lastFunding = Date.now()
            const funding = parseOkxFunding(
              await this.getJson(`${OKX}/api/v5/public/funding-rate?instId=${perps.okx[0]}`),
            )
            if (funding)
              entry.tracker.addFunding({ venue: 'okx', time: now(), rate8h: funding.rate8h })
          }),
      )
    } finally {
      this.polling = false
    }
  }

  private resubscribe() {
    for (const venue of this.sockets.keys()) this.subscribeVenue(venue)
  }

  /** OKX takes every swap in one subscription; Kraken and Deribit are per instrument. */
  private subscribeVenue(venue: LiquidationVenue) {
    const socket = this.sockets.get(venue)
    if (!socket?.isOpen) return
    const perps = [...this.watched.keys()].flatMap((p) => {
      const value = perpetualsFor(p)
      return value ? [value] : []
    })
    if (venue === 'okx') {
      void this.loadOkxContracts()
      socket.sendOnce('okx', {
        op: 'subscribe',
        args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
      })
    } else if (venue === 'kraken') {
      const ids = [...new Set(perps.map((p) => p.kraken))]
      socket.reconcile(ids, (add, remove) => [
        ...(add.length ? [{ event: 'subscribe', feed: 'trade', product_ids: add }] : []),
        ...(remove.length ? [{ event: 'unsubscribe', feed: 'trade', product_ids: remove }] : []),
      ])
    } else {
      const channels = [
        ...new Set(perps.flatMap((p) => (p.deribit ? [`trades.${p.deribit}.100ms`] : []))),
      ]
      socket.reconcile(channels, (add, remove) => [
        ...(add.length
          ? [{ jsonrpc: '2.0', id: 1, method: 'public/subscribe', params: { channels: add } }]
          : []),
        ...(remove.length
          ? [{ jsonrpc: '2.0', id: 2, method: 'public/unsubscribe', params: { channels: remove } }]
          : []),
      ])
    }
  }

  private trackerFor(match: (perps: NonNullable<ReturnType<typeof perpetualsFor>>) => boolean) {
    for (const entry of this.watched.values()) {
      const perps = perpetualsFor(entry.product)
      if (perps && match(perps)) return entry.tracker
    }
    return null
  }

  private onSocketMessage(venue: LiquidationVenue, data: string) {
    if (data === 'pong' || data.length > 1_000_000) return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    const now = Date.now() / 1000
    if (venue === 'okx') {
      if (!this.okxContracts) return
      for (const { instId, liquidation } of parseOkxLiquidations(message, this.okxContracts))
        this.trackerFor((p) => p.okx.includes(instId))?.addLiquidation(liquidation, now)
    } else if (venue === 'kraken') {
      const parsed = parseKrakenLiquidation(message)
      if (parsed)
        this.trackerFor((p) => p.kraken === parsed.productId)?.addLiquidation(
          parsed.liquidation,
          now,
        )
    } else {
      for (const { instrument, liquidation } of parseDeribitLiquidations(message))
        this.trackerFor((p) => p.deribit === instrument)?.addLiquidation(liquidation, now)
    }
  }
}

const DERIBIT_TEST = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'public/test', params: {} })

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One reconnecting public websocket. Tracks what it has subscribed so a reconnect replays exactly
 * the current set, and reports `live` only once a message has arrived.
 */
class LiveSocket {
  private socket: WebSocket | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined
  private subscribed = new Set<string>()
  private sent = new Set<string>()
  private closed = false
  state: 'live' | 'connecting' | 'down' = 'connecting'

  constructor(
    readonly venue: LiquidationVenue,
    private url: string,
    private factory: (url: string) => WebSocket,
    private handlers: {
      onOpen: () => void
      onMessage: (data: string) => void
      keepalive: string | null
    },
  ) {}

  get isOpen() {
    return this.socket?.readyState === 1
  }

  connect() {
    if (this.closed || this.socket) return
    let socket: WebSocket
    try {
      socket = this.factory(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.state = 'connecting'
    const timeout = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== 1) socket.close()
    }, 10_000)
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      clearTimeout(timeout)
      this.subscribed.clear()
      this.sent.clear()
      if (this.handlers.keepalive) {
        const ping = this.handlers.keepalive
        this.keepaliveTimer = setInterval(() => {
          if (socket.readyState === 1) socket.send(ping)
        }, 20_000)
      }
      this.handlers.onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      this.state = 'live'
      this.attempt = 0
      this.handlers.onMessage(event.data)
    })
    socket.addEventListener('close', () => {
      clearTimeout(timeout)
      if (this.socket !== socket) return
      this.socket = null
      clearInterval(this.keepaliveTimer)
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.state = 'down'
    })
  }

  /** Send a fixed subscription once per connection. */
  sendOnce(key: string, message: unknown) {
    if (!this.isOpen || this.sent.has(key)) return
    this.sent.add(key)
    this.socket!.send(JSON.stringify(message))
  }

  /** Bring the connection's subscriptions to exactly `desired`. */
  reconcile(desired: string[], build: (add: string[], remove: string[]) => unknown[]) {
    if (!this.isOpen) return
    const want = new Set(desired)
    const add = desired.filter((id) => !this.subscribed.has(id))
    const remove = [...this.subscribed].filter((id) => !want.has(id))
    for (const message of build(add, remove)) this.socket!.send(JSON.stringify(message))
    this.subscribed = want
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return
    this.state = 'down'
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.attempt++, 6))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, wait)
  }

  close() {
    this.closed = true
    clearTimeout(this.reconnectTimer)
    clearInterval(this.keepaliveTimer)
    const socket = this.socket
    this.socket = null
    socket?.close()
  }
}
