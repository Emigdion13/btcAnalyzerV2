import { describe, expect, it } from 'vitest'
import {
  calculateSmartMoneyConcepts,
  displayedSmcResult,
  findSmcPivots,
  isSmartMoneyConceptsSettings,
  smcAtr,
  smcPalette,
  smcSettings,
} from './smart-money-concepts'
import { ASSETS, generateCandles } from './market'
import { SMC_DEFAULTS, type Candle, type Indicator } from './types'

const candle = (high: number, low: number, close: number, time = 0): Candle => ({
  time,
  open: (high + low) / 2,
  high,
  low,
  close,
  volume: 1,
})
const series = (rows: [number, number, number][]) =>
  rows.map(([high, low, close], index) => candle(high, low, close, index * 3600))

const structural = series([
  [10, 6, 8],
  [12, 7, 10],
  [15, 9, 14],
  [13, 8, 10],
  [11, 4, 5],
  [12, 6, 8],
  [17, 11, 16],
  [14, 8, 13],
  [13, 7, 8],
  [10, 3, 3],
  [9, 4, 5],
  [11, 5, 8],
])

const quick = {
  ...SMC_DEFAULTS,
  swingLength: 2,
  equalHighLowBars: 1,
}

describe('Smart Money Concepts settings', () => {
  it('keeps the requested familiar defaults without relying on vendor source', () => {
    expect(SMC_DEFAULTS).toMatchObject({
      mode: 'Historical',
      style: 'Colored',
      internalBullish: 'All',
      internalBearish: 'All',
      internalLabelSize: 'Tiny',
      swingBullish: 'All',
      swingBearish: 'All',
      swingLabelSize: 'Small',
      swingLength: 50,
      internalOrderBlockCount: 5,
      swingOrderBlockCount: 5,
      orderBlockFilter: 'Atr',
      orderBlockMitigation: 'High/Low',
      equalHighLowBars: 3,
      equalHighLowThreshold: 0.1,
      equalHighLowLabelSize: 'Tiny',
      fvgTimeframe: '',
      fvgExtend: 1,
      dailyLineStyle: '⎯⎯⎯',
      weeklyLineStyle: '⎯⎯⎯',
      monthlyLineStyle: '⎯⎯⎯',
    })
  })

  it('validates every persisted setting boundary and falls back safely for legacy indicators', () => {
    expect(isSmartMoneyConceptsSettings({ ...SMC_DEFAULTS })).toBe(true)
    for (const invalid of [
      { ...SMC_DEFAULTS, mode: 'Live' },
      { ...SMC_DEFAULTS, swingLength: 1 },
      { ...SMC_DEFAULTS, internalOrderBlockCount: 2.5 },
      { ...SMC_DEFAULTS, equalHighLowThreshold: 0.6 },
      { ...SMC_DEFAULTS, fvgTimeframe: '60' },
      { ...SMC_DEFAULTS, showFairValueGaps: 'true' },
    ])
      expect(isSmartMoneyConceptsSettings(invalid)).toBe(false)
    const legacy: Indicator = {
      id: 'smc',
      kind: 'smart-money-concepts',
      name: 'Smart Money Concepts',
      period: 50,
      color: '#089981',
      visible: true,
    }
    expect(smcSettings(legacy)).toEqual(SMC_DEFAULTS)
  })

  it('switches every native annotation to a neutral palette in monochrome mode', () => {
    const palette = smcPalette({ ...SMC_DEFAULTS, style: 'Monochrome' })
    expect(palette.internalBull).toBe(palette.internalBear)
    expect(palette.swingBull).toBe(palette.swingBear)
    expect(palette.bullFvg).not.toBe('#00b878')
    expect(palette.bearFvg).not.toBe('#ef5350')
  })
})

describe('Smart Money Concepts calculation', () => {
  it('confirms pivots and labels their HH/HL/LH/LL relationship', () => {
    const pivots = findSmcPivots(structural, 2)
    expect(pivots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 2, kind: 'high', label: 'HH', confirmedAt: 4 }),
        expect.objectContaining({ index: 4, kind: 'low', label: 'LL', confirmedAt: 6 }),
      ]),
    )
    expect(() => findSmcPivots(structural, 0)).toThrow(/Pivot length/)
  })

  it('classifies close-based swing continuation and reversal breaks as BOS and CHoCH', () => {
    const result = calculateSmartMoneyConcepts(structural, quick)
    expect(result.swingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'bullish',
          type: 'BOS',
          pivotIndex: 2,
          breakIndex: 6,
          price: 15,
        }),
        expect.objectContaining({
          side: 'bearish',
          type: 'CHoCH',
          pivotIndex: 4,
          breakIndex: 9,
          price: 4,
        }),
      ]),
    )
    expect(result.trend[6]).toBe(1)
    expect(result.trend[9]).toBe(-1)
  })

  it('creates active opposite-candle order blocks and records mitigation with the selected source', () => {
    const result = calculateSmartMoneyConcepts(structural.slice(0, 8), quick)
    expect(result.swingOrderBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'bullish',
          kind: 'swing',
          startIndex: 5,
          createdIndex: 6,
          top: 12,
          bottom: 6,
          mitigatedAt: 7,
        }),
      ]),
    )
    const closeOnly = calculateSmartMoneyConcepts(structural.slice(0, 8), {
      ...quick,
      orderBlockMitigation: 'Close',
    })
    expect(closeOnly.swingOrderBlocks[0]?.mitigatedAt).toBeUndefined()
  })

  it('detects ATR-scaled equal levels and three-candle fair value gaps', () => {
    const equal = series([
      [10, 5, 7],
      [12, 6, 9],
      [15, 8, 14],
      [12, 6, 8],
      [13, 5, 9],
      [14.98, 7, 13],
      [12, 6, 8],
    ])
    const levels = calculateSmartMoneyConcepts(equal, quick).equalLevels
    expect(levels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'high', firstIndex: 2, secondIndex: 5 }),
      ]),
    )
    const gaps = calculateSmartMoneyConcepts(
      series([
        [10, 5, 7],
        [14, 8, 13],
        [17, 12, 16],
        [19, 13, 18],
      ]),
      { ...quick, showFairValueGaps: true },
    ).fairValueGaps
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'bullish', startIndex: 1, top: 12, bottom: 10 }),
      ]),
    )
  })

  it('uses a separately supplied native FVG timeframe without resampling chart bars', () => {
    const chart = Array.from({ length: 20 }, (_, index) => candle(10, 5, 7, index * 3600))
    const fourHour = [
      candle(10, 5, 7, 0),
      candle(14, 8, 13, 4 * 3600),
      candle(17, 12, 16, 8 * 3600),
      candle(19, 13, 18, 12 * 3600),
    ]
    const result = calculateSmartMoneyConcepts(
      chart,
      { ...quick, showFairValueGaps: true, fvgTimeframe: '4h' },
      { timeframe: '1h', timeframes: { '4h': { candles: fourHour } } },
    )
    expect(result.fairValueGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'bullish',
          startTime: 4 * 3600,
          endTime: 12 * 3600,
          top: 12,
          bottom: 10,
        }),
      ]),
    )
  })

  it('produces visible native markup for the default demo history', () => {
    const result = calculateSmartMoneyConcepts(generateCandles(ASSETS[0], '1h'), {
      ...SMC_DEFAULTS,
    })
    expect(result.internalEvents.length).toBeGreaterThan(0)
    expect(result.internalOrderBlocks.length).toBeGreaterThan(0)
    expect(result.equalLevels.length).toBeGreaterThan(0)
  })

  it('uses finite ATR values on a short chart and scopes Present markup to the latest set', () => {
    expect(smcAtr(structural.slice(0, 2)).every(Number.isFinite)).toBe(true)
    const result = calculateSmartMoneyConcepts(structural, quick)
    const present = displayedSmcResult(result, { ...quick, mode: 'Present' })
    expect(present.internalEvents.length).toBeLessThanOrEqual(4)
    expect(present.swingEvents.length).toBeLessThanOrEqual(4)
    expect(present.swingPivots.length).toBeLessThanOrEqual(2)
  })
})
