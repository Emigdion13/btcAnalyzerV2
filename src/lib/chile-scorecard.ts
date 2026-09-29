import { INTERVAL_SECONDS, bucketStart, type DataSource } from '../../shared/coinbase'
import {
  CHILE_KALSHI_AVERAGE_SECONDS,
  chileAboveProbability,
  chileKalshiStrike,
  type ChileKalshiBoundaries,
} from './chile-odds'
import type { ChileBarState, ChileCall, ChileReversalResult } from './chile-reversal'
import type { ChileReversalSettings, Timeframe } from './types'

/**
 * Chile scorecard — how often the panel has actually been right.
 *
 * Two things are graded, both from the engine's own bars so the grade is of the numbers the panel
 * showed:
 *
 * 1. **The V17 call.** Every round-close call (`official && confirmed`, the bar the original prints
 *    its label on) is about the round that opens as that bar closes. It is graded against that
 *    round's open → close. WAIT is recorded as an abstention and never scored.
 * 2. **The this-round odds.** Every closed chart bar inside a round carried a probability that the
 *    round would finish above its strike (`chile-odds.ts`); each one is graded against how the
 *    round did finish. On a Kalshi window that is the strike and the settlement Kalshi published;
 *    elsewhere the round's own open → close.
 *
 * Neither repaints: a round-close call reads only closed higher-timeframe bars plus a 5m bar that
 * closes with it, and a bar's odds are fixed once the bar has closed, so grading the loaded history
 * grades what the window said live. The V17 grades are also kept in a small saved journal per
 * profile, so the record outgrows the few hundred bars a chart loads. The RSI extremes have a
 * journal of their own (`chile-rsi-extreme.ts`).
 */

export interface ChileGradedCall {
  /** Open time of the round the call was about — the close of the bar it printed on. */
  roundStart: number
  call: ChileCall
  scoreUp: number
  scoreDown: number
  /** The graded round's open and close: the strike and the settlement. */
  open: number
  close: number
  outcome: 'up' | 'down' | 'flat'
}

export interface ChileOddsSample {
  roundStart: number
  secondsLeft: number
  probabilityAbove: number
  finishedAbove: boolean
}

export interface ChileCallStats {
  /** Calls whose round has finished, abstentions included. */
  graded: number
  waits: number
  /** Directional calls on a round that did not finish flat — the ones a hit rate is taken over. */
  scored: number
  correct: number
  hitRate: number | null
  /** 95% interval half-width of the hit rate. */
  margin: number | null
  up: { scored: number; correct: number }
  down: { scored: number; correct: number }
}

export interface ChileOddsStats {
  graded: number
  /** Samples where the favoured side won; a 50/50 sample favours nothing and is not counted. */
  correct: number
  hitRate: number | null
  /** Mean squared error of the probability: 0.25 for a constant coin flip, lower is better. */
  brier: number | null
}

interface RoundBars {
  byTime: Map<number, ChileBarState>
  chartSeconds: number
  roundSeconds: number
}

function roundBars(result: ChileReversalResult, chartTimeframe: Timeframe, resolution: Timeframe) {
  const chartSeconds = INTERVAL_SECONDS[chartTimeframe] ?? 60
  const roundSeconds = INTERVAL_SECONDS[resolution] ?? 900
  if (chartSeconds > roundSeconds) return null
  const byTime = new Map<number, ChileBarState>()
  for (const bar of result.bars) byTime.set(bar.time, bar)
  return { byTime, chartSeconds, roundSeconds } satisfies RoundBars
}

/**
 * The finished round that opens at `roundStart`: its first bar must be loaded (so `round.open` is
 * the real open, not a mid-round one) and its closing bar must have closed.
 */
function finishedRound(bars: RoundBars, roundStart: number) {
  const first = bars.byTime.get(roundStart)
  const closer = bars.byTime.get(roundStart + bars.roundSeconds - bars.chartSeconds)
  if (!first || !closer?.confirmed || closer.round.open === null) return null
  return { open: closer.round.open, close: closer.close }
}

/**
 * The finished rounds in the engine's loaded history, by open time: each one's open and close, or
 * null while it is unfinished or only partly loaded. Null when a chart bar spans several rounds.
 */
export function chileFinishedRounds(
  result: ChileReversalResult,
  chartTimeframe: Timeframe,
  resolution: Timeframe,
): ((roundStart: number) => { open: number; close: number } | null) | null {
  const bars = roundBars(result, chartTimeframe, resolution)
  return bars ? (roundStart) => finishedRound(bars, roundStart) : null
}

export function gradeChileCalls(
  result: ChileReversalResult,
  chartTimeframe: Timeframe,
  resolution: Timeframe,
): ChileGradedCall[] {
  const bars = roundBars(result, chartTimeframe, resolution)
  if (!bars) return []
  const graded: ChileGradedCall[] = []
  for (const bar of result.bars) {
    if (!bar.ready || !bar.official || !bar.confirmed) continue
    const roundStart = bar.time + bars.chartSeconds
    const round = finishedRound(bars, roundStart)
    if (!round) continue
    graded.push({
      roundStart,
      call: bar.call,
      scoreUp: bar.scoreUp,
      scoreDown: bar.scoreDown,
      open: round.open,
      close: round.close,
      outcome: round.close > round.open ? 'up' : round.close < round.open ? 'down' : 'flat',
    })
  }
  return graded
}

/**
 * Every closed bar's odds, graded. With Kalshi's boundaries each bar is played against the strike
 * Kalshi published and graded on the settlement it published (a tie resolves up, as Kalshi's does)
 * — the same numbers the live window showed — and rounds Kalshi has no record of are left out
 * rather than graded some other way.
 */
export function gradeChileOdds(
  result: ChileReversalResult,
  chartTimeframe: Timeframe,
  resolution: Timeframe,
  kalshi?: ChileKalshiBoundaries | null,
): ChileOddsSample[] {
  const bars = roundBars(result, chartTimeframe, resolution)
  if (!bars) return []
  const kalshiRounds = kalshi && bars.roundSeconds === 900 ? kalshi : null
  const samples: ChileOddsSample[] = []
  for (const bar of result.bars) {
    if (!bar.ready || !bar.confirmed || bar.round.move === null) continue
    const roundStart = bucketStart(bar.time, resolution)
    const secondsLeft = roundStart + bars.roundSeconds - (bar.time + bars.chartSeconds)
    // The bar that closes the round has nothing left to forecast.
    if (secondsLeft <= 0) continue
    if (kalshiRounds) {
      const strike = chileKalshiStrike(kalshiRounds, roundStart, bars.roundSeconds)
      const settlement = kalshiRounds.get(roundStart + bars.roundSeconds)
      const atr = result.atr[bar.index]
      if (strike === null || settlement === undefined || !(atr && atr > 0)) continue
      samples.push({
        roundStart,
        secondsLeft,
        probabilityAbove: chileAboveProbability(
          (bar.close - strike) / atr,
          secondsLeft,
          bars.roundSeconds,
          CHILE_KALSHI_AVERAGE_SECONDS,
        ),
        finishedAbove: settlement >= strike,
      })
      continue
    }
    const round = finishedRound(bars, roundStart)
    if (!round || round.close === round.open) continue
    samples.push({
      roundStart,
      secondsLeft,
      probabilityAbove: chileAboveProbability(bar.round.move, secondsLeft, bars.roundSeconds),
      finishedAbove: round.close > round.open,
    })
  }
  return samples
}

const margin95 = (p: number, n: number) => 1.96 * Math.sqrt((p * (1 - p)) / n)

export function chileCallStats(calls: ChileGradedCall[]): ChileCallStats {
  const up = { scored: 0, correct: 0 }
  const down = { scored: 0, correct: 0 }
  let waits = 0
  for (const entry of calls) {
    if (entry.call === 'wait') {
      waits++
      continue
    }
    if (entry.outcome === 'flat') continue
    const side = entry.call === 'up' ? up : down
    side.scored++
    if (entry.outcome === entry.call) side.correct++
  }
  const scored = up.scored + down.scored
  const correct = up.correct + down.correct
  const hitRate = scored ? correct / scored : null
  return {
    graded: calls.length,
    waits,
    scored,
    correct,
    hitRate,
    margin: hitRate === null ? null : margin95(hitRate, scored),
    up,
    down,
  }
}

export function chileOddsStats(samples: ChileOddsSample[]): ChileOddsStats {
  let correct = 0
  let squared = 0
  for (const sample of samples) {
    const p = sample.probabilityAbove
    if ((p > 0.5 && sample.finishedAbove) || (p < 0.5 && !sample.finishedAbove)) correct++
    squared += (p - (sample.finishedAbove ? 1 : 0)) ** 2
  }
  const graded = samples.length
  return {
    graded,
    correct,
    hitRate: graded ? correct / graded : null,
    brier: graded ? squared / graded : null,
  }
}

// --- the saved journal ------------------------------------------------------------------------

/** Graded calls kept per profile; about five days of 15-minute rounds. */
export const CHILE_JOURNAL_MAX_CALLS = 500
/** Profiles kept at once; the least recently updated is dropped first. */
export const CHILE_JOURNAL_MAX_PROFILES = 12

export interface ChileScorecardJournal {
  version: 1
  profiles: Record<string, { updatedAt: number; calls: ChileGradedCall[] }>
}

export const emptyChileScorecardJournal = (): ChileScorecardJournal => ({
  version: 1,
  profiles: {},
})

/**
 * One journal per profile: a call belongs to the market it was made on, the chart it was read off
 * (the local reads follow the chart timeframe) and every input that moves the score.
 */
export function chileScorecardKey(
  source: DataSource,
  ticker: string,
  chartTimeframe: Timeframe,
  settings: ChileReversalSettings,
): string {
  return [
    source,
    ticker,
    chartTimeframe,
    settings.resolution,
    settings.minScore,
    settings.minEdge,
    settings.trendFactor,
    settings.trendAtrLength,
    settings.pivotLeft,
    settings.pivotRight,
    settings.maxDistanceAtr,
  ].join('|')
}

const CALLS = new Set<unknown>(['up', 'down', 'wait'])
const OUTCOMES = new Set<unknown>(['up', 'down', 'flat'])

function isGradedCall(value: unknown): value is ChileGradedCall {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Number.isFinite(v.roundStart) &&
    CALLS.has(v.call) &&
    Number.isFinite(v.scoreUp) &&
    Number.isFinite(v.scoreDown) &&
    Number.isFinite(v.open) &&
    Number.isFinite(v.close) &&
    OUTCOMES.has(v.outcome)
  )
}

/** Whatever storage handed back, as a journal: malformed profiles and entries are dropped. */
export function sanitizeChileScorecardJournal(value: unknown): ChileScorecardJournal {
  const journal = emptyChileScorecardJournal()
  if (!value || typeof value !== 'object') return journal
  const profiles = (value as { version?: unknown; profiles?: unknown }).profiles
  if ((value as { version?: unknown }).version !== 1 || !profiles || typeof profiles !== 'object')
    return journal
  for (const [key, profile] of Object.entries(profiles as Record<string, unknown>)) {
    if (!profile || typeof profile !== 'object') continue
    const { updatedAt, calls } = profile as { updatedAt?: unknown; calls?: unknown }
    if (!Number.isFinite(updatedAt) || !Array.isArray(calls)) continue
    journal.profiles[key] = { updatedAt: updatedAt as number, calls: calls.filter(isGradedCall) }
  }
  return journal
}

/** Saved calls plus fresh ones: one entry per round (the fresh grade wins), oldest first, capped. */
export function mergeChileCalls(
  saved: ChileGradedCall[],
  fresh: ChileGradedCall[],
): ChileGradedCall[] {
  const byRound = new Map<number, ChileGradedCall>()
  for (const entry of saved) byRound.set(entry.roundStart, entry)
  for (const entry of fresh) byRound.set(entry.roundStart, entry)
  return [...byRound.values()]
    .sort((a, b) => a.roundStart - b.roundStart)
    .slice(-CHILE_JOURNAL_MAX_CALLS)
}

const sameCall = (a: ChileGradedCall | undefined, b: ChileGradedCall) =>
  a !== undefined &&
  a.roundStart === b.roundStart &&
  a.call === b.call &&
  a.outcome === b.outcome &&
  a.open === b.open &&
  a.close === b.close &&
  a.scoreUp === b.scoreUp &&
  a.scoreDown === b.scoreDown

/**
 * The journal with `fresh` recorded under `key`. Returns the same object when the merge would not
 * change the saved list, so a caller can skip the write — the engine re-runs on every tick. The
 * comparison is against the merged list, not the fresh one: a history longer than the cap would
 * otherwise re-offer rounds the cap has already dropped, and never settle.
 */
export function recordChileCalls(
  journal: ChileScorecardJournal,
  key: string,
  fresh: ChileGradedCall[],
  nowMs: number,
): ChileScorecardJournal {
  if (!fresh.length) return journal
  const saved = journal.profiles[key]?.calls ?? []
  const merged = mergeChileCalls(saved, fresh)
  if (merged.length === saved.length && merged.every((entry, i) => sameCall(saved[i], entry)))
    return journal

  const profiles = { ...journal.profiles, [key]: { updatedAt: nowMs, calls: merged } }
  const keep = Object.entries(profiles)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, CHILE_JOURNAL_MAX_PROFILES)
  return { version: 1, profiles: Object.fromEntries(keep) }
}
