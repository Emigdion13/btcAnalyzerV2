import { describe, expect, it } from 'vitest'
import { ta } from './indicator-runtime'
import { builtInPlots, INDICATOR_CATALOG } from './indicators'
import { ASSETS, generateCandles } from './market'
import type { Candle, Indicator } from './types'

describe('technical-analysis helpers', () => {
  it('computes a simple moving average with explicit warm-up values', () => {
    expect(ta.sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(ta.sma([1, 2, null, 4, 5, 6], 2)).toEqual([null, 1.5, null, null, 4.5, 5.5])
  })
  it('seeds EMA with an SMA, and resets cleanly across missing data', () => {
    expect(ta.ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(ta.ema([1, 3, null, 5, 7, 9], 2)).toEqual([null, 2, null, null, 6, 8])
  })
  it('uses Wilder smoothing for RSI', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0,
    ]
    const values = ta.rsi(prices, 14)
    expect(values.slice(0, 14).every((v) => v === null)).toBe(true)
    expect(values[14]).toBeCloseTo(70.4641, 3)
    expect(values[15]).toBeCloseTo(66.2496, 3)
    expect(ta.rsi([1, 2, 3, 4, 5], 3).at(-1)).toBe(100)
    expect(ta.rsi([5, 4, 3, 2, 1], 3).at(-1)).toBe(0)
    expect(ta.rsi([2, 2, 2, 2, 2], 3).at(-1)).toBe(50)
  })
  it('calculates population deviation and rolling extrema', () => {
    expect(ta.stdev([1, 2, 3], 3)[2]).toBeCloseTo(Math.sqrt(2 / 3))
    expect(ta.highest([3, 2, 5, 1], 2)).toEqual([null, 3, 5, 5])
    expect(ta.lowest([3, 2, 5, 1], 2)).toEqual([null, 2, 2, 1])
    expect(ta.highest([1, null, 2, 3], 2)).toEqual([null, null, null, 3])
  })
  it('finds crossovers and handles warm-up values', () => {
    expect(ta.crossover([1, 2, 3, 1, 4], [2, 2, 2, 2, 2])).toEqual([
      false,
      false,
      true,
      false,
      true,
    ])
    expect(ta.crossover([null, 2, 3], [1, 1, 1])).toEqual([false, false, false])
  })
  it.each([0, -1, 2.4, NaN, Infinity, 2001])('rejects invalid periods (%s)', (period) => {
    for (const fn of [ta.sma, ta.ema, ta.rsi, ta.stdev, ta.highest, ta.lowest])
      expect(() => fn([1, 2, 3], period)).toThrow(/Period/)
  })
  it('allows longer warm-up periods than the available chart history', () => {
    expect(ta.sma([1, 2, 3], 20)).toEqual([null, null, null])
    expect(ta.ema([1, 2, 3], 20)).toEqual([null, null, null])
  })
})

describe('built-in chart indicators', () => {
  it.each(INDICATOR_CATALOG)('produces bounded, aligned values for $name', (item) => {
    const candles = generateCandles(ASSETS[0], '1h')
    const indicator: Indicator = { ...item, id: item.kind, name: item.short, visible: true }
    const plots = builtInPlots(candles, indicator)
    for (const plot of plots) {
      expect(plot.values).toHaveLength(candles.length)
      expect(plot.values.every((v) => v === null || Number.isFinite(v))).toBe(true)
      if (item.kind === 'rsi')
        expect(plot.values.filter((v) => v !== null).every((v) => v! >= 0 && v! <= 100)).toBe(true)
    }
  })
  it('resets VWAP at each UTC day boundary', () => {
    const bar = (time: number, price: number, volume: number): Candle => ({
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
    })
    const candles = [bar(86280, 10, 1), bar(86340, 20, 3), bar(86400, 30, 2), bar(86460, 40, 2)]
    const indicator: Indicator = {
      id: 'vwap',
      name: 'VWAP',
      kind: 'vwap',
      color: '#b9ee82',
      period: 1,
      visible: true,
    }
    expect(builtInPlots(candles, indicator)[0].values).toEqual([10, 17.5, 30, 35])
  })
})
