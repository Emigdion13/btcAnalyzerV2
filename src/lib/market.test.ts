import { describe, expect, it } from 'vitest'
import {
  ASSETS,
  INTERVAL,
  METAL_ASSETS,
  METAL_DEFAULTS,
  TIMEFRAMES,
  formatPrice,
  generateCandles,
  getAsset,
  metalAsset,
  pricePrecision,
  venueForSymbol,
  venueLabel,
} from './market'
import { KALSHI_METAL_FEEDS } from '../../shared/kalshi'

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

describe('Kalshi metal metadata', () => {
  it("describes one asset per Kalshi metal feed, with the feed's own rounding", () => {
    expect(METAL_ASSETS.map((asset) => asset.symbol)).toEqual(['XAU-USD', 'XAG-USD'])
    expect(METAL_ASSETS.map((asset) => asset.symbol)).toEqual(METAL_DEFAULTS)
    for (const feed of KALSHI_METAL_FEEDS) {
      const asset = metalAsset(feed)
      expect(asset.ticker).toBe(feed.ticker)
      expect(asset.name).toBe(feed.name)
      expect(asset.category).toBe('Metals')
      expect(asset.quoteCurrency).toBe('USD')
      // The price scale reads this, so silver keeps the third decimal Kalshi rounds to.
      expect(asset.priceIncrement).toBeCloseTo(10 ** -feed.roundDigits, 10)
      // Nothing is invented: a metal has no synthetic price, volume or market cap.
      expect(Number.isNaN(asset.price)).toBe(true)
      expect(asset.volume).toBe('—')
      expect(asset.marketCap).toBe('—')
    }
  })

  it('resolves metals before the generic Coinbase fallback', () => {
    const gold = getAsset('XAU-USD')
    expect(gold.category).toBe('Metals')
    expect(gold.name).toBe('Gold')
    expect(gold.ticker).toBe('XAU')
    // Unknown products still fall back to a Coinbase-shaped asset rather than throwing.
    expect(getAsset('PEPE-USD').category).not.toBe('Metals')
  })

  it('reports the decimals Kalshi publishes, and none for other symbols', () => {
    expect(pricePrecision('XAU-USD')).toBe(2)
    expect(pricePrecision('XAG-USD')).toBe(3)
    expect(pricePrecision('BTC-USD')).toBeUndefined()
    expect(pricePrecision('BTCUSDT')).toBeUndefined()
  })

  it('separates the venue from the data source', () => {
    // The demo never claims a live venue, and a metal is never labelled Coinbase.
    expect(venueForSymbol('BTC-USD', 'demo')).toBe('demo')
    expect(venueForSymbol('XAU-USD', 'demo')).toBe('demo')
    expect(venueForSymbol('BTC-USD', 'coinbase')).toBe('coinbase')
    expect(venueForSymbol('XAU-USD', 'coinbase')).toBe('kalshi')
    expect(venueForSymbol('XAG-USD', 'coinbase')).toBe('kalshi')
    expect(venueLabel('kalshi')).toBe('Kalshi')
    expect(venueLabel('coinbase')).toBe('Coinbase')
    expect(venueLabel('demo')).toBe('Demo')
  })

  it('shows a settlement value at the precision it was rounded to', () => {
    const digits = pricePrecision('XAG-USD')
    expect(formatPrice(63.498, false, digits)).toBe('63.498')
    // The same number at the default two decimals would hide the published digit.
    expect(formatPrice(63.498)).toBe('63.50')
    expect(formatPrice(4300.16, false, pricePrecision('XAU-USD'))).toBe('4,300.16')
  })
})
