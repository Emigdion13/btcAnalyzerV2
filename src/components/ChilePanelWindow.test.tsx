// @vitest-environment jsdom
/**
 * The floating Chile panel, rendered for real: the verdict line, the countdown, the score split
 * and the eight readouts of the Pine panel. The window must say what it knows and what it does
 * not — a feed that has not answered reads "loading", never a scored zero.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { ChilePanelWindow } from './ChilePanelWindow'
import type { ChilePanelWindowProps } from './ChilePanelWindow'
import { calculateChileReversal } from '../lib/chile-reversal'
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

/** The real engine over a rising market: 16 points up, nothing down. */
const engine = (): ChileReversalResult =>
  calculateChileReversal(
    trending(40, 60, LAST_TIME - 39 * 60),
    { ...CHILE_REVERSAL_DEFAULTS },
    {
      timeframe: '1m',
      timeframes: {
        '15m': { candles: trending(40, 900, 0) },
        '5m': { candles: trending(40, 300, LAST_TIME - 39 * 300) },
      },
    },
  )

/** A round feed that answered, but not with enough bars for ATR(14). */
const warming = (): ChileReversalResult =>
  calculateChileReversal(
    trending(40, 60, LAST_TIME - 39 * 60),
    { ...CHILE_REVERSAL_DEFAULTS },
    {
      timeframe: '1m',
      timeframes: { '15m': { candles: trending(6, 900, 0) } },
    },
  )

function props(overrides: Partial<ChilePanelWindowProps> = {}): ChilePanelWindowProps {
  return {
    ticker: 'BTC-USD',
    source: 'coinbase',
    timeframe: '1m',
    settings: { ...CHILE_REVERSAL_DEFAULTS },
    result: engine(),
    roundState: 'live',
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
    const unfed = calculateChileReversal(
      trending(40, 60, LAST_TIME - 39 * 60),
      {
        ...CHILE_REVERSAL_DEFAULTS,
      },
      { timeframe: '1m', timeframes: { '15m': { candles: [] } } },
    )
    expect(unfed.missingFeed).toBe(true)
    const html = render({ result: unfed, roundState: 'offline' })
    expect(html).toContain('15m feed loading…')
    expect(html).toContain('>WAIT</')
    expect(html).toContain('DEGRADED')
  })

  it('says when the round ATR is still warming', () => {
    const html = render({ result: warming() })
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

describe('ChilePanelWindow · this round and the scorecard', () => {
  afterEach(() => localStorage.clear())

  it('shows the odds this round closes above its open', () => {
    // The newest bar opened a round at 139 and closed a bar higher: a rising round, 14 minutes left
    // on the data's own clock.
    const html = render()
    expect(html).toContain('data-testid="chile-panel-odds"')
    expect(html).toContain('>THIS ROUND</span>')
    expect(html).toMatch(/chile-panel-odds is-above[^"]*"/)
    expect(html).toMatch(/>ABOVE \d{2}%</)
    expect(html).toContain('open 139')
  })

  it('has no round to play when one chart bar spans several rounds', () => {
    expect(render({ timeframe: '1h' })).not.toContain('data-testid="chile-panel-odds"')
  })

  it('grades the V17 call and the odds on the loaded history', () => {
    const html = render()
    // Two round-close calls have a finished round after them; the third is still being played.
    expect(html).toContain('>V17 CALLS</dt>')
    expect(html).toMatch(/>\d+% right · \d\/2</)
    expect(html).toContain('>THIS-ROUND ODDS</dt>')
    // Every 1m bar inside those two rounds, bar the one that closes each: 2 × 14.
    expect(html).toContain('>100% right · 28<')
  })

  it('keeps the odds on the minimized row', () => {
    localStorage.setItem('atlas.v1.chile-panel-min', 'true')
    const html = render()
    expect(html).toContain('chile-panel-min-row')
    expect(html).toMatch(/chile-panel-min-odds mono is-above"[^>]*>ABOVE \d{2}%</)
  })

  const mounted = (overrides: Partial<ChilePanelWindowProps>) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(ChilePanelWindow, props(overrides))))
    return () => {
      act(() => root.unmount())
      container.remove()
    }
  }

  it('saves real-market grades per profile, and never synthetic ones', () => {
    const unmountLive = mounted({})
    const saved = JSON.parse(localStorage.getItem('atlas.v1.chile-scorecard') ?? 'null')
    unmountLive()
    expect(saved.version).toBe(1)
    const [key] = Object.keys(saved.profiles)
    expect(key).toBe('coinbase|BTC-USD|1m|15m|6|2|2.4|10|2|2|2.5')
    expect(saved.profiles[key!].calls).toHaveLength(2)

    localStorage.clear()
    const unmountDemo = mounted({ source: 'demo' })
    expect(localStorage.getItem('atlas.v1.chile-scorecard')).toBeNull()
    unmountDemo()
  })
})
