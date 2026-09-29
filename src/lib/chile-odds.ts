import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import type { ChileBarState } from './chile-reversal'
import { normalCdf } from './price-forecast'
import type { Timeframe } from './types'

/**
 * Chile odds — where THIS round finishes against its strike.
 *
 * The V17 call is about the next round. Once a round is under way, the question a trader holding a
 * 15-minute up/down contract actually has is different: does this round settle above the price it
 * is played against? Most of the answer is already on the screen — how far price has moved from
 * the strike, and how little time is left for it to come back — so the odds are a driftless walk
 * from the current price to the settlement:
 *
 *   P(settle > strike) = Φ(Δ / (σ · √(τ / S)))
 *
 * with Δ the distance from the strike in round ATR, τ the seconds of price movement still to come,
 * S the round length and σ one round's close-to-close spread in round ATR.
 *
 * Two strikes, two settlements. A 15-minute round on a pair Kalshi lists is played the way Kalshi
 * settles it: against Kalshi's published strike (the 60-second BRTI average ending at the open,
 * which the Coinbase open missed by $12.60 on average for BTC) and to a 60-second average ending
 * at the close, which leaves less movement to come than the clock says. Everywhere else the strike
 * is the round's own open and the settlement its last print.
 *
 * On 60 days of Kalshi KXBTC15M (August–September 2026, graded on Kalshi's own results) the two
 * changes took the odds' Brier score from 0.1644 to 0.1615. Kalshi's own price scored 0.1583 over
 * the same minutes — the market is still the better forecaster, which is why the panel shows it.
 *
 * The V17 score is deliberately not in the formula. On 120 days of Coinbase BTC-USD a logistic fit
 * gave the score a small negative weight once Δ and τ were known, and neither it nor any of the 38
 * indicator readings tested later improved the out-of-sample log loss.
 */

/**
 * One round's close-to-close spread, in round ATR(14). Maximum-likelihood fit on the June–September
 * 2026 tape: 0.61 on a 5m chart, 0.65 on a 1m chart. Refitted against Kalshi's strike and
 * settlement it came out at 0.61 and scored no better out of sample, so it stays.
 */
export const CHILE_ROUND_SIGMA_ATR = 0.63

/**
 * The odds never claim more than 97/3 while the round is open. The fitted walk is slightly
 * overconfident in its tails (a 3.8% prediction finished above 6.6% of the time), and the last
 * Coinbase trade is not the print a contract settles on.
 */
export const CHILE_ODDS_CAP = 0.97

/** Kalshi's crypto 15-minute markets settle on the average of the last 60 seconds of BRTI. */
export const CHILE_KALSHI_AVERAGE_SECONDS = 60

/**
 * The seconds of price movement still to come, when the settlement is the average of the last
 * `averageSeconds` of the round rather than its final print.
 *
 * The average of a random walk over its last A seconds moves like the walk would over A/3 of them,
 * so with τ ≥ A left there are τ − 2A/3 seconds' worth of movement to come. Inside the averaging
 * window part of the average has already printed; it is taken to have printed at the current
 * price (a chart bar cannot resolve seconds), which leaves the remaining τ seconds weighted by
 * τ/A: τ³/(3A²) seconds' worth. The two meet at A/3 when τ = A.
 */
export function chileEffectiveSecondsLeft(secondsLeft: number, averageSeconds = 0): number {
  if (!(secondsLeft > 0)) return 0
  if (!(averageSeconds > 0)) return secondsLeft
  if (secondsLeft >= averageSeconds) return secondsLeft - (2 * averageSeconds) / 3
  return secondsLeft ** 3 / (3 * averageSeconds ** 2)
}

export type ChileOddsState = 'live' | 'closed' | 'unavailable'

/** What the round is played against: Kalshi's published strike, or the round's own open. */
export type ChileStrikeSource = 'kalshi' | 'open'

export interface ChileRoundOdds {
  state: ChileOddsState
  /** The round the odds are about, by its open time. */
  roundStart: number | null
  /** The price this round is played against. */
  strike: number | null
  strikeSource: ChileStrikeSource | null
  price: number | null
  /** Distance from the strike in round ATR; positive when price is above it. */
  deltaAtr: number | null
  /** Seconds until the round closes; 0 once it has. */
  secondsLeft: number
  /** P(the round settles above its strike). 1 or 0 once closed; null when there is nothing to read. */
  probabilityAbove: number | null
  /** The side the odds favour; null at an exact coin flip and when unavailable. */
  favoured: 'above' | 'below' | null
}

/** The probability behind the odds, on its own so the scorecard grades the same number. */
export function chileAboveProbability(
  deltaAtr: number,
  secondsLeft: number,
  roundSeconds: number,
  averageSeconds = 0,
): number {
  if (!(secondsLeft > 0)) return deltaAtr > 0 ? 1 : deltaAtr < 0 ? 0 : 0.5
  // Exactly on the strike is exactly even; the erf approximation is 5e-10 off at zero, which would
  // otherwise favour a side.
  if (deltaAtr === 0) return 0.5
  const effective = chileEffectiveSecondsLeft(Math.min(secondsLeft, roundSeconds), averageSeconds)
  const remaining = effective / Math.max(roundSeconds, 1)
  const p = normalCdf(deltaAtr / (CHILE_ROUND_SIGMA_ATR * Math.sqrt(remaining)))
  return Math.min(CHILE_ODDS_CAP, Math.max(1 - CHILE_ODDS_CAP, p))
}

/**
 * Kalshi's published boundary values for the pair on screen: each window's strike, which is also
 * the settlement of the window before it (both are the 60-second index average ending at that
 * quarter hour). Keyed by the boundary's unix seconds.
 */
export type ChileKalshiBoundaries = ReadonlyMap<number, number>

/**
 * Kalshi's strike for the round opening at `roundStart`, when the round is one of its 15-minute
 * windows and the value has been published; null means the round is played against its open.
 */
export function chileKalshiStrike(
  kalshi: ChileKalshiBoundaries | null | undefined,
  roundStart: number,
  roundSeconds: number,
): number | null {
  if (!kalshi || roundSeconds !== 900) return null
  const strike = kalshi.get(roundStart)
  return strike !== undefined && Number.isFinite(strike) && strike > 0 ? strike : null
}

export interface ChileRoundOddsInput {
  /** The engine's newest bar. */
  bar: ChileBarState | null
  /** That bar's round ATR (`ChileReversalResult.atr[bar.index]`); needed to play Kalshi's strike. */
  atr?: number | null
  /** The clock the round is timed against — see `chileMarkerNowSeconds`. */
  nowSeconds: number
  resolution: Timeframe
  chartTimeframe: Timeframe
  /** Kalshi's boundaries, when the round is a Kalshi 15-minute market; null plays the open. */
  kalshi?: ChileKalshiBoundaries | null
}

const unavailable = (secondsLeft = 0): ChileRoundOdds => ({
  state: 'unavailable',
  roundStart: null,
  strike: null,
  strikeSource: null,
  price: null,
  deltaAtr: null,
  secondsLeft,
  probabilityAbove: null,
  favoured: null,
})

export function chileRoundOdds(input: ChileRoundOddsInput): ChileRoundOdds {
  const { bar, atr } = input
  const roundSeconds = INTERVAL_SECONDS[input.resolution] ?? 900
  const chartSeconds = INTERVAL_SECONDS[input.chartTimeframe] ?? 60
  // A chart bar longer than the round holds several rounds: there is no single open to play.
  if (chartSeconds > roundSeconds) return unavailable()
  if (!bar?.ready || bar.round.open === null || bar.round.move === null) return unavailable()

  const roundStart = bucketStart(bar.time, input.resolution)
  const secondsLeft = Math.max(0, Math.floor(roundStart + roundSeconds - input.nowSeconds))
  const kalshiStrike =
    typeof atr === 'number' && atr > 0
      ? chileKalshiStrike(input.kalshi, roundStart, roundSeconds)
      : null
  const deltaAtr = kalshiStrike === null ? bar.round.move : (bar.close - kalshiStrike) / atr!
  const probabilityAbove = chileAboveProbability(
    deltaAtr,
    secondsLeft,
    roundSeconds,
    kalshiStrike === null ? 0 : CHILE_KALSHI_AVERAGE_SECONDS,
  )
  return {
    state: secondsLeft > 0 ? 'live' : 'closed',
    roundStart,
    strike: kalshiStrike ?? bar.round.open,
    strikeSource: kalshiStrike === null ? 'open' : 'kalshi',
    price: bar.close,
    deltaAtr,
    secondsLeft,
    probabilityAbove,
    favoured: probabilityAbove > 0.5 ? 'above' : probabilityAbove < 0.5 ? 'below' : null,
  }
}
