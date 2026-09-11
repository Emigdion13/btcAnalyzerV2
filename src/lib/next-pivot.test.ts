import { describe, expect, it } from 'vitest'
import { calculateNextPivot, isNextPivotSettings } from './next-pivot'
import { NEXT_PIVOT_DEFAULTS } from './types'
import type { Candle } from './types'

function synthCandles(n: number, seed = 42): Candle[] {
  // A deterministic synthetic series with embedded patterns: a noisy sine wave
  // around a slow trend so pattern-matching can find plausible matches.
  const candles: Candle[] = []
  let price = 100
  let s = seed
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  for (let i = 0; i < n; i++) {
    const t = i / 10
    const wave = Math.sin(t) * 2
    const drift = i * 0.02
    const noise = (rand() - 0.5) * 0.8
    const close = price + wave + drift + noise
    candles.push({
      time: i * 3600,
      open: price,
      high: close + Math.abs(rand() * 0.8),
      low: close - Math.abs(rand() * 0.8),
      close,
      volume: 1000 + rand() * 500,
    })
    price = close
  }
  return candles
}

describe('isNextPivotSettings', () => {
  it('accepts the published defaults', () => {
    expect(isNextPivotSettings(NEXT_PIVOT_DEFAULTS)).toBe(true)
  })
  it('rejects bogus values', () => {
    expect(isNextPivotSettings({ ...NEXT_PIVOT_DEFAULTS, correlationLength: 1 })).toBe(false)
    expect(isNextPivotSettings({ ...NEXT_PIVOT_DEFAULTS, barsBack: 10 })).toBe(false)
    expect(isNextPivotSettings(null)).toBe(false)
  })
})

describe('calculateNextPivot', () => {
  it('returns an empty forecast when not enough bars', () => {
    const c = synthCandles(30)
    const res = calculateNextPivot(c, NEXT_PIVOT_DEFAULTS, 3600)
    expect(res.forecast).toHaveLength(0)
    expect(res.bestStart).toBeNull()
  })

  it('produces a forecast of the requested length with reasonable bounds', () => {
    const c = synthCandles(1000)
    const res = calculateNextPivot(c, NEXT_PIVOT_DEFAULTS, 3600)
    expect(res.forecast.length).toBe(NEXT_PIVOT_DEFAULTS.forecastLength)
    expect(res.bestStart).not.toBeNull()
    expect(res.bestMid).not.toBeNull()
    expect(res.bestEnd).not.toBeNull()
    expect(res.topMatches.length).toBeGreaterThanOrEqual(1)
    expect(res.topMatches.length).toBeLessThanOrEqual(NEXT_PIVOT_DEFAULTS.ensembleTopK)
    // Forecast prices should be finite and positive.
    for (const p of res.forecast) {
      expect(Number.isFinite(p.price)).toBe(true)
      expect(p.price).toBeGreaterThan(0)
      expect(p.upper).toBeGreaterThanOrEqual(p.price)
      expect(p.lower).toBeLessThanOrEqual(p.price)
    }
    // Forecast timestamps should be strictly increasing past the last candle.
    for (let i = 1; i < res.forecast.length; i++) {
      expect(res.forecast[i].time).toBeGreaterThan(res.forecast[i - 1].time)
    }
    // Similarity score of cosine should lie in [-1, 1] for z-normalized inputs.
    expect(res.info!.similarity).toBeGreaterThanOrEqual(-1.0001)
    expect(res.info!.similarity).toBeLessThanOrEqual(1.0001)
    expect(res.info!.method).toBe('Cosine Similarity')
  })

  it('supports every similarity method without crashing', () => {
    const c = synthCandles(600)
    const methods = ['cosine', 'pearson', 'spearman', 'euclidean', 'mse', 'kendall', 'dtw'] as const
    for (const m of methods) {
      const res = calculateNextPivot(
        c,
        { ...NEXT_PIVOT_DEFAULTS, similarity: m, barsBack: 500 },
        3600,
      )
      expect(res.forecast.length).toBe(NEXT_PIVOT_DEFAULTS.forecastLength)
      expect(res.topMatches.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('supports %Change source', () => {
    const c = synthCandles(1000)
    const res = calculateNextPivot(
      c,
      { ...NEXT_PIVOT_DEFAULTS, source: 'pctChange' },
      3600,
    )
    expect(res.forecast).toHaveLength(NEXT_PIVOT_DEFAULTS.forecastLength)
  })
})
