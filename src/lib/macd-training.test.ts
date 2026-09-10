/**
 * MACD AI training harness.
 *
 * Replays real BTC-USD scenarios bar-by-bar through the exact production loop:
 *   forecast -> record -> resolve -> learn -> memory feeds the next forecast.
 *
 * Every forecast is strictly causal (prefix-only indicator values); resolution
 * uses the realized future exactly like the live journal. Learning accumulates
 * across scenarios in chronological order, so the final weights are the
 * pre-trained defaults candidate. The report printed below is the behavioral
 * record: hit rates, cross-timing error, touch confusion, thrust accuracy.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateCmMacd, CM_MACD_DEFAULTS } from './cm-ult-macd'
import {
  analyzeMacdForecast,
  defaultMacdAiLearningState,
  defaultMacdForecastJournal,
  macdMemoryStats,
  recordMacdForecast,
  resolveMacdJournal,
  MACD_FORECAST_HORIZON_BARS,
  type MacdAiLearningState,
  type MacdCrossDir,
  type MacdForecast,
  type MacdForecastEntry,
  type MacdForecastJournal,
  type MacdThrust,
  type MacdTouchVerdict,
} from './macd-forecast'
import type { Candle, Timeframe } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(here, 'macd-training-data')

const SYMBOL = 'BTC-USD'
const SETTINGS_KEY = 'macd-train:cm12-26-9'
const WARMUP_BARS = 60
const HORIZON = MACD_FORECAST_HORIZON_BARS

interface Scenario {
  file: string
  label: string
  timeframe: Timeframe
}

/** Chronological: broad history first, most recent last. */
const SCENARIOS: Scenario[] = [
  { file: 'btc-usd-1D.json', label: '1D trailing year (Sep25-Sep26)', timeframe: '1D' },
  { file: 'btc-usd-1h-2024-11.json', label: '1h Nov-2024 election rally', timeframe: '1h' },
  { file: 'btc-usd-1h.json', label: '1h recent (Aug-Sep26)', timeframe: '1h' },
  { file: 'btc-usd-15m.json', label: '15m recent (Sep26)', timeframe: '15m' },
  { file: 'btc-usd-5m.json', label: '5m recent (Sep26)', timeframe: '5m' },
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

interface TouchRow {
  pred: MacdTouchVerdict
  actual: MacdTouchVerdict
}

interface ScenarioReport {
  label: string
  timeframe: Timeframe
  bars: number
  forecasts: number
  expected: number
  hit: number
  partial: number
  miss: number
  stale: number
  meanEnsemble: number
  crossTimed: number
  crossMae: number | null
  crossDirBoth: boolean
  actualCrosses: number
  touches: TouchRow[]
  touchAcc: number
  thrustChecked: number
  thrustHit: number
  thrustPred: Record<MacdThrust, number>
  meanConfidence: number
  memorySamplesEnd: number
}

function summarize(label: string, timeframe: Timeframe, bars: number, resolved: MacdForecastEntry[]): ScenarioReport {
  let ensembleSum = 0
  let crossErrSum = 0
  let crossTimed = 0
  let thrustChecked = 0
  let thrustHit = 0
  let touchHit = 0
  let confSum = 0
  let hit = 0
  let partial = 0
  let miss = 0
  let stale = 0
  let actualCrosses = 0
  const predDirs = new Set<MacdCrossDir>()
  const touches: TouchRow[] = []
  const thrustPred: Record<MacdThrust, number> = { strong: 0, mild: 0, weak: 0 }
  for (const entry of resolved) {
    if (entry.result === 'hit') hit++
    else if (entry.result === 'partial') partial++
    else if (entry.result === 'miss') miss++
    else stale++
    ensembleSum += entry.scores?.ensemble ?? 0
    confSum += entry.confidence
    thrustPred[entry.thrust]++
    if (entry.crossDir) predDirs.add(entry.crossDir)
    const actual = entry.actual
    if (actual) {
      if (actual.crossDir) actualCrosses++
      if (
        entry.crossDir &&
        actual.crossDir === entry.crossDir &&
        entry.crossBars !== null &&
        actual.crossBars !== null
      ) {
        crossTimed++
        crossErrSum += Math.abs(actual.crossBars - entry.crossBars)
      }
      touches.push({ pred: entry.touch, actual: actual.touchResult })
      if (entry.touch === actual.touchResult) touchHit++
      if (actual.thrust) {
        thrustChecked++
        if (entry.thrust === actual.thrust) thrustHit++
      }
    }
  }
  const n = resolved.length
  return {
    label,
    timeframe,
    bars,
    forecasts: n,
    expected: 0,
    hit,
    partial,
    miss,
    stale,
    meanEnsemble: n ? ensembleSum / n : 0,
    crossTimed,
    crossMae: crossTimed ? crossErrSum / crossTimed : null,
    crossDirBoth: predDirs.has('bullish') && predDirs.has('bearish'),
    actualCrosses,
    touches,
    touchAcc: n ? touchHit / n : 0,
    thrustChecked,
    thrustHit,
    thrustPred,
    meanConfidence: n ? confSum / n : 0,
    memorySamplesEnd: 0,
  }
}

interface TrainingResult {
  reports: ScenarioReport[]
  learning: MacdAiLearningState
  journal: MacdForecastJournal
}

function runTraining(): TrainingResult {
  let journal = defaultMacdForecastJournal()
  let learning = defaultMacdAiLearningState()
  const reports: ScenarioReport[] = []

  for (const scenario of SCENARIOS) {
    const candles = loadCandles(scenario.file)
    const lastIndex = candles.length - HORIZON - 1
    // Attribute by anchor time: the journal caps at 300 entries, so length
    // growth undercounts once earlier scenarios fill it.
    const anchors = new Set<number>()
    for (let i = WARMUP_BARS; i <= lastIndex; i++) {
      const prefix = candles.slice(0, i + 1)
      // Strictly causal: indicator sees only bars 0..i, exactly like live.
      const values = calculateCmMacd(prefix, CM_MACD_DEFAULTS, { timeframe: scenario.timeframe })
      const memory = macdMemoryStats(journal, SYMBOL, scenario.timeframe)
      const forecast: MacdForecast | null = analyzeMacdForecast({
        candles: prefix,
        timeframe: scenario.timeframe,
        values,
        resolution: scenario.timeframe,
        settingsLabel: 'CM 12/26/9',
        symbol: SYMBOL,
        memory,
      })
      // Past warmup the engine must always produce a forecast, never null.
      expect(forecast).not.toBeNull()
      if (!forecast) continue
      journal = recordMacdForecast(journal, {
        source: 'coinbase',
        symbol: SYMBOL,
        timeframe: scenario.timeframe,
        candles: prefix,
        forecast,
        settingsKey: SETTINGS_KEY,
      })
      anchors.add(prefix[prefix.length - 1].time)
      // Online resolution every 10 bars so learning + memory evolve mid-scenario.
      if ((i - WARMUP_BARS) % 10 === 9) {
        const step = resolveMacdJournal(journal, learning, {
          source: 'coinbase',
          symbol: SYMBOL,
          timeframe: scenario.timeframe,
          candles: prefix,
          values,
          settingsKey: SETTINGS_KEY,
        })
        journal = step.journal
        learning = step.learning
      }
    }
    // Final resolution over the full realized series.
    const fullValues = calculateCmMacd(candles, CM_MACD_DEFAULTS, { timeframe: scenario.timeframe })
    const final = resolveMacdJournal(journal, learning, {
      source: 'coinbase',
      symbol: SYMBOL,
      timeframe: scenario.timeframe,
      candles,
      values: fullValues,
      settingsKey: SETTINGS_KEY,
    })
    journal = final.journal
    learning = final.learning

    // Same-TF scenarios share journal keys, so attribute by anchor time.
    // (No scenario records >300 entries, so nothing here was evicted.)
    const mine = journal.entries.filter(
      (entry) =>
        entry.symbol === SYMBOL &&
        entry.timeframe === scenario.timeframe &&
        anchors.has(entry.candleTime),
    )
    const report = summarize(scenario.label, scenario.timeframe, candles.length, mine)
    report.expected = anchors.size
    report.memorySamplesEnd = macdMemoryStats(journal, SYMBOL, scenario.timeframe).samples
    reports.push(report)
  }
  return { reports, learning, journal }
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '   —  '
  return value.toFixed(digits).padStart(6)
}

function printReport(result: TrainingResult): void {
  const lines: string[] = []
  lines.push('')
  lines.push('MACD AI training report (BTC-USD, CM 12/26/9, horizon 10 bars)')
  lines.push('─'.repeat(96))
  lines.push(
    'scenario'.padEnd(34) +
      'n'.padStart(5) +
      'hit%'.padStart(7) +
      'par%'.padStart(7) +
      'ens'.padStart(7) +
      'xMae'.padStart(7) +
      'xN'.padStart(5) +
      'thr%'.padStart(7) +
      'conf'.padStart(7) +
      'mem'.padStart(5),
  )
  for (const r of result.reports) {
    const n = r.forecasts || 1
    lines.push(
      r.label.padEnd(34) +
        String(r.forecasts).padStart(5) +
        fmt((100 * r.hit) / n, 1).padStart(7) +
        fmt((100 * r.partial) / n, 1).padStart(7) +
        fmt(r.meanEnsemble).padStart(7) +
        fmt(r.crossMae).padStart(7) +
        String(r.crossTimed).padStart(5) +
        fmt(r.thrustChecked ? (100 * r.thrustHit) / r.thrustChecked : null, 1).padStart(7) +
        fmt(r.meanConfidence).padStart(7) +
        String(r.memorySamplesEnd).padStart(5),
    )
  }
  lines.push('─'.repeat(96))
  lines.push('touch confusion (pred -> actual):')
  const verdicts: MacdTouchVerdict[] = ['break', 'bounce', 'none']
  const thrusts: (MacdThrust | '—')[] = ['strong', 'mild', 'weak']
  for (const r of result.reports) {
    const matrix = verdicts.map((p) => verdicts.map((a) => r.touches.filter((t) => t.pred === p && t.actual === a).length))
    lines.push(
      `  ${r.timeframe.padEnd(4)} ` +
        verdicts.map((p, i) => `${p}=${matrix[i].join('/')}`).join('  ') +
        `   (actual order ${verdicts.join('/')})  thrust pred: ` +
        thrusts.map((t) => (t === '—' ? '' : `${t}=${r.thrustPred[t]}`)).join(' '),
    )
  }
  lines.push('─'.repeat(96))
  lines.push('learned agent skills (overall / samples):')
  for (const [id, entry] of Object.entries(result.learning.agents)) {
    lines.push(
      `  ${id.padEnd(12)} skill=${fmt(entry?.overall.skill)} n=${entry?.overall.samples ?? 0} ` +
        `byRegime=${Object.entries(entry?.byRegime ?? {})
          .map(([k, v]) => `${k}:${v.skill.toFixed(2)}/${v.samples}`)
          .join(' ') || '—'}`,
    )
  }
  const cal = result.learning.calibration
  lines.push(
    `calibration: crossBarsBias=${fmt(cal.crossBarsBias)} zeroBarsBias=${fmt(cal.zeroBarsBias)} samples=${cal.samples}`,
  )
  lines.push('')
  console.log(lines.join('\n'))
}

const SNAPSHOT_PATH = join(here, 'macd-pretrained.ts')
/** Fixed vintage stamp so the generated snapshot is byte-deterministic. */
const SNAPSHOT_UPDATED_AT = '2026-09-10T00:00:00.000Z'

/**
 * Serialize the trained weights as a committed TS module. Only called after
 * every behavioral assertion passes, so a regression can never bless new
 * weights. Output is deterministic: rounded floats, fixed stamp, stable keys.
 */
function writePretrainedSnapshot(learning: MacdAiLearningState, totalForecasts: number): void {
  const rounded = JSON.parse(
    JSON.stringify(learning, (_key, value: unknown) =>
      typeof value === 'number' ? Math.round(value * 10000) / 10000 : value,
    ),
  ) as MacdAiLearningState
  rounded.updatedAt = SNAPSHOT_UPDATED_AT
  const body = `/**
 * Pre-trained MACD AI weights — AUTO-GENERATED by macd-training.test.ts, do not edit.
 *
 * Trained on ${totalForecasts} causal BTC-USD forecasts (Coinbase spot):
 * 1D trailing year, 1h Nov-2024 election rally, recent 1h / 15m / 5m.
 * Fresh installs start here via pretrainedMacdAiLearningState(); live outcomes
 * keep adapting every cell from this prior. Regenerates byte-identically on
 * every test run unless the engine, data, or harness changed.
 */
import type { MacdAiLearningState } from './macd-forecast'

export const MACD_PRETRAINED_LEARNING: MacdAiLearningState = ${JSON.stringify(rounded, null, 2)}
`
  writeFileSync(SNAPSHOT_PATH, body)
}

describe('MACD AI training on real BTC scenarios', () => {
  it('replays scenarios causally and learns without errors', () => {
    const result = runTraining()
    printReport(result)

    // Structural invariants: every eligible bar forecast, every forecast settled.
    for (const report of result.reports) {
      expect(report.forecasts).toBe(report.expected)
      expect(report.forecasts).toBeGreaterThan(100)
      expect(report.stale).toBe(0)
      expect(report.hit + report.partial + report.miss).toBe(report.forecasts)
      expect(Number.isFinite(report.meanEnsemble)).toBe(true)
      expect(Number.isFinite(report.meanConfidence)).toBe(true)
      expect(report.actualCrosses).toBeGreaterThan(0)
    }
    // Behavioral bars: hit+partial well above chance, timing within ~3 bars,
    // touch judge uses its full vocabulary, thrust beats 1-of-3 guessing.
    for (const report of result.reports) {
      const n = report.forecasts
      expect((report.hit + report.partial) / n).toBeGreaterThanOrEqual(0.65)
      expect(report.meanEnsemble).toBeGreaterThanOrEqual(0.45)
      expect(report.crossTimed).toBeGreaterThanOrEqual(20)
      expect(report.crossMae ?? 99).toBeLessThanOrEqual(3)
      expect(report.crossDirBoth).toBe(true)
      const preds = new Set(report.touches.map((t) => t.pred))
      expect(preds.has('break')).toBe(true)
      expect(preds.has('bounce')).toBe(true)
      expect(preds.has('none')).toBe(true)
      expect(report.touchAcc).toBeGreaterThanOrEqual(0.28)
      expect(report.thrustHit / Math.max(1, report.thrustChecked)).toBeGreaterThanOrEqual(0.33)
      expect(report.memorySamplesEnd).toBe(30)
    }
    // Learning actually accumulated: every agent scored, calibration sampled.
    const agentIds = Object.keys(result.learning.agents)
    expect(agentIds.length).toBeGreaterThan(0)
    for (const entry of Object.values(result.learning.agents)) {
      expect(entry?.overall.samples).toBeGreaterThan(0)
      expect(entry?.overall.skill).toBeGreaterThanOrEqual(0)
      expect(entry?.overall.skill).toBeLessThanOrEqual(1)
    }
    expect(result.learning.calibration.samples).toBeGreaterThanOrEqual(100)

    const total = result.reports.reduce((sum, report) => sum + report.forecasts, 0)
    writePretrainedSnapshot(result.learning, total)
  }, 120000)
})
