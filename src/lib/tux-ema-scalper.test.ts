import { describe, expect, it } from 'vitest'
import {
  calculateTuxEmaScalper,
  isTuxEmaScalperSettings,
  tuxEmaScalperIndicatorLabel,
  tuxEmaScalperPlots,
} from './tux-ema-scalper'
import {
  TUX_EMA_SCALPER_DEFAULTS,
  type Candle,
  type Indicator,
  type TuxEmaScalperSettings,
} from './types'

const candles = (closes: number[]): Candle[] =>
  closes.map((close, index) => ({
    time: index * 60,
    open: index === 0 ? close : closes[index - 1],
    high: Math.max(close, index === 0 ? close : closes[index - 1]) + 1,
    low: Math.min(close, index === 0 ? close : closes[index - 1]) - 1,
    close,
    volume: 1,
  }))

const settings = (overrides: Partial<TuxEmaScalperSettings> = {}): TuxEmaScalperSettings => ({
  ...TUX_EMA_SCALPER_DEFAULTS,
  emaLength: 3,
  atrPeriod: 2,
  ...overrides,
})

describe('TUX EMA Scalper+SuperTrend settings', () => {
  it('keeps the requested (3, 7, 20, close) profile', () => {
    expect(TUX_EMA_SCALPER_DEFAULTS).toMatchObject({
      factor: 3,
      atrPeriod: 7,
      emaLength: 20,
      source: 'close',
    })
  })

  it('validates settings and formats the TradingView-style legend', () => {
    expect(isTuxEmaScalperSettings({ ...TUX_EMA_SCALPER_DEFAULTS })).toBe(true)
    expect(isTuxEmaScalperSettings({ ...TUX_EMA_SCALPER_DEFAULTS, factor: 0 })).toBe(false)
    expect(isTuxEmaScalperSettings({ ...TUX_EMA_SCALPER_DEFAULTS, atrPeriod: 1.5 })).toBe(false)
    expect(isTuxEmaScalperSettings({ ...TUX_EMA_SCALPER_DEFAULTS, buyColor: 'green' })).toBe(false)

    const indicator: Indicator = {
      id: 'tux',
      kind: 'tux-ema-scalper',
      name: 'TUX EMA Scalper+SuperTrend',
      period: 20,
      color: '#39b978',
      visible: true,
      tuxEmaScalper: { ...TUX_EMA_SCALPER_DEFAULTS },
    }
    expect(tuxEmaScalperIndicatorLabel(indicator)).toBe(
      'TUX EMA Scalper+SuperTrend (3, 7, 20, close)',
    )
  })
})

describe('TUX EMA Scalper+SuperTrend calculation', () => {
  it('prints an EMA-cross BUY and SELL arrow on the crossing candle', () => {
    const result = calculateTuxEmaScalper(candles([100, 99, 98, 97, 96, 100, 95]), settings())
    expect(result.signals.map((signal) => [signal.side, signal.index])).toEqual([
      ['buy', 5],
      ['sell', 6],
    ])
    expect(result.signals[0]).toMatchObject({ price: 95, close: 100, trend: 'down' })
    expect(result.signals[1]).toMatchObject({ price: 101, close: 95 })
  })

  it('uses Wilder ATR and splits the SuperTrend into transparent line segments', () => {
    const result = calculateTuxEmaScalper(
      candles([100, 99, 98, 97, 96, 100, 105]),
      settings({ factor: 0.1 }),
    )
    expect(result.atr[0]).toBeNull()
    expect(result.atr[1]).toBe(2.5)
    expect(result.supertrend[1]).toBeTypeOf('number')
    expect(result.upTrend.some((value) => value !== null)).toBe(true)
    expect(result.downTrend.some((value) => value !== null)).toBe(true)

    const indicator: Indicator = {
      id: 'tux',
      kind: 'tux-ema-scalper',
      name: 'TUX EMA Scalper+SuperTrend',
      period: 3,
      color: '#39b978',
      visible: true,
      tuxEmaScalper: settings(),
    }
    expect(tuxEmaScalperPlots([], indicator).map((plot) => plot.title)).toEqual([
      'EMA 3',
      'SuperTrend Up',
      'SuperTrend Down',
    ])
  })
})
