import { describe, expect, it } from 'vitest'
import type { CmMacdValues } from './cm-ult-macd'
import {
  analyzeMacdForecast,
  defaultMacdAiLearningState,
  defaultMacdForecastJournal,
  macdMemoryStats,
  normalizeMacdAiLearningState,
  normalizeMacdForecastJournal,
  recordMacdForecast,
  resolveMacdJournal,
  type MacdAiLearningState,
} from './macd-forecast'
import type { Candle, Timeframe } from './types'

function candles(count: number, step = 60): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * step,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }))
}

/** Build chart-aligned CM values from raw MACD/signal series. */
function values(macd: number[], signal: number[]): CmMacdValues {
  return {
    macd: [...macd],
    signal: [...signal],
    histogram: macd.map((value, i) => value - signal[i]),
  }
}

function convergingBullish(): CmMacdValues {
  // MACD below signal, climbing into it: gap -1.2 → -0.1 over the tail.
  const macd: number[] = []
  const signal: number[] = []
  for (let i = 0; i < 40; i++) {
    const gap = -1.2 + (i / 39) * 1.1
    const level = -2 + (i / 39) * 1.6
    signal.push(level)
    macd.push(level + gap)
  }
  return values(macd, signal)
}

function touchShallowBearish(): CmMacdValues {
  // MACD above signal, drifting down shallowly while deeply above zero.
  const macd: number[] = []
  const signal: number[] = []
  for (let i = 0; i < 40; i++) {
    const gap = 0.56 - (i / 39) * 0.45
    const level = 2 + i * 0.01
    signal.push(level)
    macd.push(level + gap)
  }
  return values(macd, signal)
}

function divergingLines(): CmMacdValues {
  const macd: number[] = []
  const signal: number[] = []
  for (let i = 0; i < 40; i++) {
    signal.push(1)
    macd.push(1.5 + i * 0.05)
  }
  return values(macd, signal)
}

function inputFor(v: CmMacdValues, timeframe: Timeframe = '5m') {
  return {
    candles: candles(v.macd.length),
    timeframe,
    values: v,
    resolution: timeframe,
    settingsLabel: 'CM_Ult_MacD_MTF (5, 12, 26, 9)',
    symbol: 'BTC-USD',
  }
}

function opinionOf(forecast: NonNullable<ReturnType<typeof analyzeMacdForecast>>, id: string) {
  const found = forecast.agents.find((entry) => entry.id === id)
  expect(found).toBeDefined()
  return found!
}

describe('macd forecast engine', () => {
  it('predicts a bullish signal cross a few bars out when MACD climbs into the signal', () => {
    const forecast = analyzeMacdForecast(inputFor(convergingBullish()))
    expect(forecast).not.toBeNull()
    expect(forecast!.crossDir).toBe('bullish')
    expect(forecast!.crossBars).not.toBeNull()
    expect(forecast!.crossBars!).toBeGreaterThanOrEqual(1)
    expect(forecast!.crossBars!).toBeLessThanOrEqual(12)
    expect(forecast!.headline).toContain('Bullish cross')
    expect(forecast!.timeline[0].title).toMatch(/Touch|cross/i)
    expect(opinionOf(forecast!, 'cross-timer').bias).toBe('bullish')
  })

  it('reads a below → above mid-line flip while the cross approaches', () => {
    const forecast = analyzeMacdForecast(inputFor(convergingBullish()))
    expect(forecast!.zeroDir).toBe('up')
    expect(forecast!.zeroBars).not.toBeNull()
    expect(forecast!.timeline.some((step) => step.title.includes('below → above'))).toBe(true)
  })

  it('calls a shallow touch-and-bounce when the approach is slow against the regime', () => {
    const forecast = analyzeMacdForecast(inputFor(touchShallowBearish()))
    expect(forecast).not.toBeNull()
    expect(forecast!.touch).toBe('bounce')
    expect(forecast!.headline).toMatch(/Touch the signal.*reverse up/)
    expect(opinionOf(forecast!, 'touch-judge').reasons[0]).toContain('reversal back up')
  })

  it('stays honest when the lines diverge: no cross on the radar', () => {
    const forecast = analyzeMacdForecast(inputFor(divergingLines()))
    expect(forecast).not.toBeNull()
    expect(forecast!.crossDir).toBeNull()
    expect(forecast!.regime).toBe('diverging')
    expect(forecast!.headline).toContain('No cross on the radar')
    expect(forecast!.timeline[0].title).toContain('Stand by')
  })

  it('leads with thrust right after a fresh cross instead of timing another one', () => {
    // Converge then flip sign on the last bar: a fresh bullish cross.
    const v = convergingBullish()
    const n = v.macd.length
    v.macd[n - 1] = (v.signal[n - 1] ?? 0) + 0.15
    v.histogram[n - 1] = 0.15
    const forecast = analyzeMacdForecast(inputFor(v))
    expect(forecast!.regime).toBe('fresh-cross')
    expect(forecast!.headline).toContain('cross just printed')
    expect(forecast!.timeline[0].title).toMatch(/push|follow-through/)
  })

  it('waits for enough history instead of guessing', () => {
    const short = candles(20)
    const v = values(Array(20).fill(1), Array(20).fill(1))
    expect(analyzeMacdForecast({ ...inputFor(v), candles: short })).toBeNull()
  })

  it('flags the mid-line hold when no flip is forming', () => {
    const forecast = analyzeMacdForecast(inputFor(divergingLines()))
    expect(forecast!.zeroDir).toBeNull()
    expect(opinionOf(forecast!, 'zero-scout').reasons[0]).toMatch(/not on the radar|drifting/)
  })
})

describe('macd forecast journal and learning', () => {
  const settingsKey = JSON.stringify({ fast: 12, slow: 26, signal: 9, resolution: '5m' })

  function resolvingSeries(): { bars: Candle[]; vals: CmMacdValues } {
    // Entry at bar 39 (settled), then a bullish cross 3 bars later with thrust.
    const bars = candles(60)
    const macd: number[] = []
    const signal: number[] = []
    for (let i = 0; i < 60; i++) {
      const level = -1.5 + i * 0.09
      signal.push(level)
      if (i < 40) macd.push(level - 0.5 + i * 0.012)
      else if (i < 43) macd.push(level - 0.03 + (i - 40) * 0.02)
      else macd.push(level + 0.25 + (i - 43) * 0.12)
    }
    return { bars, vals: values(macd, signal) }
  }

  function settledForecast() {
    const { bars, vals } = resolvingSeries()
    const settledBars = bars.slice(0, 40)
    const settledVals: CmMacdValues = {
      macd: vals.macd.slice(0, 40),
      signal: vals.signal.slice(0, 40),
      histogram: vals.histogram.slice(0, 40),
    }
    const forecast = analyzeMacdForecast({
      candles: settledBars,
      timeframe: '5m',
      values: settledVals,
      resolution: '5m',
      settingsLabel: 'CM',
      symbol: 'BTC-USD',
    })
    expect(forecast).not.toBeNull()
    expect(forecast!.crossDir).toBe('bullish')
    return { bars, vals, settledBars, forecast: forecast! }
  }

  it('records one forecast per closed candle and stays pending until the horizon elapses', () => {
    const { bars, vals, settledBars, forecast } = settledForecast()
    let journal = recordMacdForecast(defaultMacdForecastJournal(), {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: settledBars,
      forecast,
      settingsKey,
    })
    // Same candle twice records once.
    journal = recordMacdForecast(journal, {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: settledBars,
      forecast,
      settingsKey,
    })
    expect(journal.entries).toHaveLength(1)

    const early = resolveMacdJournal(journal, defaultMacdAiLearningState(), {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: bars.slice(0, 44),
      values: {
        macd: vals.macd.slice(0, 44),
        signal: vals.signal.slice(0, 44),
        histogram: vals.histogram.slice(0, 44),
      },
      settingsKey,
    })
    expect(early.resolved).toHaveLength(0)
    expect(early.journal.entries[0].resolvedAt).toBeUndefined()
  })

  it('scores outcomes and adapts trust weights plus timing calibration', () => {
    const { bars, vals, settledBars, forecast } = settledForecast()
    const journal = recordMacdForecast(defaultMacdForecastJournal(), {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: settledBars,
      forecast,
      settingsKey,
    })
    const learning: MacdAiLearningState = defaultMacdAiLearningState()
    const done = resolveMacdJournal(journal, learning, {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: bars,
      values: vals,
      settingsKey,
    })
    expect(done.resolved).toHaveLength(1)
    const entry = done.resolved[0]
    expect(entry.actual?.crossDir).toBe('bullish')
    expect(entry.actual?.crossBars).toBe(3)
    expect(entry.result).toMatch(/hit|partial/)
    expect(done.learning.agents['cross-timer']?.overall.skill ?? 0.5).toBeGreaterThan(0.5)
    expect(done.learning.agents['cross-timer']?.overall.samples).toBe(1)
    expect(done.learning.calibration.samples).toBeGreaterThan(0)

    const memory = macdMemoryStats(done.journal, 'BTC-USD', '5m')
    expect(memory.samples).toBe(1)
    expect(memory.hitRate).toBeGreaterThan(0.5)
  })

  it('marks entries stale when history rotates past them without learning from them', () => {
    const { settledBars, forecast } = settledForecast()
    const journal = recordMacdForecast(defaultMacdForecastJournal(), {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: settledBars,
      forecast,
      settingsKey,
    })
    // A rotated window that starts after the entry candle.
    const rotated = candles(30, 60).map((candle, i) => ({ ...candle, time: 100000 + i * 60 }))
    const done = resolveMacdJournal(journal, defaultMacdAiLearningState(), {
      source: 'coinbase',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: rotated,
      values: {
        macd: rotated.map(() => 1),
        signal: rotated.map(() => 1),
        histogram: rotated.map(() => 0),
      },
      settingsKey,
    })
    expect(done.resolved[0].result).toBe('stale')
    expect(done.learning.agents['cross-timer']).toBeUndefined()
  })

  it('normalizes corrupt stored state back to safe defaults', () => {
    expect(normalizeMacdAiLearningState(null)).toEqual(defaultMacdAiLearningState())
    expect(normalizeMacdAiLearningState({ version: 2 })).toEqual(defaultMacdAiLearningState())
    expect(normalizeMacdForecastJournal(null)).toEqual(defaultMacdForecastJournal())
    expect(normalizeMacdForecastJournal({ entries: [{ nope: true }] }).entries).toEqual([])
    const biased = normalizeMacdAiLearningState({
      version: 1,
      agents: {},
      calibration: { crossBarsBias: 99, zeroBarsBias: -99, samples: 3 },
    })
    expect(biased.calibration.crossBarsBias).toBe(4)
    expect(biased.calibration.zeroBarsBias).toBe(-4)
  })
})
