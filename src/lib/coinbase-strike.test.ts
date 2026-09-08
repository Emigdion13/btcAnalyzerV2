import { describe, expect, it } from 'vitest'
import {
  calculateCoinbaseStrike,
  coinbaseStrikePriceLevels,
  coinbaseStrikeSettings,
  isCoinbaseStrikeSettings,
  COINBASE_STRIKE_DEFAULTS,
} from './coinbase-strike'
import { builtInPlots } from './indicators'
import type { Candle, Indicator } from './types'

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
    expect(coinbaseStrikePriceLevels(result, settings)).toEqual([
      {
        role: 'strike',
        price: 50000,
        color: '#f5a623',
        axisLabelVisible: true,
        title: 'STRIKE',
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
