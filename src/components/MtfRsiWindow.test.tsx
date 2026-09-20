// @vitest-environment jsdom
/**
 * The MTF RSI window, rendered for real: five rows, one per watched resolution, each with that
 * timeframe's RSI and the tendency call, plus the weighted bias line. The window must say what
 * it knows and what it does not — an unfed rung reads "no data", never a made-up reading.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MtfRsiWindow } from './MtfRsiWindow'
import type { MtfRsiRowFeed } from './MtfRsiWindow'
import type { Candle } from '../lib/types'

const candle = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close + 0.3,
  low: close - 0.3,
  close,
  volume: 100,
})

const rising = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(i * 60, 100 + i * 0.8))
const falling = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(i * 60, 300 - i * 0.8))

const feed = (resolution: MtfRsiRowFeed['resolution'], candles: Candle[]): MtfRsiRowFeed => ({
  resolution,
  candles,
  state: 'live',
  message: '',
})

const ladder = (make: (count: number) => Candle[]): MtfRsiRowFeed[] =>
  (['1m', '5m', '15m', '30m', '1h'] as const).map((resolution) => feed(resolution, make(120)))

function renderWindow(rows: MtfRsiRowFeed[]) {
  return renderToStaticMarkup(
    createElement(MtfRsiWindow, { ticker: 'BTC-USD', rows, onClose: () => {} }),
  )
}

describe('MtfRsiWindow', () => {
  it('renders one row per watched timeframe with the RSI on it', () => {
    const html = renderWindow(ladder(rising))
    expect(html).toContain('data-testid="mtf-rsi-window"')
    expect((html.match(/mtf-rsi-tf mono/g) ?? []).length).toBe(5)
    for (const label of ['1m', '5m', '15m', '30m', '1h']) {
      expect(html).toContain(`>${label}</span>`)
    }
  })

  it('a market only ever rising reads bullish on every row and in the bias', () => {
    const html = renderWindow(ladder(rising))
    expect((html.match(/is-bullish/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('data-bias="bullish"')
    expect(html).toContain('5/5 trending')
    expect(html).toContain('>LIVE</span>')
  })

  it('a market only ever falling reads bearish', () => {
    const html = renderWindow(ladder(falling))
    expect(html).toContain('data-bias="bearish"')
    expect(html).toContain('BEARISH')
  })

  it('an unfed rung says no data instead of inventing a reading, and the window says degraded', () => {
    const rows = ladder(rising).map((row) =>
      row.resolution === '1h' ? { ...row, candles: [], state: 'offline' as const } : row,
    )
    const html = renderWindow(rows)
    expect(html).toContain('no data')
    expect(html).toContain('data-bias="bullish"')
    expect(html).toContain('4/5 trending')
    expect(html).toContain('DEGRADED')
    expect(html).toContain('1 unfed')
  })

  it('a short feed warms up honestly instead of quoting a half-period RSI', () => {
    const rows = ladder(rising).map((row) =>
      row.resolution === '1m' ? { ...row, candles: rising(6) } : row,
    )
    const html = renderWindow(rows)
    expect(html).toContain('>warming</span>')
  })

  it('the minimized window is one line: bias and trending count', () => {
    window.localStorage.setItem('atlas.v1.mtf-rsi-min', 'true')
    const html = renderWindow(ladder(rising))
    expect(html).toContain('is-minimized')
    expect(html).toContain('mtf-rsi-min-trend')
    expect(html).not.toContain('mtf-rsi-rows')
    window.localStorage.removeItem('atlas.v1.mtf-rsi-min')
  })

  it('offers the methodology behind the call, one click away', () => {
    const html = renderWindow(ladder(rising))
    expect(html).toContain('aria-label="How the tendency is determined"')
    expect(html).toContain('tendency from ADX + efficiency + slope')
  })
})
