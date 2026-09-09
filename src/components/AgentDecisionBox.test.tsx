import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentDecisionBox } from './AgentDecisionBox'
import type { MarketAnalysis } from '../lib/market-agents'

const sampleAnalysis: MarketAnalysis = {
  bias: 'bullish',
  confidence: 0.75,
  score: 0.5,
  regime: 'Bullish Trend',
  reasons: ['Strong upward momentum across timeframes.'],
  risks: ['Approaching resistance level.'],
  summary: {
    currentPrice: 90000,
    atr: 500,
    nearestSupport: { price: 88000, type: 'support', distanceAtr: 4 },
    nearestResistance: { price: 92000, type: 'resistance', distanceAtr: 4 },
  },
  agents: [
    {
      id: 'momentum',
      label: 'Momentum Agent',
      bias: 'bullish',
      confidence: 0.8,
      score: 0.6,
      reasons: ['RSI bullish'],
      warnings: [],
    },
  ],
  learningRecord: {
    regime: 'Bullish Trend',
    timeframe: '15m',
    agents: [{ id: 'momentum', bias: 'bullish', confidence: 0.8, score: 0.6 }],
    ensemble: { id: 'ensemble', bias: 'bullish', confidence: 0.75, score: 0.5 },
  },
}

describe('AgentDecisionBox', () => {
  it('renders Open full agents button when expanded with analysis', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '15m',
        analysis: sampleAnalysis,
        context: [],
        feedState: 'live',
        onOpenPanel: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    expect(markup).toContain('Open full agents')
    expect(markup).toContain('ai-decision-open')
  })

  it('renders Open full agents button when analysis is null (waiting for candles)', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '15m',
        analysis: null,
        context: [],
        feedState: 'live',
        onOpenPanel: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    expect(markup).toContain('Open full agents')
    expect(markup).toContain('ai-decision-open')
  })
})
