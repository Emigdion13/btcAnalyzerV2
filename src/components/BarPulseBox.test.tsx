import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarPulseBox } from './BarPulseBox'
import type { Candle } from '../lib/types'

const mk = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle => ({ time, open, high, low, close, volume })

function market(count = 60): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i / 5) * 0.8
    out.push(mk(i * 60, base, base + 0.25, base - 0.25, base + (i % 2 ? 0.1 : -0.1), 100 + (i % 3) * 10))
  }
  // The forming bar: one minute in, leaning up.
  out[count - 1] = mk((count - 1) * 60, 100, 100.3, 99.7, 100.2, 150)
  return out
}

const baseProps = {
  ticker: 'BTC',
  source: 'demo' as const,
  state: 'live' as const,
  candles: market(),
  interval: '1m' as const,
  price: 100.2,
  book: null,
  tape: null,
  upColor: '#2bb99b',
  downColor: '#ed6773',
  onClose: () => {},
}

describe('BarPulseBox', () => {
  it('renders the full live readout with every section', () => {
    const html = renderToStaticMarkup(createElement(BarPulseBox, baseProps))
    expect(html).toContain('CANDLE PULSE')
    expect(html).toContain('BAR CLOSES IN')
    expect(html).toContain('VOLUME PACE')
    expect(html).toContain('TAPE · THIS BAR')
    expect(html).toContain('DEFENSE GRID')
    expect(html).toContain('BAR TILT')
    expect(html).toContain('CONTEXT — NOT A SIGNAL')
  })
  it('labels the offline demo instead of faking tape', () => {
    const html = renderToStaticMarkup(createElement(BarPulseBox, baseProps))
    expect(html).toContain('NO TAPE IN OFFLINE DEMO')
  })
  it('shows the taker split when tape data is available', () => {
    const html = renderToStaticMarkup(
      createElement(BarPulseBox, { ...baseProps, tape: { time: 59 * 60, bought: 120000, sold: 80000 } }),
    )
    expect(html).not.toContain('NO TAPE IN OFFLINE DEMO')
    expect(html).toContain('pulse-tape-bar')
  })
  it('calibrates instead of guessing on a thin window', () => {
    const html = renderToStaticMarkup(
      createElement(BarPulseBox, { ...baseProps, candles: market(8) }),
    )
    expect(html).toContain('CALIBRATING')
  })
  it('renders the timeframe timing dropdown with chart option and all candle resolutions', () => {
    const html = renderToStaticMarkup(
      createElement(BarPulseBox, {
        ...baseProps,
        chartTimeframe: '15m',
        selectedInterval: 'chart',
      }),
    )
    expect(html).toContain('aria-label="Candle timeframe to analyze"')
    expect(html).toContain('Chart (15m)')
    expect(html).toContain('<option value="1m">1m</option>')
    expect(html).toContain('<option value="3m">3m</option>')
    expect(html).toContain('<option value="5m">5m</option>')
    expect(html).toContain('<option value="15m">15m</option>')
    expect(html).toContain('<option value="1h">1h</option>')
    expect(html).toContain('<option value="4h">4h</option>')
    expect(html).toContain('<option value="1D">1D</option>')
    expect(html).toContain('<option value="1W">1W</option>')
  })
  it('reflects selected timing in the dropdown', () => {
    const html = renderToStaticMarkup(
      createElement(BarPulseBox, {
        ...baseProps,
        interval: '5m',
        chartTimeframe: '15m',
        selectedInterval: '5m',
      }),
    )
    expect(html).toContain('BAR CLOSES IN · 5M')
    expect(html).toContain('value="5m" selected=""')
  })
})
