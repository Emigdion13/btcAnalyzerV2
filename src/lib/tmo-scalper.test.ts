import { describe, expect, it } from 'vitest'
import {
  aggregateCandles,
  calculateTmoScalper,
  isTmoScalperSettings,
  tmoFeedInterval,
  tmoResolutionLabel,
  tmoResolutionSeconds,
  tmoScalperFeeds,
  tmoScalperIndicatorLabel,
  tmoScalperPlots,
  tmoScalperSettings,
  TMO_COLORS,
  TMO_CUTOFF,
  TMO_DISPLAY_SCALE,
  TMO_SCALPER_DEFAULTS as defaults,
} from './tmo-scalper'
import { oscHudRequestedTimeframes, tmoScalperHudModel, tmoScalperVerdict } from './osc-hud'
import { builtInPlots } from './indicators'
import type { IndicatorContext } from './cm-ult-macd'
import type { Candle, Indicator, Timeframe, TmoResolution, TmoScalperSettings } from './types'

const M = 60
/** Monotonic candles: each bar opens where the last closed and moves `move` dollars. */
const series = (moves: number[], startPrice = 100, start = 0, step = M): Candle[] => {
  let price = startPrice
  return moves.map((move, i) => {
    const open = price
    const close = price + move
    price = close
    return {
      time: start + step * i,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1,
    }
  })
}
const t = (days: number, hours = 0) => Math.floor(Date.UTC(2024, 0, 1 + days, hours) / 1000)

const indicator: Indicator = {
  id: 'tmo',
  kind: 'tmo-scalper',
  name: 'TMO Scalper',
  period: 14,
  color: TMO_COLORS.bull,
  visible: true,
}
const settings = (patch: Partial<TmoScalperSettings> = {}): TmoScalperSettings => ({
  ...defaults,
  ...patch,
})
/** The default (1, 5, 30) wheel set wants the chart plus the 5m and 15m streams. */
const feedsFor = (chart: Candle[], timeframe: Timeframe = '1m') => ({
  timeframe,
  timeframes: {
    '5m': { candles: aggregateCandles(chart, 300) },
    '15m': { candles: aggregateCandles(chart, 900) },
  },
})

describe('TMO Scalper settings', () => {
  it('exposes the (1, 5, 30, 14, 5, 3, 3, 2, 9, -9) profile as defaults', () => {
    expect(defaults.timeframe1).toBe('1')
    expect(defaults.timeframe2).toBe('5')
    expect(defaults.timeframe3).toBe('30')
    expect([defaults.tmoLength, defaults.calcLength, defaults.smoothLength]).toEqual([14, 5, 3])
    expect([defaults.signalSize, defaults.signalOffset]).toEqual([3, 2])
    expect([defaults.extremeOb, defaults.extremeOs]).toEqual([9, -9])
    expect(defaults.showTmo1Signals).toBe(true)
    expect(defaults.showTmo2Signals).toBe(true)
    expect(defaults.showTmo2ExtremeSignals).toBe(true)
  })

  it('falls back to the profile for missing or invalid stored settings', () => {
    expect(tmoScalperSettings({ ...indicator, tmoScalper: undefined })).toEqual(defaults)
    expect(
      tmoScalperSettings({
        ...indicator,
        tmoScalper: { ...defaults, tmoLength: 0 } as TmoScalperSettings,
      }),
    ).toEqual(defaults)
  })

  it('validates every published field, including the resolution choices', () => {
    expect(isTmoScalperSettings(defaults)).toBe(true)
    expect(isTmoScalperSettings({ ...defaults, timeframe3: 'M' })).toBe(false)
    expect(isTmoScalperSettings({ ...defaults, tmoLength: 14.5 })).toBe(false)
    expect(isTmoScalperSettings({ ...defaults, extremeOb: '9' })).toBe(false)
    expect(isTmoScalperSettings({ ...defaults, showLines: 1 })).toBe(false)
    expect(isTmoScalperSettings({ ...defaults, signalOffset: 100001 })).toBe(false)
  })

  it('maps the published time-frame codes to minutes and to the stream they resample from', () => {
    expect(tmoResolutionSeconds('30' as TmoResolution)).toBe(1800)
    expect(tmoResolutionLabel('30' as TmoResolution)).toBe('30m')
    expect(tmoResolutionLabel('W' as TmoResolution)).toBe('W')
    expect(tmoFeedInterval(tmoResolutionSeconds('1' as TmoResolution))).toBe('1m')
    // The coarsest dividing stream: 30m folds 2-to-1 from 15m, not 6-to-1 from 5m.
    expect(tmoFeedInterval(tmoResolutionSeconds('30' as TmoResolution))).toBe('15m')
    expect(tmoFeedInterval(tmoResolutionSeconds('20' as TmoResolution))).toBe('5m')
    expect(tmoFeedInterval(tmoResolutionSeconds('60' as TmoResolution))).toBe('1h')
    expect(tmoFeedInterval(tmoResolutionSeconds('240' as TmoResolution))).toBe('4h')
    expect(tmoFeedInterval(tmoResolutionSeconds('2D' as TmoResolution))).toBe('1D')
    expect(tmoFeedInterval(tmoResolutionSeconds('3W' as TmoResolution))).toBe('1W')
    // The default profile reads the 1m, 5m and 15m streams, once each.
    expect(tmoScalperFeeds(defaults)).toEqual(['1m', '5m', '15m'])
    // In-feed choices dedupe and fold: 60 lands on the native 1h stream.
    expect(
      tmoScalperFeeds(settings({ timeframe1: '5', timeframe2: '30', timeframe3: '60' })),
    ).toEqual(['5m', '15m', '1h'])
    expect(
      tmoScalperFeeds(settings({ timeframe1: '30', timeframe2: '45', timeframe3: '60' })),
    ).toEqual(['15m', '1h'])
  })

  it('renders the legend with time frames and the length trio', () => {
    expect(tmoScalperIndicatorLabel(indicator)).toBe('TMO Scalper (1, 5, 30, 14, 5, 3)')
    expect(
      tmoScalperIndicatorLabel({
        ...indicator,
        tmoScalper: settings({ timeframe1: '2', timeframe2: '10', timeframe3: '60' }),
      }),
    ).toBe('TMO Scalper (2, 10, 60, 14, 5, 3)')
  })
})

describe('aggregation into a published TMO time frame', () => {
  it('folds native candles whole buckets at a time', () => {
    const chart = series([1, 1, -2, 1, 1, -3, 1, 1, 2, -1, 1, 2], 100)
    const folded = aggregateCandles(chart, 300)
    expect(folded.map((c) => c.time)).toEqual([0, 300, 600])
    // High/low/close of the bucket come from its candles, the open from its first.
    expect(folded[0]).toMatchObject({ open: 100, close: 102 })
    expect(folded[1]).toMatchObject({ open: 102, close: 102 })
    expect(folded[2]).toMatchObject({ open: 102, close: 105 })
    expect(folded[1]!.high).toBe(103)
    expect(folded[1]!.low).toBe(99)
  })

  it('keeps a partial bucket open so the unclosed bar moves tick by tick', () => {
    const chart = series([1, 1], 100) // only two minutes into a 5m bucket
    const folded = aggregateCandles(chart, 300)
    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({ time: 0, open: 100, close: 102 })
  })

  it('opens weekly buckets on Monday 00:00 UTC like the chart’s own 1W bars', () => {
    // Wednesday 2024-01-03 and Friday 2024-01-05 belong to the Monday 2024-01-01 bucket.
    const wed = t(2)
    const fri = t(4)
    const folded = aggregateCandles(
      [
        { time: wed, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        { time: fri, open: 12, high: 13, low: 12, close: 13, volume: 1 },
      ],
      604800,
    )
    expect(folded).toHaveLength(1)
    expect(new Date(folded[0]!.time * 1000).toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(folded[0]).toMatchObject({ open: 10, close: 13 })
  })
})

/**
 * Independent restatement of the published recurrence: sums written as an explicit loop and
 * EMAs written in the `(2x + (n−1)prev)/(n+1)` form, so the two implementations only agree
 * when seeding, order and scale match.
 */
const refEma = (values: number[], length: number): number[] => {
  const out: number[] = []
  values.forEach((value, i) => {
    out.push(i === 0 ? value : (2 * value + (length - 1) * out[i - 1]!) / (length + 1))
  })
  return out
}
const refTmo = (candles: Candle[], s: TmoScalperSettings) => {
  const data = candles.map((candle, i) => {
    let sum = 0
    for (let k = 1; k <= s.tmoLength - 1; k++) {
      if (i - k < 0) continue
      const open = candles[i - k]!.open
      if (candle.close > open) sum += 1
      else if (candle.close < open) sum -= 1
    }
    return sum
  })
  const ema = refEma(data, s.calcLength)
  const main = refEma(ema, s.smoothLength)
  const signal = refEma(main, s.smoothLength)
  return { main, signal }
}

describe('the wheel calculation', () => {
  const chart = series(
    [
      ...Array.from({ length: 40 }, (_, i) => (i % 7 === 3 ? -0.6 : 1)),
      ...Array.from({ length: 40 }, (_, i) => (i % 9 === 4 ? 0.8 : -1)),
    ],
    100,
  )

  it('reproduces the published recurrence on the chart’s own time frame, bar for bar', () => {
    const values = calculateTmoScalper(chart, settings(), feedsFor(chart))
    const ref = refTmo(chart, defaults)
    values.main1.forEach((value, i) => {
      expect(value).not.toBeNull()
      expect(value).toBeCloseTo((TMO_DISPLAY_SCALE * ref.main[i]!) / defaults.tmoLength, 12)
    })
    values.signal1.forEach((value, i) => {
      expect(value).toBeCloseTo((TMO_DISPLAY_SCALE * ref.signal[i]!) / defaults.tmoLength, 12)
    })
  })

  it('counts missing history as zero, like Pine’s na comparisons, and starts saturated values at no warm-up gap', () => {
    const up = series(
      Array.from({ length: 30 }, () => 1),
      100,
    )
    const values = calculateTmoScalper(up, settings(), feedsFor(up))
    // Bar 0: nothing to compare, so the wheel starts at exactly zero, not null.
    expect(values.main1[0]).toBe(0)
    // A long enough one-way stretch saturates the raw sums at ±(length−1), i.e. 15·13/14.
    const saturation = (TMO_DISPLAY_SCALE * (defaults.tmoLength - 1)) / defaults.tmoLength
    expect(Math.max(...(values.main1 as number[]))).toBeGreaterThan(saturation * 0.98)
    expect(Math.max(...(values.main1 as number[]))).toBeLessThan(saturation)
  })

  it('recomputes a higher wheel from its resampled stream and holds it flat across the bucket', () => {
    const chart = series(
      Array.from({ length: 120 }, (_, i) => Math.sin(i / 3)),
      100,
    )
    const values = calculateTmoScalper(chart, settings(), feedsFor(chart))
    // The 5m wheel folds from the 5m stream, the 30m wheel 2-to-1 from the 15m stream:
    // every value exists, and the 30m wheel changes only on 30m bucket starts.
    values.main3.forEach((value) => expect(value).not.toBeNull())
    for (let i = 1; i < chart.length; i++) {
      const sameBucket = Math.floor(chart[i]!.time / 1800) === Math.floor(chart[i - 1]!.time / 1800)
      if (sameBucket) expect(values.main3[i]).toBe(values.main3[i - 1])
    }
    const folded5 = aggregateCandles(chart, 300)
    const ref5 = refTmo(folded5, defaults)
    // The 5m wheel at the last bar equals the native recurrence on the folded stream.
    expect(values.main2.at(-1)).toBeCloseTo(
      (TMO_DISPLAY_SCALE * ref5.main.at(-1)!) / defaults.tmoLength,
      12,
    )
  })

  it('plots null wheels when a feed is missing instead of guessing', () => {
    const chart = series([1, 1, 1], 100)
    const values = calculateTmoScalper(chart, settings(), { timeframe: '1m' })
    // TMO 1 is the chart itself and survives; the two higher wheels have no 5m stream.
    expect(values.main1.every((v) => v !== null)).toBe(true)
    expect(values.main2.every((v) => v === null)).toBe(true)
    expect(values.main3.every((v) => v === null)).toBe(true)
  })
})

describe('the gated signals', () => {
  it('prints a TMO 2 buy on the resumption only because the slow wheel stayed green through the dip', () => {
    // Trend up long enough to saturate every wheel, dip just enough to cross the 5m wheel,
    // run again. The 30m wheel never reads the dip: its opens all sit below the close.
    const run = series(
      [
        ...Array.from({ length: 240 }, () => 1),
        ...Array.from({ length: 45 }, () => -1),
        ...Array.from({ length: 90 }, () => 1),
      ],
      100,
    )
    const values = calculateTmoScalper(run, settings(), feedsFor(run))
    expect(values.bull2.some((v) => v !== null)).toBe(true)
    // The dip's own down-cross is exactly what the slow wheel is there to veto.
    expect(values.bear2.every((v) => v === null)).toBe(true)
    values.bull2.forEach((value, i) => {
      if (value === null) return
      expect(values.main2[i]!).toBeGreaterThan(values.signal2[i]!)
      expect(values.main3[i]!).toBeGreaterThan(values.signal3[i]!)
      expect(value).toBeCloseTo(values.main2[i]! - defaults.signalOffset, 12)
    })
  })

  it('flags the oversold lift as an extreme while the trend gate — correctly — stays closed', () => {
    // Down for hours, then one clean turn up. The first 5m up-cross fires deep below the
    // extreme oversold level, while the 30m wheel is still red: no gated TMO 2 dot, but the
    // counter-move ▲ is exactly what the extreme pair exists for.
    const downThenUp = series(
      [...Array.from({ length: 240 }, () => -1), ...Array.from({ length: 60 }, () => 1)],
      1000,
    )
    const values = calculateTmoScalper(downThenUp, settings(), feedsFor(downThenUp))
    const cross = values.bullExtreme.findIndex((v) => v !== null)
    expect(cross).toBeGreaterThan(239)
    expect(values.main2[cross]!).toBeLessThanOrEqual(defaults.extremeOs)
    expect(values.main3[cross]!).toBeLessThan(values.signal3[cross]!)
    expect(values.bull2[cross]).toBeNull()
    // Every extreme flag is a middle-wheel cross from the extreme zone, trend gate or none.
    values.bullExtreme.forEach((value, i) => {
      if (value !== null) expect(values.main2[i]!).toBeLessThanOrEqual(defaults.extremeOs)
    })
  })

  it('mirrors the same shape on the sell side: a gated sell vetoed, the overbought sag flagged', () => {
    const upThenDown = series(
      [...Array.from({ length: 240 }, () => 1), ...Array.from({ length: 60 }, () => -1)],
      100,
    )
    const values = calculateTmoScalper(upThenDown, settings(), feedsFor(upThenDown))
    const cross = values.bearExtreme.findIndex((v) => v !== null)
    expect(cross).toBeGreaterThan(239)
    expect(values.main2[cross]!).toBeGreaterThanOrEqual(defaults.extremeOb)
    expect(values.main3[cross]!).toBeGreaterThan(values.signal3[cross]!)
    expect(values.bear2[cross]).toBeNull()
    values.bearExtreme.forEach((value, i) => {
      if (value !== null) expect(values.main2[i]!).toBeGreaterThanOrEqual(defaults.extremeOb)
    })
  })

  it('gates TMO 1 crosses on the middle wheel, never independently', () => {
    const choppy = series(
      Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 2 : -1)),
      100,
    )
    const values = calculateTmoScalper(choppy, settings(), feedsFor(choppy))
    values.bull1.forEach((value, i) => {
      if (value !== null) expect(values.main2[i]!).toBeGreaterThan(values.signal2[i]!)
    })
    values.bear1.forEach((value, i) => {
      if (value !== null) expect(values.main2[i]!).toBeLessThan(values.signal2[i]!)
    })
  })
})

describe('pane plots', () => {
  const chart = series(
    Array.from({ length: 60 }, (_, i) => Math.sin(i / 2)),
    100,
  )
  const values = calculateTmoScalper(chart, settings(), feedsFor(chart))

  it('offers the six lines, the three signal pairs, and the three reference lines of the original', () => {
    const plots = tmoScalperPlots(values, defaults)
    const titles = plots.map((p) => p.title)
    expect(titles).toEqual([
      'TMO 1 Main',
      'TMO 1 Signal',
      'TMO 2 Main',
      'TMO 2 Signal',
      'TMO 3 Main',
      'TMO 3 Signal',
      'TMO 1 Bullish Signal',
      'TMO 1 Bearish Signal',
      'TMO 2 Bullish Signal',
      'TMO 2 Bearish Signal',
      'TMO 2 Extreme Bullish',
      'TMO 2 Extreme Bearish',
      'OB Cutoff Line',
      'OS Cutoff Line',
      'Zero Line',
    ])
    // All series align with the chart and live in the oscillator pane.
    plots.forEach((plot) => {
      expect(plot.values).toHaveLength(chart.length)
      expect(plot.pane).toBe('oscillator')
    })
    // The reference lines match the published hlines and stay out of the legend.
    const ob = plots.find((p) => p.title === 'OB Cutoff Line')!
    expect(ob.horizontalLine).toBe(TMO_CUTOFF)
    expect(ob.hideLegend).toBe(true)
    const os = plots.find((p) => p.title === 'OS Cutoff Line')!
    expect(os.horizontalLine).toBe(-TMO_CUTOFF)
    expect(plots.find((p) => p.title === 'Zero Line')!.horizontalLine).toBe(0)
    // Signal dots are circles of the published sizes, dotted at the extreme size too.
    const bull1 = plots.find((p) => p.title === 'TMO 1 Bullish Signal')!
    expect(bull1.style).toBe('circles')
    expect(bull1.lineWidth).toBe(defaults.signalSize)
    expect(plots.find((p) => p.title === 'TMO 2 Bullish Signal')!.lineWidth).toBe(
      defaults.signalSize + 2,
    )
  })

  it('colors the wheel pairs by direction, the original color1/2/3 rule, per bar', () => {
    const plots = tmoScalperPlots(values, defaults)
    const main3 = plots.find((p) => p.title === 'TMO 3 Main')!
    expect(main3.colors).toBeDefined()
    main3.colors!.forEach((color, i) => {
      const expected =
        values.main3[i] !== null &&
        values.signal3[i] !== null &&
        values.main3[i]! > values.signal3[i]!
          ? TMO_COLORS.tmo2Bull
          : TMO_COLORS.tmo2Bear
      expect(color).toBe(expected)
    })
  })

  it('blanks hidden series instead of dropping them, so the legend contract holds', () => {
    const hidden = tmoScalperPlots(
      values,
      settings({ showLines: false, showTmo1Signals: false, showTmo2ExtremeSignals: false }),
    )
    expect(hidden.find((p) => p.title === 'TMO 1 Main')!.values.every((v) => v === null)).toBe(true)
    expect(
      hidden.find((p) => p.title === 'TMO 1 Bullish Signal')!.values.every((v) => v === null),
    ).toBe(true)
    expect(
      hidden.find((p) => p.title === 'TMO 2 Extreme Bearish')!.values.every((v) => v === null),
    ).toBe(true)
    // TMO 2 signals were not disabled.
    expect(hidden.find((p) => p.title === 'TMO 2 Bullish Signal')!.values).toEqual(values.bull2)
  })

  it('renders through the built-in dispatcher with its context feeds', () => {
    const plots = builtInPlots(chart, indicator, feedsFor(chart) as IndicatorContext)
    expect(plots.map((p) => p.title)).toContain('TMO 2 Extreme Bullish')
    expect(plots).toHaveLength(15)
  })
})

describe('the floating window', () => {
  const times = (count: number, step = 60) => Array.from({ length: count }, (_, i) => i * step)
  const swing = Array.from({ length: 20 }, (_, i) => Math.sin(i / 2.4) * 4)
  const emptySignals = swing.map(() => null)
  const windowValues = {
    main1: swing.map((v) => v * 0.5),
    signal1: swing.map((v) => v * 0.4),
    main2: swing,
    signal2: swing.map((v) => v * 0.9),
    main3: swing.map((v) => v * 0.6),
    signal3: swing.map((v) => v * 0.55),
    bull1: emptySignals,
    bear1: emptySignals,
    bull2: emptySignals,
    bear2: emptySignals,
    bullExtreme: emptySignals,
    bearExtreme: emptySignals,
  }
  const modelInput = { times: times(20), timeframe: '1m' as Timeframe, bars: 20, index: 19 }

  it('draws the three wheels, their signal shadows, and the ▲/▼ marker pairs', () => {
    const model = tmoScalperHudModel(windowValues, defaults, modelInput)
    expect(model.kind).toBe('tmo-scalper')
    expect(model.ready).toBe(true)
    const styles = model.traces.map((trace) => `${trace.title}:${trace.style}`)
    expect(styles).toContain('TMO 3 Main:line')
    expect(styles).toContain('TMO 2 Signal:line')
    expect(styles).toContain('TMO 2 Bullish:tri-up')
    expect(styles).toContain('TMO 2 Bearish:tri-down')
    expect(styles).toContain('TMO 2 Extreme Bullish:tri-up')
    expect(styles).toContain('TMO 1 Bullish:dots')
    // The readouts are labeled by the wheels' own time frames.
    expect(model.readouts.map((r) => r.label)).toEqual(['1m', '5m', '30m'])
    expect(model.subtitle).toBe('(1, 5, 30, 14, 5, 3)')
  })

  it('shows the extreme and cutoff levels only when the window’s own scale can reach them', () => {
    // This swing spans ±4, so only the zero line is in frame — levels outside the frame hide.
    const small = tmoScalperHudModel(windowValues, defaults, modelInput)
    expect(small.levels.map((level) => level.value)).toEqual([0])
    const wide = tmoScalperHudModel(
      { ...windowValues, main2: swing.map((v) => v * 4) },
      defaults,
      modelInput,
    )
    // Insertion order: cutoffs and extremes from OB down to OS, the zero line last.
    expect(wide.levels.map((level) => level.value)).toEqual([15, 9, -9, -15, 0])
  })

  it('calls an extreme TMO 2 cross first, then the plain gated cross, then the zone, then the wheel', () => {
    const withExtreme = {
      ...windowValues,
      bullExtreme: emptySignals.map((v, i) => (i === 19 ? -3.5 : v)),
      bull2: emptySignals.map((v, i) => (i === 19 ? -3.5 : v)),
    }
    expect(tmoScalperVerdict(withExtreme, defaults, 19).text).toBe('▲ TMO 2 EXTREME BUY')
    const withSignal = {
      ...windowValues,
      bear2: emptySignals.map((v, i) => (i === 19 ? 4.5 : v)),
    }
    expect(tmoScalperVerdict(withSignal, defaults, 19).text).toBe('▼ TMO 2 SELL SIGNAL')
    const inZone = { ...windowValues, main2: swing.map(() => 9.6) }
    expect(tmoScalperVerdict(inZone, defaults, 19).text).toBe('🔥 EXTREME OVERBOUGHT')
    const calm = {
      ...windowValues,
      main3: swing.map(() => 2),
      signal3: swing.map(() => 1),
    }
    expect(tmoScalperVerdict(calm, defaults, 19).text).toBe('▲ TMO 3 GREEN')
    expect(tmoScalperVerdict(windowValues, defaults, 0).tone).not.toBe('flat')
  })

  it('says why it is empty, and whose settings it runs on', () => {
    const nothing = {
      ...windowValues,
      main1: emptySignals,
      main2: emptySignals,
      main3: emptySignals,
      signal1: emptySignals,
      signal2: emptySignals,
      signal3: emptySignals,
    }
    const model = tmoScalperHudModel(nothing, defaults, {
      ...modelInput,
      note: 'Loading 5m source candles…',
      settingsSource: 'chart',
    })
    expect(model.ready).toBe(false)
    expect(model.note).toBe('Loading 5m source candles…')
    expect(model.settingsSource).toBe('chart')
    expect(model.verdict.text).toBe('WARMING UP')
  })

  it('asks for the window’s feeds even when no TMO pane is on the chart', () => {
    // No TMO indicator at all: the defaults still want the 1m, 5m and 15m streams,
    // minus whichever one the chart already is.
    expect(oscHudRequestedTimeframes([], '1m', { 'tmo-scalper': true }).sort()).toEqual([
      '15m',
      '5m',
    ])
    expect(oscHudRequestedTimeframes([], '15m', { 'tmo-scalper': true }).sort()).toEqual([
      '1m',
      '5m',
    ])
    // Closed window, nothing to ask.
    expect(oscHudRequestedTimeframes([], '15m', { 'tmo-scalper': false })).toEqual([])
    // Only a hidden pane needs asking for here; a visible one already requests its feeds.
    expect(
      oscHudRequestedTimeframes([{ ...indicator, visible: false }], '1m', { 'tmo-scalper': true }),
    ).toEqual(['5m', '15m'])
    expect(
      oscHudRequestedTimeframes([{ ...indicator, visible: true }], '1m', { 'tmo-scalper': true }),
    ).toEqual([])
  })
})
