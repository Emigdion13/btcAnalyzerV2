import { describe, expect, it } from 'vitest'
import type { WhaleFlow } from '../../shared/coinbase'
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

function bearishTrendCandles(count = 260): Candle[] {
  const candles: Candle[] = []
  let price = 200
  for (let i = 0; i < count; i++) {
    const drift = 0.35 + (i % 7) * 0.03
    const wave = Math.sin(i / 6) * 0.18
    const open = price
    const close = price - drift + wave
    const high = Math.max(open, close) + 0.18
    const low = Math.min(open, close) - 0.22
    candles.push({ time: i * 60, open, high, low, close, volume: 1000 + i * 4 })
    price = close
  }
  return candles
}

function whaleFlow(overrides: Partial<WhaleFlow> = {}): WhaleFlow {
  return {
    product: 'BTC-USD',
    phase: 'active',
    net: 500_000,
    bought: 500_000,
    sold: 0,
    count: 9,
    threshold: 250_000,
    windowSeconds: 5,
    intensity: 2,
    prints: [],
    calibrated: true,
    sampled: 1200,
    ...overrides,
  }
}

function strikeInput(overrides: Record<string, number | string | boolean> = {}) {
  return {
    price: 205,
    windowStart: 0,
    windowEnd: 900,
    secondsLeft: 300,
    expiryLabel: '9:15',
    provisional: false,
    ...overrides,
  }
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

  it('lets the MACD specialist read trend turns in MACD-native units', () => {
    const bearish = analyzeMarket({ candles: bearishTrendCandles(), timeframe: '1m' })
    const bearishMacd = opinion(bearish, 'macd')
    expect(bearishMacd.bias).toBe('bearish')
    expect(bearishMacd.score).toBeLessThan(-0.15)
    expect(Number(bearishMacd.metrics.zeroRegime ?? 0)).toBeLessThan(0)
    expect(bearishMacd.reasons.join(' ')).toContain('zero line')

    // A histogram dip inside a strong uptrend is a pause, not a reversal: the zero-line
    // regime anchors the call instead of letting the wiggle scream.
    const bullish = analyzeMarket({ candles: bullishTrendCandles(), timeframe: '1m' })
    const bullishMacd = opinion(bullish, 'macd')
    expect(Number(bullishMacd.metrics.zeroRegime ?? 0)).toBeGreaterThan(0.5)
    expect(Math.abs(bullishMacd.score)).toBeLessThan(0.45)
    expect(bullishMacd.warnings.join(' ')).toContain('pause, not a reversal')
  })

  it('keeps the MACD specialist honest while its EMAs warm up', () => {
    const result = analyzeMarket({ candles: bullishTrendCandles(30), timeframe: '1m' })
    const macd = opinion(result, 'macd')
    expect(macd.bias).toBe('neutral')
    expect(macd.score).toBe(0)
    expect(macd.reasons[0]).toContain('warming up')
  })

  it('lets a live whale sweep push the ensemble toward its own direction', () => {
    const candles = bullishTrendCandles()
    const plain = analyzeMarket({ candles, timeframe: '5m' })
    expect(plain.agents.some((agent) => agent.id === 'whale')).toBe(false)

    const swept = analyzeMarket({
      candles,
      timeframe: '5m',
      whale: whaleFlow({ net: -1_200_000, bought: 50_000, sold: 1_250_000, intensity: 3.4 }),
    })
    const whale = opinion(swept, 'whale')
    expect(whale.bias).toBe('bearish')
    expect(whale.score).toBeLessThan(-0.5)
    expect(whale.metrics.tier).toBe('extreme $1M+')
    expect(whale.reasons[0]).toContain('-$1.20M push out of BTC')
    expect(whale.reasons[0]).toContain('hitting the bid')
    // The sweep leans a bullish chart setup back toward caution.
    expect(swept.score).toBeLessThan(plain.score)
    expect(swept.confidence).toBeLessThan(plain.confidence)
  })

  it('scales whale conviction by size, phase, and one-sidedness', () => {
    const candles = bullishTrendCandles()
    const active = opinion(analyzeMarket({ candles, timeframe: '1m', whale: whaleFlow() }), 'whale')
    expect(active.bias).toBe('bullish')
    expect(active.score).toBeGreaterThan(0.4)
    expect(active.reasons[0]).toContain('+$500K push into BTC')
    expect(active.reasons[0]).toContain('lifting the offer')

    const fading = opinion(
      analyzeMarket({ candles, timeframe: '1m', whale: whaleFlow({ phase: 'fading' }) }),
      'whale',
    )
    expect(fading.score).toBeLessThan(active.score)
    expect(fading.warnings.join(' ')).toContain('already be in the price')

    const building = opinion(
      analyzeMarket({
        candles,
        timeframe: '1m',
        whale: whaleFlow({
          phase: 'building',
          net: 12_000,
          bought: 12_000,
          sold: 0,
          intensity: 0.48,
        }),
      }),
      'whale',
    )
    expect(building.score).toBeGreaterThan(0)
    expect(building.score).toBeLessThan(active.score)

    const twoSided = opinion(
      analyzeMarket({
        candles,
        timeframe: '1m',
        whale: whaleFlow({ net: 120_000, bought: 260_000, sold: 140_000, intensity: 1.1 }),
      }),
      'whale',
    )
    expect(twoSided.warnings.join(' ')).toContain('two-sided')

    const provisional = opinion(
      analyzeMarket({ candles, timeframe: '1m', whale: whaleFlow({ calibrated: false }) }),
      'whale',
    )
    expect(provisional.warnings.join(' ')).toContain('calibrating')
    expect(provisional.confidence).toBeLessThan(active.confidence)
  })

  it('frames the verdict as the UP/DOWN window call against the strike', () => {
    const candles = bullishTrendCandles()
    const close = candles[candles.length - 1].close
    const holding = analyzeMarket({ candles, timeframe: '5m', strike: strikeInput({ price: close - 5 }) })
    expect(holding.summary.strike?.side).toBe('above')
    expect(holding.summary.strike?.delta).toBeCloseTo(5, 6)
    expect(holding.reasons[0]).toContain('above the')
    expect(holding.reasons[0]).toContain('strike with 5:00 to the 9:15 cut')
    expect(holding.reasons.join(' ')).toContain('hold-the-lead')

    const crossing = analyzeMarket({ candles, timeframe: '5m', strike: strikeInput({ price: close + 5 }) })
    expect(crossing.summary.strike?.side).toBe('below')
    expect(crossing.risks.join(' ')).toContain('needs price to cross')
  })

  it('hands the window call to the fast readers as the cut approaches', () => {
    const candles = bullishTrendCandles()
    const close = candles[candles.length - 1].close
    const base = {
      candles,
      timeframe: '5m' as const,
      // Fast money disagrees with the slow advisors: whale sweep down, HTF still up.
      whale: whaleFlow({ net: -800_000, bought: 40_000, sold: 840_000, intensity: 2.6 }),
      context: [
        { timeframe: '15m' as const, bias: 'bullish' as const, score: 0.6, confidence: 0.7, regime: 'trend-up' as const },
      ],
    }
    const early = analyzeMarket({ ...base, strike: strikeInput({ price: close - 5, secondsLeft: 870 }) })
    const late = analyzeMarket({ ...base, strike: strikeInput({ price: close - 5, secondsLeft: 30 }) })
    const urgency = Number(opinion(late, 'ensemble').metrics.urgency ?? 0)
    expect(urgency).toBeCloseTo(1 - 30 / 900, 6)
    // Same tape, less clock: the bearish sweep outweighs the bullish context.
    expect(late.score).toBeLessThan(early.score)
    expect(late.reasons.join(' ')).toContain('Under a minute')
  })

  it('stays honest about coarse charts and coin-flip finishes', () => {
    const candles = bullishTrendCandles()
    const close = candles[candles.length - 1].close
    const hourly = analyzeMarket({ candles, timeframe: '1h', strike: strikeInput({ price: close - 5 }) })
    expect(hourly.risks.join(' ')).toContain('1h candles for a 15-minute expiry')

    const coinFlip = analyzeMarket({
      candles,
      timeframe: '1m',
      strike: strikeInput({ price: close + 5, secondsLeft: 20 }),
    })
    expect(coinFlip.risks.join(' ')).toContain('close to a coin flip')
  })

  it('reacts to whale sweeps from $50K up', () => {
    const candles = bullishTrendCandles()
    const notable = opinion(
      analyzeMarket({
        candles,
        timeframe: '1m',
        whale: whaleFlow({ net: 75_000, bought: 75_000, sold: 0, intensity: 1.2 }),
      }),
      'whale',
    )
    expect(notable.metrics.tier).toBe('notable $50K+')
    expect(notable.score).toBeGreaterThan(0.35)

    const small = opinion(
      analyzeMarket({
        candles,
        timeframe: '1m',
        whale: whaleFlow({ phase: 'building', net: 20_000, bought: 20_000, sold: 0, intensity: 0.5 }),
      }),
      'whale',
    )
    expect(small.metrics.tier).toBe('below the $50K whale line')
    expect(small.score).toBeLessThan(notable.score)
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
