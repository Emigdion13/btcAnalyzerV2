/**
 * Kalshi's 15-minute up/down market, as the data a floating indicator needs.
 *
 * This is the web port of the logic in `Kalshi-15min/kalshi_flotante.py` (the
 * standalone floating window). The pieces it adds on top of the strike work in
 * `kalshi.ts`:
 *
 *   - The UP % Kalshi displays. Kalshi does NOT show the bid, the ask, or the
 *     midpoint: it shows the LAST TRADE price, clamped to the current bid/ask
 *     (deduced by the original author from two real observations — with bid/ask
 *     70/71 the app showed 70, and with 44/45 the web showed 45; only the last
 *     trade explains both). See `floatChance`.
 *   - The payout multipliers ("1.38x"), which are the net of Kalshi's taker fee:
 *     `1 / (ask + 0.07 * fee_multiplier * ask * (1 - ask))`. See `floatPayout`.
 *   - The "Now" price: the live index Kalshi settles on, read from the same
 *     endpoint its own page uses. Public but UNDOCUMENTED — if it ever stops
 *     answering, crypto falls back to a Coinbase print (labelled approximate)
 *     and the metals simply show no value.
 *   - The live bid/ask come from `/markets/{ticker}/orderbook` and
 *     `/markets/trades`, which are not cached. The `/markets` LIST that carries
 *     them is served by Kalshi from a 15-second CloudFront cache, so the list is
 *     only a labelled fallback, never the primary source.
 */
import { kalshiIsoSeconds, kalshiMarketRows, type RawMarket } from './kalshi.ts'

/** Kalshi's taker fee, per contract: 0.07 * fee_multiplier * P * (1 - P). */
export const KALSHI_FEE = 0.07

/** Older than this and the numbers stop being drawn as live. */
export const KALSHI_FLOAT_STALE_MS = 6_000

/** A market record, plus the fields only the floating indicator reads. */
export interface FloatMarket extends RawMarket {
  /** The strike, as Kalshi spells it in the UI, e.g. "$80,787.61". */
  yes_sub_title?: unknown
  no_ask_dollars?: unknown
}

/** Best executable prices for one market, from the live order book. */
export interface KalshiFloatBook {
  yesBid: number | null
  yesAsk: number | null
  noAsk: number | null
}

/** What `/api/kalshi/float` returns to the client. */
export interface KalshiFloatResponse {
  source: 'kalshi'
  product: string
  series: string
  /** The running market's ticker, or null when no contract is open. */
  ticker: string | null
  /** The strike Kalshi settles on, or null until it is published. */
  target: number | null
  /** Decimal places Kalshi prints this coin's prices with. */
  decimals: number
  /** Window open, unix seconds; null when no market. */
  open: number | null
  /** Window close (the cut), unix seconds; null when no market. */
  close: number | null
  /** The UP % as Kalshi displays it, 1..99; null with no prices at all. */
  upPct: number | null
  /** 100 - upPct, or null. */
  downPct: number | null
  /** Net payout per $1 bought at the up ask; null when there is no ask. */
  upX: number | null
  /** Net payout per $1 bought at the down ask; null when there is no ask. */
  downX: number | null
  /** The live settlement index value, or null when unavailable. */
  now: number | null
  /** Where `now` came from. */
  nowSource: 'kalshi' | 'coinbase' | null
  /** True when the index answered but had no ticks (underlying paused). */
  quiet: boolean
  /** How the % was read: the live order book, or the cached market list. */
  pctSource: 'book' | 'list' | null
  /** Unix ms when the server took its newest reading. */
  asOf: number
  /** Human-readable state, surfaced verbatim in the window's footer. */
  message: string
}

export function isKalshiFloatResponse(value: unknown): value is KalshiFloatResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  const numOrNull = (v: unknown): boolean =>
    v === null || (typeof v === 'number' && Number.isFinite(v))
  return (
    r.source === 'kalshi' &&
    typeof r.product === 'string' &&
    typeof r.series === 'string' &&
    (r.ticker === null || typeof r.ticker === 'string') &&
    numOrNull(r.target) &&
    typeof r.decimals === 'number' &&
    (r.open === null || (typeof r.open === 'number' && Number.isInteger(r.open))) &&
    (r.close === null || (typeof r.close === 'number' && Number.isInteger(r.close))) &&
    (r.upPct === null ||
      (typeof r.upPct === 'number' && r.upPct >= 1 && r.upPct <= 99)) &&
    (r.downPct === null ||
      (typeof r.downPct === 'number' && r.downPct >= 0 && r.downPct <= 99)) &&
    (r.upX === null || (typeof r.upX === 'number' && r.upX >= 1)) &&
    (r.downX === null || (typeof r.downX === 'number' && r.downX >= 1)) &&
    numOrNull(r.now) &&
    (r.nowSource === null || r.nowSource === 'kalshi' || r.nowSource === 'coinbase') &&
    typeof r.quiet === 'boolean' &&
    (r.pctSource === null || r.pctSource === 'book' || r.pctSource === 'list') &&
    typeof r.asOf === 'number' &&
    typeof r.message === 'string'
  )
}

/**
 * The UP % as Kalshi displays it: the last trade price, clamped to the current
 * bid/ask spread.
 *
 *   - last inside the spread  -> that price (the app shows the trade, not the quote)
 *   - last outside the spread -> the nearest edge (the book moved without a print)
 *   - no last trade yet       -> the midpoint when both sides quote, else one side
 *
 * An open market is never 0 or 100.
 */
export function floatChance(
  bid: number | null,
  ask: number | null,
  last: number | null,
): number | null {
  const lo = bid ?? 0
  const hi = ask ?? 1
  let p: number | null
  if (last !== null) p = Math.min(Math.max(last, lo), hi)
  else if (bid !== null && ask !== null) p = (bid + ask) / 2
  else p = bid ?? ask
  if (p === null) return null
  return Math.max(1, Math.min(99, Math.floor(p * 100 + 0.5 + 1e-9)))
}

/**
 * What $1 buys at `ask`, net of Kalshi's taker fee — the "x" Kalshi prints under
 * each side. With `ask` 0.71 and the default multiplier of 1 that is 1.38x; with
 * 0.30 it is 3.18x. Both verified against the Kalshi UI by the original author.
 */
export function floatPayout(ask: number | null, feeMultiplier: number): number | null {
  if (ask === null || !(ask > 0 && ask < 1)) return null
  return 1 / (ask + KALSHI_FEE * feeMultiplier * ask * (1 - ask))
}

/**
 * The best executable prices for a market, from Kalshi's live order book.
 *
 * The book carries only BUY orders on each side; the yes ask is derived as
 * 1 - best no bid and vice versa. Returns null when the payload has no book at
 * all — that must fall back to the market list WITH a warning, while an empty
 * book (no levels) is a real "no quotes" and yields nulls per side.
 */
export function parseFloatOrderbook(payload: unknown): KalshiFloatBook | null {
  if (!payload || typeof payload !== 'object') return null
  const body = payload as { orderbook_fp?: unknown; orderbook?: unknown }
  let ob = body.orderbook_fp
  if (ob === null || ob === undefined) ob = body.orderbook
  if (!ob || typeof ob !== 'object' || Array.isArray(ob)) return null
  const book = ob as Record<string, unknown>
  const best = (side: 'yes' | 'no'): number | null => {
    let levels: unknown = book[`${side}_dollars`]
    let scale = 1
    if (levels === null || levels === undefined) {
      levels = book[side]
      scale = 0.01 // the pre-dollars format prices in cents
    }
    if (!Array.isArray(levels)) return null
    let top: number | null = null
    for (const level of levels) {
      if (!Array.isArray(level) || level.length < 2) continue
      const price = Number(level[0])
      const size = Number(level[1])
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue
      // The legacy path scales cents (70 * 0.01) back to dollars; round to the
      // format's own precision so 70 cents is exactly 0.70, not 0.7000000000000001.
      const scaled = scale === 1 ? price : Math.round(price * scale * 1e4) / 1e4
      if (top === null || scaled > top) top = scaled
    }
    return top
  }
  const yesBid = best('yes')
  const noBid = best('no')
  return {
    yesBid,
    yesAsk: noBid === null ? null : Math.round((1 - noBid) * 1e4) / 1e4,
    noAsk: yesBid === null ? null : Math.round((1 - yesBid) * 1e4) / 1e4,
  }
}

/** The yes price of the most recent trade, or null when there is none. */
export function parseLastTradePrice(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const trades = (payload as { trades?: unknown }).trades
  if (!Array.isArray(trades) || !trades.length) return null
  const first = trades[0]
  if (!first || typeof first !== 'object') return null
  const row = first as Record<string, unknown>
  const dollars = Number(row.yes_price_dollars)
  if (Number.isFinite(dollars) && dollars > 0 && dollars < 1) return dollars
  const cents = Number(row.yes_price)
  if (Number.isFinite(cents) && cents > 0) return cents / 100
  return null
}

/**
 * The newest point of the live index feed.
 *
 * Returns the price, or `'quiet'` when the feed answered but has no points in
 * the last ten seconds (the underlying is paused — normal outside trading
 * hours, not a failure), or null when the response is unreadable.
 *
 * The feed emits a point every second even when the value does not change, so
 * an empty list means the feed is stopped, not "no movement".
 */
export function parseLiveIndexTick(payload: unknown): number | 'quiet' | null {
  if (!payload || typeof payload !== 'object') return null
  const points = (payload as { timeseries?: unknown }).timeseries
  if (!Array.isArray(points) || !points.length) return 'quiet'
  const last = points[points.length - 1]
  const value =
    last && typeof last === 'object' ? Number((last as Record<string, unknown>).v) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The series' fee multiplier, only when its fee is quadratic (the shape every
 * 15-minute ladder publishes). Anything else reads as 1 — the same assumption
 * the floating window makes when the series lookup fails.
 */
export function parseFeeMultiplier(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 1
  const series = (payload as { series?: unknown }).series
  if (!series || typeof series !== 'object') return 1
  const row = series as Record<string, unknown>
  if (typeof row.fee_type !== 'string' || !row.fee_type.startsWith('quadratic')) return 1
  const value = Number(row.fee_multiplier)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * The market that is running NOW: the window Kalshi opened at the last
 * quarter-hour boundary.
 *
 * Two rules the standalone window learned the hard way:
 *   - a window that has opened in the future has no strike yet; the RUNNING
 *     window wins over it, so a stale list carrying only the next market never
 *     replaces the live one (the clock governs);
 *   - among the rest the nearest close wins.
 */
export function selectFloatMarket(payload: unknown, nowSec: number): FloatMarket | null {
  const rows = kalshiMarketRows(payload)
  const live = rows.filter((m) => {
    const close = kalshiIsoSeconds(m.close_time)
    return close !== null && close > nowSec
  }) as FloatMarket[]
  if (!live.length) return null
  const running = live.filter((m) => {
    const open = kalshiIsoSeconds(m.open_time)
    return open !== null && open <= nowSec
  })
  const pool = running.length ? running : live
  pool.sort(
    (a, b) => (kalshiIsoSeconds(a.close_time) ?? 0) - (kalshiIsoSeconds(b.close_time) ?? 0),
  )
  return pool[0]
}

/** Decimal places for a raw price, the way Kalshi prints sub-dollar coins. */
export function decimalsFor(price: number | null): number {
  if (price === null || price >= 100) return 2
  return price >= 1 ? 4 : 6
}

/**
 * The decimal places Kalshi prints this market's prices with, read off the
 * market's own subtitle ("Target Price: $80,787.61") so the window never
 * disagrees with the strike line.
 */
export function floatDecimals(market: FloatMarket | null, target: number | null): number {
  const sub = market?.yes_sub_title
  if (typeof sub === 'string') {
    const match = sub.match(/\$[\d,]+(?:\.(\d+))?/)
    if (match) return match[1]?.length ?? 0
  }
  return decimalsFor(target)
}

/**
 * The symbol the live index feed serves for a product.
 *
 * Crypto uses the bare coin name (BTC, ETH ...); the metals use the Pyth feed
 * names the same way Kalshi's own page does (gold answers as `Metal.Index.1OZGOLD/USD`).
 */
const METAL_LIVE_SYMBOLS: Record<string, string> = {
  'XAU-USD': 'PYTH:GOLD',
  'XAG-USD': 'PYTH:SILVER',
}

export function floatLiveSymbol(product: string): string {
  return METAL_LIVE_SYMBOLS[product] ?? product.replace(/-USD$/, '')
}
