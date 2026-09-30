import { describe, expect, it } from 'vitest'
import { OrderBook, PERSISTENCE_SECONDS } from '../../shared/order-book'
import { LEVEL_TEST_HORIZON_BARS } from './level-strength'
import {
  emptyLevelTouchJournal,
  levelTouchStats,
  levelWatches,
  priceWatch,
  recordTouches,
  resolveTouches,
  sanitizeLevelTouchJournal,
  stillApproaching,
  LEVEL_TOUCH_JOURNAL_LIMIT,
  type LevelTouchEntry,
  type LevelWatch,
} from './level-touch-journal'
import type { Candle } from './types'

const STEP = 300

/** A 5m range swinging ±5 around 100, so there is always a pivot on each side. */
function rangeTape(count = 120): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const mid = 100 + 5 * Math.sin(i / 4)
    return { time: i * STEP, open: mid, high: mid + 1, low: mid - 1, close: mid, volume: 10 }
  })
}

/** A book with a thick bid wall at `wall` and thin texture elsewhere. */
function bookWithBidWall(mid: number, wall: number) {
  const book = new OrderBook('BTC-USD')
  const bids: { price: number; size: number }[] = []
  const asks: { price: number; size: number }[] = []
  for (let i = 1; i <= 180; i++) {
    bids.push({ price: mid - i * 0.05, size: 1 })
    asks.push({ price: mid + i * 0.05, size: 1 })
  }
  for (let i = 0; i < 5; i++) bids.push({ price: wall + i * 0.01, size: 40 })
  book.seed(bids, asks, 1000, PERSISTENCE_SECONDS)
  return book.view(1060)!
}

const watch = (overrides: Partial<LevelWatch> = {}): LevelWatch => ({
  key: 'pivot:support:95',
  kind: 'pivot',
  side: 'support',
  price: 95,
  atr: 2,
  barTime: 1000,
  ...overrides,
})

const entry = (overrides: Partial<LevelTouchEntry> = {}): LevelTouchEntry => ({
  id: 'x',
  product: 'BTC-USD',
  timeframe: '5m',
  kind: 'pivot',
  side: 'support',
  price: 95,
  atr: 2,
  barTime: 0,
  book: 'strong',
  bookNotional: 1,
  outcome: 'held',
  ...overrides,
})

describe('levelWatches', () => {
  it('watches the nearest pivot and SR box plus a random price on each side, for the next bar', () => {
    const tape = rangeTape()
    const price = tape[tape.length - 1].close
    const watches = levelWatches(tape, '5m')
    const kinds = watches.map((w) => `${w.kind}:${w.side}`)
    expect(kinds).toContain('pivot:support')
    expect(kinds).toContain('pivot:resistance')
    expect(kinds).toContain('random:support')
    expect(kinds).toContain('random:resistance')
    for (const w of watches) {
      expect(w.barTime).toBe(tape[tape.length - 1].time + STEP)
      expect(w.side === 'support' ? w.price < price : w.price > price).toBe(true)
    }
  })

  it('places the random control the same way every time for the same bar', () => {
    const tape = rangeTape()
    const random = (list: LevelWatch[]) =>
      list.filter((w) => w.kind === 'random').map((w) => w.price)
    expect(random(levelWatches(tape, '5m'))).toEqual(random(levelWatches(tape, '5m')))
  })

  it('stays quiet without enough history', () => {
    expect(levelWatches(rangeTape(10), '5m')).toEqual([])
  })
})

describe('priceWatch', () => {
  it('reads a wall resting on the watched price as strong, and an empty band as nothing', () => {
    const book = bookWithBidWall(100, 95)
    expect(priceWatch(book, watch({ price: 95, atr: 0.2 })).book).toBe('strong')
    expect(priceWatch(book, watch({ price: 50, atr: 0.2 })).book).toBe('none')
  })

  it('only counts the book while price is still outside the band', () => {
    expect(stillApproaching(watch({ price: 95, atr: 2 }), 95.4)).toBe(false)
    expect(stillApproaching(watch({ price: 95, atr: 2 }), 95.6)).toBe(true)
  })
})

describe('recordTouches', () => {
  const book = bookWithBidWall(100, 95)
  const forming: Candle = { time: 1000, open: 97, high: 97.5, low: 94.8, close: 95.5, volume: 1 }

  it('records a test when the forming bar trades through, with the book seen on the approach', () => {
    const w = watch()
    const journal = recordTouches(emptyLevelTouchJournal(), {
      product: 'BTC-USD',
      timeframe: '5m',
      watches: [w],
      forming,
      book,
      before: new Map([[w.key, { book: 'weak' as const, notional: 1234 }]]),
    })
    expect(journal.entries).toHaveLength(1)
    expect(journal.entries[0]).toMatchObject({
      kind: 'pivot',
      side: 'support',
      price: 95,
      book: 'weak',
      bookNotional: 1234,
      outcome: 'open',
    })
  })

  it('falls back to the live book when price arrived without an approach read', () => {
    const journal = recordTouches(emptyLevelTouchJournal(), {
      product: 'BTC-USD',
      timeframe: '5m',
      watches: [watch({ atr: 0.2 })],
      forming,
      book,
      before: new Map(),
    })
    expect(journal.entries[0].book).toBe('strong')
  })

  it('ignores untouched prices, other bars, and re-touches of a test still open', () => {
    const params = {
      product: 'BTC-USD',
      timeframe: '5m' as const,
      forming,
      book,
      before: new Map(),
    }
    const untouched = recordTouches(emptyLevelTouchJournal(), {
      ...params,
      watches: [watch({ price: 90 })],
    })
    expect(untouched.entries).toHaveLength(0)
    const staleBar = recordTouches(emptyLevelTouchJournal(), {
      ...params,
      watches: [watch({ barTime: 700 })],
    })
    expect(staleBar.entries).toHaveLength(0)
    const first = recordTouches(emptyLevelTouchJournal(), { ...params, watches: [watch()] })
    const again = recordTouches(first, {
      ...params,
      forming: { ...forming, time: 1300 },
      watches: [watch({ barTime: 1300 })],
    })
    expect(again).toBe(first)
  })

  it('keeps the journal bounded', () => {
    const full = {
      version: 1 as const,
      entries: Array.from({ length: LEVEL_TOUCH_JOURNAL_LIMIT }, (_, i) => entry({ id: `e${i}` })),
    }
    const next = recordTouches(full, {
      product: 'BTC-USD',
      timeframe: '5m',
      watches: [watch()],
      forming,
      book,
      before: new Map(),
    })
    expect(next.entries).toHaveLength(LEVEL_TOUCH_JOURNAL_LIMIT)
    expect(next.entries[next.entries.length - 1].outcome).toBe('open')
  })
})

describe('resolveTouches', () => {
  const closed = (bars: [number, number][]): Candle[] =>
    bars.map(([low, high], i) => ({ time: i * STEP, open: low, high, low, close: high, volume: 1 }))

  it('grades open tests the backtest way once the bars have closed', () => {
    const tape = closed([
      [99, 101],
      [94, 97],
      [95, 96.5],
      [96, 97.5],
    ])
    const journal = { version: 1 as const, entries: [entry({ barTime: STEP, outcome: 'open' })] }
    expect(resolveTouches(journal, 'BTC-USD', '5m', tape.slice(0, 3)).entries[0].outcome).toBe(
      'open',
    )
    expect(resolveTouches(journal, 'BTC-USD', '5m', tape).entries[0].outcome).toBe('held')
  })

  it('leaves other charts alone and expires tests history can no longer reach', () => {
    const tape = closed(
      Array.from({ length: LEVEL_TEST_HORIZON_BARS + 5 }, () => [95.5, 96] as [number, number]),
    )
    const journal = {
      version: 1 as const,
      entries: [
        entry({ id: 'a', barTime: 0, outcome: 'open' }),
        entry({ id: 'b', barTime: -STEP * 10, outcome: 'open' }),
        entry({ id: 'c', barTime: 0, outcome: 'open', timeframe: '1m' }),
      ],
    }
    const outcomes = resolveTouches(journal, 'BTC-USD', '5m', tape).entries.map((e) => e.outcome)
    expect(outcomes).toEqual(['expired', 'expired', 'open'])
  })
})

describe('levelTouchStats', () => {
  it('splits graded tests by book bucket, levels against random prices', () => {
    const journal = {
      version: 1 as const,
      entries: [
        entry({ id: '1', book: 'strong', outcome: 'held' }),
        entry({ id: '2', book: 'strong', outcome: 'broke', kind: 'sr-zone' }),
        entry({ id: '3', book: 'strong', outcome: 'held', kind: 'random' }),
        entry({ id: '4', book: 'none', outcome: 'broke', kind: 'random' }),
        entry({ id: '5', outcome: 'open' }),
        entry({ id: '6', outcome: 'expired' }),
        entry({ id: '7', outcome: 'held', product: 'ETH-USD' }),
      ],
    }
    const stats = levelTouchStats(journal, 'BTC-USD', '5m')
    const strong = stats.rows.find((row) => row.book === 'strong')!
    expect(strong.levels).toEqual({ held: 1, tests: 2 })
    expect(strong.random).toEqual({ held: 1, tests: 1 })
    expect(stats.rows.find((row) => row.book === 'none')!.random).toEqual({ held: 0, tests: 1 })
    expect(stats.levels).toEqual({ held: 1, tests: 2 })
    expect(stats.random).toEqual({ held: 1, tests: 2 })
    expect(stats.open).toBe(1)
  })
})

describe('sanitizeLevelTouchJournal', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const good = entry()
    const clean = sanitizeLevelTouchJournal({
      version: 1,
      entries: [good, { ...good, kind: 'wall' }, { ...good, price: 'x' }, null, 7],
    })
    expect(clean.entries).toEqual([good])
    expect(sanitizeLevelTouchJournal('garbage')).toEqual(emptyLevelTouchJournal())
    expect(sanitizeLevelTouchJournal(null)).toEqual(emptyLevelTouchJournal())
  })
})
