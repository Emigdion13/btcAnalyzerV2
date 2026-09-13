import { describe, expect, it } from 'vitest'
import {
  clampPeekBars,
  peekDefaultVisible,
  PEEK_ROOMY_VIEWPORT,
  formatPeekCountdown,
  isTimeframePeekSettings,
  layoutPeekBars,
  PEEK_BARS_MAX,
  PEEK_BARS_MIN,
  PEEK_LAYOUT,
  PEEK_AUTO,
  peekBarTime,
  peekIsForming,
  peekRatio,
  peekRatioLabel,
  peekResolution,
  peekResolutionLabel,
  peekStats,
  peekSynchronizedHorizon,
  peekTimeRemaining,
  peekWindow,
  TIMEFRAME_PEEK_DEFAULTS,
  timeframePeekSettings,
} from './timeframe-peek'
import type { Candle } from './types'

const candle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle => ({ time, open, high, low, close, volume })

/** Twelve 15m bars, one unit apart in price, closing flat. */
const series = (count: number, step = 900, start = 1_700_000_100): Candle[] =>
  Array.from({ length: count }, (_, i) => {
    const time = start + i * step
    const open = 100 + i
    return candle(time, open, open + 1, open - 1, open + 0.5, 100 + i)
  })

describe('timeframe peek settings', () => {
  it('accepts its own defaults', () => {
    expect(isTimeframePeekSettings(TIMEFRAME_PEEK_DEFAULTS)).toBe(true)
    expect(TIMEFRAME_PEEK_DEFAULTS.resolution).toBe(PEEK_AUTO)
  })

  it('rejects malformed settings', () => {
    expect(isTimeframePeekSettings(null)).toBe(false)
    expect(isTimeframePeekSettings({ ...TIMEFRAME_PEEK_DEFAULTS, resolution: '2m' })).toBe(false)
    expect(isTimeframePeekSettings({ ...TIMEFRAME_PEEK_DEFAULTS, bars: 3 })).toBe(false)
    expect(isTimeframePeekSettings({ ...TIMEFRAME_PEEK_DEFAULTS, bars: 2.5 })).toBe(false)
    expect(isTimeframePeekSettings({ ...TIMEFRAME_PEEK_DEFAULTS, showVolume: 'yes' })).toBe(false)
  })

  it('repairs stored preferences instead of trusting them', () => {
    expect(timeframePeekSettings({ resolution: 'nope', bars: 9_000, showVolume: 1 })).toEqual({
      resolution: PEEK_AUTO,
      bars: PEEK_BARS_MAX,
      showVolume: true,
    })
    expect(timeframePeekSettings({ bars: 1 })).toEqual({
      resolution: PEEK_AUTO,
      bars: PEEK_BARS_MIN,
      showVolume: true,
    })
    expect(timeframePeekSettings(undefined)).toEqual(TIMEFRAME_PEEK_DEFAULTS)
    expect(timeframePeekSettings({ resolution: '15m', bars: 7, showVolume: false })).toEqual({
      resolution: '15m',
      bars: 7,
      showVolume: false,
    })
    expect(isTimeframePeekSettings(timeframePeekSettings({ bars: 'junk' }))).toBe(true)
  })

  it('clamps a bar count from any input', () => {
    expect(clampPeekBars(7.4)).toBe(7)
    expect(clampPeekBars(-20)).toBe(PEEK_BARS_MIN)
    expect(clampPeekBars(Infinity)).toBe(PEEK_BARS_MAX)
    expect(clampPeekBars(undefined)).toBe(TIMEFRAME_PEEK_DEFAULTS.bars)
  })
})

describe('viewport default', () => {
  it('opens only where a second window has room, like the side panels', () => {
    expect(peekDefaultVisible(PEEK_ROOMY_VIEWPORT)).toBe(true)
    expect(peekDefaultVisible(1440)).toBe(true)
    expect(peekDefaultVisible(PEEK_ROOMY_VIEWPORT - 1)).toBe(false)
    expect(peekDefaultVisible(390)).toBe(false)
  })
})

describe('peekResolution', () => {
  it('lands near fifteen chart bars per peek bar', () => {
    const auto = { resolution: PEEK_AUTO }
    expect(peekResolution(auto, '1m')).toBe('15m')
    expect(peekResolution(auto, '3m')).toBe('1h')
    expect(peekResolution(auto, '5m')).toBe('1h')
    expect(peekResolution(auto, '15m')).toBe('4h')
    expect(peekResolution(auto, '1h')).toBe('1D')
    // A daily bar is 6 chart bars and a weekly 42: six is nearer 15 in log terms.
    expect(peekResolution(auto, '4h')).toBe('1D')
    expect(peekResolution(auto, '1D')).toBe('1W')
  })

  it('steps down when the chart is already the largest resolution', () => {
    expect(peekResolution({ resolution: PEEK_AUTO }, '1W')).toBe('1D')
  })

  it('honours a pinned resolution, including one below the chart', () => {
    expect(peekResolution({ resolution: '1m' }, '1D')).toBe('1m')
    expect(peekResolution({ resolution: '1h' }, '15m')).toBe('1h')
    expect(peekResolution({ resolution: '15m' }, '15m')).toBe('15m')
  })
})

describe('peek ratio labels', () => {
  it('states the relationship in the unit the trader is reading', () => {
    expect(peekRatio('15m', '1m')).toBe(15)
    expect(peekRatioLabel('15m', '1m')).toBe('1 bar = 15 chart bars')
    expect(peekRatioLabel('5m', '15m')).toBe('3 bars = 1 chart bar')
    expect(peekRatioLabel('15m', '15m')).toBe('same resolution as this chart')
    expect(peekRatio('1h', '15m')).toBe(4)
  })

  it('names the resolution auto resolves to', () => {
    expect(peekResolutionLabel(PEEK_AUTO, '1m')).toBe('Auto · 15m')
    expect(peekResolutionLabel('15m', '15m')).toBe('15m · this chart')
    expect(peekResolutionLabel('4h', '15m')).toBe('4h')
  })
})

describe('peek-synchronized AI horizon', () => {
  it('turns the active peek close into whole chart bars', () => {
    const anchor = Date.UTC(2026, 8, 8, 9, 7) / 1000
    const sync = peekSynchronizedHorizon({
      chartTimeframe: '1m',
      peekTimeframe: '15m',
      anchorTime: anchor,
    })!

    expect(sync.horizonBars).toBe(8)
    expect(sync.peekCloseTime).toBe(Date.UTC(2026, 8, 8, 9, 15) / 1000)
    expect(sync.targetTime).toBe(sync.peekCloseTime)
    expect(sync.secondsToPeekClose).toBe(8 * 60)
    expect(sync.spilloverSeconds).toBe(0)
  })

  it('moves to the next peek bar when the anchor opens on the boundary', () => {
    const anchor = Date.UTC(2026, 8, 8, 9, 15) / 1000
    const sync = peekSynchronizedHorizon({
      chartTimeframe: '5m',
      peekTimeframe: '1h',
      anchorTime: anchor,
    })!

    expect(sync.horizonBars).toBe(9)
    expect(sync.peekCloseTime).toBe(Date.UTC(2026, 8, 8, 10, 0) / 1000)
    expect(sync.targetTime).toBe(sync.peekCloseTime)
  })

  it('keeps same-resolution peeks on the next chart close and rejects lower peeks', () => {
    const anchor = Date.UTC(2026, 8, 8, 9, 15) / 1000
    expect(
      peekSynchronizedHorizon({
        chartTimeframe: '15m',
        peekTimeframe: '15m',
        anchorTime: anchor,
      })?.horizonBars,
    ).toBe(1)
    expect(
      peekSynchronizedHorizon({
        chartTimeframe: '15m',
        peekTimeframe: '5m',
        anchorTime: anchor,
      }),
    ).toBeNull()
  })

  it('reports spillover when the chart and peek grids do not share closes', () => {
    const anchor = Date.UTC(2026, 8, 8, 9, 3) / 1000
    const sync = peekSynchronizedHorizon({
      chartTimeframe: '3m',
      peekTimeframe: '5m',
      anchorTime: anchor,
    })!

    expect(sync.peekCloseTime).toBe(Date.UTC(2026, 8, 8, 9, 5) / 1000)
    expect(sync.horizonBars).toBe(1)
    expect(sync.targetTime).toBe(Date.UTC(2026, 8, 8, 9, 6) / 1000)
    expect(sync.spilloverSeconds).toBe(60)
  })
})

describe('peekWindow', () => {
  it('keeps the most recent bars, oldest first, forming bar included', () => {
    const candles = series(20)
    const window = peekWindow(candles, 5)
    expect(window.map((c) => c.time)).toEqual(candles.slice(-5).map((c) => c.time))
    expect(candles).toHaveLength(20)
  })

  it('returns a short feed whole and an empty feed untouched', () => {
    const candles = series(3)
    expect(peekWindow(candles, 12)).toEqual(candles)
    expect(peekWindow([], 12)).toEqual([])
    // A corrupt stored count still cannot ask for more than the clamp allows.
    expect(peekWindow(series(60), 9_999)).toHaveLength(PEEK_BARS_MAX)
  })
})

describe('forming-bar detection', () => {
  it('is the open bucket, not "the last array entry"', () => {
    const opening = 1_700_000_100 // 15m buckets land on :00/:15/:30/:45
    const bucket = Math.floor(opening / 900) * 900
    const current = candle(bucket, 100, 101, 99, 100.5)
    const previous = candle(bucket - 900, 99, 100, 98, 99.5)
    expect(peekIsForming(current, '15m', bucket + 1)).toBe(true)
    expect(peekIsForming(current, '15m', bucket + 899)).toBe(true)
    // Exactly at the roll the bar is history; the next bucket has no bar yet.
    expect(peekIsForming(current, '15m', bucket + 900)).toBe(false)
    expect(peekIsForming(previous, '15m', bucket + 1)).toBe(false)
    expect(peekIsForming(undefined, '15m', bucket + 1)).toBe(false)
  })

  it('respects the weekly Monday bucket the chart uses', () => {
    // Weekly bars open Monday 00:00 UTC, not on a 604800-second modulo of the epoch.
    const monday = Date.UTC(2026, 8, 7) / 1000
    const bar = candle(monday, 1, 2, 0.5, 1.5)
    expect(peekIsForming(bar, '1W', monday + 3600)).toBe(true)
    expect(peekIsForming(bar, '1W', monday - 1)).toBe(false)
  })

  it('counts the remaining seconds down to zero', () => {
    const bucket = 1_700_000_000 - (1_700_000_000 % 300)
    const bar = candle(bucket, 100, 101, 99, 100)
    expect(peekTimeRemaining(bar, '5m', bucket)).toBe(300)
    expect(peekTimeRemaining(bar, '5m', bucket + 180)).toBe(120)
    expect(peekTimeRemaining(bar, '5m', bucket + 900)).toBe(0)
    expect(peekTimeRemaining(undefined, '5m', bucket)).toBe(0)
  })

  it('formats a countdown the trader can read at a glance', () => {
    expect(formatPeekCountdown(65)).toBe('01:05')
    expect(formatPeekCountdown(0)).toBe('00:00')
    expect(formatPeekCountdown(3659)).toBe('1:00:59')
    expect(formatPeekCountdown(93600)).toBe('1d 2h')
    expect(formatPeekCountdown(-5)).toBe('00:00')
  })
})

describe('peekStats', () => {
  it('reports the live bar against the previous close', () => {
    const candles = [candle(0, 100, 105, 95, 102), candle(900, 102, 110, 100, 108)]
    const stats = peekStats(candles)!
    expect(stats.change).toBeCloseTo((108 / 102 - 1) * 100, 10)
    expect(stats.windowHigh).toBe(110)
    expect(stats.windowLow).toBe(95)
    expect(stats.volume).toBe(200)
    expect(stats.bars).toBe(2)
    // 108 sits 8/13 of the way up the window's 95-110 range.
    expect(stats.position).toBeCloseTo((108 - 95) / (110 - 95), 10)
  })

  it('uses the open of a lone bar and survives a flat window', () => {
    const single = peekStats([candle(0, 100, 100, 100, 101, 0)])!
    expect(single.change).toBeCloseTo(1, 10)
    expect(single.position).toBe(0.5)
    expect(single.volume).toBe(0)
    expect(peekStats([])).toBeNull()
  })

  it('declines to invent a percentage it cannot compute', () => {
    expect(peekStats([candle(0, 0, 1, 0, 1)])!.change).toBeNull()
  })

  it('ignores non-finite volume rather than poisoning the total', () => {
    const candles = [candle(0, 1, 2, 0.5, 1.5, NaN), candle(900, 1, 2, 0.5, 1.5, 40)]
    expect(peekStats(candles)!.volume).toBe(40)
  })
})

describe('layoutPeekBars', () => {
  it('returns an empty plot for an empty window', () => {
    const layout = layoutPeekBars([])
    expect(layout.bars).toEqual([])
    expect(layout.levels).toEqual([])
    expect(layout.high).toBe(0)
    expect(Number.isFinite(layout.lastCloseY)).toBe(true)
  })

  it('places bars left to right in one slot each, inside the canvas', () => {
    const layout = layoutPeekBars(series(12))
    const xs = layout.bars.map((bar) => bar.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(xs[0]).toBeGreaterThan(0)
    expect(layout.bars.at(-1)!.x).toBeLessThan(layout.width)
    for (const bar of layout.bars) {
      expect(bar.bodyTop).toBeGreaterThanOrEqual(layout.priceTop)
      expect(bar.bodyTop + bar.bodyHeight).toBeLessThanOrEqual(layout.priceBottom + 0.001)
      expect(bar.wickTop).toBeLessThanOrEqual(bar.bodyTop)
      expect(bar.wickBottom).toBeGreaterThanOrEqual(bar.bodyTop)
      expect(bar.width).toBeGreaterThanOrEqual(1)
    }
  })

  it('scales to the window rather than to the chart', () => {
    const candles = [candle(0, 10, 20, 5, 15), candle(900, 15, 16, 1, 2)]
    const layout = layoutPeekBars(candles)
    expect(layout.high).toBe(20)
    expect(layout.low).toBe(1)
    // Ordered by price, not by index: the taller candle is the older one here.
    expect(layout.bars[0].wickTop).toBeLessThan(layout.bars[1].wickTop)
    expect(layout.bars[1].wickBottom).toBeGreaterThan(layout.bars[0].wickBottom)
    // Padded extremes keep a hair of air above the top and below the bottom.
    expect(layout.bars[0].wickTop).toBeGreaterThan(PEEK_LAYOUT.padTop)
    expect(layout.bars[1].wickBottom).toBeLessThan(layout.priceBottom)
    // Extremes outside the window would be off-canvas; clamping keeps every bar inside.
    const stray = layoutPeekBars([...candles, candle(1800, 15, 10_000, -10_000, 15)])
    for (const bar of stray.bars) {
      expect(bar.wickTop).toBeGreaterThanOrEqual(PEEK_LAYOUT.padTop - 0.001)
      expect(bar.wickBottom).toBeLessThanOrEqual(stray.priceBottom + 0.001)
    }
  })

  it('keeps a doji visible and a zero-volume bar flat', () => {
    const doji = layoutPeekBars([candle(0, 50, 60, 40, 50)])
    expect(doji.bars[0].bodyHeight).toBe(1)
    const quiet = layoutPeekBars([candle(0, 50, 60, 40, 55, 0)], { showVolume: true })
    expect(quiet.bars[0].volumeHeight).toBe(0)
    expect(quiet.bars[0].volumeTop).toBe(quiet.volumeTop + PEEK_LAYOUT.volumeHeight)
  })

  it('marks only the newest bar as forming', () => {
    const layout = layoutPeekBars(series(4), { forming: true })
    expect(layout.bars.map((bar) => bar.forming)).toEqual([false, false, false, true])
    expect(layoutPeekBars(series(4)).bars.every((bar) => !bar.forming)).toBe(true)
  })

  it('grows the canvas when volume is shown and scales it to the loudest bar', () => {
    const plain = layoutPeekBars(series(6))
    const withVolume = layoutPeekBars(series(6), { showVolume: true })
    expect(withVolume.height).toBe(plain.height + PEEK_LAYOUT.gap + PEEK_LAYOUT.volumeHeight)
    const loudest = withVolume.bars.at(-1)!
    expect(loudest.volumeHeight).toBeCloseTo(PEEK_LAYOUT.volumeHeight, 6)
    expect(withVolume.volumeMax).toBe(105)
    for (const bar of withVolume.bars) {
      expect(bar.volumeTop + bar.volumeHeight).toBeLessThanOrEqual(withVolume.height)
      expect(bar.volumeTop).toBeGreaterThanOrEqual(withVolume.volumeTop)
    }
  })

  it('pairs each gridline with the price it stands for, highest first', () => {
    const layout = layoutPeekBars(series(6))
    expect(layout.levels.map((level) => level.y)).toEqual([
      PEEK_LAYOUT.padTop + PEEK_LAYOUT.priceHeight * 0.25,
      PEEK_LAYOUT.padTop + PEEK_LAYOUT.priceHeight * 0.5,
      PEEK_LAYOUT.padTop + PEEK_LAYOUT.priceHeight * 0.75,
    ])
    const prices = layout.levels.map((level) => level.price)
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
    expect(prices[0]).toBeLessThan(layout.high)
    expect(prices[2]).toBeGreaterThan(layout.low)
  })

  it('puts the axis marker on the last close, whatever the window looks like', () => {
    const candles = series(8)
    const layout = layoutPeekBars(candles)
    const last = layout.bars.at(-1)!
    expect(layout.lastClose).toBe(candles.at(-1)!.close)
    // These bars close above their open, so the marker sits on the body's top edge.
    expect(layout.lastCloseY).toBeCloseTo(last.bodyTop, 6)
    expect(layout.lastCloseY).toBeGreaterThan(last.wickTop)
    expect(layout.lastCloseY).toBeLessThan(last.wickBottom)
  })

  it('gives a flat window a usable span instead of dividing by zero', () => {
    const flat = Array.from({ length: 4 }, (_, i) => candle(i * 900, 100, 100, 100, 100))
    const layout = layoutPeekBars(flat)
    expect(layout.bars.every((bar) => Number.isFinite(bar.bodyTop) && bar.bodyTop >= 0))
    expect(layout.lastCloseY).toBeCloseTo(layout.priceTop, 6)
    expect(layout.bars[0].bodyHeight).toBe(1)
  })
})

describe('peekBarTime', () => {
  it('reads intraday bars as a UTC clock and daily bars as a date', () => {
    const time = Date.UTC(2026, 8, 8, 14, 15) / 1000
    expect(peekBarTime(time, '15m')).toBe('14:15')
    expect(peekBarTime(time, '1m')).toBe('14:15')
    expect(peekBarTime(time, '1D')).toBe('8/9')
    expect(peekBarTime(time, '1W')).toBe('8/9')
  })
})
