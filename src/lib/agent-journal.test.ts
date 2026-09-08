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
