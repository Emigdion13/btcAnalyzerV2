import { describe, expect, it } from 'vitest'
import { PERSISTENCE_SECONDS } from '../../shared/order-book'
import type {
  OrderBookBin,
  OrderBookView,
  OrderBookWall,
  WhaleFlow,
  WhalePrint,
} from '../../shared/coinbase'
import type { LevelReference, LevelStrengthSummary } from './market-agents'
import {
  WHALE_ABSORPTION_FLIP,
  WHALE_FLIP_WALL_RATIO,
  WHALE_LEVEL_REACH_ATR,
  whaleLevelContext,
  type WhaleLevelFrame,
} from './whale-level-context'

/** Price/ATR the fixtures are built around: a level 0.4 ATR away is a level 4 away. */
const PRICE = 100
const ATR = 10

function level(overrides: Partial<LevelReference> = {}): LevelReference {
  return {
    price: PRICE,
    top: PRICE,
    bottom: PRICE,
    source: 'sr-zone',
    strength: 0.7,
    distanceAtr: 0.4,
    touches: 8,
    state: 'intact',
    ...overrides,
  }
}

/** A resistance band one ATR wide, sitting `distanceAtr` above price. */
function resistance(distanceAtr = 0.4, overrides: Partial<LevelReference> = {}): LevelReference {
  const price = PRICE + distanceAtr * ATR
  return level({
    price,
    bottom: price,
    top: price + ATR,
    distanceAtr,
    ...overrides,
  })
}

/** A support band one ATR wide, sitting `distanceAtr` below price. */
function support(distanceAtr = 0.4, overrides: Partial<LevelReference> = {}): LevelReference {
  const price = PRICE - distanceAtr * ATR
  return level({
    price,
    top: price,
    bottom: price - ATR,
    distanceAtr,
    ...overrides,
  })
}

function summary(
  nearestSupport: LevelReference | null = null,
  nearestResistance: LevelReference | null = null,
): LevelStrengthSummary {
  return {
    nearestSupport,
    nearestResistance,
    supportPressure: 0,
    resistancePressure: 0,
    imbalance: 0,
  }
}

/**
 * A resting book with a thin, even background and explicit walls.
 *
 * Background slices are deliberately tiny so a zone with no wall in it reads as dust next to any
 * real sweep — which is the point: the classifier must not mistake a book's own texture for size.
 */
function bookView(options: {
  askWall?: { price: number; notional: number; persistence?: number } | null
  bidWall?: { price: number; notional: number; persistence?: number } | null
  persistenceSeconds?: number
  binNotional?: number
}): OrderBookView {
  const step = 1
  const bins: OrderBookBin[] = []
  const binNotional = options.binNotional ?? 50
  for (let price = PRICE - 30; price <= PRICE + 30; price += step)
    bins.push({ price, bid: binNotional, ask: binNotional, hold: 1 })
  const wall = (
    value: { price: number; notional: number; persistence?: number },
    side: 'bid' | 'ask',
  ): OrderBookWall => ({
    side,
    price: value.price,
    notional: value.notional,
    depth: 0,
    peak: value.notional,
    persistence: value.persistence ?? 1,
  })
  return {
    product: 'BTC-USD',
    asOf: 1_700_000_000,
    mid: PRICE,
    spread: 0.05,
    step,
    bottom: PRICE - 30,
    top: PRICE + 30,
    imbalance: 0,
    bidsTotal: bins.length * binNotional,
    asksTotal: bins.length * binNotional,
    bins,
    supports: options.bidWall ? [wall(options.bidWall, 'bid')] : [],
    resistances: options.askWall ? [wall(options.askWall, 'ask')] : [],
    persistenceSeconds: options.persistenceSeconds ?? PERSISTENCE_SECONDS,
  }
}

function flow(overrides: Partial<WhaleFlow> = {}): WhaleFlow {
  return {
    product: 'BTC-USD',
    phase: 'active',
    net: 500_000,
    bought: 500_000,
    sold: 0,
    count: 9,
    threshold: 250_000,
    windowSeconds: 5,
    intensity: 2,
    prints: [],
    calibrated: true,
    sampled: 1_200,
    ...overrides,
  }
}

const sell = (overrides: Partial<WhaleFlow> = {}) =>
  flow({ net: -500_000, bought: 0, sold: 500_000, ...overrides })

const prints = (prices: number[], side: 'buy' | 'sell'): WhalePrint[] =>
  prices.map((price, index) => ({
    id: index + 1,
    time: 1_700_000_000 + index,
    price,
    size: 5,
    notional: side === 'buy' ? price * 5 : -price * 5,
    side,
  }))

function frame(overrides: Partial<WhaleLevelFrame> = {}): WhaleLevelFrame {
  return {
    price: PRICE,
    atr: ATR,
    levels: summary(null, resistance()),
    book: null,
    ...overrides,
  }
}

/** A wall several times the size of the sweep, resting inside the resistance band. */
const bigAskWall = { price: PRICE + 0.4 * ATR + 2, notional: 1_500_000 }
/** A wall several times the size of the sweep, resting below price. */
const bigBidWall = { price: PRICE - 0.5 * ATR, notional: 1_500_000 }

describe('whaleLevelContext', () => {
  it('leaves the raw tape read alone when there is nothing to judge it against', () => {
    const open = whaleLevelContext(flow(), frame({ levels: summary(null, null) }))
    expect(open.verdict).toBe('clear')
    expect(open.multiplier).toBe(1)
    expect(open.flip).toBe(false)
    expect(open.confidence).toBe(0)
    expect(open.reason).toContain('raw tape read stands on its own')
    expect(open.warnings).toEqual([])

    // No frame at all, a flat net, or a useless ATR must never invent a verdict.
    expect(whaleLevelContext(flow(), frame({ levels: null })).verdict).toBe('clear')
    expect(whaleLevelContext(flow({ net: 0 }), frame()).verdict).toBe('clear')
    expect(whaleLevelContext(flow(), frame({ atr: 0 })).verdict).toBe('clear')
    expect(whaleLevelContext(flow({ net: 0 }), frame()).reason).toBeNull()
  })

  it('stays neutral past the reach of the nearest level but still names it', () => {
    const far = whaleLevelContext(
      flow(),
      frame({ levels: summary(null, resistance(WHALE_LEVEL_REACH_ATR + 1.5)) }),
    )
    expect(far.verdict).toBe('clear')
    expect(far.multiplier).toBe(1)
    expect(far.reason).toContain(`${(WHALE_LEVEL_REACH_ATR + 1.5).toFixed(2)} ATR above`)
    expect(Number(far.metrics.levelDistanceAtr)).toBeCloseTo(WHALE_LEVEL_REACH_ATR + 1.5, 6)
  })

  it('damps a sweep pressing into a close level it cannot see defended', () => {
    const into = whaleLevelContext(flow(), frame())
    expect(into.verdict).toBe('absorbed')
    expect(into.flip).toBe(false)
    expect(into.multiplier).toBeLessThan(1)
    expect(into.multiplier).toBeGreaterThan(0.5)
    expect(into.confidence).toBeLessThan(0)
    expect(into.reason).toBeNull()
    expect(into.warnings[0]).toContain('pressing into resistance at 104.00')
    expect(into.warnings[0]).toContain('resting book is unavailable')
    expect(into.warnings[0]).toContain('% of its raw strength')
  })

  it('never flips against executed money on chart evidence alone', () => {
    // The strongest level a chart can offer: right at price, maximum strength, dozens of touches.
    const strongest = whaleLevelContext(
      flow(),
      frame({
        levels: summary(null, resistance(0.05, { strength: 1, touches: 60, source: 'pivot' })),
      }),
    )
    expect(strongest.verdict).toBe('absorbed')
    expect(strongest.absorption).toBeLessThan(WHALE_ABSORPTION_FLIP)
    expect(strongest.flip).toBe(false)
    expect(strongest.multiplier).toBeGreaterThan(0.5)
  })

  it('flips the vote when resting size bigger than the sweep holds the level', () => {
    const faded = whaleLevelContext(flow(), frame({ book: bookView({ askWall: bigAskWall }) }))
    expect(faded.verdict).toBe('absorbed')
    expect(faded.absorption).toBeGreaterThanOrEqual(WHALE_ABSORPTION_FLIP)
    expect(faded.flip).toBe(true)
    expect(faded.multiplier).toBeLessThan(0.5)
    expect(faded.reason).toContain('turns bearish')
    expect(faded.reason).toContain('$1.50M of resting asks')
    expect(faded.warnings[0]).toContain('cast against $500K of executed buying')
    expect(faded.warnings[0]).toContain('pulled in seconds')
    expect(faded.metrics.levelFlip).toBe(true)
    expect(faded.metrics.levelBucket).toBe('strong')
  })

  it('keeps the vote with the tape when the level is close but the size is dust', () => {
    const dust = whaleLevelContext(flow(), frame({ book: bookView({ askWall: null }) }))
    expect(dust.verdict).toBe('absorbed')
    expect(dust.flip).toBe(false)
    expect(Number(dust.metrics.levelWallNotional)).toBeLessThan(500_000 * WHALE_FLIP_WALL_RATIO)
    // Dust is still dust next to the sweep, and the line says so.
    expect(dust.warnings[0]).toContain('dust next to the sweep')
    expect(dust.multiplier).toBeGreaterThan(0.5)
  })

  it('reads a sweep that traded the whole level as a break', () => {
    // The band runs 104 → 114; the sweep's own fills printed above it and nothing rests there.
    const through = whaleLevelContext(
      flow({ net: 1_200_000, bought: 1_200_000, prints: prints([114.5, 115, 115.5], 'buy') }),
      frame({ book: bookView({ askWall: null }) }),
    )
    expect(through.verdict).toBe('break')
    expect(through.multiplier).toBeGreaterThan(1)
    expect(through.confidence).toBeGreaterThan(0)
    expect(Number(through.metrics.levelPenetration)).toBe(1)
    expect(through.reason).toContain('traded through resistance at 104.00')
    expect(through.reason).toContain('failing under the push')
    expect(through.warnings[0]).toContain('not a level cleared')
  })

  it('does not call a break while a bigger wall is still resting there', () => {
    const held = whaleLevelContext(
      flow({ prints: prints([114.5, 115], 'buy') }),
      frame({ book: bookView({ askWall: bigAskWall }) }),
    )
    expect(Number(held.metrics.levelPenetration)).toBe(1)
    expect(held.verdict).toBe('absorbed')
    // Walking the whole band and still not through the size is heavy absorption either way.
    expect(held.multiplier).toBeLessThan(0.6)
    // Progress into the level is credited: absorption drops as the sweep eats the band.
    const notWalked = whaleLevelContext(flow(), frame({ book: bookView({ askWall: bigAskWall }) }))
    expect(held.absorption).toBeLessThan(notWalked.absorption)
    expect(held.absorption).toBeGreaterThan(0.5)
  })

  it('boosts a sweep pressing off a level the book is defending behind it', () => {
    // Path ahead is open (resistance far away), a big bid wall rests half an ATR below.
    const bounced = whaleLevelContext(
      flow(),
      frame({
        levels: summary(support(4), resistance(4)),
        book: bookView({ bidWall: bigBidWall }),
      }),
    )
    expect(bounced.verdict).toBe('defended')
    expect(bounced.multiplier).toBeGreaterThan(1)
    expect(bounced.confidence).toBeGreaterThan(0)
    expect(bounced.warnings).toEqual([])
    expect(bounced.reason).toContain('pressing off a $1.50M bid wall 0.50 ATR below price')
    expect(bounced.metrics.levelSource).toBe('book-wall')
  })

  it('needs material size behind the push before it calls a level defended', () => {
    const thin = whaleLevelContext(
      flow(),
      frame({
        levels: summary(support(4), resistance(4)),
        book: bookView({ bidWall: { price: PRICE - 5, notional: 20_000 } }),
      }),
    )
    expect(thin.verdict).toBe('clear')
    expect(thin.multiplier).toBe(1)
  })

  it('treats a resting wall with no chart level as an obstacle in its own right', () => {
    // A sell sweep with no support level anywhere, but $1.5M of bids half an ATR below.
    const intoWall = whaleLevelContext(
      sell(),
      frame({ levels: summary(null, null), book: bookView({ bidWall: bigBidWall }) }),
    )
    expect(intoWall.verdict).toBe('absorbed')
    expect(intoWall.flip).toBe(true)
    expect(intoWall.reason).toContain('pressing into a $1.50M bid wall 0.50 ATR below price')
    expect(intoWall.reason).toContain('turns bullish')
    expect(intoWall.metrics.levelRole).toBe('support')
    expect(intoWall.metrics.levelSource).toBe('book-wall')
  })

  it('mirrors every read for a sell sweep', () => {
    const book = bookView({ askWall: bigAskWall })
    // The same wall that fades a buy sweep is a defended ceiling a sell sweep rejects off.
    const rejecting = whaleLevelContext(sell(), frame({ book }))
    expect(rejecting.verdict).toBe('defended')
    expect(rejecting.multiplier).toBeGreaterThan(1)
    expect(rejecting.reason).toContain('pressing off resistance at 104.00')

    // And a sell sweep into a defended support band flips the other way.
    const intoSupport = whaleLevelContext(
      sell(),
      frame({
        levels: summary(support(0.4), null),
        book: bookView({ bidWall: { price: PRICE - 0.4 * ATR - 2, notional: 1_500_000 } }),
      }),
    )
    expect(intoSupport.verdict).toBe('absorbed')
    expect(intoSupport.flip).toBe(true)
    expect(intoSupport.reason).toContain('pressing into support at 96.00')
  })

  it('reads the level ahead before the level behind', () => {
    // Defended floor below *and* a defended ceiling above: the obstacle in the path wins.
    const both = whaleLevelContext(
      flow(),
      frame({
        levels: summary(support(0.5), resistance(0.4)),
        book: bookView({ askWall: bigAskWall, bidWall: bigBidWall }),
      }),
    )
    expect(both.verdict).toBe('absorbed')
    expect(both.flip).toBe(true)
  })

  it('says when the level behind is defended even while the level ahead wins', () => {
    // A close level with only dust in it, but a real wall behind the push.
    const mixed = whaleLevelContext(
      flow(),
      frame({
        levels: summary(null, resistance(0.4)),
        book: bookView({ askWall: null, bidWall: bigBidWall }),
      }),
    )
    expect(mixed.verdict).toBe('absorbed')
    expect(mixed.flip).toBe(false)
    expect(mixed.warnings.join(' ')).toContain('level behind the push is defended too')
    expect(mixed.warnings.join(' ')).toContain('a cut, not a reversal')
  })

  it('is more careful while the persistence window is still warming', () => {
    const warming = whaleLevelContext(
      flow(),
      frame({ book: bookView({ askWall: bigAskWall, persistenceSeconds: 5 }) }),
    )
    const warmed = whaleLevelContext(flow(), frame({ book: bookView({ askWall: bigAskWall }) }))
    expect(warming.absorption).toBeLessThan(warmed.absorption)
    expect(warming.reason ?? warming.warnings.join(' ')).toContain('persistence is still warming')
  })

  it('ignores resting size on the wrong side of price', () => {
    // An ask wall below price is stale book; it must not read as an obstacle ahead of a buy sweep.
    const stale = whaleLevelContext(
      flow(),
      frame({
        levels: summary(null, null),
        book: bookView({ askWall: { price: PRICE - 4, notional: 1_500_000 } }),
      }),
    )
    expect(stale.verdict).toBe('clear')
    expect(stale.multiplier).toBe(1)
  })

  it('measures penetration from the sweep side of the fills only', () => {
    // A buy sweep whose sell-side prints went higher must not read as a break on the wrong side.
    const mixed = whaleLevelContext(
      flow({ prints: prints([120, 121], 'sell') }),
      frame({ book: bookView({ askWall: null }) }),
    )
    expect(Number(mixed.metrics.levelPenetration)).toBe(0)
    expect(mixed.verdict).toBe('absorbed')
  })
})
