import { describe, expect, it } from 'vitest'
import { ASSETS, INTERVAL, TIMEFRAMES, formatPrice, generateCandles } from './market'

describe('synthetic OHLCV feed', () => {
  it('is deterministic and ends at the reference quote', () => {
    const first = generateCandles(ASSETS[0], '1h')
    expect(first).toEqual(generateCandles(ASSETS[0], '1h'))
    expect(first).toHaveLength(900)
    expect(first.at(-1)!.close).toBeCloseTo(ASSETS[0].price, 8)
  })
  it.each(TIMEFRAMES)('produces valid, strictly ordered %s candles', (timeframe) => {
    const candles = generateCandles(ASSETS[0], timeframe)
    for (const [index, candle] of candles.entries()) {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close))
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close))
      expect(candle.low).toBeGreaterThan(0)
      expect(candle.volume).toBeGreaterThan(0)
      expect(Object.values(candle).every(Number.isFinite)).toBe(true)
      if (index) expect(candle.time - candles[index - 1].time).toBe(INTERVAL[timeframe])
    }
  })
  it.each(ASSETS)('scales prices for $ticker', (asset) => {
    const data = generateCandles(asset, '1h', 120)
    expect(data.at(-1)!.close).toBeCloseTo(asset.price, 8)
    expect(data.every((c) => c.close > 0 && Number.isFinite(c.close))).toBe(true)
  })
  it('formats high and sub-dollar prices without losing the relevant precision', () => {
    expect(formatPrice(67432.8)).toBe('67,432.80')
    expect(formatPrice(0.16482)).toBe('0.16482')
    expect(formatPrice(3521.64, true)).toBe('$3,521.64')
  })
})
