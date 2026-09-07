import { describe, expect, it } from 'vitest'
import {
  calculateSrBreaksRetests,
  isSrBreaksRetestsSettings,
  SR_BREAKS_RETESTS_COLORS,
  SR_MAX_ZONES,
  srBreaksRetestsIndicatorLabel,
  srBreaksRetestsSettings,
  srVolumeText,
} from './sr-breaks-retests'
import { ASSETS, generateCandles } from './market'
import {
  SR_BREAKS_RETESTS_DEFAULTS,
  type Candle,
  type Indicator,
  type SrBreaksRetestsSettings,
} from './types'

const candle = (
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 10,
  time = 0,
): Candle => ({ time, open, high, low, close, volume })

const series = (rows: [number, number, number, number][], step = 3600): Candle[] =>
  rows.map(([open, high, low, close], index) => candle(open, high, low, close, 10, index * step))

/** Flat doji bars: no direction, +volume, true range of 2. */
const flat = (count: number, price = 100): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(price, price + 1, price - 1, price, 10, i * 3600))

const quick = (overrides: Partial<SrBreaksRetestsSettings> = {}): SrBreaksRetestsSettings => ({
  ...SR_BREAKS_RETESTS_DEFAULTS,
  lookbackPeriod: 1,
  volumeFilterLength: 1,
  ...overrides,
})

/** Reference Pine `ta.atr(200)`: SMA seed, then Wilder recursion. */
function expectedAtr(candles: Candle[], length = 200): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null)
  let sum = 0
  let average: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const range =
      i === 0
        ? c.high - c.low
        : Math.max(
            c.high - c.low,
            Math.abs(c.high - candles[i - 1].close),
            Math.abs(c.low - candles[i - 1].close),
          )
    if (i < length - 1) {
      sum += range
      continue
    }
    if (i === length - 1) {
      sum += range
      average = sum / length
    } else average = (average! * (length - 1) + range) / length
    out[i] = average
  }
  return out
}

describe('SR Breaks and Retests settings', () => {
  it('keeps the published (20, 2, 1) defaults', () => {
    expect(SR_BREAKS_RETESTS_DEFAULTS).toEqual({
      lookbackPeriod: 20,
      volumeFilterLength: 2,
      boxWidth: 1,
    })
  })

  it('validates boundaries and falls back for legacy indicators', () => {
    expect(isSrBreaksRetestsSettings({ ...SR_BREAKS_RETESTS_DEFAULTS })).toBe(true)
    for (const invalid of [
      { ...SR_BREAKS_RETESTS_DEFAULTS, lookbackPeriod: 0 },
      { ...SR_BREAKS_RETESTS_DEFAULTS, lookbackPeriod: 2.5 },
      { ...SR_BREAKS_RETESTS_DEFAULTS, volumeFilterLength: 0 },
      { ...SR_BREAKS_RETESTS_DEFAULTS, boxWidth: -0.1 },
      { ...SR_BREAKS_RETESTS_DEFAULTS, boxWidth: 1001 },
      { ...SR_BREAKS_RETESTS_DEFAULTS, boxWidth: '1' },
    ])
      expect(isSrBreaksRetestsSettings(invalid)).toBe(false)
    const legacy: Indicator = {
      id: 'sr',
      kind: 'sr-breaks-retests',
      name: 'SR Breaks and Retests',
      period: 20,
      color: '#4caf50',
      visible: true,
    }
    expect(srBreaksRetestsSettings(legacy)).toEqual(SR_BREAKS_RETESTS_DEFAULTS)
    expect(() =>
      calculateSrBreaksRetests([], { ...SR_BREAKS_RETESTS_DEFAULTS, boxWidth: -1 }),
    ).toThrow(/Invalid SR Breaks and Retests settings/)
  })

  it('renders the legend exactly like the TradingView short title with inputs', () => {
    const indicator: Indicator = {
      id: 'sr',
      kind: 'sr-breaks-retests',
      name: 'SR Breaks and Retests',
      period: 20,
      color: '#4caf50',
      visible: true,
      sr: { ...SR_BREAKS_RETESTS_DEFAULTS },
    }
    expect(srBreaksRetestsIndicatorLabel(indicator)).toBe('SR Breaks and Retests (20, 2, 1)')
    indicator.sr = { lookbackPeriod: 10, volumeFilterLength: 4, boxWidth: 0.5 }
    expect(srBreaksRetestsIndicatorLabel(indicator)).toBe('SR Breaks and Retests (10, 4, 0.5)')
  })

  it('formats the box volume text like str.tostring(math.round(Vol, 2))', () => {
    expect(srVolumeText(123.456)).toBe('Vol: 123.46')
    expect(srVolumeText(-123.456)).toBe('Vol: -123.46')
    expect(srVolumeText(5)).toBe('Vol: 5')
    expect(srVolumeText(-0.004)).toBe('Vol: 0')
  })
})

describe('SR Breaks and Retests calculation', () => {
  it('lets pivot ties through on the past side only, like ta.pivothigh/pivotlow', () => {
    // Double top with equal closes: only the second top is the pivot, because
    // the first top has a tie on its future side, which must be strictly lower.
    const doubleTop = series([
      [10, 12.5, 9.5, 10], // 0
      [10, 12.5, 9.5, 12], // 1 first top — future tie disqualifies it
      [12, 12.5, 9.5, 12], // 2 second top — past tie is allowed
      [12, 12.5, 9.5, 10], // 3 detection bar, down candle → negative volume
    ])
    const result = calculateSrBreaksRetests(doubleTop, quick())
    expect(result.zones).toHaveLength(1)
    expect(result.zones[0]).toMatchObject({ side: 'resistance', level: 12, pivotIndex: 2 })

    // Equal lows/highs followed by a higher close: neither tied bar is a pivot
    // high (future side must drop strictly), but the second 12 is a valid
    // pivot low — its past tie is allowed and the future close is strictly
    // higher, detected by an up candle with positive delta volume.
    const risingTie = series([
      [10, 12.5, 9.5, 10],
      [10, 12.5, 9.5, 12],
      [12, 12.5, 9.5, 12],
      [12, 12.5, 9.5, 13],
    ])
    const rising = calculateSrBreaksRetests(risingTie, quick())
    expect(rising.zones.filter((zone) => zone.side === 'resistance')).toHaveLength(0)
    expect(rising.zones).toEqual([
      expect.objectContaining({ side: 'support', level: 12, pivotIndex: 2 }),
    ])
  })

  it('signs delta volume by candle direction and lets dojis inherit the last direction', () => {
    // The detection bar is a doji: it inherits the up bias from the pivot bar
    // (an up candle), so its delta volume stays positive and the zone forms.
    const dojiAfterUp = series([
      [10, 10.5, 9.5, 10.2], // 0 up
      [7.7, 8.0, 7.6, 7.9], // 1 up candle closing at the pivot low
      [8.1, 8.4, 7.5, 8.1], // 2 doji (close == open) → inherited positive volume
    ])
    const result = calculateSrBreaksRetests(dojiAfterUp, quick())
    expect(result.zones).toHaveLength(1)
    expect(result.zones[0]).toMatchObject({ side: 'support', level: 7.9, pivotIndex: 1 })

    // Same shape after a down candle: the doji inherits the down bias, its
    // negative delta volume fails the positive filter, and no zone forms.
    const dojiAfterDown = series([
      [10.2, 10.7, 9.9, 10.0], // 0 down
      [8.0, 8.1, 7.8, 7.9], // 1 down candle closing at the pivot low
      [8.1, 8.4, 7.5, 8.1], // 2 doji → inherited negative volume
    ])
    expect(calculateSrBreaksRetests(dojiAfterDown, quick()).zones).toHaveLength(0)
  })

  it('gates zones on the delta-volume filter and grades the fill by relative volume', () => {
    // volLen 2 compares against the highest of the last two scaled volumes,
    // so a small positive volume right after a large one is rejected.
    const build = (detectionVolume: number) => [
      ...flat(25, 8), // warm-up bars for the 25-bar gradient window
      candle(7.8, 8.1, 7.6, 7.9, 100, 25 * 3600), // 25 up, +100, pivot low
      candle(7.9, 8.4, 7.5, 8.1, detectionVolume, 26 * 3600), // 26 detection bar
    ]
    expect(calculateSrBreaksRetests(build(1), quick({ volumeFilterLength: 2 })).zones).toHaveLength(
      0,
    )
    const passed = calculateSrBreaksRetests(build(90), quick({ volumeFilterLength: 2 }))
    // +90 > max(+100, +90) / 2.5 = 40 → zone created; fill = 0.7 × 90/100.
    expect(passed.zones).toHaveLength(1)
    expect(passed.zones[0]).toMatchObject({ side: 'support', level: 7.9, pivotIndex: 25 })
    expect(passed.zones[0]!.fillOpacity).toBeCloseTo(0.7 * 0.9, 6)
  })

  it('keeps zone boundaries null until ATR(200) warms up, then uses ATR × width', () => {
    const dips = flat(210)
    dips[150] = candle(100, 101, 98.5, 99.5, 10, 150 * 3600)
    dips[151] = candle(99.5, 101, 98.5, 100, 10, 151 * 3600)
    dips[205] = candle(100, 101, 98.5, 99.5, 10, 205 * 3600)
    dips[206] = candle(99.5, 101, 98.5, 100, 10, 206 * 3600)
    const result = calculateSrBreaksRetests(dips, quick())
    const atr = expectedAtr(dips)
    expect(atr[198]).toBeNull()
    // The dip at 150 lifts the SMA seed slightly above the flat 2 range.
    expect(atr[199]!).toBeGreaterThan(2)
    expect(atr[199]!).toBeLessThan(2.01)
    // Each dip prints a pivot high on the last flat bar (past-side tie) and a
    // pivot low on the dip bar, so four zones form in total.
    expect(result.zones.map((zone) => [zone.side, zone.level, zone.pivotIndex])).toEqual([
      ['resistance', 100, 149],
      ['support', 99.5, 150],
      ['resistance', 100, 204],
      ['support', 99.5, 205],
    ])
    // Created before bar 199, while ATR(200) is still `na` in Pine.
    expect(result.zones[0]!.boundary).toBeNull()
    expect(result.zones[1]!.boundary).toBeNull()
    // Created after warm-up: boundary = level ± ATR at the creation bar.
    expect(result.zones[2]!.boundary).toBeCloseTo(100 + atr[205]!, 8)
    expect(result.zones[3]!.boundary).toBeCloseTo(99.5 - atr[206]!, 8)

    // Width scales the depth exactly.
    const wide = calculateSrBreaksRetests(dips, quick({ boxWidth: 2.5 }))
    expect(wide.zones[3]!.boundary).toBeCloseTo(99.5 - atr[206]! * 2.5, 8)
  })

  it('detects breaks, retests, and holds with Pine offsets, anchors, and flag memory', () => {
    // 200 flat bars (ATR = 2), then a resistance break, a retest, and a hold.
    const fixture = flat(200)
    fixture.push(
      candle(100, 103.5, 99.5, 103, 10, 200 * 3600), // 200 up → pivot low at 199 (tie left)
      candle(103, 103.5, 99.5, 100, 10, 201 * 3600), // 201 down → resistance 103 @ pivot 200
      candle(100, 107.5, 106, 107, 10, 202 * 3600), // 202 up, low clears 103 + depth → break
      candle(107, 108, 104, 107.3, 10, 203 * 3600), // 203 up, wick into the zone → retest bar
      candle(107.3, 109.5, 105.5, 109, 10, 204 * 3600), // 204 low recrosses → retest holds
      candle(102.5, 102.8, 99.5, 100, 10, 205 * 3600), // 205 high falls back under → holds
    )
    const atr = expectedAtr(fixture)
    const result = calculateSrBreaksRetests(fixture, quick())

    const byLevel = (level: number) => result.zones.filter((zone) => zone.level === level)
    expect(byLevel(100)).toHaveLength(2)
    expect(byLevel(103)).toHaveLength(1)
    expect(byLevel(109)).toHaveLength(1)

    // The broken resistance zone: level 103, boundary 103 + atr at creation.
    const resistance = byLevel(103)[0]!
    expect(resistance).toMatchObject({
      side: 'resistance',
      pivotIndex: 200,
      createdIndex: 201,
      state: 'broken',
    })
    expect(resistance.boundary).toBeCloseTo(103 + atr[201]!, 8)
    // Its replacement at 205 stays intact; both live boxes extend one bar past
    // the last bar, the replaced ones freeze at their replacement bar.
    expect(byLevel(109)[0]!).toMatchObject({ createdIndex: 205, state: 'intact' })
    expect(byLevel(109)[0]!.rightIndex).toBe(206)
    expect(resistance.rightIndex).toBe(205)
    expect(byLevel(100)[1]!.rightIndex).toBe(206)

    // First break prints the label (unset flag counts as false — documented
    // deviation), anchored at the previous bar and the previous level value.
    expect(result.labels).toEqual([
      {
        kind: 'break-resistance',
        index: 201,
        price: 103,
        color: SR_BREAKS_RETESTS_COLORS.breakResistance,
      },
    ])

    // Diamonds: the support test at 201, the resistance retest at 203, and the
    // resistance hold at 204 — all annotated one bar back, like offset = -1.
    expect(result.markers).toEqual([
      {
        kind: 'support-holds',
        index: 201,
        location: 'below',
        color: SR_BREAKS_RETESTS_COLORS.holdBelow,
      },
      {
        kind: 'resistance-as-support',
        index: 203,
        location: 'below',
        color: SR_BREAKS_RETESTS_COLORS.holdBelow,
      },
      {
        kind: 'resistance-holds',
        index: 204,
        location: 'above',
        color: SR_BREAKS_RETESTS_COLORS.holdAbove,
      },
    ])
  })

  it('labels support breaks, flips the zone role, and flags recovered support holds', () => {
    const fixture = flat(200)
    fixture.push(
      candle(100, 100.5, 96.5, 97, 10, 200 * 3600), // 200 down → pivot high at 199 and low at 200
      candle(97, 100.5, 96.5, 100, 10, 201 * 3600), // 201 up → support 97 @ pivot 200
      candle(94.5, 94.8, 92.5, 93, 10, 202 * 3600), // 202 whole bar under 97 − depth → break
      candle(93, 94.3, 92.8, 94, 10, 203 * 3600), // 203 pivot low at 202 → new support 93
      candle(94, 96.3, 93.5, 96, 10, 204 * 3600), // 204 low crosses back above 93 → holds
    )
    const atr = expectedAtr(fixture)
    const result = calculateSrBreaksRetests(fixture, quick())

    expect(
      result.zones.map((zone) => [zone.side, zone.level, zone.pivotIndex, zone.state]),
    ).toEqual([
      ['resistance', 100, 199, 'intact'],
      ['support', 97, 200, 'broken'],
      ['resistance', 100, 201, 'intact'],
      ['support', 93, 202, 'intact'],
    ])
    const broken = result.zones[1]!
    expect(broken.boundary).toBeCloseTo(97 - atr[201]!, 8)
    expect(broken.rightIndex).toBe(203)
    expect(result.zones[3]!.rightIndex).toBe(205)
    expect(result.labels).toEqual([
      {
        kind: 'break-support',
        index: 201,
        price: 97,
        color: SR_BREAKS_RETESTS_COLORS.breakSupport,
      },
    ])
    expect(result.markers).toEqual([
      {
        kind: 'resistance-holds',
        index: 201,
        location: 'above',
        color: SR_BREAKS_RETESTS_COLORS.holdAbove,
      },
      {
        kind: 'support-holds',
        index: 203,
        location: 'below',
        color: SR_BREAKS_RETESTS_COLORS.holdBelow,
      },
    ])
  })

  it('remembers role reversal across replacements, printing retest diamonds instead of labels', () => {
    // After a support break the flag stays true unless a hold resets it. When
    // the replacement support breaks while the flag is still true, the
    // original prints "Support as Resistance Holds" instead of a new label.
    const build = (recovery: Candle[]) => {
      const fixture = flat(200)
      fixture.push(
        candle(100, 100.5, 96.5, 97, 10, 200 * 3600), // 200 pivot low at 200
        candle(97, 100.5, 96.5, 100, 10, 201 * 3600), // 201 support 97 created
        candle(94.5, 94.8, 92.5, 93, 10, 202 * 3600), // 202 breaks support → flag true
        candle(93, 93.8, 91.5, 93.5, 10, 203 * 3600), // 203 pivot low → replacement support 93
        ...recovery,
      )
      return fixture
    }
    // Recovery: the low crosses back above 93 (flag resets to false), so the
    // second break at 205 prints another "Break Sup" label at bar 204.
    const recovered = calculateSrBreaksRetests(
      build([
        candle(94, 96.3, 93.5, 96, 10, 204 * 3600), // 204 low crosses above 93 → hold, flag false
        candle(90.5, 90.7, 89, 89.5, 10, 205 * 3600), // 205 whole bar below → break #2
      ]),
      quick(),
    )
    // Sticky: the low never crosses back above 93, the flag stays true, and
    // the second break prints the retest diamond instead of a label.
    const sticky = calculateSrBreaksRetests(
      build([
        candle(93.6, 94, 91.8, 93.7, 10, 204 * 3600), // 204 low stays under 93 → no hold yet
        candle(90.5, 90.7, 89, 89.5, 10, 205 * 3600), // 205 whole bar below 93 − depth
      ]),
      quick(),
    )
    expect(recovered.labels.map((label) => [label.kind, label.index])).toEqual([
      ['break-support', 201],
      ['break-support', 204],
    ])
    expect(recovered.markers).toContainEqual({
      kind: 'support-holds',
      index: 203,
      location: 'below',
      color: SR_BREAKS_RETESTS_COLORS.holdBelow,
    })
    expect(recovered.markers).not.toContainEqual(
      expect.objectContaining({ kind: 'support-as-resistance' }),
    )

    expect(sticky.labels.map((label) => [label.kind, label.index])).toEqual([
      ['break-support', 201],
    ])
    expect(sticky.markers).toContainEqual({
      kind: 'support-as-resistance',
      index: 204,
      location: 'above',
      color: SR_BREAKS_RETESTS_COLORS.holdAbove,
    })
    expect(sticky.markers).not.toContainEqual(
      expect.objectContaining({ kind: 'support-holds', index: 204 }),
    )
  })

  it('caps the retained zones at fifty, like max_boxes_count', () => {
    const alternating = Array.from({ length: 120 }, (_, i) => {
      const high = i % 2 === 0
      const close = high ? 101 : 100
      const open = high ? 100 : 101
      return candle(open, close + 0.5, open - 0.5, close, 10, i * 3600)
    })
    const result = calculateSrBreaksRetests(alternating, quick())
    expect(result.zones.length).toBe(SR_MAX_ZONES)
    expect(result.zones[0]!.createdIndex).toBe(120 - SR_MAX_ZONES)
    expect(result.zones.at(-1)!.createdIndex).toBe(119)
  })

  it('stays bounded and consistent on the synthetic demo series', () => {
    const candles = generateCandles(ASSETS[0], '1h')
    const result = calculateSrBreaksRetests(candles, { ...SR_BREAKS_RETESTS_DEFAULTS })
    expect(candles).toHaveLength(900)
    expect(result.zones.length).toBeLessThanOrEqual(SR_MAX_ZONES)
    expect(result.zones.length).toBeGreaterThan(0)
    for (const zone of result.zones) {
      expect(zone.createdIndex).toBe(zone.pivotIndex + 20)
      expect(zone.volumeText).toBe(srVolumeText(zone.volume))
      if (zone.boundary === null) continue
      expect(
        zone.side === 'support' ? zone.boundary < zone.level : zone.boundary > zone.level,
      ).toBe(true)
      expect(zone.fillOpacity).toBeGreaterThanOrEqual(0)
      expect(zone.fillOpacity).toBeLessThanOrEqual(0.7)
    }
    const last = candles.length - 1
    for (const marker of result.markers) {
      expect(marker.index).toBeGreaterThanOrEqual(0)
      expect(marker.index).toBeLessThan(last)
    }
    for (const label of result.labels) {
      expect(label.index).toBeGreaterThanOrEqual(0)
      expect(label.index).toBeLessThan(last)
      expect(Number.isFinite(label.price)).toBe(true)
    }
  })
})
