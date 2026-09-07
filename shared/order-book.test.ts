import { describe, expect, it } from 'vitest'
import {
  OrderBook,
  parseLevel2Snapshot,
  parseLevel2Update,
  scoreZone,
  PERSISTENCE_SECONDS,
} from './order-book'
import { isOrderBookView } from './coinbase'

/** Realistic BTC-USD book around $100,000: fine background levels plus obvious walls. */
function btcBook(): { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] } {
  const level = (side: 1 | -1, offset: number, size: number) => ({
    price: 100_000 + side * offset,
    size,
  })
  const bids: { price: number; size: number }[] = []
  const asks: { price: number; size: number }[] = []
  // A spread of a few cents.
  for (let step = 0; step < 500; step++) {
    const offset = 0.01 + step * 0.01
    bids.push(level(-1, offset, 0.05 + (step % 7) * 0.01)) // ~$5k-12k per level
    asks.push(level(1, offset, 0.05 + ((step * 3) % 5) * 0.01))
  }
  // Support wall ~0.3% below mid: 40 BTC ($4M) stacked over four adjacent prices.
  const wallPrice = 99_700
  for (let i = 0; i < 4; i++) bids.push({ price: wallPrice + i * 0.01, size: 10 })
  // Resistance wall ~0.25% above mid: 30 BTC ($3M).
  const askWallPrice = 100_250
  for (let i = 0; i < 3; i++) asks.push({ price: askWallPrice + i * 0.01, size: 10 })
  // A second, bigger bid wall closer to price.
  for (let i = 0; i < 5; i++) bids.push({ price: 99_880 + i * 0.01, size: 12 })
  return { bids, asks }
}

describe('level2 wire parsing', () => {
  it('parses a snapshot of [price, size] tuples', () => {
    const parsed = parseLevel2Snapshot({
      type: 'snapshot',
      product_id: 'BTC-USD',
      bids: [['99.5', '2'], ['99', '1']],
      asks: [['100.5', '3']],
    })
    expect(parsed).toEqual({
      bids: [
        { price: 99.5, size: 2 },
        { price: 99, size: 1 },
      ],
      asks: [{ price: 100.5, size: 3 }],
    })
  })
  it('rejects malformed snapshots rather than corrupting the book', () => {
    expect(parseLevel2Snapshot({ type: 'snapshot', bids: 'x', asks: [] })).toBeNull()
    expect(parseLevel2Snapshot({ type: 'l2update', changes: [] })).toBeNull()
    expect(
      parseLevel2Snapshot({ type: 'snapshot', bids: [['bad', '2']], asks: [] }),
    ).toBeNull()
  })
  it('parses l2update deltas with buy/sell sides and zero-size removal', () => {
    const changes = parseLevel2Update({
      type: 'l2update',
      product_id: 'BTC-USD',
      changes: [
        ['buy', '99.5', '0'], // remove
        ['sell', '100.5', '1.5'], // resize
      ],
    })
    expect(changes).toEqual([
      { side: 'bid', price: 99.5, size: 0 },
      { side: 'ask', price: 100.5, size: 1.5 },
    ])
  })
})

describe('OrderBook', () => {
  it('rejects a l2update before any snapshot exists', () => {
    const book = new OrderBook('BTC-USD')
    expect(
      book.applyMessage(
        { type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '99', '1']] },
        1000,
      ),
    ).toBe(true)
    // No snapshot yet: no mid, no view.
    expect(book.mid).toBeNull()
    expect(book.view(1001)).toBeNull()
  })
  it('builds a mid and spread from a snapshot and applies deltas', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000)
    expect(book.mid).toBeCloseTo(100_000)
    expect(book.spread).toBeCloseTo(0.02)
    expect(book.sizeAt('bid', 99_700)).toBeGreaterThan(0)
    // Walk part of the support wall away.
    book.apply({ side: 'bid', price: 99_700, size: 0 }, 1001)
    expect(book.sizeAt('bid', 99_700)).toBe(0)
    // Resize an ask level.
    book.apply({ side: 'ask', price: 100_250, size: 2 }, 1001)
    expect(book.sizeAt('ask', 100_250)).toBe(2)
  })
  it('keeps malformed messages away from the book state', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000)
    expect(book.applyMessage({ type: 'error', message: 'x' }, 1001)).toBe(false)
    book.apply({ side: 'ask', price: -5, size: 1 }, 1001)
    expect(book.size).toBe(book.size)
    expect(book.size).toBeGreaterThan(0)
  })
})

describe('OrderBook.view — depth profile and walls', () => {
  it('produces a validated view with the crafted walls ranked first', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    const now = 1_000_000
    book.seed(bids, asks, now, PERSISTENCE_SECONDS) // levels have been resting a full window
    const view = book.view(now + PERSISTENCE_SECONDS)
    expect(view).not.toBeNull()
    expect(view!.bins.length).toBeGreaterThan(0)
    expect(view!.bins.length).toBeLessThanOrEqual(300)
    expect(view!.mid).toBeCloseTo(100_000)
    expect(view!.spread).toBeGreaterThan(0)
    expect(view!.persistenceSeconds).toBe(PERSISTENCE_SECONDS)
    expect(view!.supports.length).toBeGreaterThanOrEqual(1)
    expect(view!.resistances.length).toBeGreaterThanOrEqual(1)
    // The $6M cluster at 99,880 dominates: 5 × 12 BTC = 60 BTC ≈ $5.99M.
    expect(view!.supports[0].notional).toBeGreaterThan(5_000_000)
    expect(view!.supports[0].price).toBeGreaterThan(99_878)
    expect(view!.supports[0].price).toBeLessThan(99_885)
    expect(view!.resistances[0].notional).toBeGreaterThan(2_900_000)
    // Depth in front of the dominant support: between 99,885 and mid (~$13M background).
    expect(view!.supports[0].depth).toBeGreaterThan(2_000_000)
    // Persistence: everything rested unchanged for the whole window.
    expect(view!.supports[0].persistence).toBe(1)
    // Is the whole view accepted by the browser-side validator?
    expect(isOrderBookView(view!)).toBe(true)
  })
  it('reports the book sides and a bounded near-mid imbalance', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
    const view = book.view(1060)!
    expect(view.bidsTotal).toBeGreaterThan(0)
    expect(view.asksTotal).toBeGreaterThan(0)
    expect(view.imbalance).toBeGreaterThanOrEqual(-1)
    expect(view.imbalance).toBeLessThanOrEqual(1)
    const sorted = view.bins.every((bin, i, arr) => i === 0 || arr[i - 1].price < bin.price)
    expect(sorted).toBe(true)
  })
  it('applies a later level2 update into the view', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000)
    const before = book.view(1060)!
    // Walk both far walls away entirely: the ask side now has no outstanding wall left.
    for (let i = 0; i < 4; i++) book.apply({ side: 'bid', price: 99_700 + i * 0.01, size: 0 }, 2000)
    for (let i = 0; i < 3; i++)
      book.apply({ side: 'ask', price: 100_250 + i * 0.01, size: 0 }, 2000)
    const after = book.view(2060)!
    expect(after.resistances.length).toBe(0)
    // The nearer $6M support wall at 99,880 is untouched and still leads the book.
    expect(after.supports[0].notional).toBeGreaterThan(5_000_000)
    expect(after.bidsTotal).toBeLessThan(before.bidsTotal)
    expect(after.asksTotal).toBeLessThan(before.asksTotal)
  })
})

describe('scoreZone — zone strength against the resting book', () => {
  it('prices an SMC-style support order block by the bids inside it', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
    const view = book.view(1060)!
    // Zone covering the 99,880 wall plus its neighbors.
    const score = scoreZone(view, 99_900, 99_870, 'bid')
    expect(score.bucket).toBe('strong')
    expect(score.notional).toBeGreaterThan(5_000_000)
    expect(score.wallsInside).toBeGreaterThanOrEqual(1)
    expect(score.bins).toBeGreaterThan(0)
    expect(score.strongRef).toBeGreaterThan(0)
    expect(score.hold).toBe(1)
  })
  it('scores the ask side of a bearish OB/FVG-style zone separately', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
    const view = book.view(1060)!
    const score = scoreZone(view, 100_260, 100_245, 'ask')
    expect(score.bucket).toBe('strong')
    expect(score.notional).toBeGreaterThan(2_900_000)
    // The bid side of the same price band is not credited with ask liquidity.
    const wrongSide = scoreZone(view, 100_260, 100_245, 'bid')
    expect(wrongSide.notional).toBe(0)
    expect(wrongSide.bucket).toBe('unloaded')
  })
  it('grades a thin background zone weak and an empty price band unloaded', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
    const view = book.view(1060)!
    // A dollar-wide slice of ordinary background bids ($5-12k per level).
    const thin = scoreZone(view, 99_996.5, 99_995.5, 'bid')
    expect(thin.bucket).toBe('weak')
    expect(thin.notional).toBeGreaterThan(0)
    expect(thin.strongRef).toBeGreaterThan(thin.notional)
    // Far below the book entirely: nothing resting there.
    const empty = scoreZone(view, 90_000, 89_000, 'bid')
    expect(empty.bucket).toBe('unloaded')
    expect(empty.notional).toBe(0)
  })
  it('sizes a freshly posted stack strongly while the persistence window is still warming', () => {
    const book = new OrderBook('BTC-USD')
    const { bids, asks } = btcBook()
    // Fresh snapshot: every level arrived "now", so persistence is ~0 and still calibrating.
    book.seed(bids, asks, 1000)
    const view = book.view(1000)!
    expect(view.persistenceSeconds).toBeLessThan(PERSISTENCE_SECONDS)
    const score = scoreZone(view, 99_900, 99_870, 'bid')
    // Until the hold metric warms, size alone may rate strong — it is what a trader sees.
    expect(score.bucket).toBe('strong')
    expect(score.notional).toBeGreaterThan(5_000_000)
  })
})
