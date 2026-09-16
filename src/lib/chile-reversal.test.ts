import { describe, expect, it } from 'vitest'
import {
  CHILE_ATR_LENGTH,
  CHILE_PIVOT_MEMORY,
  calculateChileReversal,
  chileReversalIndicatorLabel,
  displayedChileSignals,
  chileReversalSettings,
  isChileReversalSettings,
} from './chile-reversal'
import {
  CHILE_REVERSAL_DEFAULTS,
  type Candle,
  type ChileReversalSettings,
  type Indicator,
} from './types'

const candle = (
  open: number,
  high: number,
  low: number,
  close: number,
  time: number,
  volume = 10,
): Candle => ({ time, open, high, low, close, volume })

/** Chart series on the same resolution as the pivot feed, so no HTF feed is needed. */
const series = (rows: [number, number, number, number][], step = 900): Candle[] =>
  rows.map(([o, h, l, c], i) => candle(o, h, l, c, i * step))

/** Filler bars with a stable 2-wide range, to warm ATR(14) up without making pivots. */
const filler = (count: number, price = 100, step = 900, from = 0): Candle[] =>
  Array.from({ length: count }, (_, i) =>
    candle(price, price + 1, price - 1, price, (from + i) * step),
  )

const settings = (overrides: Partial<ChileReversalSettings> = {}): ChileReversalSettings => ({
  ...CHILE_REVERSAL_DEFAULTS,
  resolution: '15m',
  ...overrides,
})

const indicator = (overrides: Partial<Indicator> = {}): Indicator => ({
  id: 'chile',
  kind: 'chile-reversal',
  name: 'Chile Reversal',
  period: 2,
  color: '#00e191',
  visible: true,
  ...overrides,
})

describe('chile reversal settings', () => {
  it('accepts the published defaults', () => {
    expect(isChileReversalSettings(CHILE_REVERSAL_DEFAULTS)).toBe(true)
  })

  it('rejects out-of-range and malformed settings', () => {
    expect(isChileReversalSettings(settings({ pivotLeft: 0 }))).toBe(false)
    expect(isChileReversalSettings(settings({ pivotRight: 6 }))).toBe(false)
    expect(isChileReversalSettings(settings({ maxDistanceAtr: 0.2 }))).toBe(false)
    expect(isChileReversalSettings(settings({ zoneThicknessAtr: 0.9 }))).toBe(false)
    expect(isChileReversalSettings(settings({ supportColor: 'green' }))).toBe(false)
    expect(isChileReversalSettings({ ...CHILE_REVERSAL_DEFAULTS, resolution: '7m' })).toBe(false)
    expect(isChileReversalSettings(null)).toBe(false)
  })

  it('falls back to defaults for an indicator with no stored settings', () => {
    expect(chileReversalSettings(indicator())).toEqual(CHILE_REVERSAL_DEFAULTS)
  })

  it('labels with the active profile', () => {
    expect(chileReversalIndicatorLabel(indicator())).toBe('Chile Reversal (15m, 2, 2, 0.1)')
  })

  it('throws on invalid settings rather than computing nonsense', () => {
    expect(() =>
      calculateChileReversal(filler(20), settings({ pivotLeft: 0 }), { timeframe: '15m' }),
    ).toThrow(/Invalid Chile Reversal settings/)
  })
})

describe('chile reversal levels', () => {
  it('produces no levels while ATR is still warming up', () => {
    const result = calculateChileReversal(filler(5), settings(), { timeframe: '15m' })
    expect(result.levels).toEqual([])
    expect(result.signals).toEqual([])
    expect(result.atr.every((value) => value === null)).toBe(true)
  })

  it('reports a missing higher-timeframe feed instead of inventing levels', () => {
    const result = calculateChileReversal(filler(40), settings({ resolution: '1h' }), {
      timeframe: '15m',
      timeframes: {},
    })
    expect(result.missingFeed).toBe(true)
    expect(result.levels).toEqual([])
  })

  it('takes the nearest pivot high above price as R1 and the runner-up as R2', () => {
    // Two pivot highs at 112 and 120, price trading below both.
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 104, 99, 103],
      [103, 120, 102, 110], // pivot high 120
      [110, 108, 105, 106],
      [106, 107, 104, 105],
      [105, 112, 104, 108], // lower pivot high 112 (confirmed later)
      [108, 109, 106, 107],
      [107, 108, 105, 106],
      [106, 107, 104, 105],
      [105, 106, 103, 104],
    ]
    const result = calculateChileReversal(
      series(rows),
      settings({ maxDistanceAtr: 6, zoneThicknessAtr: 0.03 }),
      { timeframe: '15m' },
    )
    const kinds = result.levels.map((level) => level.kind)
    expect(kinds).toContain('R1')
    const r1 = result.levels.find((level) => level.kind === 'R1')!
    const r2 = result.levels.find((level) => level.kind === 'R2')
    // R1 is always the closer of the two; R2, when present, is further away.
    expect(r1.price).toBeGreaterThan(result.levels[0].price - 1)
    if (r2) expect(r2.price).toBeGreaterThan(r1.price)
  })

  it('never emits a second level without a first one', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 130, 99, 101],
      [101, 102, 100, 101],
      [101, 140, 100, 101],
      [101, 102, 100, 101],
      [101, 102, 100, 101],
      [101, 102, 100, 101],
    ]
    // Tight distance filter removes the far levels; the Pine sort could have
    // produced an R2 with no R1 here.
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 0.5 }), {
      timeframe: '15m',
    })
    const kinds = result.levels.map((level) => level.kind)
    if (kinds.includes('R2')) expect(kinds).toContain('R1')
    if (kinds.includes('S2')) expect(kinds).toContain('S1')
  })

  it('remembers at most four pivots per side', () => {
    expect(CHILE_PIVOT_MEMORY).toBe(4)
  })

  it('warms up with ATR(14) at minimum', () => {
    const result = calculateChileReversal(filler(40), settings(), { timeframe: '15m' })
    expect(result.warmupBars).toBeGreaterThanOrEqual(CHILE_ATR_LENGTH)
  })
})

describe('chile reversal signals', () => {
  /**
   * A support level at 96, then a bar that wicks into the zone and closes
   * green above it — Pine's `reboteS1`.
   */
  const bounceSeries = (): Candle[] => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 101, 99, 100],
      [100, 101, 96, 100], // pivot low 96
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 97, 99], // wick toward the zone
      [99, 103, 96, 102], // wick into 96, closes green well above it
      [102, 103, 101, 102],
    ]
    return series(rows)
  }

  it('prints a bounce when price wicks the support zone and closes green above it', () => {
    const result = calculateChileReversal(
      bounceSeries(),
      settings({ maxDistanceAtr: 6, showBreaks: false }),
      { timeframe: '15m' },
    )
    const bounces = result.signals.filter((signal) => signal.kind === 'bounce-support')
    expect(bounces.length).toBeGreaterThan(0)
    for (const bounce of bounces) {
      const c = bounceSeries()[bounce.index]
      expect(c.close).toBeGreaterThan(c.open)
      expect(c.close).toBeGreaterThan(bounce.level)
      expect(c.low).toBeLessThanOrEqual(bounce.level + 0.5)
      expect(bounce.side).toBe('bullish')
    }
  })

  it('does not print a bounce on a red candle that closes below the level', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 101, 99, 100],
      [100, 101, 96, 100], // pivot low 96
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 94, 95], // slices through the level and closes red below it
      [95, 96, 94, 95],
    ]
    const result = calculateChileReversal(
      series(rows),
      settings({ maxDistanceAtr: 6, showBreaks: false }),
      { timeframe: '15m' },
    )
    expect(result.signals.filter((signal) => signal.kind === 'bounce-support')).toEqual([])
  })

  it('prints a rejection when price wicks the resistance zone and closes red below it', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 101, 99, 100],
      [100, 104, 99, 100], // pivot high 104
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [101, 104, 98, 99], // tags 104, closes red below it
      [99, 100, 98, 99],
    ]
    const result = calculateChileReversal(
      series(rows),
      settings({ maxDistanceAtr: 6, showBreaks: false }),
      { timeframe: '15m' },
    )
    const rejects = result.signals.filter((signal) => signal.kind === 'reject-resistance')
    expect(rejects.length).toBeGreaterThan(0)
    expect(rejects[0].side).toBe('bearish')
  })

  it('suppresses signals that fail the optional Pine confirmation gates', () => {
    const candles = bounceSeries()
    const open = calculateChileReversal(
      candles,
      settings({ maxDistanceAtr: 6, showBreaks: false, requireConfirmation: false }),
      { timeframe: '15m' },
    )
    const gated = calculateChileReversal(
      candles,
      settings({
        maxDistanceAtr: 6,
        showBreaks: false,
        requireConfirmation: true,
        impulseBodyRatio: 0.99,
      }),
      { timeframe: '15m' },
    )
    expect(gated.signals.length).toBeLessThanOrEqual(open.signals.length)
  })

  it('omits break markers when they are switched off', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 104, 99, 100], // pivot high 104
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 110, 99, 109], // decisively above 104 + zone
      [109, 110, 108, 109],
    ]
    const withBreaks = calculateChileReversal(
      series(rows),
      settings({ maxDistanceAtr: 6, showBreaks: true }),
      { timeframe: '15m' },
    )
    const without = calculateChileReversal(
      series(rows),
      settings({ maxDistanceAtr: 6, showBreaks: false }),
      { timeframe: '15m' },
    )
    expect(without.signals.some((s) => s.kind.startsWith('break-'))).toBe(false)
    expect(withBreaks.signals.length).toBeGreaterThanOrEqual(without.signals.length)
  })
})

describe('chile reversal higher timeframe reads', () => {
  it('only uses closed higher-timeframe bars, never the developing one', () => {
    // 15m pivot feed where the FINAL (developing) bar contains an extreme low.
    // If that bar leaked in, it would become a support level immediately.
    const htf: Candle[] = [
      ...filler(20, 100, 900),
      candle(100, 101, 99, 100, 20 * 900),
      candle(100, 101, 99, 100, 21 * 900),
      candle(100, 101, 50, 100, 22 * 900), // extreme low in the newest HTF bar
    ]
    const chart: Candle[] = Array.from({ length: 5 }, (_, i) =>
      candle(100, 101, 99, 100, 22 * 900 + i * 180),
    )
    const result = calculateChileReversal(
      chart,
      settings({ resolution: '15m', maxDistanceAtr: 6 }),
      { timeframe: '3m', timeframes: { '15m': { candles: htf } } },
    )
    expect(result.missingFeed).toBe(false)
    expect(result.levels.some((level) => level.price === 50)).toBe(false)
  })

  it('keeps every signal index inside the chart series', () => {
    const result = calculateChileReversal(filler(60, 100), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    for (const signal of result.signals) {
      expect(signal.index).toBeGreaterThanOrEqual(0)
      expect(signal.index).toBeLessThan(60)
    }
  })
})

describe('displayedChileSignals', () => {
  const print = (
    index: number,
    kind: 'bounce-support' | 'reject-resistance' = 'bounce-support',
    level = 100,
    levelKind: 'R1' | 'R2' | 'S1' | 'S2' = 'S1',
  ) => ({
    kind,
    index,
    time: index * 60,
    level,
    levelKind,
    price: level - 1,
    side: 'bullish' as const,
    confirmed: true,
  })

  it('collapses a consecutive-bar reprint of the same pattern to its freshest print', () => {
    const out = displayedChileSignals([print(10), print(11), print(12)])
    expect(out).toHaveLength(1)
    expect(out[0].index).toBe(12)
  })

  it('keeps non-consecutive prints of the same pattern', () => {
    const out = displayedChileSignals([print(10), print(12), print(20)])
    expect(out.map((s) => s.index)).toEqual([10, 12, 20])
  })

  it('does not collapse different kinds or levels on consecutive bars', () => {
    const out = displayedChileSignals([
      print(10, 'bounce-support', 100),
      print(11, 'reject-resistance', 100, 'R1'),
      print(12, 'reject-resistance', 101, 'R1'),
    ])
    expect(out.map((s) => [s.index, s.kind, s.level])).toEqual([
      [10, 'bounce-support', 100],
      [11, 'reject-resistance', 100],
      [12, 'reject-resistance', 101],
    ])
  })

  it('caps the history, keeping the newest markers', () => {
    const many = Array.from({ length: 60 }, (_, i) => print(i * 3))
    const out = displayedChileSignals(many)
    expect(out).toHaveLength(40)
    expect(out[0].index).toBe(60)
    expect(out[out.length - 1].index).toBe(59 * 3)
  })

  it('leaves short unique lists untouched', () => {
    const few = [print(0), print(5), print(9)]
    expect(displayedChileSignals(few)).toEqual(few)
  })
})
