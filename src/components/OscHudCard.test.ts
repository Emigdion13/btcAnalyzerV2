import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OscHudCard } from './OscHudCard'
import { cmMacdHudModel, oscHudGeometry, waveTrendHudModel } from '../lib/osc-hud'
import { CM_MACD_DEFAULTS, CM_COLORS } from '../lib/cm-ult-macd'
import { WAVE_TREND_DEFAULTS, WT_COLORS } from '../lib/wave-trend'
import type { CmMacdValues } from '../lib/cm-ult-macd'
import type { WaveTrendValues } from '../lib/wave-trend'
import type { Indicator, Timeframe } from '../lib/types'

const times = (count: number, step = 60): number[] =>
  Array.from({ length: count }, (_, index) => index * step)

const cmValues = (macd: (number | null)[]): CmMacdValues => ({
  macd,
  signal: macd.map((value) => (value === null ? null : value * 0.5)),
  histogram: macd.map((value) => (value === null ? null : value * 0.25)),
})

const waveValues = (wt1: (number | null)[]): WaveTrendValues => ({
  wt1,
  wt2: wt1.map((value) => (value === null ? null : value - 2)),
  diff: wt1.map((value) => (value === null ? null : 2)),
})

/** A window that swings through zero, which is the shape the card has to make readable. */
const swing = Array.from({ length: 20 }, (_, index) => Math.sin(index / 2.2) * 8)

const modelOf = (values: CmMacdValues, timeframe: Timeframe = '1m') =>
  cmMacdHudModel(values, CM_MACD_DEFAULTS, {
    times: times(values.macd.length),
    timeframe,
    bars: 20,
    index: values.macd.length - 1,
  })
const waveModelOf = (values: WaveTrendValues) =>
  waveTrendHudModel(values, WAVE_TREND_DEFAULTS, {
    times: times(values.wt1.length),
    timeframe: '1m',
    bars: 20,
    index: values.wt1.length - 1,
  })

const noop = () => {}
const base = {
  dock: 'cm' as const,
  indicator: null,
  onEditIndicator: noop,
  onAddIndicator: noop,
  onClose: noop,
  bars: 20,
  onZoom: noop,
}
const card = (model: unknown, override: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(OscHudCard, { model, ...base, ...override } as never))

describe('the floating oscillator card', () => {
  it('is a named window that says what it is looking at', () => {
    const markup = card(modelOf(cmValues(swing)))
    expect(markup).toContain('aria-label="CM_Ult_MacD_MTF window"')
    expect(markup).toContain('data-testid="osc-hud-cm-ult-macd"')
    // Twenty minutes on a 1m chart, and it admits which settings it is using.
    expect(markup).toContain('20 bars / 20 min')
    expect(markup).toContain('default settings')
    expect(markup).toContain('LIVE')
  })

  it('draws one histogram bar per bar in the window, hung from the zero line', () => {
    const model = modelOf(cmValues(swing))
    const markup = card(model)
    const rects = markup.match(/<rect[^>]*>/g) ?? []
    expect(rects).toHaveLength(20)
    // Positive bars end at the zero line below them, negative ones start at it above them.
    const geometry = oscHudGeometry(20, model.domain)
    const endsAtZero = rects.filter((rect) => {
      const y = Number(/y="([\d.]+)"/.exec(rect)![1])
      const height = Number(/height="([\d.]+)"/.exec(rect)![1])
      return Math.abs(y + height - geometry.zeroY) < 0.51 || Math.abs(y - geometry.zeroY) < 0.51
    })
    expect(endsAtZero).toHaveLength(20)
    // The original's four-colour momentum rules, not a single theme colour.
    const fills = new Set(rects.map((rect) => /fill="(#[0-9a-f]{6})"/.exec(rect)?.[1]))
    for (const color of [CM_COLORS.aqua, CM_COLORS.blue, CM_COLORS.red, CM_COLORS.maroon])
      expect(fills.has(color)).toBe(true)
  })

  it('skips a histogram bar with no value instead of drawing it at the baseline', () => {
    const values = cmValues(swing)
    values.histogram = values.histogram.map((value, index) => (index === 3 ? null : value))
    const markup = card(modelOf(values))
    expect(markup.match(/<rect[^>]*>/g)).toHaveLength(19)
  })

  it('closes the WaveTrend area on the zero line, the way the original area plot does', () => {
    const model = waveModelOf(waveValues(swing))
    const markup = card(model, { dock: 'wave' })
    // Scoped to the area: the header's icons are <path>s too, and they come first in the markup.
    const path = /<path d="(M[^"]* Z)"/.exec(markup)?.[1] ?? ''
    const geometry = oscHudGeometry(20, model.domain)
    const vertices = path
      .replace(/ Z$/, '')
      .split(' L ')
      .map((part) => part.split(',').map(Number))
    const last = vertices.at(-1)!,
      secondLast = vertices.at(-2)!
    expect(path.endsWith(' Z')).toBe(true)
    expect(secondLast[1]).toBeCloseTo(geometry.y(0), 6)
    expect(last[1]).toBeCloseTo(geometry.y(0), 6)
    // The fill is the original `transp=80`, so it never hides the lines over it.
    expect(/fill-opacity="0\.2"/.test(markup)).toBe(true)
  })

  it('shows the level lines the window’s own scale can reach, and colours the wave', () => {
    // Half the size: nothing but zero fits. Ten times the size: the 53 and 60 bands appear.
    // Only the level lines carry a stroke — the crosshair guide is styled in CSS, not here.
    const stroked = (markup: string) =>
      (markup.match(/<line[^>]*>/g) ?? []).filter((line) => line.includes('stroke=')).length
    const tame = card(waveModelOf(waveValues(swing.map((value) => value / 2))))
    const wild = card(waveModelOf(waveValues(swing.map((value) => value * 9))))
    expect(stroked(tame)).toBe(1)
    const lines = (wild.match(/<line[^>]*>/g) ?? []).filter((line) => line.includes('stroke='))
    expect(lines).toHaveLength(5)
    expect(wild).toContain(`stroke="${WT_COLORS.red}"`)
    expect(wild).toContain('stroke-dasharray="2 2"')
    expect(wild).toContain(`stroke="${WT_COLORS.green}"`)
    // Dotted for the second pair, exactly as the published style=3 lines read.
    expect(lines.filter((line) => line.includes('stroke-dasharray="3 3"')).length).toBe(2)
  })

  it('marks the bar the crosshair is on, and stops being LIVE when it is', () => {
    const model = { ...modelOf(cmValues(swing)), hovered: true, activeIndex: 5 }
    const markup = card(model)
    expect(markup).toContain('BAR')
    expect(markup).toContain('osc-hud-cursor')
    const geometry = oscHudGeometry(20, model.domain)
    expect(markup).toContain(`x1="${geometry.x[5]}"`)
    // A bar outside the window leaves nothing to mark rather than marking the wrong one.
    expect(card({ ...model, activeIndex: null })).not.toContain('osc-hud-cursor')
  })

  it('explains an empty window instead of drawing an empty box', () => {
    const empty = modelOf(cmValues(Array(40).fill(null)))
    expect(empty.ready).toBe(false)
    const markup = card({ ...empty, note: '1h feed offline' })
    expect(markup).toContain('1h feed offline')
    expect(markup).not.toContain('osc-hud-plot')
  })

  it('offers the pane when the chart has no indicator, and its settings when it does', () => {
    const model = modelOf(cmValues(swing))
    expect(card(model)).toContain('Add the CM_Ult_MacD_MTF pane to the chart')
    const indicator: Indicator = {
      id: 'cm',
      kind: 'cm-ult-macd',
      name: 'CM_Ult_MacD_MTF',
      period: 12,
      color: CM_COLORS.lime,
      visible: true,
    }
    const owned = card({ ...model, settingsSource: 'chart' as const }, { indicator })
    expect(owned).toContain('Settings for CM_Ult_MacD_MTF')
    expect(owned).not.toContain('Add the CM_Ult_MacD_MTF pane')
    // The card says whose settings it is borrowing, because that is the difference between a
    // window you can tune and a window that is only showing you the published defaults.
    expect(owned).toContain('your indicator')
  })

  it('reports the histogram direction in the small print, which is what the colours mean', () => {
    const rising = modelOf(cmValues(swing.map((value, index) => (index === 19 ? 9 : value))))
    expect(rising.verdict.detail).toMatch(/histogram (rising|falling|level)/)
    expect(rising.verdict.detail).toContain('MACD')
    // And the readouts are the numbers themselves, not a description of them.
    expect(rising.readouts.map((readout) => readout.label)).toEqual(['MACD', 'Signal', 'Hist'])
  })
})
