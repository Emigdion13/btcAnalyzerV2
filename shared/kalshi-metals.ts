/**
 * Turning Kalshi's published precious-metal settlements into chart data.
 *
 * Kalshi runs a 15-minute up/down ladder on gold (`KXGOLD15M`) and silver
 * (`KXSILVER15M`) that settles on Pyth's 1-minute candlestick close for the metal.
 * Neither metal trades on Coinbase, so this ladder is the *only* price source the app
 * has for them — and it is an unusually good one, because every window publishes two
 * exact numbers:
 *
 *   - `floor_strike`     — the metal's price at the window open.
 *   - `expiration_value` — the metal's price at the window close.
 *
 * One window's settlement is the next window's strike, so a run of settled markets is an
 * exact price series sampled every quarter hour. That series is what becomes candles.
 *
 * Two consequences are carried through the whole module, because pretending otherwise
 * would put invented numbers on a chart:
 *
 *   1. **Resolution is 15 minutes.** Nothing finer exists, so 1m/3m/5m are rejected
 *      rather than resampled, and higher timeframes are aggregations of these bars.
 *   2. **A bar's high/low is the envelope of its two settlement points**, not the true
 *      intra-window range. Kalshi publishes no metal high or low, so the extremes shown
 *      are the tightest honest bound — the real range was at least this wide.
 *
 * Volume is zero for the same reason: Kalshi's `volume_fp` counts *contracts*, and
 * drawing contract turnover in a pane labelled as metal volume would be a lie.
 */
import {
  aggregateCandles,
  bucketStart,
  finite,
  INTERVAL_SECONDS,
  isCandle,
  type MarketCandle,
  type MarketQuote,
} from './coinbase.ts'
import {
  KALSHI_WINDOW_SECONDS,
  kalshiIsoSeconds,
  kalshiMarketRows,
  kalshiNumeric,
  roundStrike,
  type KalshiMetalFeed,
  type MetalInterval,
  type RawMarket,
} from './kalshi.ts'

/** One exact price Kalshi published at a quarter-hour boundary, unix seconds. */
export interface SettlementPoint {
  /** Boundary time, unix seconds. Always a multiple of 900. */
  time: number
  /** The metal's price at that boundary, in USD per troy ounce. */
  value: number
}

/**
 * How far back the metals service will page.
 *
 * Kalshi's gold ladder began in July 2026, so this comfortably covers the whole series
 * while bounding the work a 1W request can trigger: at 100 days the deepest fetch is
 * ~9,600 settled markets, ten pages of 1,000.
 */
export const METAL_MAX_LOOKBACK_SECONDS = 100 * 86_400

/** Settled pages are keyed on a coarse bucket so overlapping requests share them. */
export const METAL_LOOKBACK_BUCKET_SECONDS = 6 * 3_600

/** Round a lookback down to the cache bucket, so nearby requests reuse the same pages. */
export function quantizeMetalLookback(fromSec: number): number {
  if (!Number.isFinite(fromSec) || fromSec <= 0) return 0
  return Math.floor(fromSec / METAL_LOOKBACK_BUCKET_SECONDS) * METAL_LOOKBACK_BUCKET_SECONDS
}

/** Read a market's own rounding, falling back to the feed default. */
function digitsFor(market: { custom_strike?: unknown }, fallback: number): number {
  const custom = market.custom_strike as { round_digits?: unknown } | undefined
  const parsed = Number(custom?.round_digits)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 8 ? parsed : fallback
}

/**
 * Exact price points from one `/markets` payload.
 *
 * Settlements are preferred over strikes when both name the same boundary: the graded
 * `expiration_value` is final, while the neighbouring window's `floor_strike` is the same
 * number published a quarter hour earlier. Taking them in that order makes the result
 * independent of the order Kalshi returned the markets in.
 */
export function parseSettlementPoints(payload: unknown, feed: KalshiMetalFeed): SettlementPoint[] {
  const strikes = new Map<number, number>()
  const settlements = new Map<number, number>()
  for (const market of kalshiMarketRows(payload)) {
    const digits = digitsFor(market, feed.roundDigits)
    const open = kalshiIsoSeconds(market.open_time)
    const close = kalshiIsoSeconds(market.close_time)
    const strike = kalshiNumeric(market.floor_strike)
    // An unsettled window publishes `expiration_value: ""`, which reads as null.
    const settled = kalshiNumeric(market.expiration_value)
    if (open !== null && strike !== null) strikes.set(open, roundStrike(strike, digits))
    if (close !== null && settled !== null) settlements.set(close, roundStrike(settled, digits))
  }
  const merged = new Map<number, number>(strikes)
  for (const [time, value] of settlements) merged.set(time, value)
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }))
}

/** Merge several point runs into one sorted series, keeping the first value per boundary. */
export function mergeSettlementPoints(
  ...runs: readonly (readonly SettlementPoint[])[]
): SettlementPoint[] {
  const merged = new Map<number, number>()
  for (const run of runs)
    for (const point of run) if (!merged.has(point.time)) merged.set(point.time, point.value)
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }))
}

/**
 * Candles built from settlement points.
 *
 * A 15-minute bar exists only where two points sit exactly one window apart: `open` is the
 * earlier value, `close` the later, and high/low the envelope of the two. Where Kalshi
 * published nothing — a missing window, the start of the series — there is simply no bar.
 * Gaps stay gaps; a flat invented candle would be indistinguishable from a real quiet one.
 */
export function settlementCandles(
  points: readonly SettlementPoint[],
  interval: MetalInterval,
  limit = 900,
): MarketCandle[] {
  const bars: MarketCandle[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i],
      to = points[i + 1]
    if (to.time - from.time !== KALSHI_WINDOW_SECONDS) continue
    const open = from.value,
      close = to.value
    bars.push({
      time: from.time,
      open,
      close,
      // The tightest bound Kalshi's own numbers support — see the module header.
      high: Math.max(open, close),
      low: Math.min(open, close),
      volume: 0,
    })
  }
  const scaled = interval === '15m' ? bars : aggregateCandles(bars, interval)
  const count = Math.max(2, Math.min(900, Math.trunc(limit)))
  return scaled.slice(-count)
}

/** How much history the points actually cover. */
export interface MetalCoverage {
  /** Number of exact settlement points held. */
  points: number
  /** Oldest point, unix seconds, or null when nothing was published. */
  from: number | null
  /** Newest point, unix seconds, or null. */
  to: number | null
  /** Seconds between the newest point and now — the quote's real age. */
  ageSeconds: number
  /** True when the run reaches back as far as was asked, or hit the series start. */
  complete: boolean
}

export function metalCoverage(
  points: readonly SettlementPoint[],
  nowSec: number,
  complete: boolean,
): MetalCoverage {
  const oldest = points[0]?.time ?? null,
    newest = points.at(-1)?.time ?? null
  return {
    points: points.length,
    from: oldest,
    to: newest,
    ageSeconds: newest === null ? 0 : Math.max(0, Math.round(nowSec - newest)),
    complete,
  }
}

/**
 * A quote assembled from settlement points.
 *
 * Every field is a real published number or null. `price` is the newest settlement point,
 * which is up to a quarter hour old and says so through `updatedAt`; `open` is the newest
 * point at or before 24 hours ago, so `change` measures a genuine day rather than whatever
 * happens to be in the buffer. High and low are the 24-hour envelope of settlement points.
 * Volume is null: Kalshi counts contracts, not ounces.
 */
export function metalQuote(points: readonly SettlementPoint[]): MarketQuote | null {
  const newest = points.at(-1)
  if (!newest) return null
  const dayAgo = newest.time - 86_400
  let openPoint: SettlementPoint | null = null
  const window: SettlementPoint[] = []
  for (const point of points) {
    if (point.time <= dayAgo) openPoint = point
    else window.push(point)
  }
  const range = window.length ? window : [newest]
  let high = -Infinity,
    low = Infinity
  for (const point of range) {
    high = Math.max(high, point.value)
    low = Math.min(low, point.value)
  }
  return {
    price: newest.value,
    open: openPoint?.value ?? null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    volume: null,
    change: openPoint ? (newest.value / openPoint.value - 1) * 100 : null,
    updatedAt: newest.time * 1000,
    source: 'kalshi',
  }
}

/** Seconds until the current window settles, i.e. until the next point is published. */
export function secondsUntilSettlement(nowSec: number): number {
  const windowEnd = (Math.floor(nowSec / KALSHI_WINDOW_SECONDS) + 1) * KALSHI_WINDOW_SECONDS
  return Math.max(0, windowEnd - nowSec)
}

/** The settled range a request needs, clamped to what the service will page through. */
export function metalRequestRange(
  interval: MetalInterval,
  limit: number,
  nowSec: number,
): { from: number; to: number } {
  const step = INTERVAL_SECONDS[interval]
  const bars = Math.max(2, Math.min(900, Math.trunc(limit)))
  // One extra window, so the oldest bar has an opening point to be built from.
  const wanted = bucketStart(nowSec, interval) - (bars - 1) * step - KALSHI_WINDOW_SECONDS
  // A 1W/300 request would otherwise ask for six years of settled markets. Clamp to the
  // depth the service will walk; the response says so through `coverage.complete`.
  const floor = nowSec - METAL_MAX_LOOKBACK_SECONDS
  return { from: Math.max(0, wanted, floor), to: nowSec }
}

/** A contract price in dollars: finite and inside 0–1, or null. Zero is a valid "no trade". */
function contractDollars(value: unknown): number | null {
  const parsed = finite(value)
  return parsed === null || parsed < 0 || parsed > 1 ? null : parsed
}

/**
 * What the live market itself thinks, as a 0–1 chance of an UP close.
 *
 * This is a *contract* price, not a metal price — it belongs in the HUD next to the
 * window, never in the quote. A traded price wins; otherwise the quote midpoint.
 */
export function parseImpliedUp(market: RawMarket | null): number | null {
  if (!market) return null
  const last = contractDollars(market.last_price_dollars)
  if (last !== null && last > 0) return last
  const bid = contractDollars(market.yes_bid_dollars),
    ask = contractDollars(market.yes_ask_dollars)
  if (bid !== null && ask !== null && (bid > 0 || ask > 0)) return (bid + ask) / 2
  return null
}

/** The live window's published strike — the forming bar's open, which has no close yet. */
export interface MetalPendingWindow {
  windowStart: number
  windowEnd: number
  /** Exact price at the window open, i.e. the bar forming right now. */
  strike: number
  roundDigits: number
  ticker: string
  /** Verbatim settlement rule, so the UI can name Pyth rather than imply Coinbase. */
  rule: string
  /** True when a tie resolves UP (`strike_type: greater_or_equal`). */
  tieGoesUp: boolean
  /**
   * The live market's own price, 0–1, as the ladder's implied chance of an UP close.
   * A contract price, not a metal price — kept separate from the quote on purpose.
   */
  impliedUp: number | null
}

/** What `/api/kalshi/metals/history` returns. */
export interface KalshiMetalHistory {
  source: 'kalshi'
  symbol: string
  series: string
  /** The reference named in Kalshi's rule text, e.g. "PYTH_GOLD". */
  indexId: string
  interval: MetalInterval
  /** Bars built from settlement points. Fewer than requested is normal near the series start. */
  candles: MarketCandle[]
  /** The exact quarter-hour points the bars were built from. */
  points: SettlementPoint[]
  quote: MarketQuote | null
  /** The window forming now: its strike is known, its settlement is not. */
  pending: MetalPendingWindow | null
  roundDigits: number
  /** "troy ounce" — what one unit of this metal is. */
  unit: string
  coverage: MetalCoverage
  /** Unix ms the server assembled this. */
  asOf: number
  /** Human-readable state, surfaced verbatim in the UI. */
  message: string
}

export function isSettlementPoint(value: unknown): value is SettlementPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.time === 'number' &&
    Number.isInteger(p.time) &&
    p.time > 0 &&
    typeof p.value === 'number' &&
    Number.isFinite(p.value) &&
    p.value > 0
  )
}

/** A metal quote, validated. `isQuote` is Coinbase-only, so metals get their own guard. */
export function isMetalQuote(value: unknown): value is MarketQuote {
  if (!value || typeof value !== 'object') return false
  const q = value as MarketQuote
  return (
    q.source === 'kalshi' &&
    finite(q.price) !== null &&
    q.price > 0 &&
    Number.isFinite(q.updatedAt) &&
    q.volume === null &&
    [q.open, q.high, q.low, q.change].every(
      (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
    )
  )
}

function isPendingWindow(value: unknown): value is MetalPendingWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.windowStart === 'number' &&
    Number.isInteger(p.windowStart) &&
    typeof p.windowEnd === 'number' &&
    p.windowEnd === p.windowStart + KALSHI_WINDOW_SECONDS &&
    typeof p.strike === 'number' &&
    Number.isFinite(p.strike) &&
    p.strike > 0 &&
    typeof p.roundDigits === 'number' &&
    typeof p.ticker === 'string' &&
    typeof p.rule === 'string' &&
    typeof p.tieGoesUp === 'boolean' &&
    (p.impliedUp === null || (typeof p.impliedUp === 'number' && Number.isFinite(p.impliedUp)))
  )
}

function isCoverage(value: unknown): value is MetalCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.points === 'number' &&
    Number.isInteger(c.points) &&
    c.points >= 0 &&
    (c.from === null || (typeof c.from === 'number' && Number.isInteger(c.from))) &&
    (c.to === null || (typeof c.to === 'number' && Number.isInteger(c.to))) &&
    typeof c.ageSeconds === 'number' &&
    Number.isFinite(c.ageSeconds) &&
    typeof c.complete === 'boolean'
  )
}

/** Validate a metal history payload before anything is drawn from it. */
export function isKalshiMetalHistory(
  value: unknown,
  symbol?: string,
  interval?: string,
): value is KalshiMetalHistory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const h = value as Record<string, unknown>
  return (
    h.source === 'kalshi' &&
    (symbol === undefined || h.symbol === symbol) &&
    (interval === undefined || h.interval === interval) &&
    typeof h.series === 'string' &&
    typeof h.indexId === 'string' &&
    typeof h.unit === 'string' &&
    typeof h.roundDigits === 'number' &&
    Number.isFinite(h.asOf) &&
    typeof h.message === 'string' &&
    Array.isArray(h.candles) &&
    h.candles.length <= 900 &&
    h.candles.every(isCandle) &&
    Array.isArray(h.points) &&
    h.points.every(isSettlementPoint) &&
    (h.quote === null || isMetalQuote(h.quote)) &&
    (h.pending === null || isPendingWindow(h.pending)) &&
    isCoverage(h.coverage)
  )
}
