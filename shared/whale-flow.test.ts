import { describe, expect, it } from 'vitest'
import {
  CALIBRATION_MINIMUM,
  MINIMUM_THRESHOLD,
  WhaleFlowTracker,
  formatNotional,
} from './whale-flow'
import { parseTrade } from './coinbase'

const trade = (
  id: number,
  time: number,
  price: number,
  size: number,
  takerSide: 'buy' | 'sell' | null = 'buy',
) => ({ id, time, price, size, takerSide })

/** Push `count` small trades so the tracker calibrates on a realistic distribution. */
function calibrate(tracker: WhaleFlowTracker, now: number, count = CALIBRATION_MINIMUM) {
  for (let i = 0; i < count; i++)
    // Notionals cluster around $1,000 with mild spread.
    tracker.apply(trade(i + 1, now, 100, 10 + (i % 5)), now)
  return count
}

describe('taker side derivation', () => {
  it('inverts the documented Coinbase maker side into the aggressor side', () => {
    // Coinbase: "The side field indicates the maker order side. If the side is sell this
    // indicates the maker was a sell order and the match is considered an up-tick."
    const upTick = parseTrade({
      type: 'match',
      product_id: 'BTC-USD',
      trade_id: 1,
      price: '100',
      size: '1',
      time: '2026-09-06T12:00:00Z',
      side: 'sell',
    })
    expect(upTick?.takerSide).toBe('buy')

    const downTick = parseTrade({
      type: 'match',
      product_id: 'BTC-USD',
      trade_id: 2,
      price: '100',
      size: '1',
      time: '2026-09-06T12:00:00Z',
      side: 'buy',
    })
    expect(downTick?.takerSide).toBe('sell')
  })
  it('leaves takerSide null when side is missing or malformed', () => {
    const base = {
      type: 'match',
      product_id: 'BTC-USD',
      trade_id: 3,
      price: '100',
      size: '1',
      time: '2026-09-06T12:00:00Z',
    }
    expect(parseTrade(base)?.takerSide).toBeNull()
    expect(parseTrade({ ...base, side: 'nonsense' })?.takerSide).toBeNull()
  })
})

describe('WhaleFlowTracker', () => {
  it('reports uncalibrated until enough trades are sampled', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    expect(tracker.calibrated).toBe(false)
    expect(tracker.snapshot(now).calibrated).toBe(false)
    calibrate(tracker, now)
    expect(tracker.calibrated).toBe(true)
    expect(tracker.snapshot(now).sampled).toBeGreaterThanOrEqual(CALIBRATION_MINIMUM)
  })

  it('never marks a trade below the absolute floor as a whale print', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    // A market of dust: every trade is $10.
    for (let i = 0; i < 400; i++) tracker.apply(trade(i + 1, now, 1, 10), now)
    expect(tracker.threshold).toBeGreaterThanOrEqual(MINIMUM_THRESHOLD)
    // A $100 trade is huge relative to this book but still economically irrelevant.
    expect(tracker.apply(trade(9001, now, 1, 100), now)).toBeNull()
    expect(tracker.snapshot(now).count).toBe(0)
  })

  it('signs notional by aggressor: buys positive, sells negative', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)

    const buy = tracker.apply(trade(5001, now, 100_000, 5, 'buy'), now)
    expect(buy?.notional).toBe(500_000)
    const sell = tracker.apply(trade(5002, now, 100_000, 2, 'sell'), now)
    expect(sell?.notional).toBe(-200_000)

    const snap = tracker.snapshot(now)
    expect(snap.bought).toBe(500_000)
    expect(snap.sold).toBe(200_000)
    expect(snap.net).toBe(300_000)
    expect(snap.count).toBe(2)
  })

  it('excludes trades with an unknown aggressor from directional flow', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(6001, now, 100_000, 5, null), now)).toBeNull()
    expect(tracker.snapshot(now).count).toBe(0)
  })

  it('ignores duplicate trade IDs replayed across reconnects', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(7001, now, 100_000, 5, 'buy'), now)).not.toBeNull()
    expect(tracker.apply(trade(7001, now, 100_000, 5, 'buy'), now)).toBeNull()
    expect(tracker.snapshot(now).net).toBe(500_000)
  })

  it('evicts prints once they age out of the rolling window', () => {
    const tracker = new WhaleFlowTracker('BTC-USD', { windowSeconds: 600 })
    const start = 1_000_000
    calibrate(tracker, start)
    tracker.apply(trade(8001, start, 100_000, 5, 'buy'), start)
    expect(tracker.snapshot(start).count).toBe(1)
    // 11 minutes later the print is outside a 10-minute window.
    const later = start + 660
    expect(tracker.snapshot(later).count).toBe(0)
    expect(tracker.snapshot(later).net).toBe(0)
  })

  it('adapts the threshold to the product rather than using a fixed dollar amount', () => {
    const now = 1_000_000
    const liquid = new WhaleFlowTracker('BTC-USD')
    for (let i = 0; i < 400; i++) liquid.apply(trade(i + 1, now, 100_000, 1), now)
    const thin = new WhaleFlowTracker('SOL-USD')
    for (let i = 0; i < 400; i++) thin.apply(trade(i + 1, now, 200, 1), now)
    // The liquid book demands a far larger print to qualify.
    expect(liquid.threshold).toBeGreaterThan(thin.threshold)
  })

  it('caps transported prints and returns them newest first', () => {
    const tracker = new WhaleFlowTracker('BTC-USD', { maxPrints: 3 })
    const now = 1_000_000
    calibrate(tracker, now)
    for (let i = 0; i < 10; i++) tracker.apply(trade(9100 + i, now + i, 100_000, 5, 'buy'), now + i)
    const snap = tracker.snapshot(now + 10)
    expect(snap.prints).toHaveLength(3)
    expect(snap.prints[0].time).toBeGreaterThan(snap.prints[1].time)
  })

  it('rejects malformed trades without corrupting the window', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(9500, now, Number.NaN, 5, 'buy'), now)).toBeNull()
    expect(tracker.apply(trade(9501, now, 100_000, -5, 'buy'), now)).toBeNull()
    expect(tracker.apply(trade(9502.5, now, 100_000, 5, 'buy'), now)).toBeNull()
    expect(tracker.snapshot(now).count).toBe(0)
    expect(Number.isFinite(tracker.snapshot(now).net)).toBe(true)
  })
})

describe('formatNotional', () => {
  it('formats the magnitudes a trader scans', () => {
    expect(formatNotional(100_000)).toBe('+$100K')
    expect(formatNotional(-20_000_000)).toBe('-$20.0M')
    expect(formatNotional(1_240_000)).toBe('+$1.24M')
    expect(formatNotional(2_500_000_000)).toBe('+$2.50B')
    expect(formatNotional(0)).toBe('$0')
  })
  it('degrades safely on non-finite input', () => {
    expect(formatNotional(Number.NaN)).toBe('—')
    expect(formatNotional(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
