import { describe, expect, it } from 'vitest'
import {
  DIVERGENCE_COLORS,
  detectMacdDivergences,
  divergenceEnabled,
  divergenceSettings,
  isDivergenceSettings,
  pivotIndices,
} from './macd-divergence'
import { macdHistogram } from './indicators'
import { DIVERGENCE_DEFAULTS } from './types'
import type { Candle, DivergenceSettings, Indicator } from './types'

const defaults: DivergenceSettings = { ...DIVERGENCE_DEFAULTS }
const bars = (lows: number[], highs: number[] = lows): Candle[] =>
  lows.map((low, i) => ({
    time: i * 3600,
    open: (low + highs[i]) / 2,
    high: highs[i],
    low,
    close: (low + highs[i]) / 2,
    volume: 1,
  }))

describe('pivotIndices', () => {
  it('confirms a pivot only with strictly lower/higher neighbours on both sides', () => {
    const values = [3, 2, 1, 2, 3, 4, 5, 4, 3]
    const { lows, highs } = pivotIndices(values, 2)
    expect(lows[2]).toBe(true)
    expect(highs[6]).toBe(true)
    // Edges lack a full window on one side.
    expect(lows.slice(0, 2).every((v) => v === false)).toBe(true)
    expect(highs.at(-1)).toBe(false)
  })
  it('treats plateaus (ties) as non-pivots', () => {
    const { lows } = pivotIndices([3, 1, 1, 1, 3], 1)
    expect(lows.every((v) => v === false)).toBe(true)
  })
  it('never marks a bar without enough neighbours or with nulls in the window', () => {
    const { lows, highs } = pivotIndices([1, null, 1, 2, 3], 2)
    expect(lows.every((v) => v === false)).toBe(true)
    expect(highs.every((v) => v === false)).toBe(true)
  })
})

describe('detectMacdDivergences', () => {
  it('flags regular bullish: price lower low, histogram higher low', () => {
    // Two histogram pivot lows at indices 2 and 8; second is a higher low.
    const hist = [0, -2, -5, -2, 0, 1, 0, -1, -3, -1, 0]
    const priceLows = [10, 9, 8, 9, 10, 11, 10, 9, 7, 9, 10] // price lower low at 8
    const candles = bars(priceLows)
    const found = detectMacdDivergences(candles, hist, {
      ...defaults,
      pivotLookback: 2,
      rangeLower: 1,
      rangeUpper: 20,
    })
    const bull = found.find((d) => d.kind === 'regular-bullish')
    expect(bull).toBeTruthy()
    expect(bull!.fromIndex).toBe(2)
    expect(bull!.toIndex).toBe(8)
    expect(bull!.color).toBe(DIVERGENCE_COLORS.regularBullish)
  })

  it('flags hidden bullish: price higher low, histogram lower low', () => {
    const hist = [0, -2, -3, -2, 0, 1, 0, -1, -5, -1, 0]
    const priceLows = [10, 9, 8, 9, 10, 11, 10, 9.5, 8.5, 9, 10] // higher low at 8
    const candles = bars(priceLows)
    const found = detectMacdDivergences(candles, hist, {
      ...defaults,
      pivotLookback: 2,
      rangeLower: 1,
      rangeUpper: 20,
    })
    const hidden = found.find((d) => d.kind === 'hidden-bullish')
    expect(hidden).toBeTruthy()
    expect(hidden!.hidden).toBe(true)
    expect(hidden!.color).toBe(DIVERGENCE_COLORS.hiddenBullish)
  })

  it('flags regular and hidden bearish from histogram pivot highs', () => {
    const hist = [0, 2, 5, 2, 0, -1, 0, 1, 3, 1, 0]
    const regularHighs = [10, 11, 12, 11, 10, 9, 10, 11, 13, 11, 10] // higher high at 8, hist lower high
    const regular = detectMacdDivergences(bars(regularHighs, regularHighs), hist, {
      ...defaults,
      pivotLookback: 2,
      rangeLower: 1,
      rangeUpper: 20,
    })
    expect(regular.find((d) => d.kind === 'regular-bearish')).toBeTruthy()

    const hist2 = [0, 2, 3, 2, 0, -1, 0, 1, 5, 1, 0] // histogram higher high at 8
    const lowerHighs = [10, 11, 12, 11, 10, 9, 10, 10.5, 11.5, 10.5, 10] // lower high at 8
    const hidden = detectMacdDivergences(bars(lowerHighs, lowerHighs), hist2, {
      ...defaults,
      pivotLookback: 2,
      rangeLower: 1,
      rangeUpper: 20,
    })
    expect(hidden.find((d) => d.kind === 'hidden-bearish')).toBeTruthy()
  })

  it('respects the pivot gap range and the type toggles', () => {
    const hist = [0, -2, -5, -2, 0, 1, 0, -1, -3, -1, 0]
    const priceLows = [10, 9, 8, 9, 10, 11, 10, 9, 7, 9, 10]
    const candles = bars(priceLows)
    // Gap of 6 exceeds rangeUpper 4 → nothing.
    expect(
      detectMacdDivergences(candles, hist, {
        ...defaults,
        pivotLookback: 2,
        rangeLower: 1,
        rangeUpper: 4,
      }),
    ).toEqual([])
    // Regular disabled → no regular bullish.
    expect(
      detectMacdDivergences(candles, hist, {
        ...defaults,
        pivotLookback: 2,
        rangeLower: 1,
        rangeUpper: 20,
        showRegular: false,
      }).find((d) => !d.hidden),
    ).toBeUndefined()
  })

  it('returns nothing when both types are off or settings are invalid', () => {
    const hist = [0, -2, -5, -2, 0]
    expect(
      detectMacdDivergences(bars([1, 1, 1, 1, 1]), hist, {
        ...defaults,
        showRegular: false,
        showHidden: false,
      }),
    ).toEqual([])
  })
})

describe('settings helpers', () => {
  it('validates divergence settings', () => {
    expect(isDivergenceSettings(defaults)).toBe(true)
    expect(isDivergenceSettings({ ...defaults, rangeUpper: 2, rangeLower: 5 })).toBe(false)
    expect(isDivergenceSettings({ ...defaults, pivotLookback: 0 })).toBe(false)
    expect(isDivergenceSettings({ ...defaults, showRegular: 'yes' })).toBe(false)
    expect(isDivergenceSettings(null)).toBe(false)
  })
  it('falls back to defaults and reports enablement per kind', () => {
    const macd: Indicator = {
      id: 'm',
      kind: 'macd',
      name: 'MACD',
      period: 12,
      color: '#7eacf3',
      visible: true,
    }
    expect(divergenceSettings(macd)).toEqual(defaults)
    expect(divergenceEnabled(macd)).toBe(false)
    expect(divergenceEnabled({ ...macd, divergence: { ...defaults } })).toBe(true)
    expect(
      divergenceEnabled({
        ...macd,
        divergence: { ...defaults, showRegular: false, showHidden: false },
      }),
    ).toBe(false)
    // Non-MACD kinds never enable divergence.
    expect(divergenceEnabled({ ...macd, kind: 'rsi', divergence: { ...defaults } })).toBe(false)
  })
})

describe('macdHistogram source', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1)
  const candles: Candle[] = closes.map((close, i) => ({
    time: i * 3600,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }))
  it('returns an aligned histogram for the conventional MACD', () => {
    const indicator: Indicator = {
      id: 'm',
      kind: 'macd',
      name: 'MACD',
      period: 12,
      color: '#7eacf3',
      visible: true,
    }
    const hist = macdHistogram(candles, indicator)
    expect(hist).not.toBeNull()
    expect(hist!).toHaveLength(candles.length)
    expect(hist!.some((v) => v !== null)).toBe(true)
  })
  it('returns an aligned histogram for CM_Ult_MacD_MTF and null for others', () => {
    const cm: Indicator = {
      id: 'cm',
      kind: 'cm-ult-macd',
      name: 'CM_Ult_MacD_MTF',
      period: 12,
      color: '#00ff00',
      visible: true,
    }
    const hist = macdHistogram(candles, cm)
    expect(hist).not.toBeNull()
    expect(hist!).toHaveLength(candles.length)
    expect(macdHistogram(candles, { ...cm, kind: 'rsi' })).toBeNull()
  })
})
