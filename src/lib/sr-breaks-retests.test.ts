import { describe, expect, it } from 'vitest'
import {
  calculateSrBreaks,
  isSrBreaksSettings,
  srAtr,
  srBreaksIndicatorLabel,
  srBreaksSettings,
  srDeltaVolume,
  srGradient,
  srPivots,
  srRma,
  srVolumeText,
} from './sr-breaks-retests'
import { ASSETS, generateCandles } from './market'
import { SR_BREAKS_DEFAULTS } from './types'
import type { Candle, Indicator, SrBreaksSettings } from './types'

/** Uniform bars: `high`/`low` straddle the close, so a cross is driven by the close. */
function bar(index: number, close: number, volume: number, open = close - 0.1): Candle {
  return {
    time: 1_700_000_000 + index * 60,
    open,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
  }
}

function settings(overrides: Partial<SrBreaksSettings> = {}): SrBreaksSettings {
  return {
    ...SR_BREAKS_DEFAULTS,
    lookbackPeriod: 2,
    volumeFilterLength: 2,
    atrLength: 2,
    boxWidth: 1,
    maxBoxes: 50,
    ...overrides,
  }
}

/** Bullish series with a confirmed pivot low of 8 at index 4. */
const supportCloses = [10, 9, 8, 9, 10, 11, 12, 11, 10, 9]
const supportVolumes = [10, 10, 10, 10, 100, 10, 10, 10, 10, 10]
const supportCandles = supportCloses.map((close, index) => bar(index, close, supportVolumes[index]))

/** Bearish series: resistance at 12, broken at 6, held back at 7, broken again at 8. */
const retestCloses = [10, 11, 12, 11, 12, 12.5, 15, 13.5, 16]
const retestCandles = retestCloses.map((close, index) => bar(index, close, 10, close + 0.1))

describe('SR Breaks and Retests primitives', () => {
  it('signs volume by bar direction and carries the direction across dojis', () => {
    const candles: Candle[] = [
      { time: 60, open: 9, high: 11, low: 8, close: 10, volume: 5 },
      { time: 120, open: 11, high: 12, low: 9, close: 9, volume: 7 },
      // Doji keeps the previous (sell) direction, exactly like the `var` flag.
      { time: 180, open: 9, high: 10, low: 8, close: 9, volume: 3 },
      { time: 240, open: 8, high: 12, low: 7, close: 11, volume: 4 },
    ]
    expect(srDeltaVolume(candles)).toEqual([5, -7, -3, 4])
  })

  it('seeds the RMA with an SMA and stays undefined during warm-up', () => {
    expect(srRma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.25, 3.125])
    expect(srRma([2, 2, 2, 2], 4)).toEqual([null, null, null, 2])
    expect(() => srRma([1], 0)).toThrow(/RMA length/)
  })

  it('smooths true range into ATR', () => {
    const flat = Array.from({ length: 4 }, (_, index) => ({
      time: index * 60,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 1,
    }))
    expect(srAtr(flat, 2)).toEqual([null, 2, 2, 2])
  })

  it('confirms close-based pivots one lookback late and accepts plateaus', () => {
    const closes = [10, 9, 8, 9, 10, 11, 12, 11, 10, 9]
    expect(srPivots(closes, 2, 'low')).toEqual([
      null,
      null,
      null,
      null,
      8,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(srPivots(closes, 2, 'high')[8]).toBe(12)
    // Pine compares with `>=`, so equal neighbours still form a pivot.
    expect(srPivots([1, 2, 3, 3, 2], 2, 'high')[4]).toBe(3)
    expect(() => srPivots(closes, 0, 'low')).toThrow(/Pivot length/)
  })

  it('formats the box volume caption', () => {
    expect(srVolumeText(1234.567)).toBe('Vol: 1234.57')
    expect(srVolumeText(-8)).toBe('Vol: -8')
    expect(srVolumeText(1234567)).toBe('Vol: 1.23M')
  })

  it('interpolates the gradient like color.from_gradient', () => {
    expect(srGradient(0, 0, 100, 0, 0.7)).toBe(0)
    expect(srGradient(100, 0, 100, 0, 0.7)).toBeCloseTo(0.7)
    expect(srGradient(50, 0, 100, 0, 0.7)).toBeCloseTo(0.35)
    // Outside the range the color is clamped, which is how a red box with a
    // positive delta volume ends up fully transparent.
    expect(srGradient(500, 0, 100, 0, 0.7)).toBeCloseTo(0.7)
    expect(srGradient(-500, 0, 100, 0, 0.7)).toBe(0)
    expect(srGradient(-5, -10, 0, 0.7, 0)).toBeCloseTo(0.35)
    expect(srGradient(3, 3, 3, 0, 0.7)).toBeCloseTo(0.7)
  })
})

describe('SR Breaks and Retests calculation', () => {
  it('builds a volume-filtered support box that extends past the last bar', () => {
    const result = calculateSrBreaks(supportCandles, settings())
    expect(result.boxes).toHaveLength(1)
    const box = result.boxes[0]
    expect(box.kind).toBe('support')
    expect(box.level).toBe(8)
    expect(box.startIndex).toBe(2)
    // The live box always stretches one bar past the newest candle.
    expect(box.endIndex).toBe(supportCandles.length)
    expect(box.outer).toBeCloseTo(8 - (result.atr[4] as number))
    expect(box.volume).toBe(100)
    // Vol equals the 25-bar maximum here, so the gradient reaches full strength.
    expect(box.fillOpacity).toBeCloseTo(0.7)
    expect(box.state).toBe('active')
  })

  it('scales the fill gradient by the measured volume', () => {
    const closes = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12]
    const volumes = [10, 10, 10, 10, 100, 10, 10, 10, 10, 10]
    const candles = closes.map((close, index) => bar(index, close, volumes[index]))
    const result = calculateSrBreaks(candles, settings())
    expect(result.boxes.map((box) => box.level)).toEqual([8, 8.2])
    // The second box measured 10 against a 100 maximum: 10% of the gradient.
    expect(result.boxes[1].fillOpacity).toBeCloseTo(0.07)
  })

  it('flags a broken support and labels the bar before the break', () => {
    const closes = [10, 9, 8, 9, 10, 8, 6, 4, 3, 2]
    const candles = closes.map((close, index) => bar(index, close, supportVolumes[index]))
    const result = calculateSrBreaks(candles, settings())
    expect(result.boxes).toHaveLength(1)
    expect(result.boxes[0].state).toBe('broken')
    expect(result.labels).toEqual([{ index: 5, price: 8, kind: 'support', text: 'Break Sup' }])
  })

  it('marks a support hold when price reclaims the level', () => {
    const closes = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12]
    const candles = closes.map((close, index) => bar(index, close, supportVolumes[index]))
    const result = calculateSrBreaks(candles, settings())
    // `belowbar` anchors on the plotted bar's low: close 8.2 - 0.5.
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]).toMatchObject({ index: 7, plotIndex: 6, kind: 'support-holds' })
    expect(result.signals[0].price).toBeCloseTo(7.7)
    expect(result.labels).toEqual([])
  })

  it('freezes a replaced box at the bar the newer box appears', () => {
    const closes = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12]
    const candles = closes.map((close, index) => bar(index, close, supportVolumes[index]))
    const result = calculateSrBreaks(candles, settings())
    expect(result.boxes.map((box) => [box.startIndex, box.endIndex])).toEqual([
      [2, 8],
      [6, 10],
    ])
  })

  it('reports the first resistance break, then the retest without a second label', () => {
    const result = calculateSrBreaks(retestCandles, settings())
    expect(result.boxes).toHaveLength(1)
    expect(result.boxes[0]).toMatchObject({ kind: 'resistance', level: 12, state: 'broken' })
    // `res_is_sup[1]` is true on the second breakout, so it plots the green
    // "Resistance as Support Holds" diamond and suppresses the break label.
    expect(result.signals).toEqual([
      { index: 8, plotIndex: 7, kind: 'resistance-as-support', price: 13 },
    ])
    expect(result.labels).toEqual([{ index: 5, price: 12, kind: 'resistance', text: 'Break Res' }])
  })

  it('keeps hold signals while ATR is still warming up', () => {
    const closes = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12]
    const candles = closes.map((close, index) => bar(index, close, supportVolumes[index]))
    const result = calculateSrBreaks(candles, settings({ atrLength: 200 }))
    expect(result.atr.every((value) => value === null)).toBe(true)
    expect(result.boxes).toEqual([])
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]).toMatchObject({ index: 7, plotIndex: 6, kind: 'support-holds' })
    expect(result.signals[0].price).toBeCloseTo(7.7)
  })

  it('caps the retained boxes like max_boxes_count', () => {
    const closes = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12]
    const candles = closes.map((close, index) => bar(index, close, supportVolumes[index]))
    const result = calculateSrBreaks(candles, settings({ maxBoxes: 1 }))
    expect(result.boxes.map((box) => box.level)).toEqual([8.2])
  })

  it('returns an empty result for an empty chart', () => {
    expect(calculateSrBreaks([], settings())).toEqual({
      boxes: [],
      signals: [],
      labels: [],
      deltaVolume: [],
      atr: [],
    })
  })

  it('produces the same markup on repeated runs over demo history', () => {
    const candles = generateCandles(ASSETS[0], '1h')
    const first = calculateSrBreaks(candles, SR_BREAKS_DEFAULTS)
    const second = calculateSrBreaks(candles, SR_BREAKS_DEFAULTS)
    expect(first).toEqual(second)
    expect(first.boxes.length).toBeGreaterThan(0)
    expect(first.boxes.length).toBeLessThanOrEqual(SR_BREAKS_DEFAULTS.maxBoxes)
    for (const box of first.boxes) {
      expect(box.startIndex).toBeGreaterThanOrEqual(0)
      expect(box.endIndex).toBeGreaterThan(box.startIndex)
      expect(box.endIndex).toBeLessThanOrEqual(candles.length)
      expect(Number.isFinite(box.level)).toBe(true)
      expect(Number.isFinite(box.outer)).toBe(true)
      expect(box.fillOpacity).toBeGreaterThanOrEqual(0)
      expect(box.fillOpacity).toBeLessThanOrEqual(0.7)
    }
    for (const signal of first.signals) {
      expect(signal.plotIndex).toBe(signal.index - 1)
      expect(signal.index).toBeLessThan(candles.length)
    }
  })
})

describe('SR Breaks and Retests settings', () => {
  const indicator: Indicator = {
    id: 'sr',
    kind: 'sr-breaks-retests',
    name: 'SR Breaks and Retests',
    period: 20,
    color: '#008000',
    visible: true,
  }

  it('falls back to the original defaults', () => {
    expect(srBreaksSettings(indicator)).toEqual(SR_BREAKS_DEFAULTS)
    expect(srBreaksIndicatorLabel(indicator)).toBe('SR Breaks and Retests [ChartPrime] (20, 2, 1)')
  })

  it('reflects edited inputs in the label', () => {
    const edited = {
      ...indicator,
      sr: { ...SR_BREAKS_DEFAULTS, lookbackPeriod: 30, volumeFilterLength: 5, boxWidth: 0.5 },
    }
    expect(srBreaksIndicatorLabel(edited)).toBe('SR Breaks and Retests [ChartPrime] (30, 5, 0.5)')
  })

  it.each([
    ['a fractional lookback', { lookbackPeriod: 2.5 }],
    ['a zero lookback', { lookbackPeriod: 0 }],
    ['a negative box width', { boxWidth: -1 }],
    ['an oversized box width', { boxWidth: 1001 }],
    ['a zero ATR length', { atrLength: 0 }],
    ['a fractional volume filter', { volumeFilterLength: 1.5 }],
    ['a non-boolean toggle', { showBoxes: 'yes' }],
    ['a missing field', undefined],
  ])('rejects %s', (_label, overrides) => {
    const candidate =
      overrides === undefined
        ? undefined
        : { ...SR_BREAKS_DEFAULTS, ...(overrides as Partial<SrBreaksSettings>) }
    expect(isSrBreaksSettings(candidate)).toBe(false)
    if (candidate) expect(() => calculateSrBreaks(supportCandles, candidate)).toThrow(/Invalid SR/)
  })

  it('accepts the published input profile', () => {
    expect(isSrBreaksSettings(SR_BREAKS_DEFAULTS)).toBe(true)
    expect(
      isSrBreaksSettings({ ...SR_BREAKS_DEFAULTS, boxWidth: 0, maxBoxes: 1, atrLength: 1 }),
    ).toBe(true)
  })
})
