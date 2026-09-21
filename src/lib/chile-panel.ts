import { INTERVAL_SECONDS } from '../../shared/coinbase'
import type { ChileReversalSettings } from './types'
import type {
  ChileBarState,
  ChileCall,
  ChileLevelState,
  ChileReversalResult,
  ChileScoreFactor,
  ChileTrend,
  ChileVolume,
} from './chile-reversal'

/**
 * Chile panel — the readout half of "ROBEX IA CHILERA V17 PRO".
 *
 * The engine (`lib/chile-reversal.ts`) is the script: it scores every bar and calls the next
 * round. This module is the Pine `table` — the corner panel that shows that call, the countdown to
 * the round close, each side's share of the score and the handful of readings beside it — as data
 * the floating window can render. It computes nothing the engine has not already computed, so the
 * window and the chart can never disagree.
 */

export interface ChileRoundClock {
  totalSeconds: number
  /** `mm:ss` to the next round close. */
  text: string
  /** Pine's `colorTiempo` thresholds: red at 60 s, amber at 180 s. */
  urgency: 'steady' | 'closing' | 'final'
}

export interface ChilePanelSnapshot {
  /** False while something the score needs is still missing. */
  ready: boolean
  /** What is missing, so the window says so instead of showing zeros. */
  waitingOn: 'data' | 'round-feed' | 'warmup' | null
  call: ChileCall
  scoreUp: number
  scoreDown: number
  /** Pine `fuerzaArriba`/`fuerzaAbajo`: each side's share of the total, in percent. */
  fuerzaArriba: number
  fuerzaAbajo: number
  /** Pine `ventaja`: the signed gap, positive when the up side leads. */
  advantage: number
  /** Pine `mercadoLateral` — both calls are suppressed while it holds. */
  lateral: boolean
  /**
   * True when the newest chart bar closes a round. Pine only prints its labels on those bars
   * (`fin15 and barstate.isconfirmed`); the panel's live call runs on every bar.
   */
  official: boolean
  clock: ChileRoundClock
  /** The scored contributions behind `scoreUp`/`scoreDown`, strongest first. */
  factors: ChileScoreFactor[]
  buyers: number
  sellers: number
  volumeRatio: number
  volume: ChileVolume
  rsiRound: number | null
  rsiLocal: number | null
  trend: ChileTrend
  /** Pine `trendTexto`: supertrend and the round EMA cross have to agree to name a trend. */
  trendLabel: 'ALCISTA' | 'BAJISTA' | 'MIXTA'
  supertrendUp: boolean | null
  level: ChileLevelState
  /** Pine `srTexto`. */
  levelLabel: string
  round: ChileBarState['round']
}

export interface ChilePanelInput {
  /** The engine's result for these candles and settings. */
  result: ChileReversalResult
  settings: ChileReversalSettings
  /** Seconds, wall clock on a live feed. Drives the countdown only. */
  nowSeconds: number
}

const pad = (value: number) => (value < 10 ? `0${value}` : String(value))

/**
 * Seconds to the next round close, matching Pine's `time("15") + 15 * 60 * 1000 - timenow` for
 * UTC-aligned buckets. The urgency thresholds are the original's `colorTiempo` cuts.
 */
export function chileRoundClock(nowSeconds: number, roundSeconds: number): ChileRoundClock {
  const safe = Math.max(roundSeconds, 1)
  const boundary = (Math.floor(nowSeconds / safe) + 1) * safe
  const totalSeconds = Math.max(0, Math.floor(boundary - nowSeconds))
  return {
    totalSeconds,
    text: `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`,
    urgency: totalSeconds <= 60 ? 'final' : totalSeconds <= 180 ? 'closing' : 'steady',
  }
}

/**
 * The panel's read on the newest chart bar — the Pine `table` rendered on `barstate.islast`, which
 * is why it shows the live call on the forming bar rather than waiting for a round close.
 */
export function chilePanelSnapshot(input: ChilePanelInput): ChilePanelSnapshot {
  const { result, settings } = input
  const roundSeconds = INTERVAL_SECONDS[settings.resolution] ?? 900
  const clock = chileRoundClock(input.nowSeconds, roundSeconds)
  const last = result.last

  const waitingOn: ChilePanelSnapshot['waitingOn'] = !result.bars.length
    ? 'data'
    : result.missingFeed
      ? 'round-feed'
      : !last?.ready
        ? 'warmup'
        : null

  if (!last || waitingOn)
    return {
      ready: false,
      waitingOn,
      call: 'wait',
      scoreUp: 0,
      scoreDown: 0,
      fuerzaArriba: 0,
      fuerzaAbajo: 0,
      advantage: 0,
      lateral: false,
      official: false,
      clock,
      factors: [],
      buyers: 50,
      sellers: 50,
      volumeRatio: 1,
      volume: 'normal',
      rsiRound: null,
      rsiLocal: null,
      trend: 'mixed',
      trendLabel: 'MIXTA',
      supertrendUp: null,
      level: 'none',
      levelLabel: 'SIN NIVEL CERCANO',
      round: {
        open: null,
        high: null,
        low: null,
        position: null,
        move: null,
        strong: false,
        up: false,
      },
    }

  return {
    ready: true,
    waitingOn: null,
    call: last.call,
    scoreUp: last.scoreUp,
    scoreDown: last.scoreDown,
    fuerzaArriba: last.fuerzaArriba,
    fuerzaAbajo: last.fuerzaAbajo,
    advantage: last.advantage,
    lateral: last.lateral,
    official: last.official,
    clock,
    factors: last.factors,
    buyers: last.buyers,
    sellers: last.sellers,
    volumeRatio: last.volumeRatio,
    volume: last.volume,
    rsiRound: last.rsiRound,
    rsiLocal: last.rsiLocal,
    trend: last.trend,
    trendLabel: last.trendLabel,
    supertrendUp: last.supertrendUp,
    level: last.level,
    levelLabel: last.levelLabel,
    round: last.round,
  }
}
