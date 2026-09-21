// @vitest-environment jsdom
/**
 * The floating Chile panel, rendered for real: the verdict line, the countdown, the score split
 * and the eight readouts of the Pine panel. The window must say what it knows and what it does
 * not — a feed that has not answered reads "loading", never a scored zero.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChilePanelWindow } from './ChilePanelWindow'
import type { ChilePanelWindowProps } from './ChilePanelWindow'
import type { ChileReversalResult } from '../lib/chile-reversal'
import { CHILE_REVERSAL_DEFAULTS, type Candle } from '../lib/types'

const candle = (
  open: number,
  high: number,
  low: number,
  close: number,
  time: number,
  volume = 10,
): Candle => ({ time, open, high, low, close, volume })

/** Rising series whose bars close at their own high, so buyers read 100%. */
const trending = (count: number, step: number, firstTime: number, start = 100): Candle[] =>
  Array.from({ length: count }, (_, i) => {
    const open = start + i
    const close = open + 1
    return candle(open, close, open - 0.5, close, firstTime + i * step)
  })

const LAST_TIME = 31500

const engine = (bars: number): ChileReversalResult => ({
  levels: [],
  signals: [],
  atr: Array.from({ length: bars }, () => 4),
  warmupBars: 14,
  resolution: '15m',
  missingFeed: false,
})

function props(overrides: Partial<ChilePanelWindowProps> = {}): ChilePanelWindowProps {
  const candles = trending(40, 60, LAST_TIME - 39 * 60)
  return {
    ticker: 'BTC-USD',
    source: 'coinbase',
    candles,
    timeframe: '1m',
    settings: { ...CHILE_REVERSAL_DEFAULTS },
    reversal: engine(candles.length),
    roundCandles: trending(40, 900, 0),
    roundState: 'live',
    momentumCandles: trending(40, 300, LAST_TIME - 39 * 300),
    momentumState: 'live',
    hasIndicator: true,
    onAddIndicator: () => {},
    onClose: () => {},
    ...overrides,
  }
}

const render = (overrides: Partial<ChilePanelWindowProps> = {}) =>
  renderToStaticMarkup(createElement(ChilePanelWindow, props(overrides)))

describe('ChilePanelWindow', () => {
  it('renders the verdict, the countdown and every readout of the Pine panel', () => {
    const html = render()
    expect(html).toContain('data-testid="chile-panel-window"')
    expect(html).toContain('CHILE PANEL')
    expect(html).toContain('>UP</')
    for (const label of [
      'UP FORCE',
      'DOWN FORCE',
      'BUYERS',
      'SELLERS',
      'VOLUME',
      'RSI 15m',
      'TREND',
      'S/R 15m',
    ]) {
      expect(html).toContain(`>${label}</dt>`)
    }
    // The countdown is mm:ss, and the frame answers the call.
    expect(html).toMatch(/\d{2}:\d{2}/)
    expect(html).toContain('data-call="up"')
    expect(html).toContain('>LIVE</span>')
  })

  it('scores a rising market up and shows why', () => {
    const html = render()
    expect(html).toContain('100%')
    expect(html).toContain('BULLISH')
    expect(html).toContain('ROBEX trend')
    expect(html).toContain('5m momentum')
  })

  it('keeps the Pine wording in the tooltips', () => {
    const html = render()
    expect(html).toContain('Pine FUERZA ARRIBA')
    expect(html).toContain('Pine TENDENCIA: ALCISTA')
  })

  it('says a missing round feed instead of scoring against nothing', () => {
    const html = render({ roundCandles: [], roundState: 'offline' })
    expect(html).toContain('15m feed loading…')
    expect(html).toContain('>WAIT</')
    expect(html).toContain('DEGRADED')
  })

  it('says when the round ATR is still warming', () => {
    const html = render({ reversal: { ...engine(40), atr: Array(40).fill(null) } })
    expect(html).toContain('Warming the 15m ATR…')
  })

  it('labels offline demo data as synthetic', () => {
    expect(render({ source: 'demo' })).toContain('>SYNTH</span>')
  })

  it('offers the overlay when the chart has no Chile indicator to borrow a profile from', () => {
    expect(render({ hasIndicator: false })).toContain(
      'aria-label="Add the Chile Reversal overlay to the chart"',
    )
    expect(render()).not.toContain('Add the Chile Reversal overlay')
  })

  it('names the pivot resolution it is reading', () => {
    const html = render({ settings: { ...CHILE_REVERSAL_DEFAULTS, resolution: '1h' } })
    expect(html).toContain('next 1h round')
    expect(html).toContain('>RSI 1h</dt>')
  })
})
