import { describe, expect, it } from 'vitest'
import {
  aggregateCandles,
  bucketStart,
  candleFingerprint,
  CandleTracker,
  historyWindows,
  INTERVAL_SECONDS,
  isCandle,
  isProductId,
  nativeGranularity,
  parseCandles,
  parseProducts,
  parseQuote,
  parseTrade,
  validateHistory,
} from './coinbase'
import type { Interval, MarketCandle } from './coinbase'
const bar = (time: number, open: number, close: number, volume = 1): MarketCandle => ({
  time,
  open,
  close,
  high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1,
  volume,
})

describe('Coinbase candle normalization and intervals', () => {
  it('maps Coinbase [time,low,high,open,close,volume], sorts and deduplicates', () => {
    expect(
      parseCandles([
        [120, 9, 14, 10, 13, 2],
        [60, 8, 13, 9, 12, 1],
        [120, 9, 15, 10, 14, 3],
      ]),
    ).toEqual([
      { time: 60, low: 8, high: 13, open: 9, close: 12, volume: 1 },
      { time: 120, low: 9, high: 15, open: 10, close: 14, volume: 3 },
    ])
  })
  it('builds exact UTC-aligned 3m OHLCV from three Coinbase 1m candles', () => {
    const start = Date.UTC(2026, 8, 6, 12, 0) / 1000
    const data = [bar(start, 10, 12, 2), bar(start + 60, 12, 11, 3), bar(start + 120, 11, 15, 4)]
    expect(aggregateCandles(data.reverse(), '3m')).toEqual([
      { time: start, open: 10, high: 16, low: 9, close: 15, volume: 9 },
    ])
    expect(nativeGranularity('3m')).toBe(60)
  })
  it('aggregates 4h from hours and Monday-based weekly candles from days', () => {
    const monday = Date.UTC(2026, 7, 31) / 1000
    expect(bucketStart(monday + 6 * 86400, '1W')).toBe(monday)
    expect(bucketStart(monday - 1, '1W')).toBe(monday - 604800)
    const hours = Array.from({ length: 4 }, (_, i) => bar(monday + i * 3600, 10 + i, 11 + i))
    expect(aggregateCandles(hours, '4h')).toEqual([
      { time: monday, open: 10, high: 15, low: 9, close: 14, volume: 4 },
    ])
    expect(nativeGranularity('1W')).toBe(86400)
  })
  it('does not invent candles for no-trade gaps', () => {
    const data = [bar(0, 10, 12), bar(600, 12, 15)]
    expect(aggregateCandles(data, '3m').map((c) => c.time)).toEqual([0, 540])
  })
  it.each(Object.keys(INTERVAL_SECONDS) as Interval[])(
    'paginates %s without exceeding Coinbase limits',
    (interval) => {
      const plan = historyWindows(interval, 900, Date.UTC(2026, 8, 6, 12, 5, 16))
      expect([60, 300, 900, 3600, 86400]).toContain(plan.granularity)
      expect(plan.start).toBe(bucketStart(plan.start, interval))
      expect(plan.windows[0].start).toBe(plan.start)
      expect(plan.windows.at(-1)!.end).toBe(plan.end)
      plan.windows.forEach((window, index) => {
        expect(window.end - window.start).toBeLessThan(300 * plan.granularity)
        if (index)
          expect(window.start).toBe(
            Math.floor(plan.windows[index - 1].end / plan.granularity) * plan.granularity +
              plan.granularity,
          )
      })
    },
  )
  it.each([
    {},
    [[1, 5]],
    [[60, 11, 10, 12, 10, 2]],
    [[60, 9, 13, 10, 11, -1]],
    [[60, 9, 13, 10, Infinity, 2]],
  ])('rejects corrupt OHLCV', (value) => expect(() => parseCandles(value)).toThrow())
  it('fingerprints volume-only updates and historical corrections', () => {
    const data = [bar(0, 10, 12), bar(60, 12, 13)]
    expect(candleFingerprint(data)).not.toBe(candleFingerprint([{ ...data[0], high: 15 }, data[1]]))
    expect(candleFingerprint(data)).not.toBe(
      candleFingerprint([data[0], { ...data[1], volume: 2 }]),
    )
  })
  it('rejects responses for the wrong symbol or timeframe', () => {
    const data = {
      source: 'coinbase',
      product: 'BTC-USD',
      interval: '1m',
      candles: [bar(60, 10, 12)],
      asOf: 60000,
      revision: 1,
    }
    expect(() => validateHistory(data, 'ETH-USD', '1m')).toThrow()
    expect(() => validateHistory(data, 'BTC-USD', '3m')).toThrow()
  })
})
describe('Coinbase quote/catalog validation', () => {
  it('lists only online, enabled USD products with a valid increment', () => {
    const p = { id: 'BTC-USD', quote_currency: 'USD', status: 'online', quote_increment: '.01' }
    expect(
      parseProducts([
        p,
        { ...p, id: 'BNB-USD', trading_disabled: true },
        { ...p, id: 'BTC-EUR', quote_currency: 'EUR' },
        { ...p, id: 'ETH-USD', cancel_only: true },
      ]),
    ).toEqual([{ id: 'BTC-USD', base: 'BTC', quote: 'USD', increment: 0.01 }])
    expect(isProductId('https://evil.example/data')).toBe(false)
  })
  it('computes real 24h changes and never invents missing stats', () => {
    expect(
      parseQuote(
        { price: '120', open_24h: '100', high_24h: '125', low_24h: '99', volume_24h: '8' },
        5,
      ).change,
    ).toBeCloseTo(20)
    expect(parseQuote({ last: '100' }, 5)).toMatchObject({
      price: 100,
      change: null,
      open: null,
      volume: null,
    })
    expect(() => parseQuote({ price: '' }, 5)).toThrow()
  })
})
describe('provisional live candle tracking', () => {
  it('updates a candle and creates the next 3m bucket', () => {
    const tracker = new CandleTracker([bar(0, 10, 11, 2)], '3m', 30000)
    tracker.apply({ product: 'BTC-USD', id: 1, time: 60, price: 14, size: 3 })
    tracker.apply({ product: 'BTC-USD', id: 2, time: 180, price: 12, size: 4 })
    expect(tracker.bars).toEqual([
      { time: 0, open: 10, high: 14, low: 9, close: 14, volume: 5 },
      { time: 180, open: 12, high: 12, low: 12, close: 12, volume: 4 },
    ])
  })
  it('deduplicates trades, respects the REST boundary and handles late trades', () => {
    const tracker = new CandleTracker([bar(0, 10, 11, 2)], '1m', 30000)
    const trade = { product: 'BTC-USD', id: 1, time: 50, price: 15, size: 2 }
    expect(tracker.apply({ ...trade, time: 20 })).toBe(false)
    expect(tracker.apply(trade)).toBe(true)
    expect(tracker.apply(trade)).toBe(false)
    tracker.apply({ ...trade, id: 2, time: 40, price: 8, size: 1 })
    expect(tracker.bars[0]).toMatchObject({ close: 15, low: 8, volume: 5 })
    tracker.seed([bar(0, 10, 14, 9)], 55000)
    expect(tracker.bars[0].volume).toBe(9)
    expect(tracker.apply({ ...trade, id: 3, time: 54 })).toBe(false)
  })
  it('ignores initial last_match snapshots and malformed trades', () => {
    expect(
      parseTrade({
        type: 'last_match',
        product_id: 'BTC-USD',
        trade_id: 1,
        price: '100',
        size: '1',
        time: '2026-09-06T12:00:00Z',
      }),
    ).toBeNull()
    expect(
      parseTrade({
        type: 'match',
        product_id: 'BTC-USD',
        trade_id: 1,
        price: 'no',
        size: '1',
        time: 'bad',
      }),
    ).toBeNull()
    expect(isCandle({})).toBe(false)
  })
})
