import { describe, expect, it } from 'vitest'
import { bucketStart, INTERVAL_SECONDS } from '../../shared/coinbase'
import {
  calculateCmMacd,
  cmHistogramColor,
  cmMacdPlots,
  cmMacdResolution,
  cmMacdSettings,
  CM_COLORS as C,
  CM_MACD_DEFAULTS as defaults,
  indicatorLabel,
  isCmMacdSettings,
  pineEma,
  requestedIndicatorTimeframes,
} from './cm-ult-macd'
import type { CmMacdValues, IndicatorContext, IndicatorTimeframes } from './cm-ult-macd'
import {
  SMC_DEFAULTS,
  type Candle,
  type CmMacdSettings,
  type Indicator,
  type Timeframe,
} from './types'
import { ta } from './indicator-runtime'
import { builtInPlots } from './indicators'
import reference from './fixtures/cm-ult-macd-reference.json'

const bars = (closes: number[], interval: Timeframe = '1h', start = 0): Candle[] =>
  closes.map((close, i) => ({
    time: start + INTERVAL_SECONDS[interval] * i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
const feed = (resolution: Timeframe, candles: Candle[]): IndicatorTimeframes => ({
  [resolution]: { candles, state: 'live', message: '', asOf: 0 },
})
const indicator: Indicator = {
  id: 'cm',
  kind: 'cm-ult-macd',
  name: 'CM_Ult_MacD_MTF',
  period: 12,
  color: C.lime,
  visible: true,
}
const quick = { ...defaults, fastLength: 2, slowLength: 3, signalLength: 2 }
const native = bars(reference.closes)
const numeric = (actual: (number | null)[], expected: (number | null)[]) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, i) =>
    expected[i] === null ? expect(value).toBeNull() : expect(value).toBeCloseTo(expected[i]!, 10),
  )
}

describe('CM_Ult_MacD_MTF — original calculation, not standard MACD', () => {
  it('matches an independent exact-rational 12/26/9 reference vector', () => {
    const result = calculateCmMacd(native, { ...defaults })
    numeric(result.macd, reference.macd)
    numeric(result.signal, reference.signal)
    numeric(result.histogram, reference.histogram)
    expect(result.signal.slice(0, 8)).toEqual(Array(8).fill(null))
    expect(result.signal[8]).not.toBeNull()
  })
  it('seeds Pine EMA from the first close without changing the Studio EMA', () => {
    expect(pineEma([1, 2, 3, 4], 3)).toEqual([1, 1.5, 2.25, 3.125])
    expect(ta.ema([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3])
    expect(pineEma([], 26)).toEqual([])
  })
  it('uses an SMA signal, never an EMA signal or resampled lower-timeframe MACD', () => {
    const result = calculateCmMacd(native, { ...defaults })
    numeric(result.signal, ta.sma(result.macd, 9))
    expect(result.signal.at(-1)).not.toBeCloseTo(ta.ema(result.macd, 9).at(-1)!, 3)
    const regular = builtInPlots(native, { ...indicator, kind: 'macd' })
    expect(regular).toHaveLength(2)
    expect(regular[0].values[24]).toBeNull()
    numeric(regular[1].values, ta.ema(regular[0].values, 9))
  })
  it('keeps the slow and signal lengths independent of the fast length', () => {
    const values = calculateCmMacd(native, {
      ...quick,
      fastLength: 5,
      slowLength: 2,
      signalLength: 4,
    })
    numeric(
      values.macd,
      pineEma(reference.closes, 5).map((v, i) => v - pineEma(reference.closes, 2)[i]),
    )
    numeric(values.signal, ta.sma(values.macd, 4))
    // The original permits fast == slow and fast > slow; do not silently reorder them.
    expect(
      calculateCmMacd(native, { ...quick, fastLength: 2, slowLength: 2 }).macd.every(
        (v) => v === 0,
      ),
    ).toBe(true)
  })
  it('handles empty, short, constant and length-one inputs without NaN', () => {
    expect(calculateCmMacd([], { ...defaults })).toEqual({ macd: [], signal: [], histogram: [] })
    expect(calculateCmMacd(bars([4]), { ...defaults })).toEqual({
      macd: [0],
      signal: [null],
      histogram: [null],
    })
    const flat = calculateCmMacd(bars(Array(40).fill(8)), { ...defaults })
    expect(flat.histogram.slice(8)).toEqual(Array(32).fill(0))
    const one = calculateCmMacd(native, { ...quick, signalLength: 1 })
    expect(one.signal).toEqual(one.macd)
    expect(one.histogram.every((v) => v === 0)).toBe(true)
  })
  it.each([0, -1, 2.5, NaN, Infinity, 2001])('rejects invalid lengths (%s)', (length) => {
    expect(() => pineEma([1, 2], length)).toThrow(/length/)
    for (const key of ['fastLength', 'slowLength', 'signalLength'])
      expect(() => calculateCmMacd(native, { ...defaults, [key]: length })).toThrow(/settings/)
  })
})

describe('original palette, guards and cross() semantics', () => {
  it.each([
    [2, 1, C.aqua],
    [1, 2, C.blue],
    [-2, -1, C.red],
    [-1, -2, C.maroon],
    [0, 1, C.red],
    [0, -1, C.maroon],
    [2, 2, C.yellow],
    [-2, -2, C.yellow],
    [0, 0, C.yellow],
    [1, null, C.yellow],
    [null, 1, C.yellow],
  ] as const)('colors histogram %s after %s as %s', (value, previous, color) => {
    expect(cmHistogramColor(value, previous)).toBe(color)
    expect(cmHistogramColor(value, previous, false)).toBe(C.gray)
  })
  const values: CmMacdValues = {
    macd: [null, -1, 0, 1, 2, 0, -1, 0, 1],
    signal: [null, 0, 0, 0, 0, 0, 0, 0, 0],
    histogram: [null, -1, 0, 1, 2, 0, -1, 0, 1],
  }
  it('plots dots exactly at the signal value, including zero, only on crossings', () => {
    const plots = cmMacdPlots(values, { ...defaults })
    expect(plots[3].values).toEqual([null, null, null, 0, null, null, 0, null, 0])
    expect(plots[3].style).toBe('circles')
    expect(plots[3].colors).toEqual([
      C.red,
      C.red,
      C.lime,
      C.lime,
      C.lime,
      C.lime,
      C.red,
      C.lime,
      C.lime,
    ])
    expect(plots[0].colors).toEqual(plots[3].colors)
  })
  it('suppresses exact zero values in lines/histogram as the original numeric truthiness does', () => {
    const plots = cmMacdPlots(values, { ...defaults })
    expect(plots[0].values).toEqual([null, -1, null, 1, 2, null, -1, null, 1])
    expect(plots[1].values.every((v) => v === null)).toBe(true)
    expect(plots[2].values).toEqual(plots[0].values)
    expect(plots.map((p) => p.lineWidth)).toEqual([4, 2, 4, 4, 2])
    expect(plots[4]).toMatchObject({
      title: '0 Line',
      color: C.white,
      horizontalLine: 0,
      hideLegend: true,
    })
  })
  it('keeps dots independent of Show MacD & Signal, as sd is independent of smd', () => {
    const plots = cmMacdPlots(values, { ...defaults, showLines: false })
    expect(plots[0].values.every((v) => v === null)).toBe(true)
    expect(plots[1].values.every((v) => v === null)).toBe(true)
    expect(plots[3].values[3]).toBe(0)
    const hidden = cmMacdPlots(values, {
      ...defaults,
      showLines: false,
      showDots: false,
      showHistogram: false,
    })
    expect(hidden.slice(0, 4).every((p) => p.values.every((v) => v === null))).toBe(true)
    expect(hidden[4].values.every((v) => v === 0)).toBe(true)
  })
  it('switches to fixed red MACD/dots, lime signal and gray histogram when colors are disabled', () => {
    const plots = cmMacdPlots(values, {
      ...defaults,
      macdColorChange: false,
      histogramColorChange: false,
    })
    expect(plots[0].colors?.every((color) => color === C.red)).toBe(true)
    expect(plots[1].color).toBe(C.lime)
    expect(plots[2].colors?.every((color) => color === C.gray)).toBe(true)
    expect(plots[3].colors?.every((color) => color === C.red)).toBe(true)
  })
  it('does not create a warm-up crossing or confuse an equality with a crossing', () => {
    const samples = {
      macd: [null, 4, 4, 3, 2],
      signal: [null, null, 3, 3, 3],
      histogram: [null, null, 1, 0, -1],
    }
    expect(cmMacdPlots(samples, { ...defaults })[3].values).toEqual([null, null, null, null, 3])
  })
})

describe('multi-timeframe security() projection', () => {
  const settings = { ...quick, useCurrentRes: false, resCustom: '1h' as const }
  const context: IndicatorContext = { timeframe: '15m', timeframes: feed('1h', native) }
  const chart = bars(
    Array.from({ length: 64 * 4 }, (_, i) => 100 + i / 4),
    '15m',
  )
  it('preserves useCurrentRes=true even when the legend contains 60', () => {
    expect(cmMacdResolution({ ...defaults }, '5m')).toBe('5m')
    expect(cmMacdResolution(settings, '5m')).toBe('1h')
    expect(indicatorLabel(indicator)).toBe('CM_Ult_MacD_MTF (60, 12, 26, 9)')
    const own = calculateCmMacd(chart, { ...defaults }, context)
    numeric(
      own.macd,
      pineEma(
        chart.map((c) => c.close),
        12,
      ).map(
        (v, i) =>
          v -
          pineEma(
            chart.map((c) => c.close),
            26,
          )[i],
      ),
    )
  })
  it('calculates on actual hourly candles and projects historical values from the START of the hour', () => {
    const higher = calculateCmMacd(native, { ...quick })
    const projected = calculateCmMacd(chart, settings, context)
    for (const key of ['macd', 'signal', 'histogram'] as const)
      numeric(
        projected[key],
        chart.map((_, i) => higher[key][Math.floor(i / 4)]),
      )
    const differentChart = chart.map((c) => ({ ...c, close: c.close * 10 }))
    expect(calculateCmMacd(differentChart, settings, context)).toEqual(projected)
  })
  it('colors and crosses AFTER projection: flat HTF steps turn yellow and dots are not duplicated', () => {
    const higher = cmMacdPlots(calculateCmMacd(native, { ...quick }), { ...quick })
    const plots = cmMacdPlots(calculateCmMacd(chart, settings, context), settings)
    expect(plots[2].colors?.filter((_, i) => i % 4 !== 0).every((c) => c === C.yellow)).toBe(true)
    expect(plots[3].values.filter((v) => v !== null)).toHaveLength(
      higher[3].values.filter((v) => v !== null).length,
    )
    expect(plots[3].values.every((v, i) => v === null || i % 4 === 0)).toBe(true)
  })
  it('uses full native warm-up history even when only a few chart bars are displayed', () => {
    const all = calculateCmMacd(chart, settings, context)
    const tail = calculateCmMacd(chart.slice(-8), settings, context)
    numeric(tail.macd, all.macd.slice(-8))
    numeric(tail.signal, all.signal.slice(-8))
    expect(tail.signal.every((v) => v !== null)).toBe(true)
  })
  it('does not silently fall back to chart MACD when target history is unavailable', () => {
    const missing = calculateCmMacd(chart, settings, { timeframe: '15m' })
    expect(
      Object.values(missing).every(
        (v) => v.length === chart.length && v.every((n: number | null) => n === null),
      ),
    ).toBe(true)
  })
  it('forward-fills gaps without inventing native source observations or leading values', () => {
    const sparse = [native[2], native[5], native[9]]
    const result = calculateCmMacd(chart.slice(0, 40), settings, {
      timeframe: '15m',
      timeframes: feed('1h', sparse),
    })
    const expected = calculateCmMacd(sparse, { ...quick })
    expect(result.macd.slice(0, 8)).toEqual(Array(8).fill(null))
    expect(result.macd.slice(8, 20)).toEqual(Array(12).fill(expected.macd[0]))
    expect(result.macd.slice(20, 36)).toEqual(Array(16).fill(expected.macd[1]))
  })
  it('selects first LTF intrabar historically and latest intrabar on realtime bars', () => {
    const lower = bars(reference.closes, '15m')
    const prices = bars(Array(16).fill(100))
    const opts = { ...settings, resCustom: '15m' as const }
    const ctx = { timeframe: '1h' as const, timeframes: feed('15m', lower) }
    const raw = calculateCmMacd(lower, { ...quick }, { timeframe: '15m' })
    const historical = calculateCmMacd(prices, opts, ctx)
    numeric(
      historical.macd,
      prices.map((_, i) => raw.macd[i * 4]),
    )
    const live = calculateCmMacd(prices, opts, { ...ctx, realtimeFrom: prices.at(-1)!.time })
    numeric(live.macd.slice(0, -1), historical.macd.slice(0, -1))
    expect(live.macd.at(-1)).toBe(raw.macd.at(-1))
  })
  it('reports no values before a truncated lower-timeframe history window', () => {
    const lower = bars(reference.closes, '15m', 3600 * 5 + 900)
    const result = calculateCmMacd(
      bars(Array(9).fill(100)),
      { ...settings, resCustom: '15m' },
      {
        timeframe: '1h',
        timeframes: feed('15m', lower),
      },
    )
    expect(result.macd.slice(0, 6).every((v) => v === null)).toBe(true)
    expect(result.macd[6]).not.toBeNull()
  })
  it('aligns weekly source buckets to Monday UTC', () => {
    const monday = bucketStart(Date.UTC(2026, 8, 7) / 1000, '1W')
    const weekly = bars([100, 200, 80], '1W', monday)
    const daily = bars(Array(21).fill(123), '1D', monday)
    const result = calculateCmMacd(
      daily,
      { ...settings, resCustom: '1W' },
      { timeframe: '1D', timeframes: feed('1W', weekly) },
    )
    const raw = calculateCmMacd(weekly, { ...quick }, { timeframe: '1W' })
    numeric(
      result.macd,
      daily.map((_, i) => raw.macd[Math.floor(i / 7)]),
    )
  })
  it('deduplicates feed requests and excludes hidden/current-resolution indicators', () => {
    const cm = { ...indicator, cmMacd: settings }
    const smc: Indicator = {
      id: 'smc',
      kind: 'smart-money-concepts',
      name: 'Smart Money Concepts',
      period: 50,
      color: '#089981',
      visible: true,
      smc: { ...SMC_DEFAULTS, showFairValueGaps: true, fvgTimeframe: '4h' },
    }
    expect(requestedIndicatorTimeframes([cm, { ...cm, id: 'two' }, indicator, smc], '15m')).toEqual(
      ['1h', '4h'],
    )
    expect(requestedIndicatorTimeframes([{ ...cm, visible: false }], '15m')).toEqual([])
    expect(requestedIndicatorTimeframes([cm, smc], '1h')).toEqual(['4h'])
    // Extra resolutions (the timeframe peek window) reuse a feed already requested by an
    // indicator, and never open one for the chart's own resolution.
    expect(requestedIndicatorTimeframes([cm, smc], '15m', ['1h'])).toEqual(['1h', '4h'])
    expect(requestedIndicatorTimeframes([], '15m', ['4h', '1h'])).toEqual(['1h', '4h'])
    expect(requestedIndicatorTimeframes([], '15m', ['15m'])).toEqual([])
    expect(cmMacdSettings({ ...indicator, cmMacd: { ...defaults, slowLength: 0 } })).toEqual(
      defaults,
    )
  })
  it('validates boolean types and supported resolutions strictly', () => {
    expect(isCmMacdSettings({ ...defaults })).toBe(true)
    for (const bad of [
      null,
      [],
      {},
      { ...defaults, useCurrentRes: 'false' },
      { ...defaults, resCustom: 'garbage' },
    ])
      expect(isCmMacdSettings(bad)).toBe(false)
  })
})

describe('developing candles and replay boundaries', () => {
  const source = bars(reference.closes)
  const settings = { ...quick, useCurrentRes: false, resCustom: '1h' as const }
  it('updates only one developing HTF sample and retains earlier observed closes', () => {
    const chart = bars([101, 102, 103, 104], '15m', 3600 * 40)
    const context: IndicatorContext = {
      timeframe: '15m',
      timeframes: feed('1h', source),
      realtimeFrom: chart[0].time,
    }
    const result = calculateCmMacd(chart, settings, context)
    for (let i = 0; i < chart.length; i++) {
      const truncated = [...source.slice(0, 40), { ...source[40], close: chart[i].close }]
      const expected = calculateCmMacd(truncated, { ...quick })
      expect(result.macd[i]).toBeCloseTo(expected.macd.at(-1)!, 10)
      expect(result.signal[i]).toBeCloseTo(expected.signal.at(-1)!, 10)
    }
    const updated = chart.map((c, i) => (i === 3 ? { ...c, close: 999 } : c))
    expect(calculateCmMacd(updated, settings, context).macd.slice(0, -1)).toEqual(
      result.macd.slice(0, -1),
    )
  })
  it('never reads the future final HTF close in a partial replay hour', () => {
    const chart = bars([101, 102], '15m', 3600 * 40)
    const context: IndicatorContext = {
      timeframe: '15m',
      timeframes: feed('1h', source),
      replay: true,
    }
    const replay = calculateCmMacd(chart, settings, context)
    const tampered = source.map((c, i) => (i < 40 ? c : { ...c, close: 1_000_000 }))
    expect(
      calculateCmMacd(chart, settings, { ...context, timeframes: feed('1h', tampered) }),
    ).toEqual(replay)
    const oracle = calculateCmMacd([...source.slice(0, 40), { ...source[40], close: 102 }], {
      ...quick,
    })
    expect(replay.macd.at(-1)).toBeCloseTo(oracle.macd.at(-1)!, 10)
  })
  it('uses legacy historical placement once an entire replay HTF candle is available', () => {
    const chart = bars([101, 102, 103, source[40].close], '15m', 3600 * 40)
    const result = calculateCmMacd(chart, settings, {
      timeframe: '15m',
      timeframes: feed('1h', source),
      replay: true,
    })
    const oracle = calculateCmMacd(source, { ...quick })
    expect(result.macd).toEqual(Array(4).fill(oracle.macd[40]))
  })
  it('ignores all lower-timeframe candles beyond the replay cursor', () => {
    const lower = bars(reference.closes, '15m')
    const chart = bars([100, 120])
    const opts: CmMacdSettings = { ...settings, resCustom: '15m' }
    const ctx: IndicatorContext = { timeframe: '1h', timeframes: feed('15m', lower), replay: true }
    const result = calculateCmMacd(chart, opts, ctx)
    const futureChanged = lower.map((c, i) => (i < 8 ? c : { ...c, close: 1_000_000 }))
    expect(
      calculateCmMacd(chart, opts, { ...ctx, timeframes: feed('15m', futureChanged) }),
    ).toEqual(result)
    expect(result.macd.at(-1)).toBeCloseTo(
      calculateCmMacd(lower, { ...quick }, { timeframe: '15m' }).macd[7]!,
      10,
    )
  })
})
