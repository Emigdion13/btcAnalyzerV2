import { describe, expect, it } from 'vitest'
import type { IRange, Logical } from 'lightweight-charts'
import { CLIP_FLOOR, WICK_CLIP, candleAutoscale, robustPriceRange } from './price-autoscale'
import type { Ohlc } from './price-autoscale'

/** A quiet bar of a ~$67k asset: 0.05% range, like a typical BTC 1m candle. */
const bar = (mid: number, wiggle = 35, body = 15): Ohlc => ({
  open: mid - body / 2,
  close: mid + body / 2,
  high: mid + wiggle,
  low: mid - wiggle,
})

const quietMarket = (count = 145, mid = 67_000): Ohlc[] => Array.from({ length: count }, () => bar(mid))

const window = (candles: Ohlc[]): [number, number] => [0, candles.length - 1]

describe('robustPriceRange', () => {
  it('keeps quiet candles tight around their bodies and normal wicks', () => {
    const candles = quietMarket()
    const range = robustPriceRange(candles, ...window(candles))!
    const lows = candles.map((c) => c.low)
    const highs = candles.map((c) => c.high)
    expect(range.minValue).toBeCloseTo(Math.min(...lows))
    expect(range.maxValue).toBeCloseTo(Math.max(...highs))
  })

  it('clips a glitch wick instead of stretching the scale to it', () => {
    const candles = quietMarket()
    // One bad print merged into a bar's high: 130k above a 67k market.
    candles[100] = { ...candles[100], high: 200_000 }
    const range = robustPriceRange(candles, ...window(candles))!
    const { open, close } = candles[100]
    // The glitch wick only reaches WICK_CLIP median ranges past its body…
    expect(range.maxValue).toBeLessThanOrEqual(Math.max(open, close) + WICK_CLIP * 70 + 1)
    // …which keeps the scale on the market, nowhere near the glitch.
    expect(range.maxValue).toBeLessThan(75_000)
  })

  it('clips a glitch low the same way', () => {
    const candles = quietMarket()
    candles[20] = { ...candles[20], low: 0.5 }
    const range = robustPriceRange(candles, ...window(candles))!
    const { open, close } = candles[20]
    expect(range.minValue).toBeGreaterThanOrEqual(Math.min(open, close) - WICK_CLIP * 70 - 1)
    expect(range.minValue).toBeGreaterThan(60_000)
  })

  it('never clips a genuinely large candle body', () => {
    const candles = quietMarket()
    // A real 3k crash bar — 100x the typical range — must fully set the scale.
    candles[100] = { open: 67_000, close: 64_000, high: 67_100, low: 63_800 }
    const range = robustPriceRange(candles, ...window(candles))!
    expect(range.minValue).toBeLessThanOrEqual(63_800)
    expect(range.maxValue).toBeGreaterThanOrEqual(67_100)
  })

  it('lets a real bar keep its own proportional wick', () => {
    const candles = quietMarket()
    // A volatile-but-real bar: wick 3x its body, body 40x the median range.
    candles[100] = { open: 67_000, close: 65_200, high: 68_400, low: 64_600 }
    const range = robustPriceRange(candles, ...window(candles))!
    // Bodies are never clipped, and the clip is >= WICK_CLIP * median range from
    // each body, so this bar's 1.4k wick (its own body is 1.8k) is fully in range.
    expect(range.maxValue).toBeGreaterThanOrEqual(68_400)
    expect(range.minValue).toBeLessThanOrEqual(64_600)
  })

  it('falls back to a small price-relative floor when the market is flat', () => {
    const candles = Array.from({ length: 20 }, () => ({
      open: 100,
      close: 100,
      high: 100,
      low: 100,
    }))
    candles[5] = { ...candles[5], high: 1_000 }
    const range = robustPriceRange(candles, ...window(candles))!
    const clip = Math.abs(100) * CLIP_FLOOR
    expect(range.maxValue).toBeLessThanOrEqual(100 + Math.max(WICK_CLIP * 0, clip) + 1)
    expect(range.maxValue).toBeLessThan(150)
  })

  it('clamps the requested window to the data and returns null when empty', () => {
    const candles = quietMarket(10)
    expect(robustPriceRange(candles, -50, 1_000)).toEqual(robustPriceRange(candles, 0, 9))
    expect(robustPriceRange(candles, 20, 30)).toBeNull()
    expect(robustPriceRange([], 0, 5)).toBeNull()
  })
})

describe('candleAutoscale provider', () => {
  const logicals = (candles: Ohlc[]): IRange<Logical> =>
    ({ from: 0, to: candles.length - 1 }) as unknown as IRange<Logical>
  const baseInfo = {
    priceRange: { minValue: -1_000_000, maxValue: 1_000_000 },
    margins: { above: 3, below: 4 },
  }

  it('replaces the native glitch-stretched range with the robust one', () => {
    const candles = quietMarket()
    candles[100] = { ...candles[100], high: 200_000 }
    const info = candleAutoscale(
      () => candles,
      () => logicals(candles),
    )(() => ({ ...baseInfo, priceRange: { minValue: 66_000, maxValue: 200_000 } }))
    expect(info!.priceRange!.maxValue).toBeLessThan(75_000)
    expect(info!.priceRange!.minValue).toBeGreaterThan(60_000)
  })

  it('keeps the base implementation margins', () => {
    const candles = quietMarket()
    const info = candleAutoscale(
      () => candles,
      () => logicals(candles),
    )(() => baseInfo)
    expect(info!.margins).toEqual({ above: 3, below: 4 })
  })

  it('leaves line/area charts on the native close-based range', () => {
    const candles = quietMarket()
    candles[100] = { ...candles[100], high: 200_000 }
    const native = {
      priceRange: { minValue: 66_000, maxValue: 67_500 },
      margins: { above: 1, below: 1 },
    }
    expect(
      candleAutoscale(
        () => candles,
        () => logicals(candles),
        false,
      )(() => native),
    ).toEqual(native)
  })

  it('falls back to the native range with no visible window or data', () => {
    const candles = quietMarket()
    expect(
      candleAutoscale(
        () => candles,
        () => null,
      )(() => baseInfo),
    ).toEqual(baseInfo)
    expect(
      candleAutoscale(
        () => [],
        () => logicals(candles),
      )(() => baseInfo),
    ).toEqual(baseInfo)
  })
})
