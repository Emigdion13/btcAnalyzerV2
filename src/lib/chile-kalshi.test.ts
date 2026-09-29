import { describe, expect, it } from 'vitest'
import type { KalshiStrikeResponse } from '../../shared/kalshi'
import type { KalshiFloatResponse } from '../../shared/kalshi-float'
import { chileKalshiEligible, chileKalshiView } from './chile-kalshi'

const OPEN = Date.UTC(2026, 8, 29, 6, 0, 0) / 1000

const strikeResponse = (overrides: Partial<KalshiStrikeResponse> = {}): KalshiStrikeResponse => ({
  source: 'kalshi',
  product: 'BTC-USD',
  series: 'KXBTC15M',
  indexId: 'BRTI',
  strike: {
    product: 'BTC-USD',
    series: 'KXBTC15M',
    indexId: 'BRTI',
    ticker: 'KXBTC15M-26SEP290215-15',
    windowStart: OPEN,
    windowEnd: OPEN + 900,
    strike: 83375.74,
    roundDigits: 2,
    rule: '',
    tieGoesUp: true,
    fetchedAt: 0,
  },
  anchors: [
    { time: OPEN - 1800, value: 83100.1, indexId: 'BRTI' },
    { time: OPEN - 900, value: 83250.5, indexId: 'BRTI' },
  ],
  samples: null,
  keyed: false,
  asOf: 0,
  message: '',
  ...overrides,
})

const floatResponse = (overrides: Partial<KalshiFloatResponse> = {}): KalshiFloatResponse => ({
  source: 'kalshi',
  product: 'BTC-USD',
  series: 'KXBTC15M',
  ticker: 'KXBTC15M-26SEP290215-15',
  target: 83375.74,
  decimals: 2,
  open: OPEN,
  close: OPEN + 900,
  upPct: 61,
  downPct: 39,
  upX: 1.6,
  downX: 2.5,
  now: 83400,
  nowSource: 'kalshi',
  quiet: false,
  pctSource: 'book',
  asOf: 0,
  message: '',
  ...overrides,
})

describe('chileKalshiEligible', () => {
  it("is a real feed's 15-minute round on a coin Kalshi lists, charted at 15m or finer", () => {
    expect(chileKalshiEligible('BTC-USD', 'coinbase', '15m', '5m')).toBe(true)
    expect(chileKalshiEligible('BTC-USD', 'coinbase', '15m', '15m')).toBe(true)
    expect(chileKalshiEligible('BTC-USD', 'demo', '15m', '5m')).toBe(false)
    expect(chileKalshiEligible('BTC-USD', 'coinbase', '1h', '5m')).toBe(false)
    expect(chileKalshiEligible('BTC-USD', 'coinbase', '15m', '1h')).toBe(false)
    expect(chileKalshiEligible('LINK-USD', 'coinbase', '15m', '5m')).toBe(false)
  })

  it('leaves out the metal ladders, which settle on a candle close rather than an average', () => {
    expect(chileKalshiEligible('XAU-USD', 'kalshi', '15m', '15m')).toBe(false)
  })
})

describe('chileKalshiView', () => {
  it('collects every published boundary and prices both sides fee-included', () => {
    const view = chileKalshiView('BTC-USD', strikeResponse(), floatResponse(), false)!
    expect([...view.boundaries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [OPEN - 1800, 83100.1],
      [OPEN - 900, 83250.5],
      [OPEN, 83375.74],
    ])
    expect(view.market).toEqual({
      open: OPEN,
      upPct: 61,
      upCost: 1 / 1.6,
      downCost: 1 / 2.5,
      stale: false,
    })
  })

  it("takes the running window's strike from the price feed when the strike feed lags", () => {
    const view = chileKalshiView(
      'BTC-USD',
      strikeResponse({ strike: null }),
      floatResponse(),
      true,
    )!
    expect(view.boundaries.get(OPEN)).toBe(83375.74)
    expect(view.market?.stale).toBe(true)
  })

  it('ignores a response left over from another pair, and has nothing before either answers', () => {
    expect(chileKalshiView('ETH-USD', strikeResponse(), floatResponse(), false)).toBeNull()
    expect(chileKalshiView('BTC-USD', null, null, false)).toBeNull()
    const noQuote = chileKalshiView(
      'BTC-USD',
      null,
      floatResponse({ upX: null, downX: null, upPct: null }),
      false,
    )!
    expect(noQuote.market).toEqual({
      open: OPEN,
      upPct: null,
      upCost: null,
      downCost: null,
      stale: false,
    })
    expect(
      chileKalshiView('BTC-USD', null, floatResponse({ open: null }), false)!.market,
    ).toBeNull()
  })
})
