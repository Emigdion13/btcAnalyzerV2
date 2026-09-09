import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentDecisionBox } from './AgentDecisionBox'
import type { MarketAnalysis } from '../lib/market-agents'

// Pin the window open so the expanded body (strike strip included) renders.
vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>()
  return { ...actual, useLocalState: () => [false, () => {}] }
})

const sampleAnalysis: MarketAnalysis = {
  bias: 'bullish',
  confidence: 0.75,
  score: 0.5,
  regime: 'trend-up',
  reasons: ['Strong upward momentum across timeframes.'],
  risks: ['Approaching resistance level.'],
  summary: {
    currentPrice: 90000,
    atr: 500,
    nearestSupport: {
      price: 88000,
      top: 88200,
      bottom: 87800,
      source: 'pivot',
      strength: 0.6,
      distanceAtr: 4,
      touches: 3,
    },
    nearestResistance: {
      price: 92000,
      top: 92200,
      bottom: 91800,
      source: 'pivot',
      strength: 0.6,
      distanceAtr: 4,
      touches: 3,
    },
    strike: null,
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
      metrics: {},
    },
  ],
  learningRecord: {
    regime: 'trend-up',
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

  it('frames the verdict as UP/DOWN from the strike with a countdown', () => {
    const strikeAnalysis: MarketAnalysis = {
      ...sampleAnalysis,
      summary: {
        ...sampleAnalysis.summary,
        strike: {
          price: 89900,
          windowEnd: 1787329500,
          secondsLeft: 272,
          delta: 100,
          deltaAtr: 0.2,
          side: 'above',
          provisional: false,
        },
      },
    }
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '1m',
        analysis: strikeAnalysis,
        context: [],
        feedState: 'live',
        onOpenPanel: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    expect(markup).toContain('>UP<')
    expect(markup).toContain('4:32')
    expect(markup).not.toContain('Bullish')
  })

  it('renders the strike strip with side and countdown when expanded', () => {
    const strikeAnalysis: MarketAnalysis = {
      ...sampleAnalysis,
      summary: {
        ...sampleAnalysis.summary,
        strike: {
          price: 89900,
          windowEnd: 1787329500,
          secondsLeft: 272,
          delta: 100,
          deltaAtr: 0.2,
          side: 'above',
          provisional: false,
        },
      },
    }
    const markup = renderToStaticMarkup(
      createElement(AgentDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '1m',
        analysis: strikeAnalysis,
        context: [],
        feedState: 'live',
        onOpenPanel: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    expect(markup).toContain('ai-decision-strike')
    expect(markup).toContain('STRIKE')
    expect(markup).toContain('above')
    expect(markup).toContain('4:32')
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
