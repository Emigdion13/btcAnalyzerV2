import { describe, expect, it } from 'vitest'
import {
  calculateCoinbaseStrike,
  coinbaseStrikePriceLevels,
  coinbaseStrikeSettings,
  isCoinbaseStrikeSettings,
  COINBASE_STRIKE_DEFAULTS,
  resolveStrike,
} from './coinbase-strike'
import { builtInPlots } from './indicators'
import type { Candle, Indicator } from './types'
import type { KalshiStrike } from '../../shared/kalshi'

describe('Coinbase Strike settings validation', () => {
  it('validates default settings', () => {
    expect(isCoinbaseStrikeSettings(COINBASE_STRIKE_DEFAULTS)).toBe(true)
  })

  it('rejects invalid parameters', () => {
    expect(isCoinbaseStrikeSettings({ ...COINBASE_STRIKE_DEFAULTS, intervalMinutes: 0 })).toBe(
      false,
    )
    expect(isCoinbaseStrikeSettings({ ...COINBASE_STRIKE_DEFAULTS, intervalMinutes: -5 })).toBe(
      false,
    )
    expect(isCoinbaseStrikeSettings({ ...COINBASE_STRIKE_DEFAULTS, buffer: -10 })).toBe(false)
    expect(isCoinbaseStrikeSettings({ ...COINBASE_STRIKE_DEFAULTS, strikeColor: 'invalid' })).toBe(
      false,
    )
    expect(isCoinbaseStrikeSettings(null)).toBe(false)
    expect(isCoinbaseStrikeSettings(undefined)).toBe(false)
  })

  it('resolves fallback settings correctly', () => {
    const indicator: Indicator = {
      id: 'coinbase-strike',
      kind: 'coinbase-strike',
      name: 'BTC Strike',
      period: 30,
      color: '#f5a623',
      visible: true,
    }
    const settings = coinbaseStrikeSettings(indicator)
    expect(settings.intervalMinutes).toBe(30)
    expect(settings.strikeColor).toBe('#f5a623')
  })
})

describe('Coinbase Strike calculations', () => {
  const bar = (time: number, open: number, close: number): Candle => ({
    time,
    open,
    high: Math.max(open, close) + 5,
    low: Math.min(open, close) - 5,
    close,
    volume: 100,
  })

  it('locks the strike price at each interval boundary (e.g. 15-minute intervals)', () => {
    // 15m = 900 seconds
    const candles: Candle[] = [
      bar(0, 100, 105), // Interval 0 start (strike = 100)
      bar(300, 105, 110), // Interval 0 mid (strike = 100)
      bar(600, 110, 115), // Interval 0 mid (strike = 100)
      bar(900, 115, 120), // Interval 1 start (strike = 115)
      bar(1200, 120, 118), // Interval 1 mid (strike = 115)
      bar(1800, 118, 112), // Interval 2 start (strike = 118)
    ]

    const result = calculateCoinbaseStrike(candles, {
      ...COINBASE_STRIKE_DEFAULTS,
      intervalMinutes: 15,
      showTargets: false,
    })

    expect(result.strikeLine).toEqual([100, 100, 100, 115, 115, 118])
    expect(result.currentStrike).toBe(118)
    expect(result.currentPrice).toBe(112)
    expect(result.delta).toBe(-6)
    expect(result.isUp).toBe(false)
    expect(result.timeRemainingSeconds).toBe(900) // 1800 to 2700
  })

  it('calculates upper and lower target bands when showTargets is enabled', () => {
    const candles: Candle[] = [bar(0, 1000, 1010), bar(300, 1010, 1020)]
    const result = calculateCoinbaseStrike(candles, {
      ...COINBASE_STRIKE_DEFAULTS,
      intervalMinutes: 15,
      buffer: 50,
      showTargets: true,
    })

    expect(result.strikeLine).toEqual([1000, 1000])
    expect(result.upperTarget).toEqual([1050, 1050])
    expect(result.lowerTarget).toEqual([950, 950])
  })

  it('supports custom fixed strike price override', () => {
    const candles: Candle[] = [bar(0, 1000, 1010), bar(900, 1050, 1060)]
    const result = calculateCoinbaseStrike(candles, {
      ...COINBASE_STRIKE_DEFAULTS,
      intervalMinutes: 15,
      customStrike: 1025,
      showTargets: false,
    })

    expect(result.strikeLine).toEqual([1025, 1025])
    expect(result.currentStrike).toBe(1025)
    expect(result.delta).toBe(35) // 1060 - 1025
    expect(result.isUp).toBe(true)
  })

  it('uses only active price-scale levels instead of historical chart plots', () => {
    const candles: Candle[] = [bar(0, 50000, 50200), bar(300, 50200, 50300)]
    const indicator: Indicator = {
      id: 'coinbase-strike',
      kind: 'coinbase-strike',
      name: 'BTC Strike',
      period: 15,
      color: '#f5a623',
      visible: true,
      strike: {
        ...COINBASE_STRIKE_DEFAULTS,
        showTargets: true,
        buffer: 100,
      },
    }
    const settings = coinbaseStrikeSettings(indicator)
    const result = calculateCoinbaseStrike(candles, settings)

    expect(builtInPlots(candles, indicator)).toEqual([])
    // A purely Coinbase-derived level is labelled an estimate: it is close to Kalshi's
    // strike, but it is not the number the contract settles against.
    expect(coinbaseStrikePriceLevels(result, settings)).toEqual([
      {
        role: 'strike',
        price: 50000,
        color: '#f5a623',
        axisLabelVisible: true,
        title: 'STRIKE (EST)',
      },
      {
        role: 'upper-target',
        price: 50100,
        color: '#2bb99b',
        axisLabelVisible: false,
        title: '',
      },
      {
        role: 'lower-target',
        price: 49900,
        color: '#ed6773',
        axisLabelVisible: false,
        title: '',
      },
    ])
  })
})

describe('resolveStrike', () => {
  // 1m candles spanning the 21:00→21:15 UTC window recorded on 2026-09-13.
  const T = (iso: string) => Date.parse(iso) / 1000
  const WINDOW_START = T('2026-09-13T21:00:00Z')
  const minute = (offsetMinutes: number, open: number, close: number): Candle => ({
    time: WINDOW_START - 60 + offsetMinutes * 60,
    open,
    high: Math.max(open, close) + 2,
    low: Math.min(open, close) - 2,
    close,
    volume: 1,
  })
  const candles: Candle[] = [
    minute(0, 77300, 77310), // [20:59, 21:00) — the minute Kalshi averages for a 21:00 open
    minute(1, 77310, 77320), // 21:00 boundary candle; its open is the naive strike
    minute(2, 77320, 77318),
  ]
  const settings = { ...COINBASE_STRIKE_DEFAULTS, intervalMinutes: 15 }
  const published: KalshiStrike = {
    product: 'BTC-USD',
    series: 'KXBTC15M',
    indexId: 'BRTI',
    ticker: 'KXBTC15M-26SEP131715-15',
    windowStart: WINDOW_START,
    windowEnd: WINDOW_START + 900,
    strike: 77314.22,
    roundDigits: 2,
    rule: "sixty seconds of CF Benchmarks' BRTI",
    tieGoesUp: true,
    fetchedAt: 0,
  }

  it('prefers the strike Kalshi published over anything derived locally', () => {
    const result = calculateCoinbaseStrike(candles, settings)
    const resolved = resolveStrike(result, published, settings, candles, 60)
    expect(resolved.price).toBe(77314.22)
    expect(resolved.source).toBe('kalshi')
    expect(resolved.authoritative).toBe(true)
    expect(resolved.manual).toBe(false)
    expect(resolved.ticker).toBe('KXBTC15M-26SEP131715-15')
    // The local number is kept alongside, so the UI can show the basis instead of
    // silently swapping one number for another.
    expect(resolved.naiveOpen).toBe(77310) // open of the 21:00 boundary candle
    expect(resolved.estimate).not.toBeNull()
    expect(resolved.basis).toBeCloseTo((resolved.estimate as number) - 77314.22, 6)
  })

  it('labels the authoritative level as Kalshi on the price scale', () => {
    const result = calculateCoinbaseStrike(candles, settings)
    const resolved = resolveStrike(result, published, settings, candles, 60)
    const [strike] = coinbaseStrikePriceLevels(result, settings, resolved)
    expect(strike.title).toBe('KALSHI STRIKE')
    expect(strike.price).toBe(77314.22)
  })

  it('refuses a published strike that belongs to a different window', () => {
    const result = calculateCoinbaseStrike(candles, settings)
    // Same value, but stamped one window later: applying it here would be a lie.
    const mismatched = {
      ...published,
      windowStart: published.windowStart + 900,
      windowEnd: published.windowEnd + 900,
    }
    const resolved = resolveStrike(result, mismatched, settings, candles, 60)
    expect(resolved.source).toBe('estimate')
    expect(resolved.authoritative).toBe(false)
    expect(resolved.price).not.toBe(77314.22)
  })

  it('refuses a 15-minute strike on an hourly ladder', () => {
    const hourly = { ...settings, intervalMinutes: 60 }
    const result = calculateCoinbaseStrike(candles, hourly)
    const aligned = {
      ...published,
      windowStart: result.intervalStart,
      windowEnd: result.intervalEnd,
    }
    // Even when the timestamps line up, Kalshi's 15m series says nothing about an hour.
    expect(resolveStrike(result, aligned, hourly, candles, 3600).source).toBe('estimate')
  })

  it('falls back to an averaged estimate, never to the bare boundary open', () => {
    const result = calculateCoinbaseStrike(candles, settings)
    const resolved = resolveStrike(result, null, settings, candles, 60)
    expect(resolved.authoritative).toBe(false)
    expect(resolved.estimate).not.toBeNull()
    expect(resolved.price).toBe(resolved.estimate)
    expect(resolved.price).not.toBe(resolved.naiveOpen)
  })

  it('gives up on an estimate when the grid cannot resolve 60 seconds', () => {
    const result = calculateCoinbaseStrike(candles, settings)
    const resolved = resolveStrike(result, null, settings, candles, 300)
    expect(resolved.estimate).toBeNull()
    // Degrades to the old behaviour rather than to nothing at all.
    expect(resolved.price).toBe(resolved.naiveOpen)
  })

  it('keeps a hand-pinned strike above everything else', () => {
    const pinned = { ...settings, customStrike: 77000 }
    const result = calculateCoinbaseStrike(candles, pinned)
    const resolved = resolveStrike(result, published, pinned, candles, 60)
    expect(resolved.price).toBe(77000)
    expect(resolved.manual).toBe(true)
    expect(resolved.authoritative).toBe(true)
    expect(resolved.source).toBe('estimate')
  })
})
