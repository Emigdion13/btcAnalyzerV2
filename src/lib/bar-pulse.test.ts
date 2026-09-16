import { describe, expect, it } from 'vitest'
import { analyzeBarPulse } from './bar-pulse'
import type { BarPulseInput } from './bar-pulse'
import type { BarTape, OrderBookView } from '../../shared/coinbase'
import type { Candle } from './types'

const mk = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle => ({ time, open, high, low, close, volume })

/** A gentle sine-wave market around 100, one bar per minute. */
function sineClosed(count: number, start = 0): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i / 5) * 0.8
    out.push(mk(start + i * 60, base, base + 0.25, base - 0.25, base + (i % 2 ? 0.1 : -0.1), 100 + (i % 3) * 10))
  }
  return out
}

const BOOK: OrderBookView = {
  product: 'BTC-USD',
  asOf: 0,
  mid: 100.2,
  spread: 0.1,
  step: 0.01,
  bottom: 90,
  top: 110,
  imbalance: 0.2,
  bidsTotal: 1_000_000,
  asksTotal: 1_000_000,
  bins: [],
  supports: [
    { side: 'bid', price: 99.03, notional: 500_000, depth: 1_000, peak: 400_000, persistence: 0.8 },
  ],
  resistances: [
    { side: 'ask', price: 101.5, notional: 300_000, depth: 1_000, peak: 250_000, persistence: 0.5 },
  ],
  persistenceSeconds: 60,
}

const BUY_TAPE: BarTape = { time: 40 * 60, bought: 500_000, sold: 50_000 }
const SELL_TAPE: BarTape = { time: 40 * 60, bought: 20_000, sold: 480_000 }

/**
 * The reference market: 30 sine bars, then nine bars that dip INTO a 99.0 level and close back
 * above it, a confirmed fractal low at 99.0, and the bar now forming one minute into its life.
 */
function referenceCandles(forming: Candle): Candle[] {
  const closed = sineClosed(30)
  for (let i = 30; i < 39; i++) {
    if (i === 35) {
      closed[i] = mk(i * 60, 99.3, 99.6, 99.0, 99.4)
    } else {
      closed[i] = mk(i * 60, 100, 100.4, 99.02, 100.3, 100)
    }
  }
  return [...closed, forming]
}

function referenceInput(overrides: Partial<BarPulseInput> = {}): BarPulseInput {
  const forming = mk(40 * 60, 100, 100.3, 99.7, 100.2, 150)
  return {
    candles: referenceCandles(forming),
    interval: '1m',
    now: 40 * 60 + 36,
    price: 100.2,
    book: null,
    tape: null,
    ...overrides,
  }
}

describe('bar clock', () => {
  it('tracks progress and countdown inside the forming bar', () => {
    const read = analyzeBarPulse(referenceInput())
    expect(read.ready).toBe(true)
    expect(read.clock.start).toBe(40 * 60)
    expect(read.clock.end).toBe(41 * 60)
    expect(read.clock.progress).toBeCloseTo(0.6, 5)
    expect(read.clock.secondsLeft).toBe(24)
    expect(read.clock.clockLabel).toBe('00:24')
  })
  it('formats hours and days cleanly for higher candle timings', () => {
    const closed = sineClosed(30)
    const forming1h = mk(0, 100, 101, 99, 100.5, 150)
    const read1h = analyzeBarPulse({
      candles: [...closed, forming1h],
      interval: '1h',
      now: 1800,
      price: 100.5,
    })
    expect(read1h.clock.secondsLeft).toBe(1800)
    expect(read1h.clock.clockLabel).toBe('30:00')

    const read1hLong = analyzeBarPulse({
      candles: [...closed, forming1h],
      interval: '1h',
      now: 60,
      price: 100.5,
    })
    expect(read1hLong.clock.secondsLeft).toBe(3540)
    expect(read1hLong.clock.clockLabel).toBe('59:00')

    const forming1D = mk(0, 100, 101, 99, 100.5, 150)
    const read1D = analyzeBarPulse({
      candles: [...closed, forming1D],
      interval: '1D',
      now: 3600,
      price: 100.5,
    })
    expect(read1D.clock.secondsLeft).toBe(82800)
    expect(read1D.clock.clockLabel).toBe('23:00:00')
  })
})

describe('bar shape', () => {
  it('measures the body, wicks and close position of the live bar', () => {
    const { shape } = analyzeBarPulse(referenceInput())
    expect(shape.lean).toBe('up')
    expect(shape.closePosition).toBeCloseTo(0.8333, 3)
    expect(shape.bodyRatio).toBeCloseTo(0.3333, 3)
    expect(shape.upperWick).toBeCloseTo(0.1, 5)
    expect(shape.lowerWick).toBeCloseTo(0.3, 5)
  })
})

describe('volume pace', () => {
  it('compares the live bar against the typical bar at this point in its life', () => {
    const { pace } = analyzeBarPulse(referenceInput())
    // Median of {100,110,120} volumes is 110; at 60% elapsed, 66 is "on pace".
    expect(pace.medianBar).toBe(110)
    expect(pace.paceRatio).toBeCloseTo(150 / 66, 2)
    expect(pace.projectedTotal).toBeCloseTo(250, 2)
    expect(pace.projectedVsMedian).toBeCloseTo(250 / 110 - 1, 2)
  })
  it('withholds a verdict while the bar is too young to judge', () => {
    const read = analyzeBarPulse(referenceInput({ now: 40 * 60 + 1 }))
    expect(read.pace.paceRatio).toBeNull()
    expect(read.pace.projectedTotal).toBeNull()
  })
})

describe('levels', () => {
  it('clusters the pivot low with the resting bid wall into one defensible support', () => {
    const { levels } = analyzeBarPulse(referenceInput({ book: BOOK }))
    const best = levels.support[0]
    expect(best).toBeDefined()
    // The 99.0 zone: the pivot, the bid wall, and nearby sine lows within cluster tolerance.
    expect(best.price).toBeGreaterThan(98.9)
    expect(best.price).toBeLessThan(99.05)
    expect(best.sources).toEqual(expect.arrayContaining(['swing', 'book']))
    expect(best.bookUsd).toBeGreaterThan(0)
    expect(best.distanceBps).toBeGreaterThan(100)
    expect(best.distanceBps).toBeLessThan(140)
    expect(best.score).toBeGreaterThan(40)
    // Nine dip-and-hold bars plus the pivot bar itself: every approach closed back above.
    expect(best.holdStats).not.toBeNull()
    expect(best.holdStats!.approaches).toBeGreaterThanOrEqual(9)
    expect(best.holdStats!.held).toBe(best.holdStats!.approaches)
    expect(levels.resistance.length).toBeGreaterThan(0)
  })
  it('finds levels from price action alone when no book is available', () => {
    const { levels } = analyzeBarPulse(referenceInput())
    expect(levels.support.length).toBeGreaterThan(0)
    expect(levels.support[0].sources).toContain('swing')
  })
  it('uses the prior UTC day when the window spans two days', () => {
    // 23 flat day-0 bars (one with a 105 spike), one day-1 bar, and the forming bar.
    const day0: Candle[] = []
    for (let i = 0; i < 23; i++) day0.push(mk(80000 + i * 60, 100, 100.1, 99.9, 100))
    day0[0] = mk(80000, 100, 105, 99.5, 100.5)
    const candles = [
      ...day0,
      mk(86400, 100, 100.1, 99.9, 100),
      mk(86460, 100, 100.2, 99.95, 100.05, 50),
    ]
    const read = analyzeBarPulse({
      candles,
      interval: '1m',
      now: 86496,
      price: 100.05,
    })
    expect(read.ready).toBe(true)
    expect(read.levels.resistance[0].price).toBeCloseTo(105, 2)
    expect(read.levels.resistance[0].sources).toContain('prior-day')
    expect(read.levels.support[0].price).toBeCloseTo(99.5, 2)
    expect(read.levels.support[0].sources).toContain('prior-day')
  })
})

describe('tilt', () => {
  it('leans up on an up bar with buying tape into strong support', () => {
    const { tilt } = analyzeBarPulse(referenceInput({ book: BOOK, tape: BUY_TAPE }))
    expect(tilt.score).toBeGreaterThan(20)
    expect(tilt.label).toBe('UP-LEAN')
    expect(tilt.strength).toBe('strong')
    const tapeFactor = tilt.factors.find((f) => f.id === 'tape')
    expect(tapeFactor).toBeDefined()
    expect(tapeFactor!.value).toBeCloseTo(((500_000 - 50_000) / 550_000) * 25, 2)
  })
  it('leans down on a down bar with selling tape', () => {
    const input = referenceInput({ book: BOOK, tape: SELL_TAPE })
    input.candles[input.candles.length - 1] = mk(40 * 60, 100.2, 100.3, 99.6, 99.8, 150)
    input.price = 99.8
    const { tilt } = analyzeBarPulse(input)
    expect(tilt.score).toBeLessThan(-12)
    expect(tilt.label).toBe('DOWN-LEAN')
  })
  it('reports no tape factor when the feed has no taker data', () => {
    const { tilt } = analyzeBarPulse(referenceInput())
    expect(tilt.factors.find((f) => f.id === 'tape')).toBeUndefined()
    expect(tilt.factors.map((f) => f.id)).toEqual(
      expect.arrayContaining(['levels', 'momentum', 'position']),
    )
  })
})

describe('base rate and warm-up', () => {
  it('reports the historical close-up share and median close position', () => {
    const { baseRate } = analyzeBarPulse(referenceInput())
    expect(baseRate).not.toBeNull()
    expect(baseRate!.bars).toBe(39)
    expect(baseRate!.upShare).toBeGreaterThan(0.4)
    expect(baseRate!.upShare).toBeLessThan(0.8)
    expect(baseRate!.medianClosePosition).toBeGreaterThan(0)
    expect(baseRate!.medianClosePosition).toBeLessThan(1)
  })
  it('refuses to read a chart that is still warming up', () => {
    const read = analyzeBarPulse({
      candles: Array.from({ length: 10 }, (_, i) => mk(i * 60, 100, 100.2, 99.8, 100.1)),
      interval: '1m',
      now: 600,
      price: 100,
    })
    expect(read.ready).toBe(false)
    expect(read.reason).toBeTruthy()
    expect(read.tilt.label).toBe('NO EDGE')
  })
})
