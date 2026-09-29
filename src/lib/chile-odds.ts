import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import type { ChileBarState } from './chile-reversal'
import { normalCdf } from './price-forecast'
import type { Timeframe } from './types'

/**
 * Chile odds — where THIS round finishes against its open.
 *
 * The V17 call is about the next round. Once a round is under way, the question a trader holding a
 * 15-minute up/down contract actually has is different: does this round close above the price it
 * opened at? Most of the answer is already on the screen — how far price has moved from the open,
 * and how little time is left for it to come back — so the odds are a driftless walk from the
 * current price to the round close:
 *
 *   P(close > open) = Φ(Δ / (σ · √(τ / S)))
 *
 * with Δ the move from the round open in round ATR (the engine's `round.move`), τ the seconds left,
 * S the round length and σ one round's close-to-close spread in round ATR.
 *
 * The V17 score is deliberately not in the formula. On 120 days of Coinbase BTC-USD (June–September
 * 2026, 23,037 mid-round bar closes) a logistic fit gave the score a small negative weight once Δ
 * and τ were known, and it improved the out-of-sample log loss by 0.0007 — nothing. The odds say
 * what the distance and the clock say, and the panel shows the V17 call beside them.
 */

/**
 * One round's close-to-close spread, in round ATR(14). Maximum-likelihood fit on the June–September
 * 2026 tape: 0.61 on a 5m chart, 0.65 on a 1m chart. Out of sample, rounds the odds put at 70–80%
 * finished above their open 75.8% of the time.
 */
export const CHILE_ROUND_SIGMA_ATR = 0.63

/**
 * The odds never claim more than 97/3 while the round is open. The fitted walk is slightly
 * overconfident in its tails (a 3.8% prediction finished above 6.6% of the time), and the last
 * Coinbase trade is not the print a contract settles on.
 */
export const CHILE_ODDS_CAP = 0.97

export type ChileOddsState = 'live' | 'closed' | 'unavailable'

export interface ChileRoundOdds {
  state: ChileOddsState
  /** The round the odds are about, by its open time. */
  roundStart: number | null
  /** The round open — the strike this round is played against. */
  strike: number | null
  price: number | null
  /** Move from the open in round ATR; positive when price is above it. */
  deltaAtr: number | null
  /** Seconds until the round closes; 0 once it has. */
  secondsLeft: number
  /** P(the round closes above its open). 1 or 0 once closed; null when there is nothing to read. */
  probabilityAbove: number | null
  /** The side the odds favour; null at an exact coin flip and when unavailable. */
  favoured: 'above' | 'below' | null
}

/** The probability behind the odds, on its own so the scorecard grades the same number. */
export function chileAboveProbability(
  deltaAtr: number,
  secondsLeft: number,
  roundSeconds: number,
): number {
  if (!(secondsLeft > 0)) return deltaAtr > 0 ? 1 : deltaAtr < 0 ? 0 : 0.5
  // Exactly on the open is exactly even; the erf approximation is 5e-10 off at zero, which would
  // otherwise favour a side.
  if (deltaAtr === 0) return 0.5
  const remaining = Math.min(secondsLeft, roundSeconds) / Math.max(roundSeconds, 1)
  const p = normalCdf(deltaAtr / (CHILE_ROUND_SIGMA_ATR * Math.sqrt(remaining)))
  return Math.min(CHILE_ODDS_CAP, Math.max(1 - CHILE_ODDS_CAP, p))
}

export interface ChileRoundOddsInput {
  /** The engine's newest bar. */
  bar: ChileBarState | null
  /** The clock the round is timed against — see `chileMarkerNowSeconds`. */
  nowSeconds: number
  resolution: Timeframe
  chartTimeframe: Timeframe
}

const unavailable = (secondsLeft = 0): ChileRoundOdds => ({
  state: 'unavailable',
  roundStart: null,
  strike: null,
  price: null,
  deltaAtr: null,
  secondsLeft,
  probabilityAbove: null,
  favoured: null,
})

export function chileRoundOdds(input: ChileRoundOddsInput): ChileRoundOdds {
  const { bar } = input
  const roundSeconds = INTERVAL_SECONDS[input.resolution] ?? 900
  const chartSeconds = INTERVAL_SECONDS[input.chartTimeframe] ?? 60
  // A chart bar longer than the round holds several rounds: there is no single open to play.
  if (chartSeconds > roundSeconds) return unavailable()
  if (!bar?.ready || bar.round.open === null || bar.round.move === null) return unavailable()

  const roundStart = bucketStart(bar.time, input.resolution)
  const secondsLeft = Math.max(0, Math.floor(roundStart + roundSeconds - input.nowSeconds))
  const probabilityAbove = chileAboveProbability(bar.round.move, secondsLeft, roundSeconds)
  return {
    state: secondsLeft > 0 ? 'live' : 'closed',
    roundStart,
    strike: bar.round.open,
    price: bar.close,
    deltaAtr: bar.round.move,
    secondsLeft,
    probabilityAbove,
    favoured: probabilityAbove > 0.5 ? 'above' : probabilityAbove < 0.5 ? 'below' : null,
  }
}
