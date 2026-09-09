import { describe, expect, it } from 'vitest'
import {
  BURST_WINDOW_SECONDS,
  CALIBRATION_MINIMUM,
  LINGER_SECONDS,
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

/**
 * Push small trades so the tracker calibrates on a realistic distribution.
 *
 * Deliberately dated well before `now` and alternating in direction: calibration must not itself
 * look like a one-sided sweep, and these trades must have aged out of the live window.
 */
function calibrate(tracker: WhaleFlowTracker, now: number, count = CALIBRATION_MINIMUM) {
  const past = now - 60
  for (let i = 0; i < count; i++)
    tracker.apply(trade(i + 1, past, 100, 10 + (i % 5), i % 2 ? 'buy' : 'sell'), past)
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

describe('WhaleFlowTracker: ephemerality', () => {
  it('shows nothing at rest, so no figure is ever left on screen', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    expect(tracker.snapshot(now)).toBeNull()
    calibrate(tracker, now)
    // Ordinary two-sided chatter is not a sweep.
    expect(tracker.snapshot(now)).toBeNull()
  })

  it('clears the figure once the sweep ends, rather than accumulating a total', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const start = 1_000_000
    calibrate(tracker, start)

    tracker.apply(trade(5001, start, 100_000, 5, 'buy'), start)
    expect(tracker.snapshot(start)?.phase).toBe('active')
    expect(tracker.snapshot(start)?.net).toBe(500_000)

    // Still inside the live window.
    expect(tracker.snapshot(start + 2)?.phase).toBe('active')

    // Past the window: the sweep is over, so it lingers only briefly.
    const stopped = start + BURST_WINDOW_SECONDS + 1
    const fading = tracker.snapshot(stopped)
    expect(fading?.phase).toBe('fading')
    expect(fading?.net).toBe(500_000)

    // Past the linger: gone entirely.
    expect(tracker.snapshot(stopped + LINGER_SECONDS + 1)).toBeNull()
  })

  it('does not let an old sweep resurrect after it has cleared', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const start = 1_000_000
    calibrate(tracker, start)
    tracker.apply(trade(5100, start, 100_000, 5, 'buy'), start)
    expect(tracker.snapshot(start)?.phase).toBe('active')

    const wellAfter = start + 3600
    expect(tracker.snapshot(wellAfter)).toBeNull()
    // An hour later it is still silent — there is no rolling total to report.
    expect(tracker.snapshot(wellAfter + 60)).toBeNull()
  })

  it('flags a sweep that is under way but has not yet cleared the threshold', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    // Threshold floors at $50k; two $10k buys reach 40% of it.
    tracker.apply(trade(5201, now, 10_000, 1, 'buy'), now)
    tracker.apply(trade(5202, now, 10_000, 1, 'buy'), now)
    const snap = tracker.snapshot(now)
    expect(snap?.phase).toBe('building')
    expect(snap?.net).toBe(20_000)
  })

  it('escalates from building to active as the sweep grows', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    tracker.apply(trade(5301, now, 10_000, 1, 'buy'), now)
    tracker.apply(trade(5302, now, 10_000, 1, 'buy'), now)
    expect(tracker.snapshot(now)?.phase).toBe('building')
    tracker.apply(trade(5303, now + 1, 100_000, 4, 'buy'), now + 1)
    const snap = tracker.snapshot(now + 1)
    expect(snap?.phase).toBe('active')
    expect(snap?.net).toBe(420_000)
  })

  it('reports the peak of the sweep while it fades, not a partially evicted remnant', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const start = 1_000_000
    calibrate(tracker, start)
    // A sweep that peaks and then tails off.
    tracker.apply(trade(5401, start, 100_000, 8, 'buy'), start)
    expect(tracker.snapshot(start)?.net).toBe(800_000)
    tracker.apply(trade(5402, start + 1, 100_000, 2, 'buy'), start + 1)
    expect(tracker.snapshot(start + 1)?.net).toBe(1_000_000)

    const fading = tracker.snapshot(start + BURST_WINDOW_SECONDS + 2)
    expect(fading?.phase).toBe('fading')
    // The peak of the sweep, not whatever happened to remain in the window.
    expect(fading?.net).toBe(1_000_000)
  })

  it('lets a fresh sweep take over from a fading one', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const start = 1_000_000
    calibrate(tracker, start)
    tracker.apply(trade(5501, start, 100_000, 5, 'buy'), start)
    expect(tracker.snapshot(start)?.phase).toBe('active')

    const later = start + BURST_WINDOW_SECONDS + 1
    expect(tracker.snapshot(later)?.phase).toBe('fading')

    // A new sweep in the opposite direction during the linger wins.
    tracker.apply(trade(5502, later, 100_000, 9, 'sell'), later)
    const fresh = tracker.snapshot(later)
    expect(fresh?.phase).toBe('active')
    expect(fresh?.net).toBe(-900_000)
  })
})

describe('WhaleFlowTracker: measurement', () => {
  it('reports uncalibrated until enough trades are sampled', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    expect(tracker.calibrated).toBe(false)
    calibrate(tracker, now)
    expect(tracker.calibrated).toBe(true)
    expect(tracker.sampled).toBeGreaterThanOrEqual(CALIBRATION_MINIMUM)
  })

  it('never treats dust as a whale sweep, however thin the book', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    // A market of dust: every trade is $10.
    for (let i = 0; i < 400; i++) tracker.apply(trade(i + 1, now - 60, 1, 10, 'sell'), now - 60)
    expect(tracker.threshold).toBeGreaterThanOrEqual(MINIMUM_THRESHOLD)
    // A $100 trade is huge relative to this book but still economically irrelevant.
    tracker.apply(trade(9001, now, 1, 100, 'buy'), now)
    expect(tracker.snapshot(now)).toBeNull()
  })

  it('signs flow by aggressor: buys positive, sells negative', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    tracker.apply(trade(6001, now, 100_000, 5, 'buy'), now)
    tracker.apply(trade(6002, now, 100_000, 2, 'sell'), now)
    const snap = tracker.snapshot(now)
    expect(snap?.bought).toBe(500_000)
    expect(snap?.sold).toBe(200_000)
    expect(snap?.net).toBe(300_000)
    expect(snap?.count).toBe(2)
  })

  it('excludes trades with an unknown aggressor from directional flow', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(6101, now, 100_000, 5, null), now)).toBe(false)
    expect(tracker.snapshot(now)).toBeNull()
  })

  it('still counts unknown-aggressor trades toward threshold calibration', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    for (let i = 0; i < CALIBRATION_MINIMUM; i++)
      tracker.apply(trade(i + 1, now, 100, 10, null), now)
    expect(tracker.calibrated).toBe(true)
  })

  it('ignores duplicate trade IDs replayed across reconnects', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(7001, now, 100_000, 5, 'buy'), now)).toBe(true)
    expect(tracker.apply(trade(7001, now, 100_000, 5, 'buy'), now)).toBe(false)
    expect(tracker.snapshot(now)?.net).toBe(500_000)
  })

  it('windows on arrival time so venue clock skew cannot distort a 5s window', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    // Exchange timestamp is minutes stale, but it arrived just now.
    tracker.apply(trade(7101, now - 600, 100_000, 5, 'buy'), now)
    const snap = tracker.snapshot(now)
    expect(snap?.phase).toBe('active')
    // Display keeps the exchange timestamp.
    expect(snap?.prints[0].time).toBe(now - 600)
  })

  it('adapts the threshold to the product rather than using a fixed dollar amount', () => {
    const now = 1_000_000
    const liquid = new WhaleFlowTracker('BTC-USD')
    for (let i = 0; i < 400; i++) liquid.apply(trade(i + 1, now, 100_000, 1, null), now)
    const thin = new WhaleFlowTracker('SOL-USD')
    for (let i = 0; i < 400; i++) thin.apply(trade(i + 1, now, 200, 1, null), now)
    expect(liquid.threshold).toBeGreaterThan(thin.threshold)
  })

  it('clamps intensity so an extreme sweep cannot overflow the meter', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    tracker.apply(trade(7201, now, 100_000, 500, 'buy'), now)
    expect(tracker.snapshot(now)?.intensity).toBe(4)
  })

  it('caps transported prints and returns them newest first', () => {
    const tracker = new WhaleFlowTracker('BTC-USD', { maxPrints: 3, windowSeconds: 30 })
    const now = 1_000_000
    calibrate(tracker, now)
    for (let i = 0; i < 10; i++) tracker.apply(trade(9100 + i, now + i, 100_000, 5, 'buy'), now + i)
    const snap = tracker.snapshot(now + 10)
    expect(snap?.prints).toHaveLength(3)
    expect(snap!.prints[0].time).toBeGreaterThan(snap!.prints[1].time)
  })

  it('rejects malformed trades without corrupting the window', () => {
    const tracker = new WhaleFlowTracker('BTC-USD')
    const now = 1_000_000
    calibrate(tracker, now)
    expect(tracker.apply(trade(9500, now, Number.NaN, 5, 'buy'), now)).toBe(false)
    expect(tracker.apply(trade(9501, now, 100_000, -5, 'buy'), now)).toBe(false)
    expect(tracker.apply(trade(9502.5, now, 100_000, 5, 'buy'), now)).toBe(false)
    expect(tracker.snapshot(now)).toBeNull()
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
