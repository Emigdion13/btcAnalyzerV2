import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentDecisionBox } from './AgentDecisionBox'
import { analyzeMarket, type StrikeInput } from '../lib/market-agents'
import type { Candle } from '../lib/types'

// Pin the window open so the expanded body (strike strip included) renders.
vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>()
  return { ...actual, useLocalState: () => [false, () => {}] }
})

/** A real analysis, so these tests exercise the same forecast the chart shows. */
function risingCandles(count = 220): Candle[] {
  const candles: Candle[] = []
  let price = 90000
  for (let i = 0; i < count; i++) {
    const drift = 34 + (i % 7) * 3
    const open = price
    const close = price + drift + Math.sin(i / 6) * 18
    candles.push({
      time: 1787328000 + i * 60,
      open,
      high: Math.max(open, close) + 22,
      low: Math.min(open, close) - 18,
      close,
      volume: 40 + i,
    })
    price = close
  }
  return candles
}

const tape = risingCandles()
const close = tape[tape.length - 1].close

function strike(price: number): StrikeInput {
  return {
    price,
    windowStart: tape[tape.length - 1].time - 300,
    windowEnd: tape[tape.length - 1].time + 272,
    secondsLeft: 272,
    expiryLabel: '9:15',
    provisional: false,
    label: '15m strike',
  }
}

const strikeAnalysis = analyzeMarket({
  candles: tape,
  timeframe: '1m',
  horizonBars: 10,
  strike: strike(close - 60),
})
const plainAnalysis = analyzeMarket({ candles: tape, timeframe: '1m', horizonBars: 10 })

const baseProps = {
  assetLabel: 'BTC-USD',
  source: 'coinbase' as const,
  context: [],
  onOpenPanel: vi.fn(),
  onClose: vi.fn(),
}

describe('AgentDecisionBox', () => {
  it('leads with the horizon forecast and keeps the panel one click away', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        ...baseProps,
        timeframe: '1m',
        analysis: strikeAnalysis,
        feedState: 'live',
      }),
    )
    expect(markup).toContain('AI forecast')
    expect(markup).toContain('ai-decision-open')
    // The call is a side of the strike with the probability attached, not a mood.
    expect(markup).toContain('Above strike')
    expect(markup).toContain('Finish')
    expect(markup).toContain('Drift')
    expect(markup).toContain('Horizon')
    expect(markup).toContain('10 bars')
    expect(markup).toContain('path')
    // The next thing the model expects, in order.
    expect(markup).toContain('Next:')
    expect(markup).not.toContain('Bullish')
  })

  it('renders the strike strip with the level, the side and the clock', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        ...baseProps,
        timeframe: '1m',
        analysis: strikeAnalysis,
        feedState: 'live',
      }),
    )
    expect(markup).toContain('ai-decision-strike')
    expect(markup).toContain('STRIKE')
    expect(markup).toContain('above')
    expect(markup).toContain('4:32')
    expect(markup).toContain('touch')
  })

  it('forecasts the drift when the chart has no strike line', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        ...baseProps,
        timeframe: '1m',
        analysis: plainAnalysis,
        feedState: 'live',
      }),
    )
    expect(markup).toContain('Higher')
    expect(markup).toContain('ATR')
    expect(markup).not.toContain('STRIKE')
  })

  it('dims rather than hides when the feed is not current', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        ...baseProps,
        timeframe: '1m',
        analysis: strikeAnalysis,
        feedState: 'stale',
      }),
    )
    expect(markup).toContain('is-stale')
  })

  it('renders the waiting state when no analysis is available', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        ...baseProps,
        timeframe: '15m',
        analysis: null,
        feedState: 'live',
      }),
    )
    expect(markup).toContain('ai-decision-open')
    expect(markup).toContain('30 candles')
  })
})
