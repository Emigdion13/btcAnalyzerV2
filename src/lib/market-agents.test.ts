import { describe, expect, it } from 'vitest'
import { OrderBook, PERSISTENCE_SECONDS } from '../../shared/order-book'
import {
  analyzeMarket,
  defaultAgentLearningState,
  learnFromOutcome,
  type AgentId,
  type ContextSignal,
} from './market-agents'
import type { Candle } from './types'

function buildBook(
  mid: number,
  options: { strongSupport?: boolean; strongResistance?: boolean } = {},
) {
  const { strongSupport = false, strongResistance = false } = options
  const book = new OrderBook('BTC-USD')
  const bids: { price: number; size: number }[] = []
  const asks: { price: number; size: number }[] = []
  for (let i = 1; i <= 180; i++) {
    bids.push({ price: mid - i * 0.05, size: 1 + (i % 5) * 0.15 })
    asks.push({ price: mid + i * 0.05, size: 1 + (i % 4) * 0.12 })
  }
  if (strongSupport)
    for (let i = 0; i < 5; i++) bids.push({ price: mid - 1.25 + i * 0.01, size: 18 })
  if (strongResistance)
    for (let i = 0; i < 5; i++) asks.push({ price: mid + 0.55 + i * 0.01, size: 22 })
  else for (let i = 0; i < 5; i++) asks.push({ price: mid + 1.55 + i * 0.01, size: 8 })
  book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
  return book.view(1060)
}

function bullishTrendCandles(count = 260): Candle[] {
  const candles: Candle[] = []
  let price = 100
  for (let i = 0; i < count; i++) {
    const drift = 0.35 + (i % 7) * 0.03
    const wave = Math.sin(i / 6) * 0.18
    const open = price
    const close = price + drift + wave
    const high = Math.max(open, close) + 0.22
    const low = Math.min(open, close) - 0.18
    candles.push({ time: i * 60, open, high, low, close, volume: 1000 + i * 4 })
    price = close
  }
  return candles
}

function rangeNearResistanceCandles(count = 260): Candle[] {
  const candles: Candle[] = []
  let previousClose = 100
  for (let i = 0; i < count; i++) {
    const swing = Math.sin(i / 7) * 2.4
    const drift = i > 220 ? 0.015 * (i - 220) : 0
    const center = 100 + swing + drift
    const close = i > 248 ? 102.15 + Math.sin(i / 2) * 0.08 : center
    const open = previousClose
    const high = Math.max(open, close) + 0.32
    const low = Math.min(open, close) - 0.32
    candles.push({ time: i * 60, open, high, low, close, volume: 860 + ((i * 19) % 110) })
    previousClose = close
  }
  return candles
}

function opinion(result: ReturnType<typeof analyzeMarket>, id: AgentId) {
  const found = result.agents.find((entry) => entry.id === id)
  expect(found).toBeDefined()
  return found!
}

describe('market agents', () => {
  it('recognizes a bullish trend when regime, trend, and momentum align', () => {
    const candles = bullishTrendCandles()
    const result = analyzeMarket({
      candles,
      timeframe: '1m',
      book: buildBook(candles[candles.length - 1].close, { strongSupport: true }),
    })

    expect(result.regime).toBe('trend-up')
    expect(result.bias).toBe('bullish')
    expect(result.confidence).toBeGreaterThan(0.7)
    expect(opinion(result, 'trend').bias).toBe('bullish')
    expect(opinion(result, 'momentum').bias).toBe('bullish')
    expect(opinion(result, 'ensemble').score).toBeGreaterThan(0.35)
  })

  it('lets level-strength and structure override bullish internals near strong resistance', () => {
    const candles = rangeNearResistanceCandles()
    const result = analyzeMarket({
      candles,
      timeframe: '5m',
      book: buildBook(candles[candles.length - 1].close, { strongResistance: true }),
    })

    expect(result.regime).toBe('range')
    expect(result.bias).toBe('bearish')
    expect(result.summary.nearestResistance).not.toBeNull()
    expect(result.summary.nearestResistance!.distanceAtr).toBeLessThan(1)
    expect(opinion(result, 'trend').bias).toBe('bullish')
    expect(opinion(result, 'level-strength').bias).toBe('bearish')
    expect(opinion(result, 'structure').bias).toBe('bearish')
    expect(result.risks).toContain('A strong resistance level is very close above price.')
  })

  it('lets higher-timeframe context directly pull the ensemble away from a conflicting chart setup', () => {
    const candles = bullishTrendCandles()
    const plain = analyzeMarket({ candles, timeframe: '5m' })
    const bearishContext: ContextSignal[] = [
      {
        timeframe: '15m',
        bias: 'bearish',
        score: -0.92,
        confidence: 0.88,
        regime: 'trend-down',
      },
      {
        timeframe: '1h',
        bias: 'bearish',
        score: -0.82,
        confidence: 0.84,
        regime: 'breakdown',
      },
    ]
    const contextual = analyzeMarket({ candles, timeframe: '5m', context: bearishContext })

    expect(opinion(contextual, 'context').bias).toBe('bearish')
    expect(contextual.score).toBeLessThan(plain.score)
    expect(contextual.confidence).toBeLessThan(plain.confidence)
    expect(Number(opinion(contextual, 'ensemble').metrics.contextAlignment ?? 0)).toBeLessThan(0)
  })

  it('updates agent learning conservatively from resolved outcomes', () => {
    const candles = bullishTrendCandles()
    const result = analyzeMarket({ candles, timeframe: '1m' })

    const rewarded = learnFromOutcome(defaultAgentLearningState(), result.learningRecord, {
      move: 0.01,
    })
    expect(rewarded.agents.trend?.overall.skill ?? 0).toBeGreaterThan(0.5)
    expect(rewarded.agents.ensemble?.overall.skill ?? 0).toBeGreaterThan(0.5)

    const penalized = learnFromOutcome(defaultAgentLearningState(), result.learningRecord, {
      move: -0.01,
    })
    expect(penalized.agents.trend?.overall.skill ?? 1).toBeLessThan(0.5)
    expect(penalized.agents.ensemble?.overall.skill ?? 1).toBeLessThan(0.5)
  })
})
