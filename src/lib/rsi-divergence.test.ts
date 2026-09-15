import { describe, expect, it } from 'vitest'
import {
  calculateRsiDivergence,
  rsiDivergenceIndicatorLabel,
  rsiDivergencePlots,
  RSI_DIVERGENCE_DEFAULTS,
} from './rsi-divergence'
import { divergenceEnabled } from './macd-divergence'
import type { Candle, Indicator } from './types'

const makeCandles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 3600,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }))

describe('calculateRsiDivergence', () => {
  it('computes bounded RSI values between 0 and 100', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3) * 10)
    const candles = makeCandles(closes)
    const result = calculateRsiDivergence(candles, { period: 14 })

    expect(result.rsi).toHaveLength(candles.length)
    const valid = result.rsi.filter((v): v is number => v !== null)
    expect(valid.length).toBeGreaterThan(0)
    for (const v of valid) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('detects regular bullish divergence on RSI pivots', () => {
    // Generate candles where price creates a lower low, but RSI creates a higher low
    // Create a series of bars with 2 dips:
    // Dip 1: at bar 10 (price low ~90, RSI low ~25)
    // Rise: at bar 15 (price ~105, RSI ~60)
    // Dip 2: at bar 20 (price low ~85, but steeper recovery so RSI low ~35)
    const candles: Candle[] = []
    for (let i = 0; i < 35; i++) {
      let close = 100
      let low = 99
      let high = 101
      if (i < 8) {
        close = 100 - i * 0.5
        low = close - 1
        high = close + 1
      } else if (i >= 8 && i <= 12) {
        // dip 1
        const dip = [94, 91, 88, 92, 95][i - 8]
        close = dip
        low = dip - 2
        high = dip + 1
      } else if (i > 12 && i < 18) {
        close = 96 + (i - 12) * 2
        low = close - 1
        high = close + 1
      } else if (i >= 18 && i <= 24) {
        // dip 2: price goes lower (low 82), but sudden bounce gives higher RSI
        const dip = [98, 93, 85, 87, 93, 97, 100][i - 18]
        close = dip
        low = i === 20 ? 82 : dip - 1
        high = dip + 1
      } else {
        close = 100 + (i - 24) * 0.5
        low = close - 1
        high = close + 1
      }
      candles.push({
        time: i * 3600,
        open: close,
        high,
        low,
        close,
        volume: 100,
      })
    }

    const result = calculateRsiDivergence(candles, {
      period: 5,
      divergence: {
        ...RSI_DIVERGENCE_DEFAULTS.divergence,
        pivotLookback: 2,
        rangeLower: 2,
        rangeUpper: 20,
      },
    })
    expect(result.rsi).toHaveLength(candles.length)
  })

  it('enables divergence on rsi-divergence indicator kind', () => {
    const indicator: Indicator = {
      id: 'rsi-div-1',
      kind: 'rsi-divergence',
      name: 'RSI Divergence',
      period: 14,
      color: '#ad91e5',
      visible: true,
      divergence: { ...RSI_DIVERGENCE_DEFAULTS.divergence },
    }
    expect(divergenceEnabled(indicator)).toBe(true)

    const disabledIndicator: Indicator = {
      ...indicator,
      divergence: {
        ...RSI_DIVERGENCE_DEFAULTS.divergence,
        showRegular: false,
        showHidden: false,
      },
    }
    expect(divergenceEnabled(disabledIndicator)).toBe(false)
  })
})

describe('rsiDivergencePlots', () => {
  it('generates primary RSI plot and 70/50/30 horizontal level lines', () => {
    const rsi = [null, null, 45, 52, 68, 73, 58, 28, 35]
    const indicator: Indicator = {
      id: 'rd',
      kind: 'rsi-divergence',
      name: 'RSI Divergence',
      period: 14,
      color: '#ad91e5',
      visible: true,
    }
    const plots = rsiDivergencePlots({ rsi }, indicator)
    expect(plots).toHaveLength(4)

    const [main, ob, mid, os] = plots
    expect(main.title).toBe('RSI 14')
    expect(main.values).toEqual(rsi)
    expect(main.pane).toBe('oscillator')
    expect(main.color).toBe('#ad91e5')

    expect(ob.title).toBe('Overbought (70)')
    expect(ob.horizontalLine).toBe(70)
    expect(ob.hideLegend).toBe(true)

    expect(mid.title).toBe('Midline (50)')
    expect(mid.horizontalLine).toBe(50)
    expect(mid.hideLegend).toBe(true)

    expect(os.title).toBe('Oversold (30)')
    expect(os.horizontalLine).toBe(30)
    expect(os.hideLegend).toBe(true)
  })
})

describe('rsiDivergenceIndicatorLabel', () => {
  it('formats label with period', () => {
    const indicator: Indicator = {
      id: 'rd',
      kind: 'rsi-divergence',
      name: 'RSI Divergence',
      period: 21,
      color: '#ad91e5',
      visible: true,
    }
    expect(rsiDivergenceIndicatorLabel(indicator)).toBe('RSI Divergence 21')
  })
})
