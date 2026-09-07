/** Pure transport/domain helpers shared by the API, browser and tests. */
export const INTERVAL_SECONDS = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
} as const
export type Interval = keyof typeof INTERVAL_SECONDS
export type DataSource = 'coinbase' | 'demo'
export type ConnectionState =
  'loading' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'offline' | 'paused'
export interface MarketCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface CoinbaseProduct {
  id: string
  base: string
  quote: 'USD'
  increment: number
}
export interface MarketQuote {
  price: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  change: number | null
  updatedAt: number
  source: DataSource
}
export interface HistorySnapshot {
  source: 'coinbase'
  product: string
  interval: Interval
  candles: MarketCandle[]
  asOf: number
  revision: number
  provisional: boolean
}
/**
 * A single unusually large executed trade on the venue's book.
 *
 * This is EXECUTED exchange flow, not an on-chain wallet transfer. It says a large order was
 * filled on Coinbase right now; it says nothing about wallets, custody, or off-exchange activity.
 */
export interface WhalePrint {
  id: number
  time: number
  price: number
  size: number
  /** Signed notional in USD: positive = taker bought, negative = taker sold. */
  notional: number
  side: 'buy' | 'sell'
}
/**
 * Live state of a whale sweep.
 *
 * `building` a directional sweep is under way but has not cleared the threshold
 * `active`   the sweep cleared the threshold; it is happening right now
 * `fading`   the sweep stopped; the final figure lingers briefly, then disappears
 *
 * There is no idle value: when nothing is happening the payload is omitted entirely so no figure
 * is left on screen.
 */
export type WhalePhase = 'building' | 'active' | 'fading'
/** Snapshot of an in-progress or just-finished whale sweep. */
export interface WhaleFlow {
  product: string
  phase: WhalePhase
  /** Signed USD notional swept inside the live window. */
  net: number
  /** Unsigned USD notional bought / sold inside the live window. */
  bought: number
  sold: number
  /** Trades in the sweep. */
  count: number
  /** USD notional a sweep must reach inside the window to count as whale activity. */
  threshold: number
  /** Live window length in seconds. */
  windowSeconds: number
  /** Sweep size as a multiple of the threshold, clamped to 4. */
  intensity: number
  /** Largest prints in the sweep, newest first. */
  prints: WhalePrint[]
  /**
   * False when the threshold is still a bootstrap default because too few trades have been
   * observed to compute a percentile. The UI must label this as calibrating.
   */
  calibrated: boolean
  /** Trades observed in the calibration sample. */
  sampled: number
}
export const isWhaleFlow = (value: unknown): value is WhaleFlow => {
  if (!value || typeof value !== 'object') return false
  const f = value as WhaleFlow
  return (
    isProductId(f.product) &&
    ['building', 'active', 'fading'].includes(f.phase) &&
    [f.net, f.bought, f.sold, f.threshold, f.windowSeconds, f.intensity].every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) &&
    Number.isInteger(f.count) &&
    f.count >= 0 &&
    Number.isInteger(f.sampled) &&
    f.sampled >= 0 &&
    f.bought >= 0 &&
    f.sold >= 0 &&
    f.threshold > 0 &&
    f.intensity >= 0 &&
    typeof f.calibrated === 'boolean' &&
    Array.isArray(f.prints) &&
    f.prints.length <= 50 &&
    f.prints.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        Number.isInteger(p.id) &&
        [p.time, p.price, p.size, p.notional].every(
          (v) => typeof v === 'number' && Number.isFinite(v),
        ) &&
        p.price > 0 &&
        p.size > 0 &&
        (p.side === 'buy' || p.side === 'sell'),
    )
  )
}
export interface StreamPayload {
  state: 'connecting' | 'live' | 'reconnecting' | 'stale'
  message: string
  product: string
  interval: Interval
  candles: MarketCandle[]
  quotes: Record<string, MarketQuote>
  revision: number
  asOf: number
  replace?: boolean
  provisional: boolean
  /** Executed large-print flow for the charted product. Absent when unavailable. */
  whaleFlow?: WhaleFlow
}
export const isProductId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z0-9]{1,24}-USD$/.test(value)
export const isInterval = (value: unknown): value is Interval =>
  typeof value === 'string' && Object.hasOwn(INTERVAL_SECONDS, value)
export function nativeGranularity(interval: Interval): number {
  return interval === '3m'
    ? 60
    : interval === '4h'
      ? 3600
      : interval === '1W'
        ? 86400
        : INTERVAL_SECONDS[interval]
}
/** Weekly bars start Monday 00:00 UTC; all other bars use UTC-aligned buckets. */
export function bucketStart(time: number, interval: Interval): number {
  const seconds = INTERVAL_SECONDS[interval],
    offset = interval === '1W' ? 4 * 86400 : 0
  return Math.floor((time - offset) / seconds) * seconds + offset
}
export function finite(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= 1e15 ? number : null
}
export function isCandle(value: unknown): value is MarketCandle {
  if (!value || typeof value !== 'object') return false
  const c = value as MarketCandle
  return (
    [c.time, c.open, c.high, c.low, c.close, c.volume].every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) &&
    Number.isInteger(c.time) &&
    c.time >= 0 &&
    c.low > 0 &&
    c.high <= 1e15 &&
    c.volume >= 0 &&
    c.volume <= 1e15 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close)
  )
}
export function parseCandles(value: unknown): MarketCandle[] {
  if (!Array.isArray(value)) throw new Error('Coinbase returned an invalid candle response.')
  const candles = value.map((row) => {
    if (!Array.isArray(row) || row.length < 6)
      throw new Error('Coinbase returned an invalid candle row.')
    const c = {
      time: row[0],
      low: row[1],
      high: row[2],
      open: row[3],
      close: row[4],
      volume: row[5],
    }
    if (!isCandle(c)) throw new Error('Coinbase returned invalid OHLCV values.')
    return c
  })
  return mergeCandles([], candles)
}
export function mergeCandles(
  base: MarketCandle[],
  patches: MarketCandle[],
  limit = 900,
): MarketCandle[] {
  const map = new Map(base.map((c) => [c.time, c]))
  for (const candle of patches) map.set(candle.time, candle)
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-limit)
}
export function aggregateCandles(candles: MarketCandle[], interval: Interval): MarketCandle[] {
  const buckets = new Map<number, MarketCandle>()
  for (const candle of mergeCandles([], candles, Number.MAX_SAFE_INTEGER)) {
    const time = bucketStart(candle.time, interval),
      previous = buckets.get(time)
    if (previous) {
      previous.high = Math.max(previous.high, candle.high)
      previous.low = Math.min(previous.low, candle.low)
      previous.close = candle.close
      previous.volume += candle.volume
    } else buckets.set(time, { ...candle, time })
  }
  // Gaps remain gaps. Never fabricate zero-volume OHLC bars for missing exchange data.
  return [...buckets.values()]
}
export function historyWindows(interval: Interval, limit: number, now: number) {
  const granularity = nativeGranularity(interval)
  const start = bucketStart(now / 1000, interval) - (limit - 1) * INTERVAL_SECONDS[interval]
  const end = Math.floor(now / 1000)
  const windows: { start: number; end: number }[] = []
  for (let cursor = start; cursor < end;) {
    const until = Math.min(end, cursor + 300 * granularity - 1)
    windows.push({ start: cursor, end: until })
    cursor = Math.floor(until / granularity) * granularity + granularity
  }
  return { start, end, granularity, windows }
}
export function parseProducts(value: unknown): CoinbaseProduct[] {
  if (!Array.isArray(value)) throw new Error('Coinbase returned an invalid product catalog.')
  const products = value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const p = raw as Record<string, unknown>,
      increment = finite(p.quote_increment)
    if (
      !isProductId(p.id) ||
      p.quote_currency !== 'USD' ||
      p.status !== 'online' ||
      p.trading_disabled === true ||
      p.cancel_only === true ||
      !increment ||
      increment <= 0
    )
      return []
    return [{ id: p.id, base: p.id.slice(0, -4), quote: 'USD' as const, increment }]
  })
  if (!products.length) throw new Error('No available Coinbase USD products were returned.')
  return [...new Map(products.map((p) => [p.id, p])).values()]
}
export function parseQuote(raw: unknown, updatedAt: number): MarketQuote {
  if (!raw || typeof raw !== 'object') throw new Error('Coinbase returned an invalid quote.')
  const q = raw as Record<string, unknown>,
    price = finite(q.price ?? q.last)
  if (price === null || price <= 0) throw new Error('Coinbase returned an invalid quote price.')
  const positive = (v: unknown) => {
    const n = finite(v)
    return n !== null && n > 0 ? n : null
  }
  const open = positive(q.open_24h ?? q.open),
    volume = finite(q.volume_24h ?? q.volume)
  return {
    price,
    open,
    high: positive(q.high_24h ?? q.high),
    low: positive(q.low_24h ?? q.low),
    volume: volume !== null && volume >= 0 ? volume : null,
    change: open ? (price / open - 1) * 100 : null,
    updatedAt,
    source: 'coinbase',
  }
}
export function isQuote(value: unknown): value is MarketQuote {
  if (!value || typeof value !== 'object') return false
  const q = value as MarketQuote
  return (
    q.source === 'coinbase' &&
    finite(q.price) !== null &&
    q.price > 0 &&
    Number.isFinite(q.updatedAt) &&
    [q.open, q.high, q.low, q.volume, q.change].every(
      (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
    )
  )
}
export function validateHistory(
  value: unknown,
  product: string,
  interval: Interval,
): HistorySnapshot {
  const h = value as HistorySnapshot
  if (
    !h ||
    h.source !== 'coinbase' ||
    h.product !== product ||
    h.interval !== interval ||
    !Number.isFinite(h.asOf) ||
    !Number.isFinite(h.revision) ||
    !Array.isArray(h.candles) ||
    h.candles.length > 900 ||
    h.candles.some(
      (c, i) =>
        !isCandle(c) ||
        bucketStart(c.time, interval) !== c.time ||
        (i > 0 && c.time <= h.candles[i - 1].time),
    )
  )
    throw new Error('The market service returned invalid chart data.')
  return h
}
export interface MarketTrade {
  product: string
  id: number
  time: number
  price: number
  size: number
  /**
   * Direction of the aggressor (taker), NOT the raw Coinbase `side` field.
   *
   * Coinbase documents `side` on a `match` as the **maker** order side: "If the side is sell this
   * indicates the maker was a sell order and the match is considered an up-tick." So a taker buy
   * arrives as `side: "sell"`. This field is already inverted to the taker's perspective, so
   * `'buy'` always means money went IN and `'sell'` always means money went OUT.
   *
   * `null`/absent when the upstream omitted or malformed `side`; such trades still count toward
   * OHLCV volume but are excluded from directional flow.
   */
  takerSide?: 'buy' | 'sell' | null
}
export function parseTrade(value: Record<string, unknown>): MarketTrade | null {
  const id = finite(value.trade_id),
    price = finite(value.price),
    size = finite(value.size)
  const time = typeof value.time === 'string' ? Date.parse(value.time) / 1000 : NaN
  // Invert the documented maker side into the taker/aggressor side.
  const takerSide = value.side === 'sell' ? 'buy' : value.side === 'buy' ? 'sell' : null
  return value.type === 'match' &&
    isProductId(value.product_id) &&
    id !== null &&
    Number.isInteger(id) &&
    id >= 0 &&
    price !== null &&
    price > 0 &&
    size !== null &&
    size > 0 &&
    Number.isFinite(time)
    ? { product: value.product_id, id, time, price, size, takerSide }
    : null
}
/** Tracks provisional live bars, with ID deduplication and chronological open/close. */
export class CandleTracker {
  bars: MarketCandle[]
  interval: Interval
  cutoff: number
  private ids = new Set<number>()
  private edges = new Map<number, { first: number; last: number }>()
  constructor(bars: MarketCandle[], interval: Interval, receivedAt: number) {
    this.bars = [...bars]
    this.interval = interval
    this.cutoff = receivedAt / 1000
  }
  seed(bars: MarketCandle[], receivedAt: number) {
    this.bars = mergeCandles(this.bars, bars)
    // A REST candle has no last-trade ID. Skip pre-receipt stream events to avoid
    // double-counting its volume. The short receipt gap stays provisional until
    // the authoritative REST reconciliation (also performed on reconnect).
    this.cutoff = receivedAt / 1000
    this.edges.clear()
    this.ids.clear()
  }
  apply(trade: MarketTrade): boolean {
    if (trade.time < this.cutoff || this.ids.has(trade.id)) return false
    this.ids.add(trade.id)
    if (this.ids.size > 10000) this.ids.delete(this.ids.values().next().value!)
    const time = bucketStart(trade.time, this.interval)
    let index = this.bars.length - 1
    while (index >= 0 && this.bars[index].time > time) index--
    const previous = this.bars[index]?.time === time ? this.bars[index] : undefined
    const edge = this.edges.get(time) ?? {
      first: previous ? time : trade.time,
      last: previous ? this.cutoff : trade.time,
    }
    const next = previous
      ? {
          ...previous,
          high: Math.max(previous.high, trade.price),
          low: Math.min(previous.low, trade.price),
          open: trade.time < edge.first ? trade.price : previous.open,
          close: trade.time >= edge.last ? trade.price : previous.close,
          volume: previous.volume + trade.size,
        }
      : {
          time,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.size,
        }
    edge.first = Math.min(edge.first, trade.time)
    edge.last = Math.max(edge.last, trade.time)
    this.edges.set(time, edge)
    if (previous) this.bars[index] = next
    else {
      this.bars.splice(index + 1, 0, next)
      if (this.bars.length > 900) this.bars.shift()
    }
    if (this.edges.size > 8) this.edges.delete(this.edges.keys().next().value!)
    return true
  }
}
/** Includes volume and historical corrections, not just the latest closing price. */
export function candleFingerprint(candles: MarketCandle[]): string {
  let hash = 2166136261
  for (const candle of candles)
    for (const value of [
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]) {
      for (const char of String(value)) {
        hash ^= char.charCodeAt(0)
        hash = Math.imul(hash, 16777619)
      }
      hash ^= 124
      hash = Math.imul(hash, 16777619)
    }
  return `${candles.length}:${(hash >>> 0).toString(16)}`
}
