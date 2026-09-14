import { describe, expect, it } from 'vitest'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import {
  calculateWaveTrend,
  isWaveTrendSettings,
  waveTrendIndicatorLabel,
  waveTrendPlots,
  waveTrendSettings,
  WT_AREA_TRANSPARENCY,
  WT_COLORS as C,
  WT_SCALE,
  WT_SIGNAL_LENGTH,
  WAVE_TREND_DEFAULTS as defaults,
} from './wave-trend'
import { builtInPlots } from './indicators'
import { pineEma, ta } from './indicator-runtime'
import type { Candle, Indicator, Timeframe, WaveTrendSettings } from './types'
import reference from './fixtures/wave-trend-reference.json'

const bars = (rows: Candle[], interval: Timeframe = '1h', start = 0): Candle[] =>
  rows.map((row, i) => ({ ...row, time: start + INTERVAL_SECONDS[interval] * i, volume: 1 }))
const ohlc = (high: number, low: number, close: number): Candle => ({
  time: 0,
  open: close,
  high,
  low,
  close,
  volume: 1,
})
const flat = (closes: number[]) => bars(closes.map((close) => ohlc(close, close, close)))
const candles: Candle[] = reference.candles.map((c) => ({ ...c }))
const indicator: Indicator = {
  id: 'wt',
  kind: 'wave-trend',
  name: 'WaveTrend [LazyBear]',
  period: 10,
  color: C.green,
  visible: true,
}
/**
 * Relative comparison: the recursive channel divides by a small deviation, so
 * float64 rounding is amplified along the series and an absolute tolerance
 * would be a tolerance on the price scale, not on the calculation.
 */
const numeric = (actual: (number | null)[], expected: (number | null)[], tolerance = 1e-9) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, i) => {
    if (expected[i] === null) return expect(value).toBeNull()
    expect(value).not.toBeNull()
    const scale = Math.max(1, Math.abs(expected[i]!))
    expect(Math.abs(value! - expected[i]!) / scale).toBeLessThan(tolerance)
  })
}
/**
 * Independent restatement of the published recurrence, written with the
 * `(2x + (n-1)prev)/(n+1)` form instead of an alpha, so the two implementations
 * only agree when the seeding, the scale and the order of operations match.
 */
function referenceWaveTrend(
  rows: Candle[],
  channelLength: number,
  averageLength: number,
): { wt1: number[]; wt2: (number | null)[] } {
  const average = (values: number[], length: number) => {
    let previous = values[0]
    return values.map(
      (value, i) =>
        (previous = i === 0 ? value : (2 * value + (length - 1) * previous) / (length + 1)),
    )
  }
  const ap = rows.map((c) => (c.high + c.low + c.close) / 3)
  const esa = average(ap, channelLength)
  const d = average(
    ap.map((value, i) => Math.abs(value - esa[i])),
    channelLength,
  )
  const ci = ap.map((value, i) => (d[i] === 0 ? 0 : (value - esa[i]) / (WT_SCALE * d[i])))
  const wt1 = average(ci, averageLength)
  return { wt1, wt2: ta.sma(wt1, WT_SIGNAL_LENGTH) }
}

describe('WaveTrend [LazyBear] — original calculation', () => {
  it('matches an independent exact-rational 10/21 reference vector', () => {
    const result = calculateWaveTrend(candles, { ...defaults })
    numeric(result.wt1, reference.wt1)
    numeric(result.wt2, reference.wt2)
    numeric(result.diff, reference.diff)
  })
  it('uses hlc3, not close, as the price source', () => {
    const result = calculateWaveTrend(candles, { ...defaults })
    const closes = candles.map((c) => ohlc(c.close, c.close, c.close))
    const closeOnly = calculateWaveTrend(closes, { ...defaults })
    expect(result.wt1.at(-1)).not.toBeCloseTo(closeOnly.wt1.at(-1)!, 6)
    const ap = candles.map((c) => (c.high + c.low + c.close) / 3)
    // The seeded ESA and the deviation average are both taken on hlc3, in that order.
    numeric(
      result.wt1,
      pineEma(
        ap.map((value, i) => {
          const esa = pineEma(ap, defaults.channelLength)[i]
          const d = pineEma(
            ap.map((v, j) => Math.abs(v - pineEma(ap, defaults.channelLength)[j])),
            defaults.channelLength,
          )[i]
          return d === 0 ? 0 : (value - esa) / (WT_SCALE * d)
        }),
        defaults.averageLength,
      ),
    )
  })
  it('keeps both lengths independent and never exposes the 4-bar signal as an input', () => {
    const result = calculateWaveTrend(candles, { ...defaults, channelLength: 3, averageLength: 5 })
    const expected = referenceWaveTrend(candles, 3, 5)
    numeric(result.wt1, expected.wt1)
    numeric(result.wt2, expected.wt2)
    expect(result.wt2).toEqual(ta.sma(result.wt1, WT_SIGNAL_LENGTH))
    expect(WT_SIGNAL_LENGTH).toBe(4)
    expect('signalLength' in defaults).toBe(false)
  })
  it('warms up only the four-bar average, never the Pine-seeded EMAs', () => {
    const result = calculateWaveTrend(candles, { ...defaults })
    expect(result.wt1[0]).toBe(0)
    expect(result.wt1.every((value) => value !== null)).toBe(true)
    expect(result.wt2.slice(0, WT_SIGNAL_LENGTH - 1)).toEqual([null, null, null])
    expect(result.wt2[3]).not.toBeNull()
    expect(result.diff.slice(0, 3)).toEqual([null, null, null])
  })
  it('treats the flat-channel division as zero instead of poisoning the EMA', () => {
    const result = calculateWaveTrend(flat(Array(40).fill(50000)), { ...defaults })
    expect(result.wt1.every((value) => value === 0)).toBe(true)
    expect(result.wt2.slice(3).every((value) => value === 0)).toBe(true)
    expect(result.diff.slice(3).every((value) => value === 0)).toBe(true)
    // Pine's first bar divides by the seeded d == 0; the wave must still start there.
    expect(calculateWaveTrend(flat([7]), { ...defaults }).wt1).toEqual([0])
  })
  it('handles empty and single-bar inputs without NaN', () => {
    expect(calculateWaveTrend([], { ...defaults })).toEqual({ wt1: [], wt2: [], diff: [] })
    expect(calculateWaveTrend(flat([42]), { ...defaults })).toEqual({
      wt1: [0],
      wt2: [null],
      diff: [null],
    })
  })
  it('applies no normalization or fixed band, and is scale-free like the original', () => {
    const result = calculateWaveTrend(candles, { ...defaults })
    // Not clamped to a band like RSI: the published levels are inputs, not bounds.
    expect(Math.abs(result.wt1.at(-1)!)).toBeLessThan(200)
    // ap, esa and d all scale with price, so ci — and therefore the wave — does
    // not. Doubling the series reproduces the same wave instead of a doubled one.
    const doubled = calculateWaveTrend(
      candles.map((c) => ({ ...c, high: c.high * 2, low: c.low * 2, close: c.close * 2 })),
      { ...defaults },
    )
    numeric(doubled.wt1, result.wt1)
  })
  it.each([0, -1, 2.5, NaN, Infinity, 2001])('rejects invalid lengths (%s)', (length) => {
    for (const key of ['channelLength', 'averageLength'] as const)
      expect(() => calculateWaveTrend(candles, { ...defaults, [key]: length })).toThrow(/settings/)
  })
  it.each([NaN, Infinity, 1e7, '60', null])('rejects invalid levels (%s)', (level) => {
    const settings = { ...defaults, obLevel1: level } as unknown as WaveTrendSettings
    expect(isWaveTrendSettings(settings)).toBe(false)
    expect(() => calculateWaveTrend(candles, settings)).toThrow(/settings/)
  })
})

describe('WaveTrend settings, label and plots', () => {
  it('falls back to the published defaults and reflects them in the legend', () => {
    expect(waveTrendSettings({ ...indicator })).toEqual({ ...defaults })
    expect(waveTrendSettings(indicator).channelLength).toBe(10)
    expect(waveTrendIndicatorLabel({ ...indicator })).toBe('WaveTrend [LazyBear] (10, 21)')
    expect(
      waveTrendIndicatorLabel({
        ...indicator,
        waveTrend: { ...defaults, channelLength: 21, averageLength: 34 },
      }),
    ).toBe('WaveTrend [LazyBear] (21, 34)')
    expect(
      waveTrendSettings({ ...indicator, waveTrend: { channelLength: 0 } as WaveTrendSettings }),
    ).toEqual({
      ...defaults,
    })
    expect(isWaveTrendSettings(null)).toBe(false)
    expect(isWaveTrendSettings([...Object.values(defaults)])).toBe(false)
  })
  it('plots the original wave, signal, area and five reference levels', () => {
    const settings: WaveTrendSettings = {
      ...defaults,
      obLevel1: 55,
      obLevel2: 45,
      osLevel1: -55,
      osLevel2: -45,
    }
    const plots = waveTrendPlots(calculateWaveTrend(candles, settings), settings)
    expect(plots).toHaveLength(8)
    expect(plots.every((plot) => plot.pane === 'oscillator')).toBe(true)
    expect(plots.every((plot) => plot.values.length === candles.length)).toBe(true)
    expect(plots.map((plot) => plot.title)).toEqual([
      'WT1',
      'WT2',
      'WT1 - WT2',
      'Zero',
      'Over Bought Level 1',
      'Over Sold Level 1',
      'Over Bought Level 2',
      'Over Sold Level 2',
    ])
    expect(plots[0]).toMatchObject({ color: C.green, lineWidth: 1 })
    expect(plots[0].style).toBeUndefined()
    expect(plots[1]).toMatchObject({ color: C.red, style: 'cross' })
    expect(plots[2]).toMatchObject({
      color: C.blue,
      style: 'area',
      transp: WT_AREA_TRANSPARENCY,
      values: calculateWaveTrend(candles, settings).diff,
    })
    expect(WT_AREA_TRANSPARENCY).toBe(80)
    const levels = plots.slice(3)
    expect(levels.every((plot) => plot.hideLegend === true)).toBe(true)
    expect(levels.map((plot) => plot.horizontalLine)).toEqual([0, 55, -55, 45, -45])
    expect(levels.map((plot) => plot.color)).toEqual([C.gray, C.red, C.green, C.red, C.green])
    expect(levels.map((plot) => plot.style)).toEqual(['line', 'line', 'line', 'cross', 'cross'])
    expect(
      levels.every((plot) => plot.values.every((value) => value === plot.horizontalLine)),
    ).toBe(true)
  })
  it('is exposed as a built-in oscillator pane that only reports finite values', () => {
    const plots = builtInPlots(candles, { ...indicator })
    expect(plots).toHaveLength(8)
    for (const plot of plots)
      expect(plot.values.every((value) => value === null || Number.isFinite(value))).toBe(true)
    expect(builtInPlots([], { ...indicator })).toHaveLength(8)
  })
})
