// @vitest-environment jsdom
/**
 * The timeframe peek window's RSI readout, rendered for real: the number is the watched
 * resolution's RSI(14) — not the chart's, not the visible window's — and the panel says
 * so out loud with a zone label instead of leaving the trader to decode a bare value.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TimeframePeekBox } from './TimeframePeekBox'
import { TIMEFRAME_PEEK_DEFAULTS } from '../lib/timeframe-peek'
import type { TimeframePeekSettings } from '../lib/timeframe-peek'
import type { Candle, Timeframe } from '../lib/types'

const candle = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close + 0.3,
  low: close - 0.3,
  close,
  volume: 100,
})

/** A market that only ever rises: RSI pins to 100 once enough closes exist. */
const rising = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(i * 900, 100 + i * 2))

/** A market that only ever falls: RSI pins to 0. */
const falling = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(i * 900, 300 - i * 2))

function renderPeek(
  candles: Candle[],
  resolution: Timeframe = '15m',
  settings: TimeframePeekSettings = TIMEFRAME_PEEK_DEFAULTS,
) {
  return renderToStaticMarkup(
    createElement(TimeframePeekBox, {
      ticker: 'BTC',
      source: 'demo' as const,
      settings,
      onChange: () => {},
      onClose: () => {},
      upColor: '#2bb99b',
      downColor: '#ed6773',
      feed: {
        resolution,
        candles,
        state: 'live' as const,
        message: '',
        chartTimeframe: '1m' as const,
      },
    }),
  )
}

describe('TimeframePeekBox RSI readout', () => {
  it('shows the watched resolution’s RSI big, with its zone named', () => {
    const html = renderPeek(rising(60))
    expect(html).toContain('peek-rsi-value')
    expect(html).toContain('100.0')
    expect(html).toContain('overbought')
    expect(html).toContain('rsi · 14')
    expect(html).toContain('peek-rsi-track')
  })

  it('colours the block by zone, like the RSI meter', () => {
    expect(renderPeek(rising(60))).toContain('is-overbought')
    expect(renderPeek(falling(60))).toContain('is-oversold')
    // A gentle oscillator around the middle reads as neutral: no zone colour at all.
    const wandering: Candle[] = Array.from({ length: 60 }, (_, i) =>
      candle(i * 900, 100 + Math.sin(i / 3) * 4),
    )
    expect(renderPeek(wandering)).not.toContain('is-overbought')
    expect(renderPeek(wandering)).toContain('is-')
  })

  it('is the resolution’s momentum, not the visible window’s', () => {
    // Sixty rising bars but only twelve on screen: the reading still exists, because it
    // runs on the whole 15m history the feed carries.
    const html = renderPeek(rising(60), '15m', { ...TIMEFRAME_PEEK_DEFAULTS, bars: 12 })
    expect(html).toContain('100.0')
  })

  it('says it is warming up while fewer than period + 1 closes exist', () => {
    const html = renderPeek(rising(10))
    expect(html).toContain('warming up')
    expect(html).toContain('is-warming')
  })

  it('carries a compact reading into the minimized row', () => {
    // The minimized state persists, so the test seeds it the way the minimize button writes it.
    localStorage.setItem('atlas.v1.timeframe-peek-min', 'true')
    const html = renderPeek(rising(60))
    expect(html).toContain('peek-min-row')
    expect(html).toContain('peek-min-rsi')
    expect(html).toContain('is-overbought')
    localStorage.removeItem('atlas.v1.timeframe-peek-min')
  })
})
