import { describe, expect, it } from 'vitest'
import {
  floatChance,
  floatDecimals,
  floatLiveSymbol,
  floatPayout,
  isKalshiFloatResponse,
  parseFeeMultiplier,
  parseFloatOrderbook,
  parseLastTradePrice,
  parseLiveIndexTick,
  selectFloatMarket,
} from './kalshi-float'

describe('floatChance — the % Kalshi actually displays', () => {
  it('shows the last trade when it sits inside the spread', () => {
    // The two real observations that deduced the rule: with bid/ask 70/71 the
    // app showed 70; with 44/45 the web showed 45.
    expect(floatChance(0.7, 0.71, 0.7)).toBe(70)
    expect(floatChance(0.44, 0.45, 0.45)).toBe(45)
  })

  it('shows the last trade in a wide spread, and clamps only when it fell outside the book', () => {
    // Wide spread 30/60, last print 32: it reads 32 — the midpoint (45) would
    // invent a 13-point move the market never made.
    expect(floatChance(0.3, 0.6, 0.32)).toBe(32)
    // The book moved away from a stale print: the nearest edge stands in.
    expect(floatChance(0.3, 0.6, 0.25)).toBe(30)
    expect(floatChance(0.3, 0.6, 0.9)).toBe(60)
  })

  it('falls back to the midpoint without a trade, to one side without a full book', () => {
    expect(floatChance(0.44, 0.45, null)).toBe(45) // midpoint 0.445 rounds up
    expect(floatChance(0.4, 0.4, null)).toBe(40)
    expect(floatChance(0.52, null, null)).toBe(52)
    expect(floatChance(null, 0.35, null)).toBe(35)
  })

  it('returns null with no prices at all, and never 0 or 100 on an open market', () => {
    expect(floatChance(null, null, null)).toBeNull()
    expect(floatChance(0.995, 0.999, 0.999)).toBe(99)
    expect(floatChance(0.001, 0.002, 0.001)).toBe(1)
  })
})

describe('floatPayout — the "x" net of the taker fee', () => {
  it('reproduces the two multipliers the original author verified on the Kalshi UI', () => {
    // ask 0.71 -> 1.38x, ask 0.30 -> 3.18x (fee 0.07, multiplier 1)
    expect(floatPayout(0.71, 1)).toBeCloseTo(1.3805, 3)
    expect(floatPayout(0.3, 1)).toBeCloseTo(3.1776, 3)
  })

  it('scales with the series fee multiplier and refuses prices outside (0, 1)', () => {
    expect(floatPayout(0.5, 2)).toBeCloseTo(1 / (0.5 + 0.07 * 2 * 0.5 * 0.5), 10)
    expect(floatPayout(null, 1)).toBeNull()
    expect(floatPayout(0, 1)).toBeNull()
    expect(floatPayout(1, 1)).toBeNull()
    expect(floatPayout(1.01, 1)).toBeNull()
  })
})

describe('parseFloatOrderbook — best executable prices', () => {
  const book = {
    orderbook_fp: {
      yes_dollars: [
        [0.71, 120],
        [0.7, 400],
      ],
      no_dollars: [[0.28, 90]],
    },
  }

  it('takes the best buy on each side and derives the asks as 1 - best opposite bid', () => {
    expect(parseFloatOrderbook(book)).toEqual({
      yesBid: 0.71,
      yesAsk: 0.72,
      noAsk: 0.29,
    })
  })

  it('still reads the legacy cents format, scaled to dollars', () => {
    // 70 cents = 0.70 dollars: the pre-dollars format prices in cents.
    expect(
      parseFloatOrderbook({
        orderbook: { yes: [[70, 5]], no: [[30, 5]] },
      }),
    ).toEqual({ yesBid: 0.7, yesAsk: 0.7, noAsk: 0.3 })
  })

  it('skips zero-size levels and empty levels', () => {
    expect(
      parseFloatOrderbook({
        orderbook_fp: { yes_dollars: [[0.5, 0], [0.45, 10]], no_dollars: [] },
      }),
    ).toEqual({ yesBid: 0.45, yesAsk: null, noAsk: 0.55 })
  })

  it('returns null for a payload without a book, so the caller falls back WITH a warning', () => {
    expect(parseFloatOrderbook({})).toBeNull()
    expect(parseFloatOrderbook({ orderbook_fp: 'nope' })).toBeNull()
    expect(parseFloatOrderbook(null)).toBeNull()
  })
})

describe('parseLastTradePrice', () => {
  it('reads dollars first, then the legacy cents field', () => {
    expect(parseLastTradePrice({ trades: [{ yes_price_dollars: 0.7 }] })).toBe(0.7)
    expect(parseLastTradePrice({ trades: [{ yes_price: 70 }] })).toBe(0.7)
    expect(parseLastTradePrice({ trades: [] })).toBeNull()
    expect(parseLastTradePrice({})).toBeNull()
    expect(parseLastTradePrice({ trades: [{ yes_price_dollars: 0 }] })).toBeNull()
  })
})

describe('parseLiveIndexTick — the "Now" index', () => {
  it('reads the newest point of the feed', () => {
    expect(parseLiveIndexTick({ timeseries: [{ v: 80850.1 }, { v: 80870.69 }] })).toBe(80870.69)
  })

  it('distinguishes a paused feed (quiet) from an unreadable last point (null)', () => {
    // The feed answered but has no points in the window — paused, not broken.
    expect(parseLiveIndexTick({ timeseries: [] })).toBe('quiet')
    expect(parseLiveIndexTick({})).toBe('quiet')
    // The last point exists but carries no usable value: unreadable.
    expect(parseLiveIndexTick({ timeseries: [{ v: 'garbage' }] })).toBeNull()
    expect(parseLiveIndexTick({ timeseries: [null] })).toBeNull()
  })
})

describe('parseFeeMultiplier', () => {
  it('returns the multiplier only for quadratic fees, 1 otherwise', () => {
    expect(parseFeeMultiplier({ series: { fee_type: 'quadratic', fee_multiplier: '1.5' } })).toBe(
      1.5,
    )
    expect(parseFeeMultiplier({ series: { fee_type: 'fixed', fee_multiplier: '3' } })).toBe(1)
    expect(parseFeeMultiplier({ series: {} })).toBe(1)
    expect(parseFeeMultiplier({})).toBe(1)
  })
})

describe('selectFloatMarket — the running window', () => {
  const at = (s: number) => new Date(s * 1000).toISOString()
  // 21:10 UTC: the 21:00->21:15 window is running, 21:15->21:30 is next.
  const NOW = Math.floor(Date.parse('2026-09-13T21:10:00Z') / 1000)
  const market = (
    ticker: string,
    open: number,
    close: number,
    strike: number | string = 77314.22,
  ) => ({
    ticker,
    open_time: at(open),
    close_time: at(close),
    floor_strike: strike,
    strike_type: 'greater_or_equal',
  })

  it('prefers the window that is running over a future one from the same list', () => {
    const payload = {
      markets: [
        market('NEXT', NOW + 900, NOW + 1800), // opened in the future: no strike yet
        market('RUNNING', NOW - 600, NOW + 300),
      ],
    }
    expect(selectFloatMarket(payload, NOW)?.ticker).toBe('RUNNING')
  })

  it('a stale list carrying only the NEXT window must not replace the live one — the clock governs', () => {
    // The running window is absent (15s cache). The only candidate opens in the
    // future: selectFloatMarket still returns it as the best of the list, and
    // the caller compares its open against the clock before trusting it.
    const payload = { markets: [market('NEXT', NOW + 900, NOW + 1800)] }
    const picked = selectFloatMarket(payload, NOW)
    expect(picked?.ticker).toBe('NEXT')
    expect(Math.floor(Date.parse(String(picked?.open_time ?? '')) / 1000)).toBeGreaterThan(NOW)
  })

  it('skips closed windows and picks the nearest close among the rest', () => {
    const payload = {
      markets: [
        market('CLOSED', NOW - 1800, NOW - 900),
        market('LATER', NOW - 3600, NOW + 900),
        market('SOON', NOW - 300, NOW + 30),
      ],
    }
    expect(selectFloatMarket(payload, NOW)?.ticker).toBe('SOON')
    expect(selectFloatMarket({ markets: [market('CLOSED', NOW - 1800, NOW - 900)] }, NOW)).toBeNull()
  })
})

describe('floatDecimals / decimalsFor / floatLiveSymbol', () => {
  it('reads the decimals off the market subtitle, the way Kalshi prints the strike', () => {
    expect(floatDecimals({ yes_sub_title: 'Target Price: $80,787.61' }, 80787.61)).toBe(2)
    expect(floatDecimals({ yes_sub_title: '$1.2345 or above' }, 1.2345)).toBe(4)
    expect(floatDecimals(null, 1234.5)).toBe(2)
    expect(floatDecimals(null, 4.56)).toBe(4)
    expect(floatDecimals(null, 0.00456)).toBe(6)
  })

  it('maps products to the live-index symbols', () => {
    expect(floatLiveSymbol('BTC-USD')).toBe('BTC')
    expect(floatLiveSymbol('HYPE-USD')).toBe('HYPE')
    expect(floatLiveSymbol('XAU-USD')).toBe('PYTH:GOLD')
    expect(floatLiveSymbol('XAG-USD')).toBe('PYTH:SILVER')
  })
})

describe('isKalshiFloatResponse', () => {
  const base = {
    source: 'kalshi',
    product: 'BTC-USD',
    series: 'KXBTC15M',
    ticker: 'KXBTC15M-26SEP131715-15',
    target: 77314.22,
    decimals: 2,
    open: 1_789_330_800,
    close: 1_789_331_700,
    upPct: 70,
    downPct: 30,
    upX: 1.38,
    downX: 3.18,
    now: 77330.1,
    nowSource: 'kalshi',
    quiet: false,
    pctSource: 'book',
    asOf: 1_789_331_400_000,
    message: 'ok',
  }

  it('accepts a full response and a no-market response', () => {
    expect(isKalshiFloatResponse(base)).toBe(true)
    expect(
      isKalshiFloatResponse({
        ...base,
        ticker: null,
        target: null,
        open: null,
        close: null,
        upPct: null,
        downPct: null,
        upX: null,
        downX: null,
        now: null,
        nowSource: null,
        pctSource: null,
      }),
    ).toBe(true)
  })

  it('rejects malformed fields and out-of-range percentages', () => {
    expect(isKalshiFloatResponse({ ...base, source: 'coinbase' })).toBe(false)
    expect(isKalshiFloatResponse({ ...base, upPct: 0 })).toBe(false)
    expect(isKalshiFloatResponse({ ...base, upPct: 100 })).toBe(false)
    expect(isKalshiFloatResponse({ ...base, nowSource: 'binance' })).toBe(false)
    expect(isKalshiFloatResponse({ ...base, message: 5 })).toBe(false)
    expect(isKalshiFloatResponse(null)).toBe(false)
  })
})
