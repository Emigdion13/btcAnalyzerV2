import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  calculateWilliamsVixFix,
  CM_WILLIAMS_VIX_FIX_DEFAULTS,
  isWilliamsVixFixSettings,
  williamsVixFixIndicatorLabel,
  williamsVixFixPlots,
  williamsVixFixSettings,
  WVF_COLORS,
} from './cm-williams-vix-fix'
import type { WilliamsVixFixValues } from './cm-williams-vix-fix'
import { OSC_HUD_WIDGETS, williamsVixFixHudModel, williamsVixFixVerdict } from './osc-hud'
import { OscHudCard } from '../components/OscHudCard'
import type { Candle, Indicator } from './types'

const candle = (time: number, close: number, low?: number): Candle => ({
  time,
  open: close,
  high: close,
  low: low ?? close,
  close,
  volume: 100,
})

const flatThenCrash = (): Candle[] => {
  const candles: Candle[] = []
  for (let i = 0; i < 120; i++) {
    // A breathing market, then a real selloff that stays positive: WVF is only bounded by
    // [0, 100] while lows are non-negative, exactly as in Pine.
    const close = i < 90 ? 100 + Math.sin(i / 2) * 3 : 100 - (i - 89) * 2
    candles.push(candle(i * 60, close, close - 0.5))
  }
  return candles
}

/** A mid-tape dip and a grind back up, so the last twenty bars hold lime and gray alike. */
const dipThenCalm = (): Candle[] => {
  const candles: Candle[] = []
  for (let i = 0; i < 80; i++) {
    let close = 100 + Math.sin(i / 2) * 2
    if (i >= 62 && i < 67) close = 100 - (i - 61) * 3
    else if (i >= 67) close = 86 + (i - 67) * 1.2 + Math.sin(i / 2)
    candles.push(candle(i * 60, close, close - 0.5))
  }
  return candles
}

describe('calculateWilliamsVixFix', () => {
  it('matches the published recurrence on a hand-computed tape', () => {
    const candles = [
      candle(0, 10),
      candle(60, 11),
      candle(120, 12),
      candle(180, 11),
      candle(240, 8),
    ]
    const values = calculateWilliamsVixFix(candles, {
      pd: 3,
      bbl: 2,
      mult: 2,
      lb: 3,
      ph: 0.85,
      pl: 1.01,
      showHighRange: true,
      showStdDevLine: true,
    })
    // wvf = ((highest(close, 3) - low) / highest(close, 3)) * 100
    expect(values.wvf[0]).toBeNull()
    expect(values.wvf[1]).toBeNull()
    expect(values.wvf[2]).toBeCloseTo(0, 10)
    expect(values.wvf[3]).toBeCloseTo(((12 - 11) / 12) * 100, 10)
    expect(values.wvf[4]).toBeCloseTo(((12 - 8) / 12) * 100, 10)
    // midLine = sma(wvf, 2); upperBand = midLine + 2 * stdev(wvf, 2)
    expect(values.midLine[3]).toBeCloseTo((0 + 8.3333333333) / 2, 6)
    expect(values.upperBand[3]).toBeCloseTo(12.5, 6)
    expect(values.upperBand[4]).toBeCloseTo(45.8333333333, 6)
    // rangeHigh = highest(wvf, 3) * 0.85
    expect(values.rangeHigh[3]).toBeNull()
    expect(values.rangeHigh[4]).toBeCloseTo(33.3333333333 * 0.85, 6)
    // Only the crash bar clears a trigger: below the upper band, above range-high.
    expect(values.isGreen).toEqual([false, false, false, false, true])
  })

  it('stays flat at zero on a flat tape and bounds WVF between 0 and 100', () => {
    const candles = Array.from({ length: 120 }, (_, i) => candle(i * 60, 100))
    const values = calculateWilliamsVixFix(candles, CM_WILLIAMS_VIX_FIX_DEFAULTS)
    expect(values.wvf).toHaveLength(candles.length)
    const valid = values.wvf.filter((v): v is number => v !== null)
    expect(valid.length).toBe(candles.length - (CM_WILLIAMS_VIX_FIX_DEFAULTS.pd - 1))
    for (const value of valid) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
      expect(value).toBeCloseTo(0, 10)
    }
    // Degenerate but Pine-faithful: with every value at zero, `0 >= 0` is lime wherever the
    // bands exist, and gray where they have not warmed up yet.
    values.isGreen.forEach((green, i) => {
      expect(green).toBe(values.upperBand[i] !== null)
    })
    const crash = calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    for (const value of crash.wvf) {
      if (value !== null) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
      }
    }
  })

  it('warms up each series in the published order', () => {
    const values = calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    // wvf needs pd closes, the bands need bbl wvfs, the range needs lb wvfs.
    expect(values.wvf.slice(0, 21).every((v) => v === null)).toBe(true)
    expect(values.wvf[21]).not.toBeNull()
    expect(values.upperBand.slice(0, 40).every((v) => v === null)).toBe(true)
    expect(values.upperBand[40]).not.toBeNull()
    expect(values.rangeHigh.slice(0, 70).every((v) => v === null)).toBe(true)
    expect(values.rangeHigh[70]).not.toBeNull()
  })

  it('paints a crash lime once fear clears the band or the range', () => {
    const values = calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    const greens = values.isGreen.filter(Boolean).length
    expect(greens).toBeGreaterThan(0)
    values.isGreen.forEach((green, i) => {
      const wvf = values.wvf[i]!
      const upper = values.upperBand[i]
      const range = values.rangeHigh[i]
      expect(green).toBe((upper !== null && wvf >= upper) || (range !== null && wvf >= range))
    })
  })

  it('rejects invalid settings instead of guessing', () => {
    const candles = flatThenCrash()
    expect(() =>
      calculateWilliamsVixFix(candles, { ...CM_WILLIAMS_VIX_FIX_DEFAULTS, pd: 0 }),
    ).toThrow(/Invalid Williams VIX Fix/)
    expect(() =>
      calculateWilliamsVixFix(candles, { ...CM_WILLIAMS_VIX_FIX_DEFAULTS, mult: 9 }),
    ).toThrow(/Invalid Williams VIX Fix/)
  })
})

describe('williamsVixFixPlots', () => {
  const valuesOf = (settings = CM_WILLIAMS_VIX_FIX_DEFAULTS): WilliamsVixFixValues =>
    calculateWilliamsVixFix(flatThenCrash(), settings)

  it('draws only the histogram by default, like the published script', () => {
    const plots = williamsVixFixPlots(valuesOf(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    expect(plots).toHaveLength(1)
    const [histogram] = plots
    expect(histogram.title).toBe('Williams Vix Fix')
    expect(histogram.pane).toBe('oscillator')
    expect(histogram.style).toBe('histogram')
    expect(histogram.lineWidth).toBe(4)
    expect(histogram.values).toHaveLength(120)
    expect(histogram.colors).toHaveLength(120)
    expect(new Set(histogram.colors)).toEqual(new Set([WVF_COLORS.lime, WVF_COLORS.gray]))
  })

  it('adds the orange range lines and the aqua upper band when the toggles are on', () => {
    const settings = { ...CM_WILLIAMS_VIX_FIX_DEFAULTS, showHighRange: true, showStdDevLine: true }
    const plots = williamsVixFixPlots(valuesOf(settings), settings)
    expect(plots.map((plot) => plot.title)).toEqual([
      'Williams Vix Fix',
      'Range High Percentile',
      'Range Low Percentile',
      'Upper Band',
    ])
    const [, rangeHigh, rangeLow, upper] = plots
    expect(rangeHigh.color).toBe(WVF_COLORS.orange)
    expect(rangeHigh.lineWidth).toBe(4)
    expect(rangeLow.color).toBe(WVF_COLORS.orange)
    expect(upper.color).toBe(WVF_COLORS.aqua)
    expect(upper.lineWidth).toBe(3)
  })
})

describe('williamsVixFix settings', () => {
  it('labels the pane with the published input tuple', () => {
    const indicator: Indicator = {
      id: 'vix',
      kind: 'cm-williams-vix-fix',
      name: 'CM_Williams_Vix_Fix',
      period: 22,
      color: WVF_COLORS.lime,
      visible: true,
      williamsVixFix: { ...CM_WILLIAMS_VIX_FIX_DEFAULTS },
    }
    expect(williamsVixFixIndicatorLabel(indicator)).toBe(
      'CM_Williams_Vix_Fix (22, 20, 2, 50, 0.85, 1.01)',
    )
  })

  it('falls back to the published defaults when the indicator carries nothing usable', () => {
    const indicator: Indicator = {
      id: 'vix',
      kind: 'cm-williams-vix-fix',
      name: 'CM_Williams_Vix_Fix',
      period: 22,
      color: WVF_COLORS.lime,
      visible: true,
    }
    expect(williamsVixFixSettings(indicator)).toEqual(CM_WILLIAMS_VIX_FIX_DEFAULTS)
    expect(isWilliamsVixFixSettings(CM_WILLIAMS_VIX_FIX_DEFAULTS)).toBe(true)
    expect(isWilliamsVixFixSettings({ ...CM_WILLIAMS_VIX_FIX_DEFAULTS, ph: 0 })).toBe(false)
    expect(isWilliamsVixFixSettings({ ...CM_WILLIAMS_VIX_FIX_DEFAULTS, bbl: 2.5 })).toBe(false)
    expect(
      isWilliamsVixFixSettings({ ...CM_WILLIAMS_VIX_FIX_DEFAULTS, showHighRange: 'yes' }),
    ).toBe(false)
  })
})

describe('williamsVixFixVerdict', () => {
  it('waits for history before calling anything', () => {
    expect(williamsVixFixVerdict(null, 5, 4, null, false, null)).toEqual({
      text: 'WARMING UP',
      tone: 'flat',
      detail: 'not enough history yet',
    })
  })

  it('names a fresh fear spike a potential bottom, and says which trigger broke', () => {
    const fresh = williamsVixFixVerdict(6.42, 5.1, 4.9, 3.1, true, false)
    expect(fresh.text).toBe('▲ POTENTIAL BOTTOM')
    expect(fresh.tone).toBe('bull')
    expect(fresh.detail).toContain('WVF 6.42')
    expect(fresh.detail).toContain('upper 5.10')
    expect(fresh.detail).toContain('range-high 4.90')

    const holds = williamsVixFixVerdict(6.1, 5.1, 4.9, 6.42, true, true)
    expect(holds.text).toBe('▲ BOTTOM SIGNAL HOLDS')
    expect(holds.tone).toBe('bull')
  })

  it('warns within 15% of the nearest trigger, and stays quiet otherwise', () => {
    const near = williamsVixFixVerdict(4.6, 5.0, 6.0, 4.2, false, false)
    expect(near.text).toBe('⚠ NEAR TRIGGER')
    expect(near.tone).toBe('os')
    expect(near.detail).toContain('92% of upper 5.00')

    const quiet = williamsVixFixVerdict(1.2, 5.0, 6.0, 1.0, false, false)
    expect(quiet.text).toBe('— QUIET')
    expect(quiet.tone).toBe('flat')
    expect(quiet.detail).toContain('rising')
  })

  it('admits when the bands have not warmed up yet', () => {
    const early = williamsVixFixVerdict(0.4, null, null, null, false, null)
    expect(early.text).toBe('— QUIET')
    expect(early.detail).toContain('bands warming up')
  })
})

describe('williamsVixFixHudModel', () => {
  const modelOf = (
    values: WilliamsVixFixValues,
    settings = CM_WILLIAMS_VIX_FIX_DEFAULTS,
    index = values.wvf.length - 1,
  ) =>
    williamsVixFixHudModel(values, settings, {
      times: Array.from({ length: values.wvf.length }, (_, i) => i * 60),
      timeframe: '1m',
      bars: 20,
      index,
    })

  it('scales one-sided from zero, because WVF never goes negative', () => {
    const model = modelOf(calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS))
    expect(model.kind).toBe('cm-williams-vix-fix')
    expect(model.title).toBe('CM_Williams_Vix_Fix')
    expect(model.subtitle).toContain('WVF (22, 20, 2, 50, 0.85, 1.01)')
    expect(model.accent).toBe(OSC_HUD_WIDGETS['cm-williams-vix-fix'].accent)
    expect(model.domain.min).toBe(0)
    expect(model.domain.max).toBeGreaterThan(0)
    expect(model.bars).toBe(20)
    expect(model.ready).toBe(true)
  })

  it('colours the histogram with the original lime/gray rule', () => {
    // The window is always the last twenty bars, so the dip sits inside the tail.
    const values = calculateWilliamsVixFix(dipThenCalm(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    const model = modelOf(values)
    expect(model.histogram).toBeDefined()
    expect(model.histogram!.values).toHaveLength(20)
    expect(new Set(model.histogram!.colors)).toEqual(new Set([WVF_COLORS.lime, WVF_COLORS.gray]))
    model.histogram!.colors.forEach((color, i) => {
      expect(color).toBe(values.isGreen[60 + i] ? WVF_COLORS.lime : WVF_COLORS.gray)
    })
    expect(model.readouts.map((readout) => readout.label)).toEqual(['WVF', 'Upper', 'RangeHi'])
  })

  it('draws the trigger lines only when the pane draws them', () => {
    const values = calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS)
    expect(modelOf(values).traces).toHaveLength(0)
    const shown = modelOf(values, {
      ...CM_WILLIAMS_VIX_FIX_DEFAULTS,
      showHighRange: true,
      showStdDevLine: true,
    })
    expect(shown.traces.map((trace) => trace.title)).toEqual(['Upper Band', 'Range High'])
    expect(shown.traces.map((trace) => trace.color)).toEqual([WVF_COLORS.aqua, WVF_COLORS.orange])
  })

  it('calls the crash a bottom and explains an empty window', () => {
    const crash = modelOf(calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS))
    expect(crash.verdict.text).toMatch(/POTENTIAL BOTTOM|BOTTOM SIGNAL HOLDS/)
    expect(crash.verdict.tone).toBe('bull')

    const empty = calculateWilliamsVixFix([], CM_WILLIAMS_VIX_FIX_DEFAULTS)
    const quiet = williamsVixFixHudModel(empty, CM_WILLIAMS_VIX_FIX_DEFAULTS, {
      times: [],
      timeframe: '1m',
      bars: 20,
      index: -1,
    })
    expect(quiet.ready).toBe(false)
    expect(quiet.verdict.text).toBe('WARMING UP')
  })

  it('exposes widget config matching the osc-hud contract', () => {
    const widget = OSC_HUD_WIDGETS['cm-williams-vix-fix']
    expect(widget.kind).toBe('cm-williams-vix-fix')
    expect(widget.button).toBe('VIX Fix')
    expect(widget.visibilityKey).toBe('osc-hud-visible:cm-williams-vix-fix')
    expect(widget.positionKey).toBe('osc-hud-pos:cm-williams-vix-fix')
    expect(widget.minimizedKey).toBe('osc-hud-min:cm-williams-vix-fix')
  })

  it('renders a named card that offers the pane when the chart has none', () => {
    const model = modelOf(calculateWilliamsVixFix(flatThenCrash(), CM_WILLIAMS_VIX_FIX_DEFAULTS))
    const noop = () => {}
    const markup = renderToStaticMarkup(
      createElement(OscHudCard, {
        model,
        dock: 'vix-fix',
        indicator: null,
        onEditIndicator: noop,
        onAddIndicator: noop,
        onClose: noop,
        bars: 20,
        onZoom: noop,
      }),
    )
    expect(markup).toContain('aria-label="CM_Williams_Vix_Fix window"')
    expect(markup).toContain('data-testid="osc-hud-cm-williams-vix-fix"')
    expect(markup).toContain('dock-vix-fix')
    expect(markup).toContain('Add the CM_Williams_Vix_Fix pane to the chart')
  })
})
