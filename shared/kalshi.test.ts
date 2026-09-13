import { describe, expect, it } from 'vitest'
import {
  estimateStrikeFromCandles,
  isBrtiAnchor,
  isBrtiSample,
  isKalshiStrike,
  isKalshiStrikeResponse,
  KALSHI_COIN_FEEDS,
  KALSHI_WINDOW_SECONDS,
  kalshiFeedForProduct,
  kalshiFeedForSeries,
  kalshiWindowBounds,
  parseBrtiAnchors,
  parseKalshiStrike,
  roundStrike,
  selectKalshiMarket,
  type KalshiCoinFeed,
} from './kalshi.ts'
import audit from './fixtures/kalshi-strike-audit.json'

/** Verbatim market records captured from Kalshi's public API on 2026-09-13. */
const BTC_FEED = kalshiFeedForProduct('BTC-USD')!
const HYPE_FEED = kalshiFeedForProduct('HYPE-USD')!

const btcOpenMarket = {
  ticker: 'KXBTC15M-26SEP131715-15',
  open_time: '2026-09-13T21:00:00Z',
  close_time: '2026-09-13T21:15:00Z',
  floor_strike: 77314.22,
  expiration_value: '',
  strike_type: 'greater_or_equal',
  custom_strike: { round_digits: '2' },
  rules_primary:
    "If the simple average of the sixty seconds of CF Benchmarks' BRTI before 5:15 PM EDT on Sep 13, 2026 is at least the simple average of the sixty seconds of CF Benchmarks' BRTI before 5:00 PM EDT on September 13, 2026, then the market resolves to Yes.",
  status: 'active',
}

const NOW = Date.parse('2026-09-13T21:10:00Z') / 1000

describe('kalshi coin feeds', () => {
  it('covers the seven coins Kalshi runs a 15-minute ladder on', () => {
    expect(KALSHI_COIN_FEEDS.map((feed) => feed.product)).toEqual([
      'BTC-USD',
      'ETH-USD',
      'SOL-USD',
      'XRP-USD',
      'DOGE-USD',
      'HYPE-USD',
      'BNB-USD',
    ])
  })

  it('keeps BTC on its historic index id while the rest follow the RTI naming', () => {
    expect(BTC_FEED.indexId).toBe('BRTI')
    expect(kalshiFeedForProduct('ETH-USD')?.indexId).toBe('ETHUSD_RTI')
    expect(kalshiFeedForProduct('BNB-USD')?.indexId).toBe('BNBUSD_RTI')
  })

  it('spells the rule-text name without the underscore the API id uses', () => {
    // Kalshi's rules say "CF Benchmarks' ETHUSDRTI"; the API wants "ETHUSD_RTI".
    expect(kalshiFeedForProduct('ETH-USD')?.ruleName).toBe('ETHUSDRTI')
  })

  it('looks feeds up both ways and returns null for pairs Kalshi does not list', () => {
    expect(kalshiFeedForSeries('KXBTC15M')).toBe(BTC_FEED)
    expect(kalshiFeedForProduct('AVAX-USD')).toBeNull()
    expect(kalshiFeedForSeries('KXAVAX15M')).toBeNull()
  })

  it('has no duplicate products or series', () => {
    const products = KALSHI_COIN_FEEDS.map((feed) => feed.product)
    const series = KALSHI_COIN_FEEDS.map((feed) => feed.series)
    expect(new Set(products).size).toBe(products.length)
    expect(new Set(series).size).toBe(series.length)
  })
})

describe('kalshiWindowBounds', () => {
  it('cuts the clock into quarter hours that coincide in every whole-hour timezone', () => {
    expect(kalshiWindowBounds(NOW)).toEqual({
      windowStart: Date.parse('2026-09-13T21:00:00Z') / 1000,
      windowEnd: Date.parse('2026-09-13T21:15:00Z') / 1000,
    })
  })

  it('rolls forward exactly at the cut', () => {
    const cut = Date.parse('2026-09-13T21:15:00Z') / 1000
    expect(kalshiWindowBounds(cut).windowStart).toBe(cut)
    expect(kalshiWindowBounds(cut - 1).windowEnd).toBe(cut)
  })
})

describe('roundStrike', () => {
  it('rounds to the decimals Kalshi publishes for that coin', () => {
    expect(roundStrike(77314.2249, 2)).toBe(77314.22)
    expect(roundStrike(78.84165, 4)).toBe(78.8417)
    expect(roundStrike(0.234567, 5)).toBe(0.23457)
  })

  it('clamps absurd digit counts instead of overflowing', () => {
    expect(roundStrike(1.23456789, 99)).toBe(roundStrike(1.23456789, 8))
    expect(roundStrike(1.5, -3)).toBe(2)
  })
})

describe('parseKalshiStrike', () => {
  it('reads the exact published strike off a live market record', () => {
    const strike = parseKalshiStrike({ markets: [btcOpenMarket] }, BTC_FEED, NOW, 1_700_000_000_000)
    expect(strike).not.toBeNull()
    expect(strike!.strike).toBe(77314.22)
    expect(strike!.ticker).toBe('KXBTC15M-26SEP131715-15')
    expect(strike!.windowStart).toBe(Date.parse('2026-09-13T21:00:00Z') / 1000)
    expect(strike!.windowEnd).toBe(strike!.windowStart + KALSHI_WINDOW_SECONDS)
    expect(strike!.product).toBe('BTC-USD')
    expect(strike!.indexId).toBe('BRTI')
    expect(strike!.roundDigits).toBe(2)
    expect(strike!.rule).toContain('CF Benchmarks')
    expect(isKalshiStrike(strike)).toBe(true)
  })

  it('resolves a tie upward, because Kalshi uses greater_or_equal', () => {
    const strike = parseKalshiStrike({ markets: [btcOpenMarket] }, BTC_FEED, NOW, 0)
    expect(strike!.tieGoesUp).toBe(true)
    const strict = parseKalshiStrike(
      { markets: [{ ...btcOpenMarket, strike_type: 'greater' }] },
      BTC_FEED,
      NOW,
      0,
    )
    expect(strict!.tieGoesUp).toBe(false)
  })

  it('takes rounding from the market record, not from the feed default', () => {
    // HYPE publishes four decimals; the recorded live strike was 78.8416.
    const hype = parseKalshiStrike(
      {
        markets: [
          {
            ...btcOpenMarket,
            ticker: 'KXHYPE15M-26SEP131730-30',
            floor_strike: 78.84164,
            custom_strike: { round_digits: '4' },
          },
        ],
      },
      HYPE_FEED,
      NOW,
      0,
    )
    expect(hype!.strike).toBe(78.8416)
    expect(hype!.roundDigits).toBe(4)
  })

  it('falls back to the feed default when the record omits rounding', () => {
    const strike = parseKalshiStrike(
      { markets: [{ ...btcOpenMarket, custom_strike: undefined }] },
      HYPE_FEED,
      NOW,
      0,
    )
    expect(strike!.roundDigits).toBe(HYPE_FEED.roundDigits)
  })

  it('accepts strikes sent as strings, which Kalshi does on some fields', () => {
    const strike = parseKalshiStrike(
      { markets: [{ ...btcOpenMarket, floor_strike: '77314.22' }] },
      BTC_FEED,
      NOW,
      0,
    )
    expect(strike!.strike).toBe(77314.22)
  })

  it('returns null rather than guessing when the record is unusable', () => {
    const cases: unknown[] = [
      { markets: [] },
      {},
      null,
      { markets: [{ ...btcOpenMarket, floor_strike: 0 }] },
      { markets: [{ ...btcOpenMarket, floor_strike: '' }] },
      { markets: [{ ...btcOpenMarket, open_time: 'not-a-date' }] },
      { markets: [{ ...btcOpenMarket, ticker: '' }] },
      // A close that is not exactly 15 minutes after the open is not this ladder.
      { markets: [{ ...btcOpenMarket, close_time: '2026-09-13T22:00:00Z' }] },
    ]
    for (const payload of cases) expect(parseKalshiStrike(payload, BTC_FEED, NOW, 0)).toBeNull()
  })
})

describe('selectKalshiMarket', () => {
  it('picks the most recent window that has already opened and published a strike', () => {
    const payload = {
      markets: [
        // A future window has no strike yet; it must never be used early.
        { ...btcOpenMarket, ticker: 'future', open_time: '2026-09-13T21:15:00Z', floor_strike: 0 },
        { ...btcOpenMarket, ticker: 'current', open_time: '2026-09-13T21:00:00Z' },
        {
          ...btcOpenMarket,
          ticker: 'previous',
          open_time: '2026-09-13T20:45:00Z',
          floor_strike: 77291.46,
        },
      ],
    }
    expect((selectKalshiMarket(payload, NOW) as { ticker: string }).ticker).toBe('current')
  })

  it('falls back to the previous window while the new one is still unpublished', () => {
    const payload = {
      markets: [
        {
          ...btcOpenMarket,
          ticker: 'pending',
          open_time: '2026-09-13T21:15:00Z',
          floor_strike: '',
        },
        { ...btcOpenMarket, ticker: 'current', open_time: '2026-09-13T21:00:00Z' },
      ],
    }
    const atCut = Date.parse('2026-09-13T21:15:02Z') / 1000
    expect((selectKalshiMarket(payload, atCut) as { ticker: string }).ticker).toBe('current')
  })

  it('ignores records older than a day', () => {
    const stale = {
      markets: [{ ...btcOpenMarket, open_time: '2026-09-10T21:00:00Z' }],
    }
    expect(selectKalshiMarket(stale, NOW)).toBeNull()
  })
})

describe('parseBrtiAnchors', () => {
  it('chains settled windows into an exact index series, collapsing shared boundaries', () => {
    const settled = [
      {
        open_time: '2026-09-13T20:45:00Z',
        close_time: '2026-09-13T21:00:00Z',
        floor_strike: 77291.46,
        expiration_value: '77314.22',
      },
      {
        open_time: '2026-09-13T20:30:00Z',
        close_time: '2026-09-13T20:45:00Z',
        floor_strike: 77289.61,
        expiration_value: '77291.46',
      },
      {
        open_time: '2026-09-13T20:15:00Z',
        close_time: '2026-09-13T20:30:00Z',
        floor_strike: 77266.75,
        expiration_value: '77289.61',
      },
    ]
    const anchors = parseBrtiAnchors({ markets: settled }, BTC_FEED)
    expect(anchors.map((anchor) => anchor.time)).toEqual([
      Date.parse('2026-09-13T20:15:00Z') / 1000,
      Date.parse('2026-09-13T20:30:00Z') / 1000,
      Date.parse('2026-09-13T20:45:00Z') / 1000,
      Date.parse('2026-09-13T21:00:00Z') / 1000,
    ])
    expect(anchors.map((anchor) => anchor.value)).toEqual([77266.75, 77289.61, 77291.46, 77314.22])
    expect(anchors.every((anchor) => anchor.indexId === 'BRTI')).toBe(true)
    expect(anchors.every(isBrtiAnchor)).toBe(true)
  })

  it('keeps a live window whose settlement is still blank', () => {
    const anchors = parseBrtiAnchors({ markets: [btcOpenMarket] }, BTC_FEED)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].value).toBe(77314.22)
  })

  it('returns nothing for an unusable payload', () => {
    expect(parseBrtiAnchors({}, BTC_FEED)).toEqual([])
    expect(parseBrtiAnchors(null, BTC_FEED)).toEqual([])
  })
})

describe('estimateStrikeFromCandles', () => {
  const candle = (time: number, open: number, high: number, low: number, close: number) => ({
    time,
    open,
    high,
    low,
    close,
  })
  const START = Date.parse('2026-09-13T21:00:00Z') / 1000

  it('averages the sixty seconds before the boundary, which is what Kalshi averages', () => {
    const candles = [
      candle(START - 60, 100, 104, 98, 102), // OHLC/4 = 101, and it alone covers the minute
      candle(START, 102, 110, 101, 109), // the boundary print — deliberately ignored
    ]
    expect(estimateStrikeFromCandles(candles, START, 60)).toBe(101)
  })

  it('averages every sub-minute candle inside the window', () => {
    const candles = [
      candle(START - 60, 100, 100, 100, 100),
      candle(START - 30, 110, 110, 110, 110),
      candle(START, 900, 900, 900, 900),
    ]
    expect(estimateStrikeFromCandles(candles, START, 30)).toBe(105)
  })

  it('refuses a grid too coarse to resolve sixty seconds', () => {
    const candles = [candle(START - 300, 100, 104, 98, 102), candle(START, 102, 110, 101, 109)]
    expect(estimateStrikeFromCandles(candles, START, 300)).toBeNull()
    expect(estimateStrikeFromCandles(candles, START, 900)).toBeNull()
  })

  it('refuses a partially covered minute rather than averaging what is missing', () => {
    // Only 30 of the required 60 seconds are present.
    const candles = [candle(START - 30, 100, 100, 100, 100), candle(START, 900, 900, 900, 900)]
    expect(estimateStrikeFromCandles(candles, START, 30)).toBeNull()
  })

  it('returns null on empty or nonsensical input', () => {
    expect(estimateStrikeFromCandles([], START, 60)).toBeNull()
    expect(estimateStrikeFromCandles([candle(START - 60, 1, 1, 1, 1)], NaN, 60)).toBeNull()
    expect(estimateStrikeFromCandles([candle(START - 60, 1, 1, 1, 1)], START, 0)).toBeNull()
  })
})

/**
 * The audit that motivated this module, pinned as a regression test.
 *
 * `shared/fixtures/kalshi-strike-audit.json` holds real Coinbase BTC-USD one-minute
 * candles and the real `floor_strike` values Kalshi published for the same windows.
 * These assertions record the measured gap so that any future "simplification" back
 * to the boundary candle open fails loudly.
 */
describe('strike accuracy against recorded Kalshi data', () => {
  const candles = audit.candles
  const byTime = new Map(candles.map((candle) => [candle.time, candle]))
  const naive: number[] = []
  const estimated: number[] = []

  for (const window of audit.windows) {
    const start = Date.parse(window.open) / 1000
    const open = byTime.get(start)?.open
    const estimate = estimateStrikeFromCandles(candles, start, audit.intervalSeconds)
    if (open !== undefined) naive.push(open - window.floorStrike)
    if (estimate !== null) estimated.push(estimate - window.floorStrike)
  }

  const bias = (errors: number[]) => errors.reduce((sum, e) => sum + e, 0) / errors.length
  const mae = (errors: number[]) => errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length

  it('has enough recorded windows to say something', () => {
    expect(audit.windows.length).toBeGreaterThanOrEqual(5)
    expect(naive.length).toBe(audit.windows.length)
    expect(estimated.length).toBe(audit.windows.length)
  })

  it('shows the boundary candle open is biased high against the real strike', () => {
    // Measured +$3.30 mean bias, $4.39 MAE, $9.09 worst case on 2026-09-13.
    expect(bias(naive)).toBeCloseTo(3.3, 1)
    expect(mae(naive)).toBeCloseTo(4.39, 1)
  })

  it('shows averaging the preceding minute removes essentially all of that bias', () => {
    // Measured -$0.06 mean bias, $3.53 MAE — the residual is the Coinbase↔BRTI basis.
    expect(Math.abs(bias(estimated))).toBeLessThan(0.5)
    expect(mae(estimated)).toBeCloseTo(3.53, 1)
  })

  it('beats the naive strike on both bias and mean absolute error', () => {
    expect(Math.abs(bias(estimated))).toBeLessThan(Math.abs(bias(naive)))
    expect(mae(estimated)).toBeLessThan(mae(naive))
  })

  it('still cannot match Kalshi exactly, which is why the published strike is fetched', () => {
    // A local estimate is never exact: the residual is a different venue basket and an
    // order-book index rather than Coinbase trades. Only Kalshi's own number is exact.
    expect(mae(estimated)).toBeGreaterThan(0.5)
  })
})

describe('validators', () => {
  const strike = parseKalshiStrike({ markets: [btcOpenMarket] }, BTC_FEED, NOW, 123)!

  it('accepts a well-formed response and rejects damage to any field', () => {
    const response = {
      source: 'kalshi',
      product: 'BTC-USD',
      series: 'KXBTC15M',
      indexId: 'BRTI',
      strike,
      anchors: [],
      samples: null,
      keyed: false,
      asOf: 123,
      message: 'ok',
    }
    expect(isKalshiStrikeResponse(response)).toBe(true)
    expect(isKalshiStrikeResponse({ ...response, source: 'coinbase' })).toBe(false)
    expect(isKalshiStrikeResponse({ ...response, strike: { nope: true } })).toBe(false)
    expect(isKalshiStrikeResponse({ ...response, anchors: [{ time: 1 }] })).toBe(false)
    expect(isKalshiStrikeResponse({ ...response, samples: [{ time: 1.5, value: 2 }] })).toBe(false)
    expect(isKalshiStrikeResponse({ ...response, samples: [{ time: 1, value: -2 }] })).toBe(false)
    expect(isKalshiStrikeResponse(null)).toBe(false)
    expect(isKalshiStrikeResponse([])).toBe(false)
  })

  it('rejects a strike whose window is not fifteen minutes long', () => {
    expect(isKalshiStrike({ ...strike, windowEnd: strike.windowEnd + 1 })).toBe(false)
    expect(isKalshiStrike({ ...strike, strike: 0 })).toBe(false)
    expect(isKalshiStrike({ ...strike, strike: NaN })).toBe(false)
    expect(isKalshiStrike(null)).toBe(false)
  })

  it('validates samples and anchors', () => {
    expect(isBrtiSample({ time: 1_700_000_000, value: 77314.22 })).toBe(true)
    expect(isBrtiSample({ time: 1.5, value: 1 })).toBe(false)
    expect(isBrtiSample({ time: 1, value: -3 })).toBe(false)
    expect(isBrtiAnchor({ time: 1_700_000_000, value: 77314.22, indexId: 'BRTI' })).toBe(true)
    expect(isBrtiAnchor({ time: 1_700_000_000, value: 77314.22 })).toBe(false)
  })
})

describe('feed lookup table', () => {
  it('exposes a usable feed object for every listed coin', () => {
    for (const feed of KALSHI_COIN_FEEDS as readonly KalshiCoinFeed[]) {
      expect(kalshiFeedForProduct(feed.product)).toBe(feed)
      expect(feed.series).toMatch(/^KX[A-Z]+15M$/)
      expect(feed.roundDigits).toBeGreaterThanOrEqual(0)
    }
  })
})
