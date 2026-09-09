import { describe, expect, it } from 'vitest'
import {
  agentContextTimeframes,
  defaultAgentPredictionJournal,
  horizonChoices,
  journalStats,
  recordAgentPrediction,
  resolveAgentPredictionJournal,
  suggestedHorizonBars,
} from './agent-journal'
import { analyzeMarket, defaultAgentLearningState } from './market-agents'
import type { Candle } from './types'

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

const WINDOW_START = Date.UTC(2026, 8, 8, 9, 0, 0) / 1000
const WINDOW_END = WINDOW_START + 900

/** 1-minute candles straddling the 9:00 window, gently rising. */
function windowCandles(beforeMin = 35, afterMin = 20): Candle[] {
  const candles: Candle[] = []
  let price = 100
  for (let m = -beforeMin; m <= afterMin; m++) {
    const open = price
    const close = price + 0.05
    candles.push({
      time: WINDOW_START + m * 60,
      open,
      high: close + 0.01,
      low: open - 0.01,
      close,
      volume: 100,
    })
    price = close
  }
  return candles
}

const windowStrike = { price: 100 + 35 * 0.05, windowStart: WINDOW_START, windowEnd: WINDOW_END }

describe('agent journal', () => {
  it('maps chart timeframes to higher-timeframe context and horizons', () => {
    expect(agentContextTimeframes('1m')).toEqual(['5m', '15m'])
    expect(agentContextTimeframes('15m')).toEqual(['1h', '4h'])
    expect(agentContextTimeframes('1W')).toEqual([])
    expect(suggestedHorizonBars('1m')).toBe(8)
    expect(suggestedHorizonBars('4h')).toBe(3)
    expect(horizonChoices('1m')).toEqual([4, 8, 16])
  })

  it('records one prediction per closed candle and avoids duplicates', () => {
    const candles = bullishTrendCandles(240)
    const analysis = analyzeMarket({ candles, timeframe: '1m' })
    const start = defaultAgentPredictionJournal()
    const next = recordAgentPrediction(start, {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles,
      analysis,
    })
    expect(next.entries).toHaveLength(1)
    const duplicate = recordAgentPrediction(next, {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles,
      analysis,
    })
    expect(duplicate.entries).toHaveLength(1)
    expect(duplicate.entries[0].targetTime).toBe(
      candles[candles.length - 1].time + 8 * 60,
    )
  })

  it('records the window call with the strike in and the cut as the target', () => {
    const candles = windowCandles(35, 10)
    const analysis = analyzeMarket({ candles, timeframe: '1m' })
    const params = {
      source: 'demo' as const,
      symbol: 'BTCUSDT',
      timeframe: '1m' as const,
      candles,
      analysis,
      strike: windowStrike,
    }
    const recorded = recordAgentPrediction(defaultAgentPredictionJournal(), params)
    expect(recorded.entries).toHaveLength(1)
    expect(recorded.entries[0]).toMatchObject({
      mode: 'window',
      entryPrice: windowStrike.price,
      strike: windowStrike.price,
      windowStart: WINDOW_START,
      targetTime: WINDOW_END,
      horizonBars: 0,
    })
    // One entry per window, however many candles close inside it.
    const laterCandles = windowCandles(35, 12)
    const later = recordAgentPrediction(recorded, {
      ...params,
      candles: laterCandles,
      analysis: analyzeMarket({ candles: laterCandles, timeframe: '1m' }),
    })
    expect(later.entries).toHaveLength(1)
  })

  it('settles window entries UP/DOWN from the strike at the cut', () => {
    const entryCandles = windowCandles(35, 10)
    const analysis = analyzeMarket({ candles: entryCandles, timeframe: '1m' })
    const recorded = recordAgentPrediction(defaultAgentPredictionJournal(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles: entryCandles,
      analysis,
      strike: windowStrike,
    })
    // Mid-window prints never settle the window.
    const pending = resolveAgentPredictionJournal(recorded, defaultAgentLearningState(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles: entryCandles,
    })
    expect(pending.resolved).toHaveLength(0)

    const futureCandles = windowCandles(35, 20)
    const resolved = resolveAgentPredictionJournal(recorded, defaultAgentLearningState(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles: futureCandles,
    })
    expect(resolved.resolved).toHaveLength(1)
    const entry = resolved.journal.entries[0]
    // The final print of the window: close of the 9:14 candle.
    expect(entry.resolvedPrice).toBeCloseTo(100 + 35 * 0.05 + 15 * 0.05, 6)
    expect(entry.actualBias).toBe('bullish')
    expect(entry.result).toBe(entry.bias === 'bullish' ? 'correct' : 'wrong')
    expect(resolved.learning.agents.ensemble?.overall.samples).toBe(1)
  })

  it('keeps bars-mode forecasts on timeframes too coarse for the window', () => {
    const candles = bullishTrendCandles(240)
    const analysis = analyzeMarket({ candles, timeframe: '1h' })
    const recorded = recordAgentPrediction(defaultAgentPredictionJournal(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      candles,
      analysis,
      strike: windowStrike,
    })
    expect(recorded.entries[0].mode).toBe('bars')
    expect(recorded.entries[0].entryPrice).toBe(candles[candles.length - 1].close)
  })

  it('settles predictions and updates learning from the realized move', () => {
    const entryCandles = bullishTrendCandles(240)
    const analysis = analyzeMarket({ candles: entryCandles, timeframe: '1m' })
    const recorded = recordAgentPrediction(defaultAgentPredictionJournal(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles: entryCandles,
      analysis,
    })
    const futureCandles = bullishTrendCandles(260)
    const resolved = resolveAgentPredictionJournal(recorded, defaultAgentLearningState(), {
      source: 'demo',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      candles: futureCandles,
    })
    expect(resolved.resolved).toHaveLength(1)
    expect(resolved.journal.entries[0].resolvedAt).toBeTruthy()
    expect(resolved.journal.entries[0].actualBias).toBe('bullish')
    expect(resolved.journal.entries[0].result).toBe('correct')
    expect(resolved.learning.agents.ensemble?.overall.samples).toBe(1)
    expect((resolved.learning.agents.ensemble?.overall.skill ?? 0)).toBeGreaterThan(0.5)
    expect(journalStats(resolved.journal)).toMatchObject({
      total: 1,
      pending: 0,
      resolved: 1,
      correct: 1,
    })
  })
})
