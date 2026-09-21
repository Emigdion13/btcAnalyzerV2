import { describe, expect, it } from 'vitest'
import {
  CHILE_ATR_LENGTH,
  CHILE_MOMENTUM_TIMEFRAME,
  CHILE_PIVOT_MEMORY,
  calculateChileReversal,
  chileMarkerExpiry,
  chileMarkerNowSeconds,
  chileRequestedTimeframes,
  chileReversalIndicatorLabel,
  chileReversalSettings,
  containingHtfIndexes,
  displayedChileSignals,
  isChileReversalSettings,
  type ChileSignal,
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

/** Chart series on the same resolution as the round feed, so no HTF feed is needed. */
const series = (rows: [number, number, number, number][], step = 900): Candle[] =>
  rows.map(([o, h, l, c], i) => candle(o, h, l, c, i * step))

/** Filler bars with a stable 2-wide range, to warm ATR(14) up without making pivots. */
const filler = (count: number, price = 100, step = 900, from = 0): Candle[] =>
  Array.from({ length: count }, (_, i) =>
    candle(price, price + 1, price - 1, price, (from + i) * step),
  )

/**
 * A steadily rising (or falling) series: every bar makes a higher high and a higher low, closes at
 * its own high, and moves one point — enough for the EMA stacks, the RSI and the supertrend to
 * agree without a single counter-trend bar.
 */
const trending = (
  count: number,
  step: number,
  direction: 1 | -1,
  firstTime: number,
  start = 100,
): Candle[] =>
  Array.from({ length: count }, (_, i) => {
    const open = start + direction * i
    const close = open + direction
    return candle(
      open,
      Math.max(open, close),
      Math.min(open, close) - 0.5,
      close,
      firstTime + i * step,
    )
  })

const settings = (overrides: Partial<ChileReversalSettings> = {}): ChileReversalSettings => ({
  ...CHILE_REVERSAL_DEFAULTS,
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

/** The shared bullish stage: a 1m chart whose last bar opens a fresh 15m round, feeds rising. */
const LAST_TIME = 31500
const bullish = () => {
  const candles = trending(40, 60, 1, LAST_TIME - 39 * 60)
  return {
    candles,
    timeframe: '1m' as const,
    settings: settings(),
    timeframes: {
      '15m': { candles: trending(40, 900, 1, 0) },
      [CHILE_MOMENTUM_TIMEFRAME]: { candles: trending(40, 300, 1, LAST_TIME - 39 * 300) },
    },
  }
}

const bearish = () => {
  const input = bullish()
  return {
    ...input,
    candles: trending(40, 60, -1, LAST_TIME - 39 * 60, 200),
    timeframes: {
      '15m': { candles: trending(40, 900, -1, 0, 200) },
      [CHILE_MOMENTUM_TIMEFRAME]: {
        candles: trending(40, 300, -1, LAST_TIME - 39 * 300, 200),
      },
    },
  }
}

describe('chile settings', () => {
  it('accepts the published defaults', () => {
    expect(isChileReversalSettings(CHILE_REVERSAL_DEFAULTS)).toBe(true)
  })

  it('rejects out-of-range and malformed settings', () => {
    expect(isChileReversalSettings(settings({ minScore: 2 }))).toBe(false)
    expect(isChileReversalSettings(settings({ minScore: 21 }))).toBe(false)
    expect(isChileReversalSettings(settings({ minEdge: 0 }))).toBe(false)
    expect(isChileReversalSettings(settings({ minEdge: 9 }))).toBe(false)
    expect(isChileReversalSettings(settings({ pivotLeft: 0 }))).toBe(false)
    expect(isChileReversalSettings(settings({ pivotRight: 6 }))).toBe(false)
    expect(isChileReversalSettings(settings({ maxDistanceAtr: 0.2 }))).toBe(false)
    expect(isChileReversalSettings(settings({ lineLength: 5 }))).toBe(false)
    expect(isChileReversalSettings(settings({ lineLength: 101 }))).toBe(false)
    expect(isChileReversalSettings(settings({ trendFactor: 0.5 }))).toBe(false)
    expect(isChileReversalSettings(settings({ trendAtrLength: 4 }))).toBe(false)
    expect(isChileReversalSettings(settings({ markerTtlSeconds: -1 }))).toBe(false)
    expect(isChileReversalSettings(settings({ markerFadeSeconds: 601 }))).toBe(false)
    expect(isChileReversalSettings(settings({ supportColor: 'green' }))).toBe(false)
    expect(isChileReversalSettings({ ...CHILE_REVERSAL_DEFAULTS, resolution: '7m' })).toBe(false)
    expect(isChileReversalSettings(null)).toBe(false)
  })

  it('accepts a profile persisted before the marker lifetime existed', () => {
    const { markerTtlSeconds, markerFadeSeconds, ...legacy } = CHILE_REVERSAL_DEFAULTS
    expect(markerTtlSeconds).toBe(60)
    expect(markerFadeSeconds).toBe(15)
    expect(isChileReversalSettings(legacy)).toBe(true)
  })

  it('drops the retired V18 fields instead of carrying them into the engine', () => {
    // A workspace saved by the older port still has zone thickness, the confirmation gates and the
    // panel-prefixed score inputs. None of them exist in V17, so none of them may survive.
    const stored = {
      ...CHILE_REVERSAL_DEFAULTS,
      zoneThicknessAtr: 0.1,
      showZones: true,
      showBreaks: true,
      requireConfirmation: true,
      impulseBodyRatio: 0.45,
      panelMinScore: 9,
      panelMinEdge: 5,
      panelTrendFactor: 3,
      panelTrendAtrLength: 20,
      minScore: undefined,
      minEdge: undefined,
    }
    const normalized = chileReversalSettings(
      indicator({ chileReversal: stored as unknown as ChileReversalSettings }),
    )
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(CHILE_REVERSAL_DEFAULTS).sort())
    expect(normalized.minScore).toBe(CHILE_REVERSAL_DEFAULTS.minScore)
    expect('zoneThicknessAtr' in normalized).toBe(false)
    expect('requireConfirmation' in normalized).toBe(false)
  })

  it('falls back to defaults for an indicator with no stored settings', () => {
    expect(chileReversalSettings(indicator())).toEqual(CHILE_REVERSAL_DEFAULTS)
  })

  it('labels with the active profile', () => {
    expect(chileReversalIndicatorLabel(indicator())).toBe('Chile Reversal (15m, 2, 2, 6/2)')
  })

  it('throws on invalid settings rather than computing nonsense', () => {
    expect(() =>
      calculateChileReversal(filler(20), settings({ pivotLeft: 0 }), { timeframe: '15m' }),
    ).toThrow(/Invalid Chile Reversal settings/)
  })

  it('asks for the round feed and the 5m read, never the chart itself', () => {
    expect(chileRequestedTimeframes(settings(), '1m')).toEqual(['15m', '5m'])
    expect(chileRequestedTimeframes(settings(), '15m')).toEqual(['5m'])
    expect(chileRequestedTimeframes(settings({ resolution: '5m' }), '15m')).toEqual(['5m'])
  })
})

describe('chile levels', () => {
  it('produces no levels while ATR is still warming up', () => {
    const result = calculateChileReversal(filler(5), settings(), { timeframe: '15m' })
    expect(result.levels).toEqual([])
    expect(result.signals).toEqual([])
    expect(result.last?.ready).toBe(false)
    expect(result.atr.every((value) => value === null)).toBe(true)
  })

  it('reports a missing higher-timeframe feed instead of inventing levels', () => {
    const result = calculateChileReversal(filler(40), settings({ resolution: '1h' }), {
      timeframe: '15m',
      timeframes: {},
    })
    expect(result.missingFeed).toBe(true)
    expect(result.levels).toEqual([])
    expect(result.last).toBe(null)
  })

  it('takes the nearest pivot high above price as R1 and the runner-up as R2', () => {
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
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    const kinds = result.levels.map((level) => level.kind)
    expect(kinds).toContain('R1')
    const r1 = result.levels.find((level) => level.kind === 'R1')!
    const r2 = result.levels.find((level) => level.kind === 'R2')
    // R1 is always the closer of the two; R2, when present, is further away.
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
    // A tight distance filter removes the far levels; the Pine sort could have produced an R2 with
    // no R1 here.
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 0.5 }), {
      timeframe: '15m',
    })
    const kinds = result.levels.map((level) => level.kind)
    if (kinds.includes('R2')) expect(kinds).toContain('R1')
    if (kinds.includes('S2')) expect(kinds).toContain('S1')
  })

  it('falls back to the 6-bar range when no pivot qualifies, and says so', () => {
    // A strictly rising series confirms no pivot on either side, so both slots fall back to the
    // 6-bar range: the low of the last six closed bars is the only support, and there is no
    // resistance above price at all.
    const rising = trending(40, 900, 1, 0)
    const result = calculateChileReversal(rising, settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(result.levels).toEqual([
      {
        kind: 'S1',
        side: 'support',
        price: rising.at(-7)!.low,
        fallback: true,
      },
    ])

    const falling = trending(40, 900, -1, 0)
    const down = calculateChileReversal(falling, settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(down.levels.map((level) => level.kind)).toEqual(['R1'])
    expect(down.levels[0]!.price).toBe(falling.at(-7)!.high)
  })

  it('remembers at most four pivots per side', () => {
    expect(CHILE_PIVOT_MEMORY).toBe(4)
  })

  it('warms up with ATR(14) at minimum', () => {
    const result = calculateChileReversal(filler(40), settings(), { timeframe: '15m' })
    expect(result.warmupBars).toBeGreaterThanOrEqual(CHILE_ATR_LENGTH)
  })
})

describe('chile reversal events', () => {
  /** A support level at 96, then a bar that touches it exactly and closes green above it. */
  const touchSeries = (low: number): Candle[] =>
    series([
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 101, 99, 100],
      [100, 101, 96, 100], // pivot low 96
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 97, 99],
      [99, 103, low, 102], // wick to `low`, closes green above 96
      [102, 103, 101, 102],
    ])

  it('counts a bounce when the wick reaches the level itself — V17 has no zone', () => {
    const touched = calculateChileReversal(touchSeries(96), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    const bar = touched.bars.at(-2)!
    expect(bar.level).toBe('bounce')
    const missed = calculateChileReversal(touchSeries(96.5), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    }).bars.at(-2)!
    // The three points the event is worth are the only difference between the two.
    expect(bar.scoreUp - missed.scoreUp).toBe(3)
  })

  it('does not count a bounce from a wick that stops short of the level', () => {
    const short = calculateChileReversal(touchSeries(96.5), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(short.bars.at(-2)?.level).not.toBe('bounce')
  })

  it('does not count a bounce on a red candle that closes below the level', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 101, 99, 100],
      [100, 101, 96, 100], // pivot low 96
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [101, 101, 94, 95], // slices through the level and closes red below it
      [95, 96, 94, 95],
    ]
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(result.bars.some((bar) => bar.level === 'bounce')).toBe(false)
  })

  it('counts a rejection at the level', () => {
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 104, 99, 100], // pivot high 104
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [101, 104, 98, 99], // tags 104 exactly, closes red below it
      [99, 102, 98, 101],
      [101, 102, 100, 101],
    ]
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(result.levels.map((level) => level.kind)).toEqual(['R1', 'S1'])
    expect(result.levels[0]!.price).toBe(104)
    expect(result.bars[24]!.level).toBe('reject')
  })

  it('cannot break a level it never selects — V17 reads R1 as the nearest pivot ABOVE the close', () => {
    // `rupturaR1 = close > resistencia1 and close[1] <= resistencia1`, but `resistencia1` is
    // re-resolved on this bar as a pivot strictly above this bar's close, so the two halves can
    // never both hold. The +3 break contribution is therefore unreachable in the original too —
    // a quirk of the script, kept here rather than "fixed", and the same on the support side.
    const rows: [number, number, number, number][] = [
      ...filler(20).map(
        (c) => [c.open, c.high, c.low, c.close] as [number, number, number, number],
      ),
      [100, 104, 99, 100], // pivot high 104
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 102, 99, 101],
      [101, 107, 100, 106], // closes through 104
      [106, 108, 105, 107],
    ]
    const result = calculateChileReversal(series(rows), settings({ maxDistanceAtr: 6 }), {
      timeframe: '15m',
    })
    expect(result.bars[25]!.level).not.toBe('break-resistance')
    expect(result.bars.every((bar) => bar.level !== 'break-support')).toBe(true)
  })
})

describe('chile score', () => {
  it('scores every bullish contribution and calls up', () => {
    const result = calculateChileReversal(bullish().candles, settings(), {
      timeframe: '1m',
      timeframes: bullish().timeframes,
    })
    const last = result.last!
    expect(last.ready).toBe(true)
    expect(last.lateral).toBe(false)
    // robex 2 + round EMA 2 + slope 1 + round RSI 2 + higher high 1 + higher low 1 + 5m momentum 2
    // + pressure 1 + VWAP 1 + buyers 1 + round 2
    expect(last.scoreUp).toBe(16)
    expect(last.scoreDown).toBe(0)
    expect(last.fuerzaArriba).toBe(100)
    expect(last.fuerzaAbajo).toBe(0)
    expect(last.advantage).toBe(16)
    expect(last.prediction).toBe(1)
    expect(last.call).toBe('up')
    expect(last.trendLabel).toBe('ALCISTA')
    expect(last.supertrendUp).toBe(true)
    expect(last.buyers).toBe(100)
    expect(last.volume).toBe('normal')
    // Factors are strongest first, and only the newest bar carries them.
    expect(last.factors[0]!.points).toBe(2)
    // The slope and structure points read the previous closed round bar, so they need it there.
    expect(last.factors.map((factor) => factor.key)).toContain('round-slope')
    expect(last.factors.map((factor) => factor.key)).toContain('higher-high')
    expect(last.factors.every((factor) => factor.side === 'up')).toBe(true)
    expect(result.bars[result.bars.length - 2]!.factors).toEqual([])
  })

  it('mirrors the same score on the way down', () => {
    const input = bearish()
    const last = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    }).last!
    expect(last.scoreUp).toBe(0)
    expect(last.scoreDown).toBe(16)
    expect(last.prediction).toBe(-1)
    expect(last.call).toBe('down')
    expect(last.trendLabel).toBe('BAJISTA')
    expect(last.supertrendUp).toBe(false)
    // The fixture's falling bars close a third of the way up their range, so sellers read 67%.
    expect(last.sellers).toBe(67)
  })

  it('needs both the minimum score and the minimum edge', () => {
    const input = bullish()
    const run = (overrides: Partial<ChileReversalSettings>) =>
      calculateChileReversal(input.candles, settings(overrides), {
        timeframe: '1m',
        timeframes: input.timeframes,
      }).last!.call
    expect(run({ minScore: 17 })).toBe('wait')
    expect(run({ minEdge: 8 })).toBe('up')
    const bear = bearish()
    expect(
      calculateChileReversal(bear.candles, settings({ minScore: 17 }), {
        timeframe: '1m',
        timeframes: bear.timeframes,
      }).last!.call,
    ).toBe('wait')
  })

  it('stays silent in a lateral market no matter how the trend stack reads', () => {
    const input = bullish()
    const last = calculateChileReversal(
      input.candles.map((c) => candle(100, 100.5, 99.5, 100, c.time)),
      settings(),
      {
        timeframe: '1m',
        timeframes: {
          '15m': {
            candles: input.timeframes['15m'].candles.map((c) =>
              candle(100, 100.5, 99.5, 100, c.time),
            ),
          },
        },
      },
    ).last!
    expect(last.ready).toBe(true)
    expect(last.lateral).toBe(true)
    expect(last.call).toBe('wait')
  })

  it('reads buyers and sellers off where the close landed in the bar', () => {
    const input = bullish()
    const candles = [...input.candles]
    const last = candles.length - 1
    candles[last] = candle(100, 103, 99, 100.32, candles[last]!.time)
    const bar = calculateChileReversal(candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    }).last!
    expect(bar.buyers).toBe(33)
    expect(bar.sellers).toBe(67)
  })

  it('calls the volume state off the 20-bar average', () => {
    const input = bullish()
    const candles = [...input.candles]
    const last = candles.length - 1
    candles[last] = { ...candles[last]!, volume: candles[last]!.volume * 1.7 }
    // The average includes the bar itself, so the ratio is 1.7 × 19/20 ≈ 1.62.
    const bar = calculateChileReversal(candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    }).last!
    expect(bar.volume).toBe('very-high')
  })

  it('takes the 5m momentum points from the 5m feed, and nothing without it', () => {
    const input = bullish()
    const withMomentum = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    }).last!
    expect(withMomentum.factors.find((factor) => factor.key === 'momentum')?.points).toBe(2)

    const without = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: { '15m': input.timeframes['15m'] },
    }).last!
    expect(without.factors.some((factor) => factor.key === 'momentum')).toBe(false)
    expect(without.scoreUp).toBe(withMomentum.scoreUp - 2)
  })

  it('reads the 5m bar containing the chart bar, not the closed one before it', () => {
    // Two 5m bars: the first falling, the second rising. A chart bar inside the second one reads
    // the second one, which is what `request.security(..., "5", x)` without `[1]` delivers.
    const momentum = [
      ...trending(20, 300, -1, LAST_TIME - 20 * 300, 200),
      ...trending(20, 300, 1, LAST_TIME, 100),
    ]
    const indexes = containingHtfIndexes([LAST_TIME], momentum, CHILE_MOMENTUM_TIMEFRAME, true)
    expect(indexes[0]).toBe(20) // the first rising bar, not the last falling one
  })
})

describe('chile signals', () => {
  it('prints only on a chart bar that closes a round', () => {
    const input = bullish()
    const result = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    })
    expect(result.signals.length).toBeGreaterThan(0)
    for (const signal of result.signals) {
      // Pine `fin15 = minute(time_close) % 15 == 0` on a 1m chart.
      expect((signal.time + 60) % 900).toBe(0)
      expect(result.bars[signal.index]!.official).toBe(true)
      expect(signal.kind).toBe('arriba')
      expect(signal.side).toBe('bullish')
      const bar = input.candles[signal.index]!
      expect(signal.price).toBe(bar.low)
    }
  })

  it('prints ABAJO on a falling market', () => {
    const input = bearish()
    const result = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    })
    expect(result.signals.length).toBeGreaterThan(0)
    for (const signal of result.signals) {
      expect(signal.kind).toBe('abajo')
      expect(signal.price).toBe(input.candles[signal.index]!.high)
    }
  })

  it('waits for the bar to close before printing, as barstate.isconfirmed does', () => {
    const input = bullish()
    const last = input.candles[input.candles.length - 1]!
    // A clock inside the newest bar: it has not closed, so it must not print a label yet.
    const forming = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
      nowSeconds: last.time + 30,
    })
    expect(forming.bars.at(-1)!.confirmed).toBe(false)
    expect(forming.signals.some((signal) => signal.index === input.candles.length - 1)).toBe(false)

    const closed = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
      nowSeconds: last.time + 61,
    })
    expect(closed.bars.at(-1)!.confirmed).toBe(true)
    expect(closed.signals.some((signal) => signal.index === input.candles.length - 1)).toBe(
      closed.bars.at(-1)!.official && closed.bars.at(-1)!.prediction !== 0,
    )
  })

  it('prints nothing while the call is ESPERAR', () => {
    const input = bullish()
    const result = calculateChileReversal(input.candles, settings({ minScore: 20 }), {
      timeframe: '1m',
      timeframes: input.timeframes,
    })
    expect(result.signals).toEqual([])
  })
})

describe('chile higher timeframe reads', () => {
  it('only uses closed higher-timeframe bars, never the developing one', () => {
    // 15m pivot feed where the FINAL (developing) bar contains an extreme low. If that bar leaked
    // in, it would become a support level immediately.
    const htf: Candle[] = [
      ...filler(20, 100, 900),
      candle(100, 101, 99, 100, 20 * 900),
      candle(100, 101, 99, 100, 21 * 900),
      candle(100, 101, 50, 100, 22 * 900), // extreme low in the newest HTF bar
    ]
    const chart: Candle[] = Array.from({ length: 5 }, (_, i) =>
      candle(100, 101, 99, 100, 22 * 900 + i * 180),
    )
    const result = calculateChileReversal(chart, settings({ maxDistanceAtr: 6 }), {
      timeframe: '3m',
      timeframes: { '15m': { candles: htf } },
    })
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

  it('plots ROBEX Trend, both EMAs and VWAP for every chart bar', () => {
    const input = bullish()
    const result = calculateChileReversal(input.candles, settings(), {
      timeframe: '1m',
      timeframes: input.timeframes,
    })
    expect(result.supertrend).toHaveLength(input.candles.length)
    expect(result.ema9).toHaveLength(input.candles.length)
    expect(result.ema21).toHaveLength(input.candles.length)
    expect(result.vwap).toHaveLength(input.candles.length)
    // The trend line has a value once its ATR warms up, and it is green while the direction is up.
    expect(result.supertrend.at(-1)).not.toBe(null)
    expect(result.supertrendUp.at(-1)).toBe(true)
    expect(result.ema9.at(-1)!).toBeGreaterThan(result.ema21.at(-1)!)
    expect(result.vwap.at(-1)!).toBeLessThan(input.candles.at(-1)!.close)
  })
})

describe('displayedChileSignals', () => {
  const print = (index: number): ChileSignal => ({
    kind: 'arriba',
    index,
    time: index * 900,
    price: 100,
    side: 'bullish',
    scoreUp: 10,
    scoreDown: 2,
    advantage: 8,
  })

  it('caps the labels the overlay paints, newest first', () => {
    const signals = Array.from({ length: 120 }, (_, i) => print(i))
    const shown = displayedChileSignals(signals)
    expect(shown).toHaveLength(40)
    expect(shown[0]!.index).toBe(80)
    expect(shown.at(-1)!.index).toBe(119)
  })

  it('leaves a short history alone', () => {
    const signals = [print(1), print(2)]
    expect(displayedChileSignals(signals)).toEqual(signals)
  })
})

describe('chileMarkerExpiry', () => {
  const signal = print0()
  function print0(): ChileSignal {
    return {
      kind: 'arriba',
      index: 0,
      time: 1000,
      price: 100,
      side: 'bullish',
      scoreUp: 8,
      scoreDown: 2,
      advantage: 6,
    }
  }

  it('returns null when the lifetime is off, which keeps labels until the cap', () => {
    expect(chileMarkerExpiry(signal, 5000, 60, 0, 15)).toBe(null)
  })

  it('holds full strength through the lifetime, then fades, then expires', () => {
    // The bar closes at 1060; the label prints then.
    expect(chileMarkerExpiry(signal, 1060, 60, 60, 15)).toEqual({
      ageSeconds: 0,
      expired: false,
      fadeDelaySeconds: 60,
    })
    expect(chileMarkerExpiry(signal, 1120, 60, 60, 15)!.fadeDelaySeconds).toBe(0)
    expect(chileMarkerExpiry(signal, 1130, 60, 60, 15)!.fadeDelaySeconds).toBe(-10)
    expect(chileMarkerExpiry(signal, 1134, 60, 60, 15)!.expired).toBe(false)
    expect(chileMarkerExpiry(signal, 1135, 60, 60, 15)!.expired).toBe(true)
  })

  it('never reports a negative age for a bar that has not closed yet', () => {
    expect(chileMarkerExpiry(signal, 1000, 60, 60, 15)!.ageSeconds).toBe(0)
  })
})

describe('chileMarkerNowSeconds', () => {
  it('uses wall time while the newest bar tracks it', () => {
    expect(chileMarkerNowSeconds(10_000, 9960, 60)).toBe(10_000)
  })

  it('falls back to the data edge for pinned demo and replay history', () => {
    expect(chileMarkerNowSeconds(50_000, 9960, 60)).toBe(10_020)
  })
})
