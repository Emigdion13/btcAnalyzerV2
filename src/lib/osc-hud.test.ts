import { describe, expect, it } from 'vitest'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import {
  clampOscHudBars,
  cmMacdHudModel,
  cmMacdVerdict,
  OSC_HUD_DEFAULT_VISIBLE,
  OSC_HUD_MAX_BARS,
  OSC_HUD_MIN_BARS,
  OSC_HUD_WINDOW_MINUTES,
  oscHudBars,
  oscHudDomain,
  oscHudGeometry,
  oscHudLevels,
  oscHudRequestedTimeframes,
  oscHudScaleLabel,
  oscHudSpan,
  oscHudVisible,
  rsiDivergenceHudModel,
  rsiDivergenceVerdict,
  waveTrendHudModel,
  waveTrendVerdict,
  OSC_HUD_WIDGETS,
} from './osc-hud'
import { RSI_DIVERGENCE_DEFAULTS } from './rsi-divergence'
import { CM_COLORS } from './cm-ult-macd'
import type { CmMacdValues } from './cm-ult-macd'
import { CM_MACD_DEFAULTS } from './cm-ult-macd'
import { WAVE_TREND_DEFAULTS } from './wave-trend'
import type { WaveTrendValues } from './wave-trend'
import type { Candle, Indicator, Timeframe } from './types'

const times = (count: number, timeframe: Timeframe = '1m', start = 0): number[] =>
  Array.from({ length: count }, (_, index) => start + index * INTERVAL_SECONDS[timeframe])

const modelInput = (overrides: Partial<Parameters<typeof cmMacdHudModel>[2]> = {}) => ({
  times: times(100),
  timeframe: '1m' as Timeframe,
  bars: 20,
  index: 99,
  ...overrides,
})

/** Values that walk from -1 to +1 so every series has a distinguishable, non-zero shape. */
function ramp(length: number): (number | null)[] {
  return Array.from({ length }, (_, index) => (index / (length - 1)) * 2 - 1)
}

const cmValues = (overrides: Partial<CmMacdValues> = {}): CmMacdValues => ({
  macd: ramp(100),
  signal: ramp(100).map((value) => (value === null ? null : value * 0.5)),
  histogram: ramp(100).map((value) => (value === null ? null : value * 0.5)),
  ...overrides,
})

const waveValues = (overrides: Partial<WaveTrendValues> = {}): WaveTrendValues => ({
  wt1: ramp(100).map((value) => (value === null ? null : value * 40)),
  wt2: ramp(100).map((value) => (value === null ? null : value * 20)),
  diff: ramp(100).map((value) => (value === null ? null : value * 20)),
  ...overrides,
})

describe('oscHudVisible — the toolbar button owns the window', () => {
  it('opens by default, so the pair is there the moment you ask for it', () => {
    expect(oscHudVisible(null)).toBe(OSC_HUD_DEFAULT_VISIBLE)
    expect(OSC_HUD_DEFAULT_VISIBLE).toBe(true)
  })

  it('lets an explicit choice win in both directions', () => {
    expect(oscHudVisible(true)).toBe(true)
    expect(oscHudVisible(false)).toBe(false)
  })
})

describe('oscHudBars — twenty minutes, expressed in the chart’s own bars', () => {
  it('is exactly twenty bars of a 1m chart', () => {
    expect(oscHudBars('1m')).toBe(OSC_HUD_WINDOW_MINUTES)
  })

  it('never goes below a readable window when the bars are longer than twenty minutes', () => {
    // Twenty minutes of 3m bars is 6.67 of them, and of 1h bars it is a third of one — a window
    // that small is a dot, not an oscillator, so the floor of bars takes over above 1m.
    expect(oscHudBars('3m')).toBe(OSC_HUD_MIN_BARS)
    expect(oscHudBars('5m')).toBe(OSC_HUD_MIN_BARS)
    expect(oscHudBars('1h')).toBe(OSC_HUD_MIN_BARS)
    // Only a chart at or below a bar per minute gets the literal twenty minutes.
    expect(oscHudBars('1m')).toBe(20)
  })

  it('honours a stored zoom, then clamps it to the usable range', () => {
    expect(oscHudBars('1m', 12)).toBe(12)
    expect(oscHudBars('1m', 1)).toBe(OSC_HUD_MIN_BARS)
    expect(oscHudBars('1m', 9999)).toBe(OSC_HUD_MAX_BARS)
    expect(oscHudBars('1m', 'garbage')).toBe(OSC_HUD_WINDOW_MINUTES)
  })

  it('snaps out-of-range counts to the bound and repairs garbage the same way', () => {
    expect(clampOscHudBars(-40, '1m')).toBe(OSC_HUD_MIN_BARS)
    expect(clampOscHudBars(undefined, '5m')).toBe(OSC_HUD_MIN_BARS)
  })

  it('names the span the window really covers', () => {
    expect(oscHudSpan(20, '1m')).toBe('20 min')
    expect(oscHudSpan(8, '15m')).toBe('2h')
    expect(oscHudSpan(48, '1h')).toBe('2d')
    expect(oscHudSpan(48, '1W')).toBe('48w')
  })
})

describe('oscHudDomain — the window picks its own magnification', () => {
  it('is symmetric about zero, so a bar’s sign still reads', () => {
    const domain = oscHudDomain([
      [4, 8, -2],
      [1, 2, 3],
    ])
    expect(domain.max).toBeGreaterThan(8)
    expect(domain.min).toBeCloseTo(-domain.max, 10)
  })

  it('zooms in on a small window instead of keeping a fixed scale', () => {
    expect(oscHudDomain([[0.4, -0.6]]).max).toBeLessThan(1)
    expect(oscHudDomain([[40, -60]]).max).toBeGreaterThan(60)
  })

  it('ignores gaps and survives a flat or empty window', () => {
    const flat = oscHudDomain([
      [null, null],
      [0, 0],
    ])
    expect(flat.min).toBeCloseTo(-1.14, 10)
    expect(flat.max).toBeCloseTo(1.14, 10)
    // A flat window at a non-zero level still gets a span, and stays centred on zero.
    const level = oscHudDomain([[2, 2, 2]])
    expect(level.max).toBeCloseTo(2.28, 10)
    expect(level.min).toBeCloseTo(-level.max, 10)
    expect(oscHudDomain([]).max).toBeGreaterThan(0)
  })
})

describe('oscHudGeometry — bar slots and an inverted price axis', () => {
  it('centres each bar in its slot and keeps them inside the box', () => {
    const geometry = oscHudGeometry(20, { min: -1, max: 1 }, 226, 104)
    expect(geometry.slot).toBeCloseTo(226 / 20, 6)
    expect(geometry.x[0]).toBeCloseTo(geometry.slot / 2, 6)
    expect(geometry.x[19]).toBeLessThan(226)
    expect(geometry.x[1]).toBeGreaterThan(geometry.x[0]!)
  })

  it('maps the domain top to the top of the plot and keeps stray spikes inside', () => {
    const geometry = oscHudGeometry(4, { min: -10, max: 10 }, 100, 50)
    expect(geometry.y(10)).toBeCloseTo(8, 6)
    expect(geometry.y(-10)).toBeCloseTo(42, 6)
    expect(geometry.y(0)).toBeCloseTo(25, 6)
    expect(geometry.zeroY).toBe(geometry.y(0))
    expect(geometry.y(1000)).toBe(8)
    expect(geometry.y(-1000)).toBe(42)
  })

  it('handles the empty window without dividing by zero', () => {
    const geometry = oscHudGeometry(0, { min: 0, max: 0 })
    expect(geometry.x).toEqual([])
    expect(Number.isFinite(geometry.y(0))).toBe(true)
  })
})

describe('oscHudScaleLabel — axis numbers stay readable at any magnitude', () => {
  it('drops the decimals a glance cannot use', () => {
    expect(oscHudScaleLabel(1234.5)).toBe('1,235')
    expect(oscHudScaleLabel(9.0469)).toBe('9.0')
    expect(oscHudScaleLabel(0.4812)).toBe('0.481')
    expect(oscHudScaleLabel(0.00012)).toBe('0.00012')
  })

  it('keeps the sign, so a symmetric scale reads as one', () => {
    expect(oscHudScaleLabel(-9.0469)).toBe('-9.0')
  })
})

describe('oscHudLevels — context lines walk into the picture', () => {
  it('shows a level only while the window’s own scale can draw it', () => {
    const levels = [
      { value: 0, color: '#fff', label: '0', dashed: false },
      { value: 60, color: '#f00', label: '60', dashed: false },
      { value: -60, color: '#0f0', label: '-60', dashed: false },
    ]
    expect(oscHudLevels(levels, { min: -10, max: 10 }).map((l) => l.value)).toEqual([0])
    expect(oscHudLevels(levels, { min: -70, max: 70 }).map((l) => l.value)).toEqual([0, 60, -60])
  })
})

describe('cmMacdHudModel — the CM window shows the pane’s own numbers', () => {
  it('takes the last twenty bars and keeps them aligned with the times', () => {
    const model = cmMacdHudModel(cmValues(), CM_MACD_DEFAULTS, modelInput())
    expect(model.bars).toBe(20)
    expect(model.times[0]).toBe(times(100)[80])
    expect(model.traces[0]!.values[0]).toBeCloseTo(ramp(100)[80]!, 10)
    expect(model.spanLabel).toBe('20 min')
    expect(model.ready).toBe(true)
  })

  it('paints the histogram with the original four colours, knowing its predecessor', () => {
    // Rising and positive is aqua; rising but negative is maroon; falling above zero is blue.
    const values = cmValues({ histogram: [1, 2, 1, -2, -1, null] })
    const model = cmMacdHudModel(
      values,
      CM_MACD_DEFAULTS,
      modelInput({ times: times(6), bars: 6, index: 5 }),
    )
    expect(model.histogram!.colors.slice(0, 5)).toEqual([
      CM_COLORS.yellow,
      CM_COLORS.aqua,
      CM_COLORS.blue,
      CM_COLORS.red,
      CM_COLORS.maroon,
    ])
  })

  it('keeps the zero line and drops the lines the indicator itself switched off', () => {
    const model = cmMacdHudModel(
      cmValues(),
      { ...CM_MACD_DEFAULTS, showLines: false, showDots: false },
      modelInput(),
    )
    expect(model.levels.map((level) => level.value)).toEqual([0])
    expect(model.traces).toEqual([])
    expect(model.histogram).toBeDefined()
  })

  it('reads the hovered bar, not the latest one', () => {
    const values = cmValues({ macd: Array.from({ length: 100 }, (_, i) => i) })
    const hovered = cmMacdHudModel(
      values,
      CM_MACD_DEFAULTS,
      modelInput({ index: 85, hovered: true }),
    )
    expect(hovered.activeIndex).toBe(5)
    expect(hovered.hovered).toBe(true)
    expect(hovered.readouts[0]!.value).toBe('85.00')
    const live = cmMacdHudModel(values, CM_MACD_DEFAULTS, modelInput({ index: 99 }))
    expect(live.activeIndex).toBe(19)
    expect(live.hovered).toBe(false)
  })

  it('scrolled back through history, shows the bars before the end and reads the newest of them', () => {
    const values = cmValues({ macd: Array.from({ length: 100 }, (_, i) => i) })
    const model = cmMacdHudModel(values, CM_MACD_DEFAULTS, modelInput({ end: 60, index: 59 }))
    expect(model.times).toEqual(times(100).slice(40, 60))
    expect(model.activeIndex).toBe(19)
    expect(model.readouts[0]!.value).toBe('59.00')
    // An end too early for a full window still shows a full one, from the oldest bar.
    const early = cmMacdHudModel(values, CM_MACD_DEFAULTS, modelInput({ end: 5, index: 19 }))
    expect(early.times).toEqual(times(100).slice(0, 20))
    // A hovered bar outside the scrolled window has nothing to point at.
    const outside = cmMacdHudModel(
      values,
      CM_MACD_DEFAULTS,
      modelInput({ end: 60, index: 90, hovered: true }),
    )
    expect(outside.activeIndex).toBeNull()
  })

  it('marks the bar where MACD crossed the signal, which is what the dots are for', () => {
    const macd = [-2, -1, 1, 2, -1]
    const values = cmValues({ macd, signal: [0, 0, 0, 0, 0], histogram: macd })
    const model = cmMacdHudModel(
      values,
      CM_MACD_DEFAULTS,
      modelInput({ times: times(5), bars: 5, index: 4 }),
    )
    const dots = model.traces.find((trace) => trace.title === 'Cross')!
    expect(dots.values[2]).toBe(0)
    expect(dots.values[3]).toBeNull()
  })

  it('says why it is empty instead of drawing an empty box', () => {
    const empty = {
      macd: Array(100).fill(null),
      signal: Array(100).fill(null),
      histogram: Array(100).fill(null),
    }
    const model = cmMacdHudModel(empty, CM_MACD_DEFAULTS, modelInput({ note: '1h feed offline' }))
    expect(model.ready).toBe(false)
    expect(model.note).toBe('1h feed offline')
    expect(model.verdict.tone).toBe('flat')
  })

  it('labels the resolution it is computing on, and where the settings came from', () => {
    const chart = cmMacdHudModel(cmValues(), CM_MACD_DEFAULTS, modelInput())
    expect(chart.subtitle).toContain('1m (chart)')
    expect(chart.settingsSource).toBe('defaults')
    const mtf = cmMacdHudModel(
      cmValues(),
      { ...CM_MACD_DEFAULTS, useCurrentRes: false, resCustom: '1h' },
      modelInput({ settingsSource: 'chart' }),
    )
    expect(mtf.subtitle).toContain('1h (MTF)')
    expect(mtf.settingsSource).toBe('chart')
  })
})

describe('cmMacdVerdict — the call the indicator is actually read for', () => {
  it('prefers a fresh cross over the standing relationship', () => {
    expect(cmMacdVerdict(1, 0.5, -1, -0.5, 0.5, -0.5).text).toBe('▲ MACD CROSSed ABOVE SIGNAL')
    expect(cmMacdVerdict(1, 0.5, -1, -0.5, 0.5, -0.5).tone).toBe('bull')
    expect(cmMacdVerdict(-1, -0.5, 1, 0.5, -0.5, 0.5).text).toBe('▼ MACD CROSSed BELOW SIGNAL')
    expect(cmMacdVerdict(-1, -0.5, 1, 0.5, -0.5, 0.5).tone).toBe('bear')
  })

  it('falls back to above/below signal, with the histogram’s direction as the small print', () => {
    const above = cmMacdVerdict(2, 1, 2.5, 1, 1.2, 1)
    expect(above.text).toBe('▲ ABOVE SIGNAL')
    expect(above.detail).toContain('histogram rising')
    expect(above.detail).toContain('above zero')
    expect(cmMacdVerdict(-2, -1, -2.5, -1, -1, -1.2).text).toBe('▼ BELOW SIGNAL')
  })

  it('admits when there is nothing to say yet', () => {
    expect(cmMacdVerdict(null, null, null, null, null, null)).toEqual({
      text: 'WARMING UP',
      tone: 'flat',
      detail: 'not enough history yet',
    })
  })
})

describe('waveTrendHudModel — wt1, wt2, and the area between them', () => {
  it('plots the original three series in the original colours', () => {
    const model = waveTrendHudModel(waveValues(), WAVE_TREND_DEFAULTS, modelInput())
    expect(model.traces.map((trace) => [trace.title, trace.style, trace.dash])).toEqual([
      ['WT1 - WT2', 'area', undefined],
      ['WT1', 'line', undefined],
      // Dashed rather than a scatter of cross markers, because at eight pixels per bar the
      // dashes are the same fact and the dots are noise.
      ['WT2', 'line', '2 2'],
    ])
    expect(model.bars).toBe(20)
    expect(model.readouts.map((readout) => readout.label)).toEqual(['WT1', 'WT2', 'Osc'])
  })

  it('shows the overbought and oversold lines only when the wave is near them', () => {
    const tame = waveTrendHudModel(
      waveValues({ wt1: ramp(100).map(() => 5) }),
      WAVE_TREND_DEFAULTS,
      modelInput(),
    )
    expect(tame.levels.map((level) => level.value)).toEqual([0])
    const wild = waveTrendHudModel(
      waveValues({
        wt1: Array(100).fill(58),
        wt2: Array(100).fill(55),
        diff: Array(100).fill(3),
      }),
      WAVE_TREND_DEFAULTS,
      modelInput(),
    )
    expect(wild.levels.map((level) => level.value)).toContain(60)
    expect(wild.levels.map((level) => level.value)).toContain(53)
  })

  it('carries a window of twenty minutes on a 5m chart as eight bars', () => {
    const model = waveTrendHudModel(waveValues(), WAVE_TREND_DEFAULTS, {
      times: times(100, '5m'),
      timeframe: '5m' as Timeframe,
      bars: oscHudBars('5m'),
      index: 99,
    })
    expect(model.bars).toBe(OSC_HUD_MIN_BARS)
    expect(model.spanLabel).toBe('40 min')
    expect(model.times).toHaveLength(OSC_HUD_MIN_BARS)
  })
})

describe('waveTrendVerdict — crosses, and the band that makes one worth taking', () => {
  it('calls a cross in the oversold band the way the original signals it', () => {
    expect(waveTrendVerdict(-54, -55, -56, -56, WAVE_TREND_DEFAULTS).text).toBe(
      '▲ CROSS UP IN OVERSOLD',
    )
    expect(waveTrendVerdict(56, 57, 57, 55, WAVE_TREND_DEFAULTS).text).toBe(
      '▼ CROSS DOWN IN OVERBOUGHT',
    )
    expect(waveTrendVerdict(10, 9, 8, 10, WAVE_TREND_DEFAULTS).text).toBe('▲ WT1 CROSSED ABOVE WT2')
  })

  it('reports the zone when there is no fresh cross', () => {
    expect(waveTrendVerdict(64, 62, 63, 62, WAVE_TREND_DEFAULTS).tone).toBe('ob')
    expect(waveTrendVerdict(-64, -62, -63, -62, WAVE_TREND_DEFAULTS).tone).toBe('os')
    expect(waveTrendVerdict(4, 2, 3, 2, WAVE_TREND_DEFAULTS).text).toBe('▲ RISING')
    expect(waveTrendVerdict(-4, -2, -3, -2, WAVE_TREND_DEFAULTS).text).toBe('▼ FALLING')
  })

  it('is honest about a cold start', () => {
    expect(waveTrendVerdict(null, 3, 1, 1, WAVE_TREND_DEFAULTS).text).toBe('WARMING UP')
  })
})

describe('oscHudRequestedTimeframes — a window-only MTF MACD still gets its feed', () => {
  const hidden: Indicator = {
    id: 'cm-hidden',
    kind: 'cm-ult-macd',
    name: 'CM_Ult_MacD_MTF',
    period: 12,
    color: CM_COLORS.lime,
    visible: false,
    cmMacd: { ...CM_MACD_DEFAULTS, useCurrentRes: false, resCustom: '1h' },
  }
  const shown: Indicator = { ...hidden, id: 'cm-visible', visible: true }
  const open = { 'cm-ult-macd': true, 'wave-trend': true }

  it('asks for the alternate resolution only when the window needs it', () => {
    expect(oscHudRequestedTimeframes([hidden], '15m', open)).toEqual(['1h'])
    // A visible indicator is already covered by requestedIndicatorTimeframes.
    expect(oscHudRequestedTimeframes([shown], '15m', open)).toEqual([])
    // Same resolution as the chart: no second stream is needed.
    expect(
      oscHudRequestedTimeframes([{ ...hidden, cmMacd: CM_MACD_DEFAULTS }], '1h', open),
    ).toEqual([])
    expect(
      oscHudRequestedTimeframes([hidden], '15m', { 'cm-ult-macd': false, 'wave-trend': true }),
    ).toEqual([])
    expect(oscHudRequestedTimeframes([], '15m', open)).toEqual([])
  })
})

describe('rsiDivergenceVerdict — divergence priority and overbought/oversold bands', () => {
  it('prioritizes active divergence over price bands', () => {
    const bullDiv = {
      kind: 'regular-bullish' as const,
      bullish: true,
      hidden: false,
      fromIndex: 10,
      toIndex: 20,
      fromValue: 25,
      toValue: 28,
      color: '#26a69a',
      label: 'Bull',
    }
    const verdict = rsiDivergenceVerdict(28, 26, bullDiv, null, 20)
    expect(verdict.text).toBe('▲ REGULAR BULL DIVERGENCE')
    expect(verdict.tone).toBe('bull')

    const bearDiv = {
      kind: 'regular-bearish' as const,
      bullish: false,
      hidden: false,
      fromIndex: 10,
      toIndex: 20,
      fromValue: 75,
      toValue: 72,
      color: '#ef5350',
      label: 'Bear',
    }
    const bearVerdict = rsiDivergenceVerdict(72, 74, bearDiv, null, 20)
    expect(bearVerdict.text).toBe('▼ REGULAR BEAR DIVERGENCE')
    expect(bearVerdict.tone).toBe('bear')
  })

  it('reports overbought, oversold, and midline momentum when no divergence is present', () => {
    expect(rsiDivergenceVerdict(75, 73, null, null, 20).tone).toBe('ob')
    expect(rsiDivergenceVerdict(75, 73, null, null, 20).text).toBe('🔥 OVERBOUGHT')

    expect(rsiDivergenceVerdict(25, 27, null, null, 20).tone).toBe('os')
    expect(rsiDivergenceVerdict(25, 27, null, null, 20).text).toBe('⚡ OVERSOLD')

    expect(rsiDivergenceVerdict(55, 53, null, null, 20).tone).toBe('bull')
    expect(rsiDivergenceVerdict(55, 53, null, null, 20).text).toBe('▲ BULLISH MOMENTUM')

    expect(rsiDivergenceVerdict(45, 47, null, null, 20).tone).toBe('bear')
    expect(rsiDivergenceVerdict(45, 47, null, null, 20).text).toBe('▼ BEARISH MOMENTUM')
  })

  it('handles cold starts gracefully', () => {
    expect(rsiDivergenceVerdict(null, null, null, null, 0).text).toBe('WARMING UP')
  })
})

describe('rsiDivergenceHudModel — mini chart geometry and levels', () => {
  it('builds a model with 70, 50, 30 levels and symmetric domain around 50', () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: i * 60,
      open: 100 + Math.sin(i / 2) * 5,
      high: 105 + Math.sin(i / 2) * 5,
      low: 95 + Math.sin(i / 2) * 5,
      close: 100 + Math.sin(i / 2) * 5,
      volume: 1000,
    }))

    const model = rsiDivergenceHudModel(
      candles,
      { period: 14, divergence: { ...RSI_DIVERGENCE_DEFAULTS.divergence } },
      {
        times: candles.map((c) => c.time),
        timeframe: '1m',
        bars: 20,
        index: 39,
      },
    )

    expect(model.kind).toBe('rsi-divergence')
    expect(model.title).toBe('RSI Divergence')
    expect(model.accent).toBe('#ad91e5')
    expect(model.bars).toBe(20)
    expect(model.times).toHaveLength(20)

    // Domain should be centered at 50
    expect((model.domain.min + model.domain.max) / 2).toBeCloseTo(50, 1)

    // Levels should include 70, 50, 30
    const levelValues = model.levels.map((l) => l.value)
    expect(levelValues).toContain(70)
    expect(levelValues).toContain(50)
    expect(levelValues).toContain(30)

    // Traces includes primary RSI line
    expect(model.traces.some((t) => t.title === 'RSI')).toBe(true)
    expect(model.readouts[0].label).toBe('RSI')
    expect(model.readouts[1].label).toBe('Delta')
    expect(model.readouts[2].label).toBe('Div')
  })

  it('exposes widget config matching the osc-hud contract', () => {
    const widget = OSC_HUD_WIDGETS['rsi-divergence']
    expect(widget.kind).toBe('rsi-divergence')
    expect(widget.button).toBe('RSI Div')
    expect(widget.visibilityKey).toBe('osc-hud-visible:rsi-divergence')
    expect(widget.positionKey).toBe('osc-hud-pos:rsi-divergence')
    expect(widget.minimizedKey).toBe('osc-hud-min:rsi-divergence')
  })
})
