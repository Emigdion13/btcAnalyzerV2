import { describe, expect, it } from 'vitest'
import {
  isKalshiMetalHistory,
  isMetalQuote,
  isSettlementPoint,
  mergeSettlementPoints,
  metalCoverage,
  metalQuote,
  metalRequestRange,
  METAL_MAX_LOOKBACK_SECONDS,
  parseImpliedUp,
  parseSettlementPoints,
  quantizeMetalLookback,
  secondsUntilSettlement,
  settlementCandles,
  type KalshiMetalHistory,
  type SettlementPoint,
} from './kalshi-metals.ts'
import {
  isMetalFeed,
  isMetalInterval,
  isMetalSymbol,
  KALSHI_COIN_FEEDS,
  KALSHI_METAL_FEEDS,
  KALSHI_WINDOW_SECONDS,
  kalshiFeedForProduct,
  kalshiFeedForSeries,
  metalFeedForSeries,
  metalFeedForSymbol,
  METAL_INTERVALS,
} from './kalshi.ts'
import { isProductId } from './coinbase.ts'
import fixture from './fixtures/kalshi-metals-markets.json'

/** Real Kalshi market records for the metals ladders, captured 2026-09-17. */
const GOLD = metalFeedForSymbol('XAU-USD')!
const SILVER = metalFeedForSymbol('XAG-USD')!
const goldSettled = fixture.gold.settled
const goldOpen = fixture.gold.open
const silverSettled = fixture.silver.settled

const seconds = (iso: string) => Date.parse(iso) / 1000
/** Quarter-hour aligned points, one per window, for aggregation cases. */
function ramp(fromIso: string, count: number, step = 1): SettlementPoint[] {
  const start = seconds(fromIso)
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * KALSHI_WINDOW_SECONDS,
    value: 100 + i * step,
  }))
}

describe('kalshi metal feeds', () => {
  it('lists the two metals Kalshi runs a 15-minute ladder on', () => {
    expect(KALSHI_METAL_FEEDS.map((feed) => [feed.symbol, feed.series])).toEqual([
      ['XAU-USD', 'KXGOLD15M'],
      ['XAG-USD', 'KXSILVER15M'],
    ])
    // Gold publishes 2 decimals, silver 3 — read off the live records, never assumed.
    expect(GOLD.roundDigits).toBe(2)
    expect(SILVER.roundDigits).toBe(3)
    expect(GOLD.indexId).toBe('PYTH_GOLD')
    expect(SILVER.unit).toBe('troy ounce')
  })

  it('names Pyth in the rule text, not CF Benchmarks', () => {
    const rule = goldSettled.markets[0].rules_primary
    expect(rule).toContain('Pyth GOLD')
    expect(rule).not.toContain('CF Benchmarks')
    // The metals settle on a 1-minute candlestick CLOSE, not BRTI's 60-second average.
    expect(rule).toContain('close price of the 1-minute candlestick')
  })

  it('looks metals up by symbol and by series, both directions', () => {
    expect(metalFeedForSeries('KXSILVER15M')).toBe(SILVER)
    expect(kalshiFeedForSeries('KXGOLD15M')).toBe(GOLD)
    // The strike route resolves metals too, so the overlay works on gold and silver.
    expect(kalshiFeedForProduct('XAU-USD')).toBe(GOLD)
    expect(metalFeedForSymbol('BTC-USD')).toBeNull()
    expect(metalFeedForSeries('KXBTC15M')).toBeNull()
  })

  it('keeps metals out of the crypto ladder and vice versa', () => {
    expect(KALSHI_COIN_FEEDS.every((feed) => !isMetalFeed(feed))).toBe(true)
    expect(KALSHI_METAL_FEEDS.every(isMetalFeed)).toBe(true)
    expect(isMetalFeed(kalshiFeedForProduct('BTC-USD')!)).toBe(false)
    expect(isMetalFeed(kalshiFeedForProduct('XAG-USD')!)).toBe(true)
  })

  it('recognises metal symbols, which are shaped like product ids but are not Coinbase’s', () => {
    expect(isMetalSymbol('XAU-USD')).toBe(true)
    expect(isMetalSymbol('XAG-USD')).toBe(true)
    expect(isMetalSymbol('BTC-USD')).toBe(false)
    expect(isMetalSymbol('XAUUSDT')).toBe(false)
    expect(isMetalSymbol(null)).toBe(false)
    // The trap this guards: the Coinbase id pattern matches, so routing must check metals
    // first or gold would be sent to an exchange that does not trade it.
    expect(isProductId('XAU-USD')).toBe(true)
  })

  it('supports quarter-hour resolution and up, because that is all Kalshi publishes', () => {
    expect(METAL_INTERVALS).toEqual(['15m', '1h', '4h', '1D', '1W'])
    expect(isMetalInterval('15m')).toBe(true)
    expect(isMetalInterval('1W')).toBe(true)
    // No source exists below 15 minutes: resampling would be invention.
    for (const interval of ['1m', '3m', '5m']) expect(isMetalInterval(interval)).toBe(false)
    expect(isMetalInterval('nope')).toBe(false)
  })
})

describe('parseSettlementPoints', () => {
  it('reads every exact price off the real settled gold markets', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const byTime = new Map(points.map((point) => [point.time, point.value]))
    expect(points).toHaveLength(11)
    expect(byTime.get(seconds('2026-09-16T22:15:00Z'))).toBe(4259.39)
    expect(byTime.get(seconds('2026-09-16T22:30:00Z'))).toBe(4261.94)
    expect(byTime.get(seconds('2026-09-16T22:45:00Z'))).toBe(4273.3)
    expect(byTime.get(seconds('2026-09-16T23:00:00Z'))).toBe(4266.78)
    expect(byTime.get(seconds('2026-09-17T02:00:00Z'))).toBe(4300.16)
    expect(byTime.get(seconds('2026-07-31T23:45:00Z'))).toBe(4051.15)
  })

  it('collapses the shared boundary, where one settlement is the next strike', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const times = points.map((point) => point.time)
    expect(new Set(times).size).toBe(times.length)
    // 22:30 is both the close of the 22:15 window and the strike of the 22:30 window.
    expect(times.filter((time) => time === seconds('2026-09-16T22:30:00Z'))).toHaveLength(1)
  })

  it('sorts ascending across pages Kalshi returns newest-first', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const times = points.map((point) => point.time)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(points[0].time).toBe(seconds('2026-07-31T23:45:00Z'))
  })

  it('prefers a graded settlement over a neighbouring strike for the same boundary', () => {
    const payload = {
      markets: [
        // Published later, but a strike is a preview of a number the grade makes final.
        {
          open_time: '2026-09-16T22:30:00Z',
          floor_strike: 4261.9,
          custom_strike: { round_digits: '2' },
        },
        {
          open_time: '2026-09-16T22:15:00Z',
          close_time: '2026-09-16T22:30:00Z',
          floor_strike: 4259.39,
          expiration_value: '4261.94',
          custom_strike: { round_digits: '2' },
        },
      ],
    }
    const byTime = new Map(parseSettlementPoints(payload, GOLD).map((p) => [p.time, p.value]))
    expect(byTime.get(seconds('2026-09-16T22:30:00Z'))).toBe(4261.94)
  })

  it('ignores the empty settlement of a window still open', () => {
    const points = parseSettlementPoints(goldOpen, GOLD)
    // The live market contributes its strike only; it has not settled yet.
    expect(points).toEqual([{ time: seconds('2026-09-17T02:00:00Z'), value: 4300.16 }])
  })

  it('rounds silver to the three decimals its records publish', () => {
    const points = parseSettlementPoints(silverSettled, SILVER)
    const byTime = new Map(points.map((point) => [point.time, point.value]))
    expect(byTime.get(seconds('2026-09-17T01:45:00Z'))).toBe(63.902)
    expect(byTime.get(seconds('2026-09-17T02:00:00Z'))).toBe(63.498)
  })

  it('falls back to the feed default when a record omits rounding', () => {
    const points = parseSettlementPoints(
      { markets: [{ open_time: '2026-09-16T22:15:00Z', floor_strike: 4259.3987 }] },
      GOLD,
    )
    expect(points[0].value).toBe(4259.4)
  })

  it('returns nothing for a malformed body', () => {
    expect(parseSettlementPoints(null, GOLD)).toEqual([])
    expect(parseSettlementPoints({}, GOLD)).toEqual([])
    expect(parseSettlementPoints({ markets: 'nope' }, GOLD)).toEqual([])
  })
})

describe('mergeSettlementPoints', () => {
  it('merges runs, dedupes boundaries and keeps the earliest run’s value', () => {
    const merged = mergeSettlementPoints(
      [
        { time: 1800, value: 10 },
        { time: 900, value: 9 },
      ],
      [
        { time: 1800, value: 999 },
        { time: 2700, value: 11 },
      ],
    )
    expect(merged).toEqual([
      { time: 900, value: 9 },
      { time: 1800, value: 10 },
      { time: 2700, value: 11 },
    ])
  })
})

describe('settlementCandles', () => {
  it('builds one 15m bar per pair of adjacent settlement points', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const bars = settlementCandles(points, '15m')
    const bar = bars.find((candle) => candle.time === seconds('2026-09-16T22:15:00Z'))!
    expect(bar.open).toBe(4259.39)
    expect(bar.close).toBe(4261.94)
    // Kalshi publishes no intra-window range, so the bar carries the tightest honest bound.
    expect(bar.high).toBe(4261.94)
    expect(bar.low).toBe(4259.39)
    expect(bar.volume).toBe(0)
  })

  it('draws a falling window with the high and low the right way round', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const bar = settlementCandles(points, '15m').find(
      (candle) => candle.time === seconds('2026-09-16T22:45:00Z'),
    )!
    expect(bar.open).toBe(4273.3)
    expect(bar.close).toBe(4266.78)
    expect(bar.high).toBe(4273.3)
    expect(bar.low).toBe(4266.78)
  })

  it('leaves a gap where Kalshi published nothing, rather than a flat invented bar', () => {
    const points = parseSettlementPoints(goldSettled, GOLD)
    const times = settlementCandles(points, '15m').map((candle) => candle.time)
    // 23:00 → 01:30 is nine unpublished windows: no bar may span it.
    expect(times).not.toContain(seconds('2026-09-16T23:00:00Z'))
    expect(times).toContain(seconds('2026-09-16T22:45:00Z'))
    expect(times).toContain(seconds('2026-09-17T01:30:00Z'))
    expect(times).toHaveLength(7)
  })

  it('never draws the window that is still forming', () => {
    const points = mergeSettlementPoints(
      parseSettlementPoints(goldSettled, GOLD),
      parseSettlementPoints(goldOpen, GOLD),
    )
    const bars = settlementCandles(points, '15m')
    // The 02:00 window has an opening point and no close, so it is not a candle yet.
    expect(bars.map((candle) => candle.time)).not.toContain(seconds('2026-09-17T02:00:00Z'))
    expect(bars.at(-1)!.time).toBe(seconds('2026-09-17T01:45:00Z'))
    expect(bars.at(-1)!.close).toBe(4300.16)
  })

  it('aggregates to the hour with the envelope of its quarter-hour points', () => {
    const points = ramp('2026-09-16T20:00:00Z', 9, 2) // 20:00 → 22:00, rising by 2
    const bars = settlementCandles(points, '1h')
    expect(bars).toHaveLength(2)
    expect(bars[0].time).toBe(seconds('2026-09-16T20:00:00Z'))
    expect(bars[0].open).toBe(100)
    expect(bars[0].close).toBe(108)
    expect(bars[0].high).toBe(108)
    expect(bars[0].low).toBe(100)
    expect(bars[0].volume).toBe(0)
    // The 22:00 point has no successor, so the second hour has one bar’s worth of data.
    expect(bars[1].close).toBe(116)
  })

  it('aggregates a falling hour to the same envelope, high first', () => {
    const points = ramp('2026-09-16T20:00:00Z', 5, -3)
    const bar = settlementCandles(points, '1h')[0]
    expect(bar.open).toBe(100)
    expect(bar.close).toBe(88)
    expect(bar.high).toBe(100)
    expect(bar.low).toBe(88)
  })

  it('starts weekly bars on a Monday, matching the rest of the app', () => {
    // Eight days of quarter-hour points, from one Monday 00:00 to the next Monday 23:45.
    const points = ramp('2026-09-14T00:00:00Z', 96 * 8)
    const bars = settlementCandles(points, '1W')
    expect(bars).toHaveLength(2)
    for (const bar of bars) expect(new Date(bar.time * 1000).getUTCDay()).toBe(1)
    const daily = settlementCandles(points, '1D')
    expect(daily).toHaveLength(8)
    expect(daily[0].time).toBe(seconds('2026-09-14T00:00:00Z'))
    // A bucket holds the 96 bars that START inside it, so its last bar closes on the
    // first point of the next bucket: Sep 14's 23:45 bar settles at Sep 15 00:00.
    expect(daily[0].open).toBe(points[0].value)
    expect(daily[0].close).toBe(points[96].value)
    expect(daily[0].high).toBe(points[96].value)
    expect(daily[0].low).toBe(points[0].value)
    expect(daily[7].close).toBe(points[96 * 8 - 1].value)
    // Same rule at the week: Monday's bar closes on the next Monday's opening point.
    expect(bars[0].open).toBe(points[0].value)
    expect(bars[0].close).toBe(points[96 * 7].value)
    expect(bars[1].open).toBe(points[96 * 7].value)
    expect(bars[1].close).toBe(points[96 * 8 - 1].value)
  })

  it('honours the bar limit and keeps the most recent bars', () => {
    const points = ramp('2026-09-16T00:00:00Z', 200)
    const bars = settlementCandles(points, '15m', 50)
    expect(bars).toHaveLength(50)
    expect(bars.at(-1)!.time).toBe(points.at(-2)!.time)
  })

  it('produces nothing from fewer than two points', () => {
    expect(settlementCandles([], '15m')).toEqual([])
    expect(settlementCandles([{ time: 900, value: 1 }], '15m')).toEqual([])
  })
})

describe('metalQuote', () => {
  const newest = seconds('2026-09-17T02:00:00Z')
  const points: SettlementPoint[] = [
    { time: newest - 90_000, value: 100 }, // 25 hours back: outside the 24h envelope
    { time: newest - 86_400, value: 110 }, // exactly 24 hours back: the change reference
    { time: newest - 3_600, value: 120 },
    { time: newest, value: 121 },
  ]

  it('reports the newest published settlement, and says how old it is', () => {
    const quote = metalQuote(points)!
    expect(quote.price).toBe(121)
    expect(quote.updatedAt).toBe(newest * 1000)
    expect(quote.source).toBe('kalshi')
  })

  it('measures the day against the point 24 hours back, not the oldest held', () => {
    const quote = metalQuote(points)!
    expect(quote.open).toBe(110)
    expect(quote.change).toBeCloseTo(10, 8)
  })

  it('takes the 24-hour envelope of settlement points, excluding older history', () => {
    const quote = metalQuote(points)!
    expect(quote.high).toBe(121)
    expect(quote.low).toBe(120)
  })

  it('reports no volume: Kalshi counts contracts, not ounces', () => {
    expect(metalQuote(points)!.volume).toBeNull()
  })

  it('nulls the change rather than inventing a reference point', () => {
    const quote = metalQuote([{ time: newest, value: 121 }])!
    expect(quote.open).toBeNull()
    expect(quote.change).toBeNull()
    expect(quote.high).toBe(121)
    expect(quote.low).toBe(121)
  })

  it('returns null with nothing published', () => {
    expect(metalQuote([])).toBeNull()
  })
})

describe('metalCoverage', () => {
  it('reports the span held and how stale the newest point is', () => {
    const points = ramp('2026-09-16T20:00:00Z', 5)
    const now = points.at(-1)!.time + 300
    expect(metalCoverage(points, now, true)).toEqual({
      points: 5,
      from: points[0].time,
      to: points.at(-1)!.time,
      ageSeconds: 300,
      complete: true,
    })
  })

  it('reports an empty run without dividing by nothing', () => {
    expect(metalCoverage([], 1000, false)).toEqual({
      points: 0,
      from: null,
      to: null,
      ageSeconds: 0,
      complete: false,
    })
  })
})

describe('secondsUntilSettlement', () => {
  it('counts down to the next quarter hour', () => {
    expect(secondsUntilSettlement(seconds('2026-09-17T02:10:00Z'))).toBe(300)
    expect(secondsUntilSettlement(seconds('2026-09-17T02:14:59Z'))).toBe(1)
    expect(secondsUntilSettlement(seconds('2026-09-17T02:15:00Z'))).toBe(900)
  })
})

describe('metalRequestRange', () => {
  it('asks for one extra window, so the oldest bar has an opening point', () => {
    const now = seconds('2026-09-17T02:10:00Z')
    const { from, to } = metalRequestRange('15m', 4, now)
    expect(to).toBe(now)
    // Four 15m bars end at the 02:00 boundary and open at 01:15; one window earlier is 01:00.
    expect(from).toBe(seconds('2026-09-17T01:00:00Z'))
  })

  it('clamps deep requests to the lookback the service will actually walk', () => {
    const now = seconds('2026-09-17T02:10:00Z')
    const { from } = metalRequestRange('1W', 300, now)
    expect(from).toBe(now - METAL_MAX_LOOKBACK_SECONDS)
  })

  it('aligns daily requests to the UTC day', () => {
    const now = seconds('2026-09-17T02:10:00Z')
    const { from } = metalRequestRange('1D', 3, now)
    // Three daily bars start at Sep 15 00:00; one window earlier is Sep 14 23:45.
    expect(from).toBe(seconds('2026-09-15T00:00:00Z') - KALSHI_WINDOW_SECONDS)
  })
})

describe('quantizeMetalLookback', () => {
  it('floors to the cache bucket so neighbouring requests share pages', () => {
    const bucket = 6 * 3600
    expect(quantizeMetalLookback(seconds('2026-09-17T02:10:00Z')) % bucket).toBe(0)
    expect(quantizeMetalLookback(seconds('2026-09-17T02:10:00Z'))).toBe(
      quantizeMetalLookback(seconds('2026-09-17T05:59:59Z')),
    )
    expect(quantizeMetalLookback(-5)).toBe(0)
  })
})

describe('parseImpliedUp', () => {
  it('reads the traded contract price on the live gold market', () => {
    expect(parseImpliedUp(goldOpen.markets[0])).toBe(0.016)
  })

  it('falls back to the quote midpoint when nothing has traded', () => {
    expect(
      parseImpliedUp({
        last_price_dollars: '0.0000',
        yes_bid_dollars: '0.0120',
        yes_ask_dollars: '0.0160',
      }),
    ).toBeCloseTo(0.014, 8)
  })

  it('returns null rather than guessing when there is no market', () => {
    expect(parseImpliedUp(null)).toBeNull()
    expect(parseImpliedUp({})).toBeNull()
    expect(parseImpliedUp({ last_price_dollars: '1.4' })).toBeNull()
  })
})

describe('metal history validators', () => {
  const history: KalshiMetalHistory = {
    source: 'kalshi',
    symbol: 'XAU-USD',
    series: 'KXGOLD15M',
    indexId: 'PYTH_GOLD',
    interval: '15m',
    candles: [
      {
        time: 1_789_639_500,
        open: 4259.39,
        high: 4261.94,
        low: 4259.39,
        close: 4261.94,
        volume: 0,
      },
    ],
    points: [{ time: 1_789_639_500, value: 4259.39 }],
    quote: {
      price: 4261.94,
      open: 4259.39,
      high: 4261.94,
      low: 4259.39,
      volume: null,
      change: 0.06,
      updatedAt: 1_789_639_500_000,
      source: 'kalshi',
    },
    pending: null,
    roundDigits: 2,
    unit: 'troy ounce',
    coverage: { points: 2, from: 1_789_639_500, to: 1_789_640_400, ageSeconds: 12, complete: true },
    asOf: 1_789_640_412_000,
    message: 'Gold · Kalshi KXGOLD15M settlement points on PYTH_GOLD, quarter-hour resolution.',
  }

  it('accepts a well-formed response', () => {
    expect(isKalshiMetalHistory(history)).toBe(true)
    expect(isKalshiMetalHistory(history, 'XAU-USD', '15m')).toBe(true)
  })

  it('rejects damage to any load-bearing field', () => {
    expect(isKalshiMetalHistory({ ...history, source: 'coinbase' })).toBe(false)
    expect(isKalshiMetalHistory(history, 'XAG-USD')).toBe(false)
    expect(isKalshiMetalHistory(history, 'XAU-USD', '5m')).toBe(false)
    expect(isKalshiMetalHistory({ ...history, candles: [{ time: 1 }] })).toBe(false)
    expect(isKalshiMetalHistory({ ...history, points: [{ time: 1.5, value: 2 }] })).toBe(false)
    expect(isKalshiMetalHistory({ ...history, coverage: { points: 0 } })).toBe(false)
    expect(isKalshiMetalHistory(null)).toBe(false)
    expect(isKalshiMetalHistory([])).toBe(false)
  })

  it('rejects a bar whose envelope contradicts its own open and close', () => {
    const broken = {
      ...history,
      candles: [{ time: 1_789_639_500, open: 10, high: 9, low: 11, close: 10, volume: 0 }],
    }
    expect(isKalshiMetalHistory(broken)).toBe(false)
  })

  it('validates metal quotes separately from Coinbase ones', () => {
    expect(isMetalQuote(history.quote)).toBe(true)
    // A Coinbase-shaped quote is not a metal quote, and vice versa.
    expect(isMetalQuote({ ...history.quote!, source: 'coinbase' })).toBe(false)
    expect(isMetalQuote({ ...history.quote!, volume: 12 })).toBe(false)
    expect(isMetalQuote({ ...history.quote!, price: 0 })).toBe(false)
    expect(isMetalQuote(null)).toBe(false)
  })

  it('validates settlement points', () => {
    expect(isSettlementPoint({ time: 1_789_639_500, value: 4259.39 })).toBe(true)
    expect(isSettlementPoint({ time: 1.5, value: 1 })).toBe(false)
    expect(isSettlementPoint({ time: 1, value: -2 })).toBe(false)
    expect(isSettlementPoint(null)).toBe(false)
  })

  it('accepts a pending window with an implied contract price', () => {
    const pending = {
      ...history,
      pending: {
        windowStart: 1_789_640_400,
        windowEnd: 1_789_640_400 + KALSHI_WINDOW_SECONDS,
        strike: 4300.16,
        roundDigits: 2,
        ticker: 'KXGOLD15M-26SEP162215-15',
        rule: 'Pyth GOLD',
        tieGoesUp: true,
        impliedUp: 0.016,
      },
    }
    expect(isKalshiMetalHistory(pending)).toBe(true)
    expect(
      isKalshiMetalHistory({
        ...pending,
        pending: { ...pending.pending!, windowEnd: pending.pending!.windowEnd + 1 },
      }),
    ).toBe(false)
  })
})
