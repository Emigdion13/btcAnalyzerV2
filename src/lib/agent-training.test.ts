/**
 * Agent training harness — where the main-chart AI's knowledge comes from.
 *
 * Replays real BTC-USD history bar-by-bar through the exact production loop:
 *   analyze (candles → specialists → horizon forecast) → journal → settle at the
 *   horizon → learn → the next forecast weights itself with what was learned.
 *
 * Every forecast is strictly causal: it only ever sees the prefix of the tape up
 * to the bar it is made on, the strike is the level that was actually live then,
 * and the outcome is whatever the next `horizonBars` bars printed. Learning
 * accumulates in chronological order, so the final state is this file's output:
 * `agent-pretrained.ts`, the prior every fresh install starts from.
 *
 * Higher-timeframe context is rebuilt by aggregating the same series into closed
 * buckets, which is what a live context feed shows minus the forming bar — the
 * harness never looks ahead to build it.
 *
 * The report this test prints is the behavioral record: for each scenario, how
 * often the strike call was right, how well the probabilities were calibrated
 * (Brier), how close the projected drift landed, and how each specialist's trust
 * ended up.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FORECAST_HORIZON_BARS,
  analyzeMarket,
  defaultAgentLearningState,
  type AgentLearningState,
  type ContextSignal,
} from './market-agents'
import { agentContextTimeframes } from './agent-journal'
import {
  defaultAgentPredictionJournal,
  recordAgentPrediction,
  resolveAgentPredictionJournal,
  type AgentPredictionJournal,
} from './agent-journal'
import type { Candle, Timeframe } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(here, 'macd-training-data')
const SNAPSHOT_PATH = join(here, 'agent-pretrained.ts')

const SYMBOL = 'BTC-USD'
const SOURCE = 'coinbase' as const
const WARMUP_BARS = 60
const SNAPSHOT_UPDATED_AT = '2026-09-10T00:00:00.000Z'

interface Scenario {
  file: string
  label: string
  timeframe: Timeframe
  /**
   * The strike window a trader would actually be playing on that resolution:
   * the 15-minute game on intraday charts, a 4-hour window on 1h candles and a
   * weekly one on daily candles — always a window that spans several bars.
   */
  strikeMinutes: number
}

/** Chronological: broad history first, most recent last. */
const SCENARIOS: Scenario[] = [
  {
    file: 'btc-usd-1D.json',
    label: '1D trailing year (Sep25-Sep26)',
    timeframe: '1D',
    strikeMinutes: 7 * 24 * 60,
  },
  {
    file: 'btc-usd-1h-2024-11.json',
    label: '1h Nov-2024 election rally',
    timeframe: '1h',
    strikeMinutes: 240,
  },
  { file: 'btc-usd-1h.json', label: '1h recent (Aug-Sep26)', timeframe: '1h', strikeMinutes: 240 },
  { file: 'btc-usd-15m.json', label: '15m recent (Sep26)', timeframe: '15m', strikeMinutes: 15 },
  { file: 'btc-usd-5m.json', label: '5m recent (Sep26)', timeframe: '5m', strikeMinutes: 15 },
  {
    file: 'btc-usd-1m-2026-09-03.json',
    label: '1m volatile (Sep03)',
    timeframe: '1m',
    strikeMinutes: 15,
  },
  { file: 'btc-usd-1m.json', label: '1m recent (Sep26)', timeframe: '1m', strikeMinutes: 15 },
]

/** Coinbase rows are [time, low, high, open, close, volume], newest-first. */
function loadCandles(file: string): Candle[] {
  const rows = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as number[][]
  const ascending = [...rows].sort((a, b) => a[0] - b[0])
  ascending.pop() // newest candle may still be forming
  return ascending.map(([time, low, high, open, close, volume]) => ({
    time,
    open,
    high,
    low,
    close,
    volume,
  }))
}

/** Collapse candles into `factor`-bar buckets, keeping only buckets that closed. */
function aggregate(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles
  const span = factor * (candles.length > 1 ? candles[1].time - candles[0].time : 60)
  const out: Candle[] = []
  let current: Candle | null = null
  let bucketStart = Number.NaN
  for (const candle of candles) {
    const start = Math.floor(candle.time / span) * span
    if (!current || start !== bucketStart) {
      if (current) out.push(current)
      bucketStart = start
      current = { ...candle }
      continue
    }
    current.high = Math.max(current.high, candle.high)
    current.low = Math.min(current.low, candle.low)
    current.close = candle.close
    current.volume += candle.volume
  }
  // The trailing bucket is still forming: a live context feed would show it, the
  // harness deliberately does not, so nothing here can peek at a partial bar.
  return out
}

const TIMEFRAME_SECONDS: Partial<Record<Timeframe, number>> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
}

/** Higher-timeframe context from the same tape, aggregated into closed buckets. */
function contextSignals(
  candles: Candle[],
  timeframe: Timeframe,
  learning: AgentLearningState,
): ContextSignal[] {
  const base = TIMEFRAME_SECONDS[timeframe] ?? 60
  const signals: ContextSignal[] = []
  for (const contextTimeframe of agentContextTimeframes(timeframe)) {
    const contextSeconds = TIMEFRAME_SECONDS[contextTimeframe]
    if (!contextSeconds) continue
    const factor = Math.round(contextSeconds / base)
    if (factor < 2) continue
    const contextCandles = aggregate(candles, factor)
    if (contextCandles.length < 30) continue
    try {
      const analysis = analyzeMarket(
        { candles: contextCandles, timeframe: contextTimeframe },
        learning,
      )
      signals.push({
        timeframe: contextTimeframe,
        bias: analysis.bias,
        score: analysis.score,
        confidence: analysis.confidence,
        regime: analysis.regime,
      })
    } catch {
      // Not enough history for that frame yet — no context, exactly like a cold feed.
    }
  }
  return signals
}

/**
 * The strike that was live on this bar: the open of the candle that opened the
 * window this bar sits in, on the window grid a trader would be playing. This is
 * the same definition the strike indicator draws, reconstructed causally.
 */
function trainingStrike(candles: Candle[], index: number, minutes: number) {
  const intervalSec = Math.max(60, minutes * 60)
  const candle = candles[index]
  const windowStart = Math.floor(candle.time / intervalSec) * intervalSec
  const opener = candles.find((entry) => entry.time >= windowStart && entry.time < candle.time + 1)
  const price = opener?.open ?? candle.open
  if (!Number.isFinite(price) || price <= 0) return null
  return {
    price,
    windowStart,
    windowEnd: windowStart + intervalSec,
    secondsLeft: Math.max(0, windowStart + intervalSec - candle.time),
    expiryLabel: new Date((windowStart + intervalSec) * 1000).toISOString().slice(11, 16),
    provisional: false,
    label: `${minutes}min window`,
  }
}

interface ScenarioReport {
  label: string
  timeframe: Timeframe
  bars: number
  forecasts: number
  resolved: number
  strikeEntries: number
  strikeHits: number
  /** Entries that had a strike line but called neither side — the honest coin flips. */
  strikeAbstains: number
  /**
   * Same call, split by when it was made: the first half of the tape against the second.
   * The weights adapt as the replay runs, so a late half that holds up is the honest
   * read — the early half is the cold-start prior.
   */
  firstHalf: { decided: number; hits: number }
  secondHalf: { decided: number; hits: number }
  /** Brier score of the ensemble's finish-above probability; lower is better, 0.25 = coin flip. */
  brier: number | null
  /** Mean absolute drift error, in ATR, against the realized move over the horizon. */
  driftError: number | null
  touchCalls: number
  touchHits: number
  meanProbability: number | null
  meanConfidence: number
  pathCounts: Record<string, number>
  agents: Record<string, { skill: number; samples: number }>
}

interface TrainingResult {
  learning: AgentLearningState
  reports: ScenarioReport[]
}

function runScenario(
  scenario: Scenario,
  learning: AgentLearningState,
): { report: ScenarioReport; learning: AgentLearningState } {
  const all = loadCandles(scenario.file)
  const horizonBars = FORECAST_HORIZON_BARS[scenario.timeframe] ?? 10
  let journal: AgentPredictionJournal = defaultAgentPredictionJournal()
  let current = learning
  const report: ScenarioReport = {
    label: scenario.label,
    timeframe: scenario.timeframe,
    bars: Math.max(0, all.length - WARMUP_BARS),
    forecasts: 0,
    resolved: 0,
    strikeEntries: 0,
    strikeHits: 0,
    strikeAbstains: 0,
    firstHalf: { decided: 0, hits: 0 },
    secondHalf: { decided: 0, hits: 0 },
    brier: null,
    driftError: null,
    touchCalls: 0,
    touchHits: 0,
    meanProbability: null,
    meanConfidence: 0,
    pathCounts: {},
    agents: {},
  }
  let brierSum = 0
  let brierCount = 0
  let driftErrorSum = 0
  let driftErrorCount = 0
  let probabilitySum = 0
  let confidenceSum = 0

  for (let index = WARMUP_BARS; index < all.length; index++) {
    const candles = all.slice(0, index + 1)
    // Settle what the tape has already answered before asking the next question.
    const settled = resolveAgentPredictionJournal(journal, current, {
      source: SOURCE,
      symbol: SYMBOL,
      timeframe: scenario.timeframe,
      candles,
    })
    journal = settled.journal
    current = settled.learning
    for (const entry of settled.resolved) {
      report.resolved++
      const forecast = entry.forecast
      if (!forecast) continue
      if (entry.strike != null) {
        if (forecast.strikeSide) report.strikeEntries++
        else report.strikeAbstains++
        if (entry.strikeResult === 'correct') report.strikeHits++
      }
      if (forecast.strikeSide && entry.strikeResult) {
        const bucket =
          entry.candleTime <= all[Math.floor(all.length / 2)].time
            ? report.firstHalf
            : report.secondHalf
        bucket.decided++
        if (entry.strikeResult === 'correct') bucket.hits++
      }
      if (forecast.finishAboveProbability !== null && entry.actualStrikeSide) {
        brierSum +=
          (forecast.finishAboveProbability - (entry.actualStrikeSide === 'above' ? 1 : 0)) ** 2
        brierCount++
        probabilitySum += forecast.finishAboveProbability
      }
      if (entry.actualDriftAtr != null) {
        driftErrorSum += Math.abs(forecast.driftAtr - entry.actualDriftAtr)
        driftErrorCount++
      }
      if (forecast.strikeTouch && entry.touchedStrike != null) {
        report.touchCalls++
        if (entry.touchedStrike) report.touchHits++
      }
    }

    const strike = trainingStrike(candles, index, scenario.strikeMinutes)
    let analysis
    try {
      analysis = analyzeMarket(
        {
          candles,
          timeframe: scenario.timeframe,
          context: contextSignals(candles, scenario.timeframe, current),
          strike,
          horizonBars,
        },
        current,
      )
    } catch {
      continue
    }
    report.forecasts++
    report.meanConfidence += analysis.forecast.confidence
    confidenceSum += analysis.forecast.confidence
    report.pathCounts[analysis.forecast.path] = (report.pathCounts[analysis.forecast.path] ?? 0) + 1
    journal = recordAgentPrediction(journal, {
      source: SOURCE,
      symbol: SYMBOL,
      timeframe: scenario.timeframe,
      candles,
      analysis,
      horizonBars,
      strike:
        strike && !strike.provisional
          ? { price: strike.price, windowStart: strike.windowStart, windowEnd: strike.windowEnd }
          : undefined,
    })
  }

  report.brier = brierCount ? brierSum / brierCount : null
  report.driftError = driftErrorCount ? driftErrorSum / driftErrorCount : null
  report.meanProbability = brierCount ? probabilitySum / brierCount : null
  report.meanConfidence = report.forecasts ? confidenceSum / report.forecasts : 0
  for (const [agentId, entry] of Object.entries(current.agents)) {
    if (!entry) continue
    report.agents[agentId] = { skill: entry.overall.skill, samples: entry.overall.samples }
  }
  return { report, learning: current }
}

function runTraining(): TrainingResult {
  let learning = defaultAgentLearningState()
  const reports: ScenarioReport[] = []
  for (const scenario of SCENARIOS) {
    const { report, learning: next } = runScenario(scenario, learning)
    learning = next
    reports.push(report)
  }
  return { learning, reports }
}

function percent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`
}

function printReport(result: TrainingResult): void {
  console.log('\nBTC-USD causal replay — the main-chart AI, graded on its own horizon\n')
  for (const report of result.reports) {
    const strikeRate = report.strikeEntries ? report.strikeHits / report.strikeEntries : null
    console.log(
      `${report.label} · ${report.timeframe} · ${report.forecasts} forecasts (${report.resolved} settled)`,
    )
    console.log(
      `  strike call ${percent(strikeRate)} of ${report.strikeEntries} decided · ${report.strikeAbstains} abstained · Brier ${report.brier === null ? '—' : report.brier.toFixed(4)} · mean P(up) ${percent(report.meanProbability)}`,
    )
    console.log(
      `  drift error ${report.driftError === null ? '—' : `${report.driftError.toFixed(3)} ATR`} · touch right ${report.touchCalls ? `${report.touchHits}/${report.touchCalls}` : '—'} · mean confidence ${percent(report.meanConfidence)}`,
    )
    console.log(
      `  call accuracy · first half ${report.firstHalf.decided ? percent(report.firstHalf.hits / report.firstHalf.decided) : '—'} (${report.firstHalf.decided}) · second half ${report.secondHalf.decided ? percent(report.secondHalf.hits / report.secondHalf.decided) : '—'} (${report.secondHalf.decided})`,
    )
    console.log(
      `  paths ${Object.entries(report.pathCounts)
        .map(([path, count]) => `${path}:${count}`)
        .join(' ')}`,
    )
    console.log(
      `  agents ${Object.entries(report.agents)
        .map(([id, cell]) => `${id} ${percent(cell.skill, 0)}/${cell.samples}`)
        .join(' · ')}`,
    )
    console.log('')
  }
  const overall = Object.entries(result.learning.agents).map(
    ([id, entry]) =>
      `${id} ${percent(entry?.overall.skill ?? 0, 0)}/${entry?.overall.samples ?? 0}`,
  )
  console.log(`prior written from ${overall.join(' · ')}\n`)
}

/**
 * Serialize the trained weights as a committed TS module. Only called after every
 * behavioral assertion passes, so a regression can never bless new weights.
 * Deterministic: rounded floats, fixed stamp, stable keys.
 */
function writePretrainedSnapshot(learning: AgentLearningState, totalForecasts: number): void {
  const rounded = JSON.parse(
    JSON.stringify(learning, (_key, value: unknown) =>
      typeof value === 'number' ? Math.round(value * 10000) / 10000 : value,
    ),
  ) as AgentLearningState
  rounded.updatedAt = SNAPSHOT_UPDATED_AT
  const body = `/**
 * Pre-trained main-chart AI weights — AUTO-GENERATED by agent-training.test.ts, do not edit.
 *
 * Trained on ${totalForecasts} causal BTC-USD forecasts (Coinbase spot):
 * 1D trailing year, 1h Nov-2024 election rally, recent 1h / 15m / 5m / 1m.
 * Fresh installs start here via pretrainedAgentLearningState(); live outcomes
 * keep adapting every cell from this prior. Regenerates byte-identically on
 * every test run unless the engine, data, or harness changed.
 */
import type { AgentLearningState } from './market-agents'

export const AGENT_PRETRAINED_LEARNING: AgentLearningState = ${JSON.stringify(rounded, null, 2)}
`
  writeFileSync(SNAPSHOT_PATH, body)
}

describe('main-chart AI training on real BTC scenarios', () => {
  it('replays the tape causally, settles every forecast, and learns from the outcomes', () => {
    const result = runTraining()
    printReport(result)

    for (const report of result.reports) {
      // Structural invariants: every eligible bar forecast, and forecasts settle.
      expect(report.forecasts).toBe(report.bars)
      expect(report.forecasts).toBeGreaterThan(100)
      expect(report.resolved).toBeGreaterThan(report.forecasts - 40)
      // The strike game has to be played on every scenario: a call, an outcome, a grade.
      expect(report.strikeEntries).toBeGreaterThan(20)
      // Probabilities are calibrated, not decorative: beating a coin flip's Brier score
      // means the number printed beside the call carries information.
      expect(report.brier ?? 1).toBeLessThan(0.25)
      // The projected drift has to land inside the horizon's own move scale on average:
      // √10 ≈ 3.2 ATR of noise over a ten-bar horizon is the floor any projection works against.
      expect(report.driftError ?? 99).toBeLessThan(2.6)
      // A one-sided "above" machine would show a mean probability far from a half.
      expect(report.meanProbability ?? 0.5).toBeGreaterThan(0.2)
      expect(report.meanProbability ?? 0.5).toBeLessThan(0.8)
      expect(report.meanConfidence).toBeGreaterThan(0.2)
    }

    // Every specialist that played earned a graded cell, and the ensemble is graded too.
    for (const [agentId, entry] of Object.entries(result.learning.agents)) {
      expect(entry?.overall.samples ?? 0).toBeGreaterThan(0)
      expect(entry?.overall.skill ?? 0).toBeGreaterThanOrEqual(0)
      expect(entry?.overall.skill ?? 0).toBeLessThanOrEqual(1)
      expect(agentId.length).toBeGreaterThan(0)
    }
    expect(result.learning.agents.ensemble?.overall.samples ?? 0).toBeGreaterThan(500)
    expect(Object.keys(result.learning.agents).length).toBeGreaterThanOrEqual(6)

    const total = result.reports.reduce((sum, report) => sum + report.forecasts, 0)
    writePretrainedSnapshot(result.learning, total)
  }, 300000)
})
