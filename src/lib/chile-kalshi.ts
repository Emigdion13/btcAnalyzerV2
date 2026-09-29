import { INTERVAL_SECONDS, type DataSource } from '../../shared/coinbase'
import { isMetalFeed, kalshiFeedForProduct, type KalshiStrikeResponse } from '../../shared/kalshi'
import type { KalshiFloatResponse } from '../../shared/kalshi-float'
import type { ChileKalshiBoundaries } from './chile-odds'
import type { Timeframe } from './types'

/**
 * Chile ↔ Kalshi — what the Chile panel reads off Kalshi's 15-minute market on the pair on screen.
 *
 * Two feeds the app already polls for other windows, reshaped for the panel:
 *
 * - `/api/kalshi/strike` — the live window's published strike and the exact index values Kalshi
 *   put on the record at recent quarter hours (each window's strike, which is also the previous
 *   window's settlement). They play the odds against the strike Kalshi uses and grade them on the
 *   result Kalshi published.
 * - `/api/kalshi/float` — the running market's price, which the panel shows beside its own odds
 *   because it has been the better forecaster, and the fee-inclusive cost of each side, which the
 *   RSI-extremes journal records so the signal is graded against what it would have cost.
 */

/**
 * True when the panel's round is a Kalshi crypto window: a 15-minute round on a real feed of a pair
 * Kalshi lists, charted at 15 minutes or finer. The metal ladders are left out — they settle on a
 * Pyth one-minute candle close, not a 60-second index average.
 */
export function chileKalshiEligible(
  product: string,
  source: DataSource,
  resolution: Timeframe,
  chartTimeframe: Timeframe,
): boolean {
  if (source === 'demo' || resolution !== '15m') return false
  if ((INTERVAL_SECONDS[chartTimeframe] ?? Infinity) > 900) return false
  const feed = kalshiFeedForProduct(product)
  return feed !== null && !isMetalFeed(feed)
}

/** The running Kalshi market, as the panel reads it. */
export interface ChileKalshiMarket {
  /** Window open, unix seconds — the round this price is for. */
  open: number
  /** The UP % as Kalshi displays it, 1–99; null with no prices at all. */
  upPct: number | null
  /** What $1 of payout costs at the ask, Kalshi's taker fee included (1 / Kalshi's "x"). */
  upCost: number | null
  downCost: number | null
  /** True once this client stopped receiving fresh snapshots. */
  stale: boolean
}

export interface ChileKalshiView {
  boundaries: ChileKalshiBoundaries
  market: ChileKalshiMarket | null
}

/**
 * Both responses for `product`, as one view. A response for another pair — a product switch can
 * leave the previous one in state for a frame — is ignored, and so is everything when neither has
 * answered yet.
 */
export function chileKalshiView(
  product: string,
  strike: KalshiStrikeResponse | null,
  float: KalshiFloatResponse | null,
  floatStale: boolean,
): ChileKalshiView | null {
  const strikeFor = strike?.product === product ? strike : null
  const floatFor = float?.product === product ? float : null
  if (!strikeFor && !floatFor) return null

  const boundaries = new Map<number, number>()
  for (const anchor of strikeFor?.anchors ?? []) boundaries.set(anchor.time, anchor.value)
  if (strikeFor?.strike) boundaries.set(strikeFor.strike.windowStart, strikeFor.strike.strike)
  if (floatFor?.open !== null && floatFor?.open !== undefined && floatFor.target !== null)
    boundaries.set(floatFor.open, floatFor.target)

  const market: ChileKalshiMarket | null =
    floatFor && floatFor.open !== null
      ? {
          open: floatFor.open,
          upPct: floatFor.upPct,
          upCost: floatFor.upX === null ? null : 1 / floatFor.upX,
          downCost: floatFor.downX === null ? null : 1 / floatFor.downX,
          stale: floatStale,
        }
      : null
  return { boundaries, market }
}
