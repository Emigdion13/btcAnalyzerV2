/**
 * Kalshi's 15-minute crypto up/down markets, and the index they actually settle on.
 *
 * Kalshi does NOT settle these markets on a Coinbase print. The rule text on every
 * KX*15M market reads:
 *
 *   "If the simple average of the sixty seconds of CF Benchmarks' BRTI before
 *    5:15 PM EDT ... is at least the simple average of the sixty seconds of CF
 *    Benchmarks' BRTI before 5:00 PM EDT ..., then the market resolves to Yes."
 *
 * So the strike is a 60-second average of a multi-venue index, not an instantaneous
 * single-exchange trade. This module is the shared vocabulary for that fact: both the
 * server (which fetches Kalshi's published numbers) and the client (which draws them)
 * import it, so neither can drift into re-deriving the strike from candles alone.
 *
 * Two fields on every market record carry the truth:
 *   - `floor_strike`      — the strike, i.e. the 60s index average ending at open.
 *   - `expiration_value`  — the settlement, i.e. the 60s average ending at close.
 * Because one window's `expiration_value` is the next window's `floor_strike`, a run
 * of settled markets yields an exact index series at every quarter hour, for free.
 */

/** Length of one Kalshi 15-minute up/down window, in seconds. */
export const KALSHI_WINDOW_SECONDS = 900

/** Where the strike came from. Only 'kalshi' and 'brti' are authoritative. */
export type KalshiStrikeSource =
  /** Kalshi's published `floor_strike` — exact by definition. */
  | 'kalshi'
  /** CF Benchmarks index value obtained directly (requires an API key). */
  | 'brti'
  /** Local candle-open estimate. Close, but not the number Kalshi settles on. */
  | 'estimate'

/** One coin's Kalshi series and the CF Benchmarks index behind it. */
export interface KalshiCoinFeed {
  /** Coinbase product id this feed maps onto, e.g. "BTC-USD". */
  product: string
  /** Kalshi series ticker, e.g. "KXBTC15M". */
  series: string
  /** CF Benchmarks index id as the API spells it, e.g. "ETHUSD_RTI". */
  indexId: string
  /** The same index as Kalshi's rule text spells it, e.g. "ETHUSDRTI". */
  ruleName: string
  /** Fallback decimal places; the market record's own value wins. */
  roundDigits: number
}

/**
 * Kalshi's 15-minute crypto ladder. Seven coins, each with its own CF Benchmarks
 * real-time index. BTC is the historic odd one out — its index predates the
 * `{COIN}USD_RTI` naming and is simply `BRTI`.
 *
 * Rounding is per-coin and NOT constant: BTC and ETH publish 2 decimals, HYPE
 * publishes 4. Never hardcode it — read `custom_strike.round_digits` off the market.
 */
export const KALSHI_COIN_FEEDS: readonly KalshiCoinFeed[] = [
  { product: 'BTC-USD', series: 'KXBTC15M', indexId: 'BRTI', ruleName: 'BRTI', roundDigits: 2 },
  {
    product: 'ETH-USD',
    series: 'KXETH15M',
    indexId: 'ETHUSD_RTI',
    ruleName: 'ETHUSDRTI',
    roundDigits: 2,
  },
  {
    product: 'SOL-USD',
    series: 'KXSOL15M',
    indexId: 'SOLUSD_RTI',
    ruleName: 'SOLUSDRTI',
    roundDigits: 2,
  },
  {
    product: 'XRP-USD',
    series: 'KXXRP15M',
    indexId: 'XRPUSD_RTI',
    ruleName: 'XRPUSDRTI',
    roundDigits: 4,
  },
  {
    product: 'DOGE-USD',
    series: 'KXDOGE15M',
    indexId: 'DOGEUSD_RTI',
    ruleName: 'DOGEUSDRTI',
    roundDigits: 5,
  },
  {
    product: 'HYPE-USD',
    series: 'KXHYPE15M',
    indexId: 'HYPEUSD_RTI',
    ruleName: 'HYPEUSDRTI',
    roundDigits: 4,
  },
  {
    product: 'BNB-USD',
    series: 'KXBNB15M',
    indexId: 'BNBUSD_RTI',
    ruleName: 'BNBUSDRTI',
    roundDigits: 2,
  },
]

const FEEDS_BY_PRODUCT = new Map(KALSHI_COIN_FEEDS.map((feed) => [feed.product, feed]))
const FEEDS_BY_SERIES = new Map(KALSHI_COIN_FEEDS.map((feed) => [feed.series, feed]))

/** The Kalshi feed for a Coinbase product, or null when Kalshi runs no 15m market on it. */
export function kalshiFeedForProduct(product: string): KalshiCoinFeed | null {
  return FEEDS_BY_PRODUCT.get(product) ?? null
}

/** The Kalshi feed for a series ticker, or null. */
export function kalshiFeedForSeries(series: string): KalshiCoinFeed | null {
  return FEEDS_BY_SERIES.get(series) ?? null
}

/** The 15-minute window containing `nowSec`, as unix seconds. */
export function kalshiWindowBounds(nowSec: number): { windowStart: number; windowEnd: number } {
  const windowStart = Math.floor(nowSec / KALSHI_WINDOW_SECONDS) * KALSHI_WINDOW_SECONDS
  return { windowStart, windowEnd: windowStart + KALSHI_WINDOW_SECONDS }
}

/** Round a strike the way Kalshi publishes it. */
export function roundStrike(value: number, digits: number): number {
  const scale = 10 ** Math.max(0, Math.min(8, Math.trunc(digits)))
  return Math.round(value * scale) / scale
}

/** Kalshi's published strike for one live window. */
export interface KalshiStrike {
  product: string
  series: string
  indexId: string
  /** Market ticker, e.g. "KXBTC15M-26SEP131715-15". */
  ticker: string
  /** Window open, unix seconds. */
  windowStart: number
  /** Window close — the cut, unix seconds. */
  windowEnd: number
  /** The exact strike: 60s index average ending at `windowStart`. */
  strike: number
  /** Decimals Kalshi rounds this coin to. */
  roundDigits: number
  /** Verbatim settlement rule, so the UI can show what it is actually measuring. */
  rule: string
  /** True when a tie resolves UP (`strike_type: greater_or_equal`). */
  tieGoesUp: boolean
  /** Unix ms when we read it from Kalshi. */
  fetchedAt: number
}

/** An exact index value pinned to a quarter-hour boundary. */
export interface BrtiAnchor {
  /** Boundary time, unix seconds. */
  time: number
  /** 60-second index average ending at `time`. */
  value: number
  indexId: string
}

/** A single CF Benchmarks index sample, from the authenticated passthrough. */
export interface BrtiSample {
  /** Sample time, unix seconds. */
  time: number
  /** Index value at that instant. */
  value: number
}

/** What `/api/kalshi/strike` returns to the client. */
export interface KalshiStrikeResponse {
  source: 'kalshi'
  product: string
  series: string
  indexId: string
  /** The exact published strike for the live window, or null when unavailable. */
  strike: KalshiStrike | null
  /** Exact index values pinned to quarter-hour boundaries, from settled markets. */
  anchors: BrtiAnchor[]
  /** Denser index samples; only present with an entitled Kalshi API key. */
  samples: BrtiSample[] | null
  /** True when the authenticated CF Benchmarks passthrough is configured. */
  keyed: boolean
  /** Unix ms the server assembled this. */
  asOf: number
  /** Human-readable state, surfaced verbatim in the UI. */
  message: string
}

export function isBrtiSample(value: unknown): value is BrtiSample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.time === 'number' &&
    Number.isInteger(s.time) &&
    s.time > 0 &&
    typeof s.value === 'number' &&
    Number.isFinite(s.value) &&
    s.value > 0
  )
}

export function isKalshiStrikeResponse(value: unknown): value is KalshiStrikeResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    r.source === 'kalshi' &&
    typeof r.product === 'string' &&
    typeof r.series === 'string' &&
    typeof r.indexId === 'string' &&
    (r.strike === null || isKalshiStrike(r.strike)) &&
    Array.isArray(r.anchors) &&
    r.anchors.every(isBrtiAnchor) &&
    (r.samples === null || (Array.isArray(r.samples) && r.samples.every(isBrtiSample))) &&
    typeof r.keyed === 'boolean' &&
    Number.isFinite(r.asOf) &&
    typeof r.message === 'string'
  )
}

/**
 * Best local estimate of Kalshi's strike when the published value is unavailable.
 *
 * Kalshi averages the index over the 60 seconds *before* the boundary, so an honest
 * estimate has to average too. Taking the boundary candle's `open` — what a naive
 * strike line does — inherits the whole of the previous minute's drift: measured
 * against Kalshi's published `floor_strike` over live windows it carried a mean bias
 * of +$3.30 and a max error of $9.09 on BTC. Averaging the preceding minute instead
 * cut the mean bias to −$0.06.
 *
 * Returns null rather than a guess whenever the candle grid is too coarse to resolve
 * a 60-second window, because a wrong strike drawn confidently is worse than no line.
 */
export function estimateStrikeFromCandles(
  candles: readonly { time: number; open: number; high: number; low: number; close: number }[],
  windowStart: number,
  stepSeconds: number,
): number | null {
  if (!candles.length || !Number.isFinite(windowStart) || stepSeconds <= 0) return null
  // A 60-second averaging window needs sub-minute candles to be resolved at all.
  if (stepSeconds > 60) return null
  const from = windowStart - 60
  let sum = 0
  let count = 0
  for (const candle of candles) {
    // Bucket the candle falls in: [time, time + step) must sit inside [from, windowStart).
    if (candle.time < from || candle.time + stepSeconds > windowStart) continue
    const typical = (candle.open + candle.high + candle.low + candle.close) / 4
    if (!Number.isFinite(typical) || typical <= 0) continue
    sum += typical
    count++
  }
  // Require the minute to be fully covered; a partial average is a partial lie.
  if (!count || count * stepSeconds < 60) return null
  return sum / count
}

export function isKalshiStrike(value: unknown): value is KalshiStrike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.product === 'string' &&
    typeof s.series === 'string' &&
    typeof s.indexId === 'string' &&
    typeof s.ticker === 'string' &&
    typeof s.windowStart === 'number' &&
    Number.isInteger(s.windowStart) &&
    typeof s.windowEnd === 'number' &&
    Number.isInteger(s.windowEnd) &&
    s.windowEnd === s.windowStart + KALSHI_WINDOW_SECONDS &&
    typeof s.strike === 'number' &&
    Number.isFinite(s.strike) &&
    s.strike > 0 &&
    typeof s.roundDigits === 'number' &&
    s.roundDigits >= 0 &&
    s.roundDigits <= 8 &&
    typeof s.rule === 'string' &&
    typeof s.tieGoesUp === 'boolean' &&
    Number.isFinite(s.fetchedAt)
  )
}

export function isBrtiAnchor(value: unknown): value is BrtiAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.time === 'number' &&
    Number.isInteger(a.time) &&
    a.time > 0 &&
    typeof a.value === 'number' &&
    Number.isFinite(a.value) &&
    a.value > 0 &&
    typeof a.indexId === 'string'
  )
}

/** Kalshi sends prices as JSON numbers on some fields and strings on others. */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function isoToSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

interface RawMarket {
  ticker?: unknown
  open_time?: unknown
  close_time?: unknown
  floor_strike?: unknown
  expiration_value?: unknown
  strike_type?: unknown
  rules_primary?: unknown
  custom_strike?: unknown
}

/** Every market record in a Kalshi `/markets` envelope, loosely typed. */
function rawMarkets(payload: unknown): RawMarket[] {
  if (!payload || typeof payload !== 'object') return []
  const markets = (payload as { markets?: unknown }).markets
  return Array.isArray(markets)
    ? (markets.filter((m) => m && typeof m === 'object') as RawMarket[])
    : []
}

/**
 * The market that governs `nowSec`: the most recently opened window whose strike is
 * already published. A window opened in the future has no strike yet, and one whose
 * strike is still blank is not tradeable as a reference — both are skipped rather
 * than guessed at.
 */
export function selectKalshiMarket(payload: unknown, nowSec: number): RawMarket | null {
  let best: RawMarket | null = null
  let bestStart = -Infinity
  for (const market of rawMarkets(payload)) {
    const open = isoToSeconds(market.open_time)
    const strike = numeric(market.floor_strike)
    if (open === null || strike === null) continue
    // Only windows that have already opened, and none further back than one full day.
    if (open > nowSec || open < nowSec - 86_400) continue
    if (open > bestStart) {
      best = market
      bestStart = open
    }
  }
  return best
}

/** Parse the live strike for `feed` out of a Kalshi `/markets` response. */
export function parseKalshiStrike(
  payload: unknown,
  feed: KalshiCoinFeed,
  nowSec: number,
  fetchedAt: number,
): KalshiStrike | null {
  const market = selectKalshiMarket(payload, nowSec)
  if (!market) return null
  const strike = numeric(market.floor_strike)
  const windowStart = isoToSeconds(market.open_time)
  const windowEnd = isoToSeconds(market.close_time)
  if (strike === null || windowStart === null) return null
  // Kalshi states the close; fall back to the fixed 15-minute window if it does not.
  const end = windowEnd ?? windowStart + KALSHI_WINDOW_SECONDS
  if (end !== windowStart + KALSHI_WINDOW_SECONDS) return null
  const custom = market.custom_strike as { round_digits?: unknown } | undefined
  const parsedDigits = Number(custom?.round_digits)
  const roundDigits =
    Number.isInteger(parsedDigits) && parsedDigits >= 0 && parsedDigits <= 8
      ? parsedDigits
      : feed.roundDigits
  const ticker = typeof market.ticker === 'string' ? market.ticker : ''
  if (!ticker) return null
  return {
    product: feed.product,
    series: feed.series,
    indexId: feed.indexId,
    ticker,
    windowStart,
    windowEnd: end,
    strike: roundStrike(strike, roundDigits),
    roundDigits,
    rule: typeof market.rules_primary === 'string' ? market.rules_primary : '',
    // Kalshi uses `greater_or_equal` on this ladder: a dead-even tie resolves UP.
    tieGoesUp: market.strike_type !== 'greater',
    fetchedAt,
  }
}

/**
 * Exact index values pinned to quarter-hour boundaries, read off settled markets.
 *
 * Each market contributes its strike at open and its settlement at close. Consecutive
 * windows share a boundary — one window settles at exactly the value the next strikes
 * against — so duplicates are collapsed rather than double-counted.
 */
export function parseBrtiAnchors(payload: unknown, feed: KalshiCoinFeed): BrtiAnchor[] {
  const found = new Map<number, number>()
  for (const market of rawMarkets(payload)) {
    const open = isoToSeconds(market.open_time)
    const close = isoToSeconds(market.close_time)
    const strike = numeric(market.floor_strike)
    const settled = numeric(market.expiration_value)
    if (open !== null && strike !== null) found.set(open, strike)
    if (close !== null && settled !== null) found.set(close, settled)
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({
      time,
      value: roundStrike(value, feed.roundDigits),
      indexId: feed.indexId,
    }))
}
