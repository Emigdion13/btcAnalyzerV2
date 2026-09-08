import { describe, expect, it } from 'vitest'
import {
  calculatePivotPointsMissedReversals,
  isPivotPointsMissedReversalsSettings,
  PIVOT_MAX_LABELS,
  PIVOT_MAX_LINES,
  pivotPointsMissedReversalsIndicatorLabel,
  pivotPointsMissedReversalsSettings,
  pivotTooltip,
} from './pivot-points-missed-reversals'
import { ASSETS, generateCandles } from './market'
import {
  PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
  type Candle,
  type Indicator,
  type PivotPointsMissedReversalsSettings,
} from './types'

/** Bars from `(high, low)` pairs; open/close sit inside the range. */
const bars = (rows: [number, number][]): Candle[] =>
  rows.map(([high, low], index) => ({
    time: index * 3600,
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 10,
  }))

/** Bars with a 1-point range centred on each price. */
const path = (prices: number[]): Candle[] => bars(prices.map((price) => [price + 0.5, price - 0.5]))

const settings = (
  overrides: Partial<PivotPointsMissedReversalsSettings> = {},
): PivotPointsMissedReversalsSettings => ({
  ...PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
  pivotLength: 2,
  ...overrides,
})

const fixed = <T extends { estimate: boolean }>(items: T[]) => items.filter((i) => !i.estimate)

describe('Pivot Points High Low & Missed Reversal Levels settings', () => {
  it('keeps the published defaults, rendered in the legend as (50)', () => {
    expect(PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS).toEqual({
      pivotLength: 50,
      showRegular: true,
      regularHighColor: '#ef5350',
      regularLowColor: '#26a69a',
      showMissed: true,
      missedHighColor: '#ef5350',
      missedLowColor: '#26a69a',
      labelTextColor: '#ffffff',
    })
    const indicator: Indicator = {
      id: 'p',
      kind: 'pivot-points-missed-reversals',
      name: 'Pivot Points High Low & Missed Reversal Levels',
      period: 50,
      color: '#26a69a',
      visible: true,
    }
    expect(pivotPointsMissedReversalsIndicatorLabel(indicator)).toBe(
      'Pivot Points High Low & Missed Reversal Levels (50)',
    )
    expect(
      pivotPointsMissedReversalsIndicatorLabel({
        ...indicator,
        pivots: { ...PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS, pivotLength: 12 },
      }),
    ).toBe('Pivot Points High Low & Missed Reversal Levels (12)')
  })

  it('validates boundaries and falls back to defaults for legacy indicators', () => {
    expect(
      isPivotPointsMissedReversalsSettings({ ...PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS }),
    ).toBe(true)
    expect(isPivotPointsMissedReversalsSettings(settings({ pivotLength: 0 }))).toBe(false)
    expect(isPivotPointsMissedReversalsSettings(settings({ pivotLength: 2.5 }))).toBe(false)
    expect(isPivotPointsMissedReversalsSettings(settings({ pivotLength: 501 }))).toBe(false)
    expect(isPivotPointsMissedReversalsSettings(settings({ regularHighColor: 'red' }))).toBe(false)
    expect(isPivotPointsMissedReversalsSettings(settings({ labelTextColor: '#fff' }))).toBe(false)
    expect(
      isPivotPointsMissedReversalsSettings({
        ...settings(),
        showMissed: 'yes' as unknown as boolean,
      }),
    ).toBe(false)
    expect(isPivotPointsMissedReversalsSettings(null)).toBe(false)
    const legacy: Indicator = {
      id: 'p',
      kind: 'pivot-points-missed-reversals',
      name: 'Pivots',
      period: 50,
      color: '#26a69a',
      visible: true,
      pivots: { pivotLength: 20 } as PivotPointsMissedReversalsSettings,
    }
    expect(pivotPointsMissedReversalsSettings(legacy)).toEqual(
      PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
    )
    expect(() => calculatePivotPointsMissedReversals([], settings({ pivotLength: 0 }))).toThrow(
      /Invalid Pivot Points/,
    )
  })

  it("formats tooltips like Pine's str.tostring(x, '#.####')", () => {
    expect(pivotTooltip(41896.98)).toBe('41896.98')
    expect(pivotTooltip(0.123456)).toBe('0.1235')
    expect(pivotTooltip(100)).toBe('100')
    expect(pivotTooltip(-0.00001)).toBe('0')
  })
})

describe('regular pivots and the zig-zag', () => {
  it('confirms ta.pivothigh/pivotlow(length, length) `length` bars late and alternates cleanly', () => {
    // Clean swing: low at 3, high at 6, low at 9, high at 12. Length 2 →
    // confirmation at bars 5, 8, 11 and 14.
    const candles = path([5, 5, 5, 3, 5, 7, 9, 7, 5, 3, 5, 7, 9, 7, 5])
    const result = calculatePivotPointsMissedReversals(candles, settings())

    const regular = result.labels.filter((label) => label.kind.startsWith('regular'))
    expect(regular.map((label) => [label.kind, label.index, label.price, label.style])).toEqual([
      ['regular-low', 3, 2.5, 'up'],
      ['regular-high', 6, 9.5, 'down'],
      ['regular-low', 9, 2.5, 'up'],
      ['regular-high', 12, 9.5, 'down'],
    ])
    expect(regular.every((label) => label.tooltip === String(label.price))).toBe(true)
    // Nothing was missed, so no ghosts and no historical levels...
    expect(fixed(result.labels).some((label) => label.kind.startsWith('missed'))).toBe(false)
    expect(fixed(result.levels)).toEqual([])
    // ...and the legs are solid. The uninitialised origin draws no leg (documented deviation).
    expect(fixed(result.zigzag).map((leg) => [leg.x1, leg.y1, leg.x2, leg.y2, leg.dashed])).toEqual(
      [
        [3, 2.5, 6, 9.5, false],
        [6, 9.5, 9, 2.5, false],
        [9, 2.5, 12, 9.5, false],
      ],
    )
    expect(fixed(result.zigzag).map((leg) => leg.direction)).toEqual(['up', 'down', 'up'])
    expect(result.warmupBars).toBe(5)
  })

  it('lets pivot ties through on the past side only, like the built-ins', () => {
    // Equal highs at bars 2 and 3 (length 1). The first top has a tie on its
    // future side, which must be strictly lower; the second top's tie is in
    // the past, which is allowed. Only the second top is a pivot high.
    const candles = bars([
      [10, 9],
      [11, 10],
      [12, 11],
      [12, 11],
      [11, 10],
      [10, 9],
    ])
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 1 }))
    expect(
      result.labels.filter((label) => label.kind === 'regular-high').map((label) => label.index),
    ).toEqual([3])
  })

  it('needs `length` bars on both sides — nothing prints inside the warm-up window', () => {
    const candles = path([1, 9, 1, 9, 1])
    expect(
      calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 3 })).labels.filter(
        (label) => !label.estimate,
      ),
    ).toEqual([])
    expect(calculatePivotPointsMissedReversals([], settings()).estimate).toBeNull()
  })
})

describe('missed reversals', () => {
  it('prints a 👻 at the missed low between two consecutive pivot highs (os[1] == 1)', () => {
    // Pivot high at bar 5 (9.5, confirmed at 8), a dip at bar 7 that is not a
    // pivot low for length 3 (bar 4 is lower inside its left window), then a
    // higher pivot high at bar 10 (11.5, confirmed at 13).
    const candles = path([1, 1, 1, 3, 5, 9, 7, 6, 7, 9, 11, 9, 7, 5, 3])
    //                    0  1  2  3  4  5  6  7  8  9  10 11 12 13 14
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 3 }))
    expect(fixed(result.labels).map((label) => [label.kind, label.index, label.price])).toEqual([
      ['regular-high', 5, 9.5],
      // Second pivot high in a row: the running min since the first (bar 7, 5.5) was missed.
      ['missed-low', 7, 5.5],
      ['regular-high', 10, 11.5],
    ])
    expect(fixed(result.zigzag).map((leg) => [leg.x1, leg.y1, leg.x2, leg.y2, leg.dashed])).toEqual(
      [
        [5, 9.5, 7, 5.5, true],
        [7, 5.5, 10, 11.5, true],
      ],
    )
    expect(fixed(result.zigzag).map((leg) => leg.direction)).toEqual(['down', 'up'])
    // The ghost level starts at the missed low and follows the newest bar.
    const levels = fixed(result.levels)
    expect(levels).toHaveLength(1)
    expect(levels[0]).toMatchObject({
      x1: 7,
      x2: 14,
      price: 5.5,
      side: 'low',
      color: 'regular-low',
    })
    // The estimate after a pivot high is the lowest low since it: bar 14 (2.5).
    expect(result.estimate).toEqual({ index: 14, price: 2.5, side: 'low' })
  })

  it('prints a 👻 at the missed high between two consecutive pivot lows (os[1] == 0)', () => {
    const candles = path([13, 13, 13, 11, 9, 5, 7, 8, 7, 5, 3, 5, 7, 9, 11])
    //                     0   1   2   3  4  5  6  7  8  9 10 11 12 13  14
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 3 }))
    expect(fixed(result.labels).map((label) => [label.kind, label.index, label.price])).toEqual([
      ['regular-low', 5, 4.5],
      ['missed-high', 7, 8.5],
      ['regular-low', 10, 2.5],
    ])
    expect(fixed(result.zigzag).map((leg) => [leg.x1, leg.y1, leg.x2, leg.y2, leg.dashed])).toEqual(
      [
        [5, 4.5, 7, 8.5, true],
        [7, 8.5, 10, 2.5, true],
      ],
    )
    expect(fixed(result.levels)[0]).toMatchObject({
      x1: 7,
      x2: 14,
      price: 8.5,
      side: 'high',
      color: 'regular-high',
    })
    expect(result.estimate).toEqual({ index: 14, price: 11.5, side: 'high' })
  })

  // Pivot high at 5 (13.5), pivot low at 7 (2.5), a spike at 8 (12.5) that is
  // not a pivot high for length 3 (bar 5 is higher inside its left window), a
  // dip at 10 (5.5), then a pivot high at 12 (9.5) *below* the running max.
  const lowerHigh = [10, 10, 10, 10, 11, 13, 5, 3, 12, 8, 6, 7, 9, 5, 3, 1, 0]
  //                  0   1   2   3   4   5  6  7   8  9 10 11 12 13 14 15 16

  it('prints two 👻 when a pivot high forms below the running max (ph < max)', () => {
    const result = calculatePivotPointsMissedReversals(
      path(lowerHigh),
      settings({ pivotLength: 3 }),
    )
    expect(fixed(result.labels).map((label) => [label.kind, label.index, label.price])).toEqual([
      ['regular-high', 5, 13.5],
      ['regular-low', 7, 2.5],
      // ph (9.5) < max (12.5): the max and the low that followed it were both missed.
      ['missed-high', 8, 12.5],
      ['missed-low', 10, 5.5],
      ['regular-high', 12, 9.5],
    ])
    expect(
      fixed(result.zigzag).map((leg) => [
        leg.x1,
        leg.y1,
        leg.x2,
        leg.y2,
        leg.dashed,
        leg.direction,
      ]),
    ).toEqual([
      [5, 13.5, 7, 2.5, false, 'down'],
      [7, 2.5, 8, 12.5, true, 'up'],
      [8, 12.5, 10, 5.5, true, 'down'],
      [10, 5.5, 12, 9.5, true, 'up'],
    ])
    // Two levels: the missed high's level ends where the missed low starts
    // (`line.set_x2(ghost_level, px1)`), and the missed low's level runs on.
    expect(fixed(result.levels).map((l) => [l.x1, l.x2, l.price, l.side, l.color])).toEqual([
      [8, 10, 12.5, 'high', 'regular-high'],
      [10, 16, 5.5, 'low', 'regular-low'],
    ])
  })

  it('prints two 👻 when a pivot low forms above the running min (pl > min)', () => {
    // The mirror image of the series above.
    const result = calculatePivotPointsMissedReversals(
      path(lowerHigh.map((price) => 14 - price)),
      settings({ pivotLength: 3 }),
    )
    // The original creates the follow_max label before the min label.
    expect(fixed(result.labels).map((label) => [label.kind, label.index, label.price])).toEqual([
      ['regular-low', 5, 0.5],
      ['regular-high', 7, 11.5],
      ['missed-high', 10, 8.5],
      ['missed-low', 8, 1.5],
      ['regular-low', 12, 4.5],
    ])
    expect(
      fixed(result.zigzag).map((leg) => [
        leg.x1,
        leg.y1,
        leg.x2,
        leg.y2,
        leg.dashed,
        leg.direction,
      ]),
    ).toEqual([
      [5, 0.5, 7, 11.5, false, 'up'],
      [7, 11.5, 8, 1.5, true, 'down'],
      [8, 1.5, 10, 8.5, true, 'up'],
      [10, 8.5, 12, 4.5, true, 'down'],
    ])
    expect(fixed(result.levels).map((l) => [l.x1, l.x2, l.price, l.side, l.color])).toEqual([
      [8, 10, 1.5, 'low', 'regular-low'],
      [10, 16, 8.5, 'high', 'regular-high'],
    ])
  })

  it('cuts the previous ghost level back to the next missed reversal', () => {
    // Three pivot highs in a row (5, 10, 14) with dips at 7 and 11 that never
    // qualify as pivot lows, so two consecutive missed lows are found.
    const candles = path([1, 1, 1, 3, 5, 9, 7, 6, 7, 9, 11, 7.5, 9, 10.5, 13, 11, 9, 7, 5, 3])
    //                    0  1  2  3  4  5  6  7  8  9  10  11  12  13  14  15 16 17 18 19
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 3 }))
    expect(
      fixed(result.labels)
        .filter((label) => label.kind === 'missed-low')
        .map((label) => [label.index, label.price]),
    ).toEqual([
      [7, 5.5],
      [11, 7],
    ])
    expect(fixed(result.levels).map((l) => [l.x1, l.x2, l.price])).toEqual([
      [7, 11, 5.5],
      [11, 19, 7],
    ])
  })

  it('only moves the extreme bar on a strict new extreme, like `if max > max[1]`', () => {
    // Pivot high at 5, a wide down bar at 6 (high 13, low 4), pivot low at 7,
    // then equal highs at 8 and 9. Neither tie bar is a pivot high — bar 5 /
    // bar 6 are higher inside their left windows — so the running max keeps
    // its first bar: `max_x1` stays at 8 because bar 9 does not *exceed* it.
    const candles = bars([
      [10.5, 9.5],
      [10.5, 9.5],
      [10.5, 9.5],
      [10.5, 9.5],
      [11.5, 10.5],
      [13.5, 12.5],
      [13, 4],
      [3.5, 2.5],
      [12.5, 11.5],
      [12.5, 11.5],
      [8.5, 7.5],
      [6.5, 5.5],
      [7.5, 6.5],
      [9.5, 8.5],
      [5.5, 4.5],
      [3.5, 2.5],
      [1.5, 0.5],
    ])
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 3 }))
    expect(fixed(result.labels).map((label) => [label.kind, label.index, label.price])).toEqual([
      ['regular-high', 5, 13.5],
      ['regular-low', 7, 2.5],
      ['missed-high', 8, 12.5],
      ['missed-low', 11, 5.5],
      ['regular-high', 13, 9.5],
    ])
  })
})

describe('the trailing estimate', () => {
  const swing = [1, 1, 1, 3, 5, 9, 7, 6, 7, 9, 11, 9, 7, 5, 3]

  it('tracks the lowest low after a pivot high and readjusts as price makes new lows', () => {
    const result = calculatePivotPointsMissedReversals(path(swing), settings({ pivotLength: 3 }))
    expect(result.estimate).toEqual({ index: 14, price: 2.5, side: 'low' })
    const estimateLabel = result.labels.find((label) => label.estimate)
    expect(estimateLabel).toMatchObject({ kind: 'missed-low', index: 14, price: 2.5, style: 'up' })
    const leg = result.zigzag.find((segment) => segment.estimate)
    expect(leg).toMatchObject({
      x1: 10,
      y1: 11.5,
      x2: 14,
      y2: 2.5,
      dashed: true,
      direction: 'down',
    })
    // The estimated level runs from the estimate to the newest bar and, as
    // published, is tinted with the *opposite* (leg) color.
    const level = result.levels.find((item) => item.estimate)
    expect(level).toMatchObject({ x1: 14, x2: 14, price: 2.5, side: 'low', color: 'missed-high' })

    // A bounce keeps the estimate where it was; a deeper low moves it.
    const bounce = calculatePivotPointsMissedReversals(
      path([...swing, 4]),
      settings({ pivotLength: 3 }),
    )
    expect(bounce.estimate).toEqual({ index: 14, price: 2.5, side: 'low' })
    expect(bounce.levels.find((item) => item.estimate)).toMatchObject({ x1: 14, x2: 15 })
    const deeper = calculatePivotPointsMissedReversals(
      path([...swing, 1]),
      settings({ pivotLength: 3 }),
    )
    expect(deeper.estimate).toEqual({ index: 15, price: 0.5, side: 'low' })
  })

  it('resolves ties to the newest bar, like array.indexof on a newest-first array', () => {
    const result = calculatePivotPointsMissedReversals(
      path([...swing, 3]),
      settings({ pivotLength: 3 }),
    )
    expect(result.estimate).toEqual({ index: 15, price: 2.5, side: 'low' })
  })

  it('tracks the highest high after a pivot low', () => {
    const result = calculatePivotPointsMissedReversals(
      path(swing.map((price) => 14 - price)),
      settings({ pivotLength: 3 }),
    )
    expect(result.estimate).toEqual({ index: 14, price: 11.5, side: 'high' })
    expect(result.labels.find((label) => label.estimate)).toMatchObject({
      kind: 'missed-high',
      style: 'down',
    })
    expect(result.levels.find((item) => item.estimate)).toMatchObject({ color: 'missed-low' })
  })

  it('estimates from bar 0 before the first pivot, like the original, but draws no origin leg', () => {
    // With `os == 0` and `px1 == 0` the original scans every bar for its
    // highest high; the leg would start at the uninitialised (0, 0) origin,
    // which Atlas leaves undrawn (documented deviation).
    const result = calculatePivotPointsMissedReversals(
      path([1, 2, 3, 4]),
      settings({ pivotLength: 3 }),
    )
    expect(result.estimate).toEqual({ index: 3, price: 4.5, side: 'high' })
    expect(result.zigzag).toEqual([])
    expect(result.labels.map((label) => [label.kind, label.index, label.estimate])).toEqual([
      ['missed-high', 3, true],
    ])
    expect(result.levels.map((level) => [level.x1, level.x2, level.estimate])).toEqual([
      [3, 3, true],
    ])
  })
})

describe('input switches', () => {
  const candles = path([10, 10, 10, 10, 11, 13, 5, 3, 12, 8, 6, 7, 9, 5, 3, 1, 0])

  it('hides regular labels and their legs with `show_reg` off, keeping the state machine', () => {
    const result = calculatePivotPointsMissedReversals(
      candles,
      settings({ pivotLength: 3, showRegular: false }),
    )
    expect(result.labels.some((label) => label.kind.startsWith('regular'))).toBe(false)
    // The missed reversals are still detected from the same pivot state.
    expect(fixed(result.labels).map((label) => [label.kind, label.index])).toEqual([
      ['missed-high', 8],
      ['missed-low', 10],
    ])
    // Legs into the missed points remain; the legs into regular pivots do not,
    // yet the next leg still starts from the regular pivot (`px1/py1` update regardless).
    expect(fixed(result.zigzag).map((leg) => [leg.x1, leg.y1, leg.x2, leg.y2])).toEqual([
      [7, 2.5, 8, 12.5],
      [8, 12.5, 10, 5.5],
    ])
    expect(result.zigzag.find((leg) => leg.estimate)).toMatchObject({ x1: 12, y1: 9.5 })
    expect(fixed(result.levels)).toHaveLength(2)
  })

  it('hides missed labels, dashed legs and ghost levels with `show_miss` off, but keeps the estimated level', () => {
    const result = calculatePivotPointsMissedReversals(
      candles,
      settings({ pivotLength: 3, showMissed: false }),
    )
    expect(result.labels.some((label) => label.kind.startsWith('missed'))).toBe(false)
    expect(fixed(result.levels)).toEqual([])
    // The regular leg jumps straight from the pivot low to the lower pivot
    // high, and is dashed because `ph < max` — the original's tell that a
    // reversal was skipped even with ghosts hidden.
    expect(fixed(result.zigzag).map((leg) => [leg.x1, leg.y1, leg.x2, leg.y2, leg.dashed])).toEqual(
      [
        [5, 13.5, 7, 2.5, false],
        [7, 2.5, 12, 9.5, true],
      ],
    )
    expect(result.zigzag.some((leg) => leg.estimate)).toBe(false)
    // `line.new(x, y, n, y, …)` for the estimate sits outside `if show_miss`.
    expect(result.levels.filter((level) => level.estimate)).toHaveLength(1)
    expect(result.estimate).toEqual({ index: 16, price: -0.5, side: 'low' })
  })
})

describe('drawing limits and real series', () => {
  it('keeps the newest 500 labels and 500 lines, like max_labels_count / max_lines_count', () => {
    // A length-1 sawtooth produces a regular pivot on every bar.
    const candles = path(Array.from({ length: 1400 }, (_, i) => (i % 2 ? 10 : 1)))
    const result = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 1 }))
    expect(result.labels.length).toBeLessThanOrEqual(PIVOT_MAX_LABELS)
    expect(result.zigzag.length + result.levels.length).toBeLessThanOrEqual(PIVOT_MAX_LINES)
    const oldest = Math.min(...result.labels.map((label) => label.index))
    expect(oldest).toBeGreaterThan(800)
  })

  it('stays consistent on the demo series with the (50) defaults', () => {
    const candles = generateCandles(ASSETS[0], '1h')
    const result = calculatePivotPointsMissedReversals(
      candles,
      PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
    )
    const regular = result.labels.filter((label) => label.kind.startsWith('regular'))
    expect(regular.length).toBeGreaterThan(0)
    // Every regular label sits on a real bar at that bar's high or low.
    for (const label of regular) {
      const candle = candles[label.index]
      expect(candle).toBeDefined()
      expect(label.price).toBe(label.kind === 'regular-high' ? candle.high : candle.low)
    }
    // Every ghost sits on a real bar extreme too.
    for (const label of result.labels.filter((l) => l.kind.startsWith('missed'))) {
      const candle = candles[label.index]
      expect(label.price).toBe(label.kind === 'missed-high' ? candle.high : candle.low)
    }
    // The zig-zag is continuous: each leg starts where the previous one ended.
    const legs = result.zigzag
    for (let i = 1; i < legs.length; i++) {
      expect(legs[i].x1).toBe(legs[i - 1].x2)
      expect(legs[i].y1).toBe(legs[i - 1].y2)
    }
    // Levels never run backwards and the estimate reaches the newest bar.
    for (const level of result.levels) expect(level.x2).toBeGreaterThanOrEqual(level.x1)
    expect(result.levels.find((level) => level.estimate)?.x2).toBe(candles.length - 1)
    expect(result.estimate).not.toBeNull()
  })

  it('is deterministic and independent of the volume column', () => {
    const candles = generateCandles(ASSETS[1], '4h')
    const a = calculatePivotPointsMissedReversals(candles, settings({ pivotLength: 10 }))
    const b = calculatePivotPointsMissedReversals(
      candles.map((candle) => ({ ...candle, volume: 0 })),
      settings({ pivotLength: 10 }),
    )
    expect(b).toEqual(a)
  })
})
