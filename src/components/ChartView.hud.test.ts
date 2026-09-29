import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartView } from './ChartView'
import { TREND_PRESSURE_DEFAULTS } from '../lib/zeiierman-trend-pressure'
import { DEFAULT_INDICATORS, DEFAULT_SETTINGS } from '../lib/types'
import type { Indicator } from '../lib/types'
import { ASSETS, generateCandles } from '../lib/market'

/**
 * The wiring between the chart and the two floating oscillator windows, rendered to markup.
 *
 * Static rendering runs the component body without any effects, which is exactly the seam worth
 * pinning: which indicator a window borrows its settings from, what the card therefore says, and
 * that a window the toolbar switched off is gone rather than empty. The arithmetic behind the
 * drawing is covered in `../lib/osc-hud.test.ts`, and the painting in `OscHudCard.test.ts`.
 */
const noop = () => {}
const asset = ASSETS[0]

const render = (
  overrides: {
    trendPressureHud?: boolean
    cmMacdHud?: boolean
    waveTrendHud?: boolean
    rsiDivHud?: boolean
    vixFixHud?: boolean
    indicators?: Indicator[]
  } = {},
) =>
  renderToStaticMarkup(
    createElement(ChartView, {
      source: 'demo',
      feedState: 'live',
      asset,
      candles: generateCandles(asset, '1m'),
      timeframe: '1m',
      chartType: 'candles',
      indicators: overrides.indicators ?? DEFAULT_INDICATORS,
      customResults: {},
      indicatorTimeframes: {},
      settings: DEFAULT_SETTINGS,
      drawings: [],
      drawingTool: 'cursor',
      drawingsVisible: true,
      drawingsLocked: false,
      magnet: false,
      alerts: [],
      onDraw: noop,
      onToolComplete: noop,
      onTextRequest: noop,
      onIndicatorEdit: noop,
      onIndicatorToggle: noop,
      onIndicatorRemove: noop,
      onIndicatorRetry: noop,
      replay: false,
      trendPressureHud: overrides.trendPressureHud,
      cmMacdHud: overrides.cmMacdHud ?? true,
      waveTrendHud: overrides.waveTrendHud ?? true,
      rsiDivHud: overrides.rsiDivHud,
      vixFixHud: overrides.vixFixHud,
      onOscHudClose: noop,
      onIndicatorAdd: noop,
    } as never),
  )

describe('the chart hands both oscillator windows their own view', () => {
  it('shares Trend Pressure pane settings with its floating window, or uses defaults', () => {
    const defaults = render({ trendPressureHud: true })
    expect(defaults).toContain('data-testid="osc-hud-zeiierman-trend-pressure"')
    expect(defaults).toContain('Pulse 21 · macro 120 · sensitivity 7')
    expect(defaults).toContain('Add the Zeiierman Trend Pressure pane to the chart')
    const indicator: Indicator = {
      id: 'pressure',
      kind: 'zeiierman-trend-pressure',
      name: 'Zeiierman Trend Pressure (Zeiierman)',
      period: 21,
      color: '#8baeff',
      visible: true,
      trendPressure: { ...TREND_PRESSURE_DEFAULTS, pulseRange: 15, sensitivity: 2 },
    }
    const markup = render({ trendPressureHud: true, indicators: [indicator] })
    expect(markup).toContain('Pulse 15 · macro 120 · sensitivity 2')
    expect(markup).toContain('Settings for Zeiierman Trend Pressure')
    expect(markup).toContain('data-testid="pressure-overlay"')
    expect(markup).toContain('data-testid="pressure-price-overlay"')
    expect(render({ trendPressureHud: false, indicators: [indicator] })).not.toContain(
      'data-testid="osc-hud-zeiierman-trend-pressure"',
    )
  })

  it('opens a window per flag, over the last twenty minutes of a 1m chart', () => {
    const markup = render()
    expect(markup).toContain('aria-label="CM_Ult_MacD_MTF window"')
    expect(markup).toContain('aria-label="WaveTrend [LazyBear] window"')
    expect(markup.match(/class="osc-hud-svg[ "]/g)).toHaveLength(2)
    expect(markup.match(/20 bars \/ 20 min/g)).toHaveLength(2)
  })

  it('draws real numbers for the bars, not placeholders', () => {
    const markup = render()
    expect(markup).not.toContain('NaN')
    // The crosshair is on the latest bar, which is what a window with no pointer shows.
    expect(markup).toContain('osc-hud-axis-mark')
    expect(markup).toContain('>LIVE<')
  })

  it('closes a window without touching the indicator it reads', () => {
    const markup = render({ cmMacdHud: false })
    expect(markup).not.toContain('osc-hud-cm-ult-macd')
    expect(markup).toContain('aria-label="WaveTrend [LazyBear] window"')
  })

  it('opens the RSI Divergence window when rsiDivHud is set', () => {
    const markup = render({ rsiDivHud: true })
    expect(markup).toContain('aria-label="RSI Divergence window"')
    expect(markup).toContain('data-testid="osc-hud-rsi-divergence"')
    expect(markup.match(/class="osc-hud-svg[ "]/g)).toHaveLength(3)
  })

  it('opens the Williams VIX Fix window when vixFixHud is set', () => {
    const markup = render({ vixFixHud: true })
    expect(markup).toContain('aria-label="CM_Williams_Vix_Fix window"')
    expect(markup).toContain('data-testid="osc-hud-cm-williams-vix-fix"')
    expect(markup).toContain('WVF (22, 20, 2, 50, 0.85, 1.01)')
    expect(markup).toContain('Add the CM_Williams_Vix_Fix pane to the chart')
    expect(markup.match(/class="osc-hud-svg[ "]/g)).toHaveLength(3)
  })

  it('says which settings each window is using, and offers the matching control', () => {
    const markup = render()
    // A fresh workspace carries CM_Ult_MacD_MTF, so that window is reading it; WaveTrend is not
    // on the chart, so it says it is on defaults and offers to add the pane.
    expect(markup).toContain('1m (chart) · 12/26/9 · 20 bars / 20 min · your indicator')
    expect(markup).toContain('Wave 10 · avg 21 · wt2 sma 4 · 20 bars / 20 min · default settings')
    expect(markup).toContain('Add the WaveTrend [LazyBear] pane to the chart')
    expect(markup).toContain('Settings for CM_Ult_MacD_MTF')
  })

  it('keeps one set of window controls per card, worded for screen readers', () => {
    const markup = render()
    for (const title of ['CM_Ult_MacD_MTF', 'WaveTrend [LazyBear]'])
      for (const label of [
        `Minimize ${title} window`,
        `Hide ${title} window`,
        `Fewer bars of ${title} in the window`,
        `More bars of ${title} in the window`,
      ])
        expect(markup).toContain(label)
  })

  it('reads a switched-off indicator instead of falling back to defaults', () => {
    const hidden = DEFAULT_INDICATORS.map((indicator) =>
      indicator.kind === 'cm-ult-macd'
        ? {
            ...indicator,
            visible: false,
            cmMacd: {
              useCurrentRes: false,
              resCustom: '1h' as const,
              fastLength: 8,
              slowLength: 21,
              signalLength: 5,
              showLines: true,
              showDots: true,
              showHistogram: true,
              macdColorChange: false,
              histogramColorChange: false,
            },
          }
        : indicator,
    )
    const markup = render({ indicators: hidden })
    // The lengths and the alternate resolution of the hidden indicator, plus the reason the
    // window has nothing to draw: no 1h candles were ever asked for an invisible indicator, so
    // App requests them for the window instead (oscHudRequestedTimeframes).
    expect(markup).toContain('1h (MTF) · 8/21/5 · 20 bars / 20 min · your indicator')
    expect(markup).toContain('Loading 1h source candles…')
    expect(markup).not.toContain('osc-hud-histogram')
  })

  it('is quiet on a chart with no candles', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartView, {
        source: 'demo',
        feedState: 'live',
        asset,
        candles: [],
        timeframe: '1m',
        chartType: 'candles',
        indicators: [],
        customResults: {},
        indicatorTimeframes: {},
        settings: DEFAULT_SETTINGS,
        drawings: [],
        drawingTool: 'cursor',
        drawingsVisible: true,
        drawingsLocked: false,
        magnet: false,
        alerts: [],
        onDraw: noop,
        onToolComplete: noop,
        onTextRequest: noop,
        onIndicatorEdit: noop,
        onIndicatorToggle: noop,
        onIndicatorRemove: noop,
        onIndicatorRetry: noop,
        replay: false,
        cmMacdHud: true,
        waveTrendHud: true,
        onOscHudClose: noop,
        onIndicatorAdd: noop,
      } as never),
    )
    // Nothing to plot, so the windows explain themselves instead of drawing an empty frame.
    expect(markup).toContain('Not enough history in this window yet.')
    expect(markup).toContain('0 bars / 0 min')
  })
})
