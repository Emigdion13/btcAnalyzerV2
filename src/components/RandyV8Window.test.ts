// @vitest-environment jsdom
/**
 * The floating Randy V8.10 window, rendered for real: the Target field, the final call and the
 * Pine table's readouts. It must say what it knows and what it does not — a feed that has not
 * answered reads "loading", never a scored zero, and an empty Target asks for one.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { bucketStart } from '../../shared/coinbase'
import { RandyV8Window } from './RandyV8Window'
import type { RandyV8WindowProps } from './RandyV8Window'
import { calculateRandyV8 } from '../lib/randy-v8'
import { RANDY_V8_DEFAULTS, type Candle, type Timeframe } from '../lib/types'

const START = 1_767_571_200

function market(count: number): Candle[] {
  let a = 5
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let price = 100_000
  return Array.from({ length: count }, (_, i) => {
    const open = price
    price = open + 2 + (random() - 0.5) * 60
    return {
      time: START + i * 60,
      open,
      high: Math.max(open, price) + random() * 20,
      low: Math.min(open, price) - random() * 20,
      close: price,
      volume: 5 + random() * 10,
    }
  })
}

function aggregate(candles: Candle[], timeframe: Timeframe): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const time = bucketStart(c.time, timeframe)
    const last = out[out.length - 1]
    if (last && last.time === time) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else out.push({ ...c, time })
  }
  return out
}

const candles = market(1200)
const feeds = {
  '5m': { candles: aggregate(candles, '5m') },
  '15m': { candles: aggregate(candles, '15m') },
  '1h': { candles: aggregate(candles, '1h') },
}
const lastClose = candles[candles.length - 1]!.close

function props(overrides: Partial<RandyV8WindowProps> = {}): RandyV8WindowProps {
  const settings = { ...RANDY_V8_DEFAULTS, target: Math.round(lastClose - 100) }
  return {
    ticker: 'BTC-USD',
    source: 'coinbase',
    timeframe: '1m',
    settings,
    result: calculateRandyV8(candles, settings, { timeframe: '1m', timeframes: feeds }),
    feedState: 'live',
    hasIndicator: true,
    kalshiStrike: null,
    onAddIndicator: () => {},
    onTargetChange: () => {},
    onClose: () => {},
    ...overrides,
  }
}

const render = (overrides: Partial<RandyV8WindowProps> = {}) =>
  renderToStaticMarkup(createElement(RandyV8Window, props(overrides)))

describe('RandyV8Window', () => {
  it('renders the target field, the call and every readout of the Pine table', () => {
    const html = render()
    expect(html).toContain('data-testid="randy-v8-window"')
    expect(html).toContain('RANDY V8.10')
    expect(html).toContain('data-testid="randy-v8-decision"')
    expect(html).toContain('aria-label="Target Kalshi / to beat"')
    for (const label of [
      'TIME',
      'DIRECTION',
      'TARGET METER',
      'STRENGTH',
      '1M + 5M',
      'STAGE',
      'MAP 1H/15M',
      'REASON',
    ]) {
      expect(html).toContain(`>${label}</dt>`)
    }
    expect(html).toMatch(/UP \d+% \| DOWN \d+%/)
    expect(html).toContain('>1M LIVE</span>')
  })

  it('keeps the Pine wording in the tooltips and calls the meter an estimate', () => {
    const html = render()
    expect(html).toContain('Pine DIRECCION')
    expect(html).toContain('Pine RAZON')
    expect(html).toContain('not Kalshi’s price')
  })

  it('asks for a target before it calls anything', () => {
    const settings = { ...RANDY_V8_DEFAULTS, target: 0 }
    const result = calculateRandyV8(candles, settings, { timeframe: '1m', timeframes: feeds })
    const html = render({ settings, result })
    expect(html).toContain('ENTER A TARGET')
    expect(html).toContain('REVIEW TARGET')
    expect(html).toContain('data-decision="review-target"')
  })

  it('shows the distance to a valid target', () => {
    const html = render()
    expect(html).toMatch(/\$[\d,.]+ \| \+\$[\d,.]+/)
  })

  it('says a missing feed instead of scoring against nothing', () => {
    const settings = { ...RANDY_V8_DEFAULTS, target: 100_000 }
    const result = calculateRandyV8(candles, settings, {
      timeframe: '1m',
      timeframes: { '5m': feeds['5m'] },
    })
    const html = render({ settings, result, feedState: 'offline' })
    expect(html).toContain('15m / 1h feed loading…')
    expect(html).toContain('data-decision="waiting"')
    expect(html).toContain('DEGRADED')
  })

  it('tells the trader the engine is tuned for a 1m chart, and labels demo data', () => {
    expect(render({ timeframe: '5m' })).toContain('>USE 1M</span>')
    expect(render({ source: 'demo' })).toContain('>SYNTH</span>')
  })

  it('offers the indicator when the chart has none to borrow a profile from', () => {
    expect(render({ hasIndicator: false })).toContain(
      'aria-label="Add the Randy V8.10 lines to the chart"',
    )
    expect(render()).not.toContain('Add the Randy V8.10 lines')
  })

  it('offers Kalshi’s strike only when it differs from the typed Target', () => {
    const typed = props().settings.target
    expect(render({ kalshiStrike: typed + 25 })).toContain('>KALSHI</button>')
    expect(render({ kalshiStrike: typed })).not.toContain('>KALSHI</button>')
    expect(render({ kalshiStrike: null })).not.toContain('>KALSHI</button>')
  })
})
