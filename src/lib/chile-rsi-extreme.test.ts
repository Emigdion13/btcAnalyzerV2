import { describe, expect, it } from 'vitest'
import type { ChileKalshiMarket } from './chile-kalshi'
import {
  calculateChileReversal,
  wilderRsi,
  type ChileBarState,
  type ChileReversalResult,
} from './chile-reversal'
import {
  CHILE_RSI_JOURNAL_MAX_MARKETS,
  chileRsiCostToRecord,
  chileRsiJournalKey,
  chileRsiRounds,
  chileRsiStats,
  emptyChileRsiJournal,
  gradeChileRsiExtremes,
  mergeChileRsiEntries,
  recordChileRsiCost,
  recordChileRsiEntries,
  sanitizeChileRsiJournal,
  type ChileRsiEntry,
  type ChileRsiRound,
} from './chile-rsi-extreme'
import { CHILE_REVERSAL_DEFAULTS, type Candle } from './types'

const STEP = 300
// 16:00 UTC opens a quarter-hour round.
const R0 = Date.UTC(2026, 8, 7, 16, 0, 0) / 1000
const R1 = R0 + 900
const R2 = R1 + 900

/** 5m candles ending with the bar that closes at `end`, closing on `closes`. */
function tape(end: number, closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: end - (closes.length - i) * STEP,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }))
}

describe('chileRsiRounds', () => {
  it('reads the 5m RSI(14) of the bar that closes as each round opens', () => {
    // Forty falling bars, then forty rising ones: RSI pinned low, then pinned high.
    const closes = [
      ...Array.from({ length: 40 }, (_, i) => 200 - i),
      ...Array.from({ length: 40 }, (_, i) => 161 + i * 2),
    ]
    const candles = tape(R2, closes)
    const rounds = chileRsiRounds(candles, '15m')
    const rsi = wilderRsi(
      candles.map((c) => c.close),
      14,
    )
    for (const [roundStart, round] of rounds) {
      expect(roundStart % 900).toBe(0)
      const i = candles.findIndex((c) => c.time + STEP === roundStart)
      expect(round.rsi).toBe(rsi[i])
    }
    // Deep in the fall the reading is extreme low → UP; at the end of the rally extreme high → DOWN.
    const fallEnd = candles[38]!.time + STEP
    const lowRound = [...rounds.values()].find((r) => r.roundStart <= fallEnd && r.rsi < 30)
    expect(lowRound?.side).toBe('up')
    expect(rounds.get(R2)?.side).toBe('down')
    expect(rounds.get(R2)!.rsi).toBeGreaterThan(70)
  })

  it('calls nothing between 30 and 70', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1))
    const rounds = chileRsiRounds(tape(R2, closes), '15m')
    expect(rounds.size).toBeGreaterThan(0)
    for (const round of rounds.values()) expect(round.side).toBeNull()
  })

  it('never reads a bar that is still forming', () => {
    const candles = tape(
      R2,
      Array.from({ length: 40 }, (_, i) => 200 - i),
    )
    expect(chileRsiRounds(candles, '15m', R2 - 1).has(R2)).toBe(false)
    expect(chileRsiRounds(candles, '15m', R2).has(R2)).toBe(true)
  })

  it('is only read on the 15-minute rounds it was measured on', () => {
    const candles = tape(
      R2,
      Array.from({ length: 40 }, (_, i) => 200 - i),
    )
    expect(chileRsiRounds(candles, '1h').size).toBe(0)
    expect(chileRsiRounds([], '15m').size).toBe(0)
  })
})

const template = calculateChileReversal(
  [{ time: R0, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
  { ...CHILE_REVERSAL_DEFAULTS },
  { timeframe: '5m', timeframes: { '15m': { candles: [] } } },
).bars[0]!

/** Three 5m bars of one round, opening at `open` and closing on `closes`. */
const round = (start: number, open: number, closes: number[]): ChileBarState[] =>
  closes.map((close, i) => ({
    ...template,
    time: start + i * STEP,
    close,
    ready: true,
    confirmed: true,
    round: { ...template.round, open, move: (close - open) / 10 },
  }))

const resultOf = (bars: ChileBarState[]): ChileReversalResult => ({
  ...calculateChileReversal([], { ...CHILE_REVERSAL_DEFAULTS }),
  bars,
  last: bars.at(-1) ?? null,
})

const reading = (roundStart: number, rsi: number): ChileRsiRound => ({
  roundStart,
  rsi,
  side: rsi < 30 ? 'up' : rsi > 70 ? 'down' : null,
})

const rsiMap = (...rounds: ChileRsiRound[]) => new Map(rounds.map((r) => [r.roundStart, r]))

describe('gradeChileRsiExtremes', () => {
  const bars = [
    ...round(R0, 100, [101, 99, 102]),
    ...round(R1, 103, [102, 104, 101]),
    ...round(R2, 101, [100, 99]),
  ]

  it('grades each extreme reading against how its round finished on Coinbase', () => {
    const graded = gradeChileRsiExtremes(
      resultOf(bars),
      '5m',
      '15m',
      rsiMap(reading(R0, 22), reading(R1, 78), reading(R2, 25)),
    )
    expect(graded).toEqual([
      {
        roundStart: R0,
        side: 'up',
        rsi: 22,
        open: 100,
        close: 102,
        outcome: 'up',
        settledBy: 'coinbase',
      },
      {
        roundStart: R1,
        side: 'down',
        rsi: 78,
        open: 103,
        close: 101,
        outcome: 'down',
        settledBy: 'coinbase',
      },
    ])
  })

  it('skips readings that call nothing', () => {
    expect(gradeChileRsiExtremes(resultOf(bars), '5m', '15m', rsiMap(reading(R0, 50)))).toEqual([])
  })

  it("prefers Kalshi's published strike and settlement, a tie resolving up", () => {
    const kalshi = new Map([
      [R0, 100.5],
      [R1, 100.2], // R0 settles below its Kalshi strike though Coinbase finished it up
      [R2, 100.2], // R1 settles exactly on its strike: up
    ])
    const graded = gradeChileRsiExtremes(
      resultOf(bars),
      '5m',
      '15m',
      rsiMap(reading(R0, 22), reading(R1, 78)),
      kalshi,
    )
    expect(graded.map((e) => [e.outcome, e.settledBy, e.open, e.close])).toEqual([
      ['down', 'kalshi', 100.5, 100.2],
      ['up', 'kalshi', 100.2, 100.2],
    ])
  })
})

const market = (overrides: Partial<ChileKalshiMarket> = {}): ChileKalshiMarket => ({
  open: R1,
  upPct: 52,
  upCost: 0.54,
  downCost: 0.5,
  stale: false,
  ...overrides,
})

describe('chileRsiCostToRecord', () => {
  it("records the side's fee-inclusive price one to two minutes into the signal's round", () => {
    expect(chileRsiCostToRecord(reading(R1, 25), market(), R1 + 60)).toBe(0.54)
    expect(chileRsiCostToRecord(reading(R1, 75), market(), R1 + 120)).toBe(0.5)
  })

  it('records nothing outside that window, for another round, or without a live quote', () => {
    expect(chileRsiCostToRecord(reading(R1, 25), market(), R1 + 59)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 25), market(), R1 + 121)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 50), market(), R1 + 90)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 25), market({ open: R0 }), R1 + 90)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 25), market({ stale: true }), R1 + 90)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 25), market({ upCost: null }), R1 + 90)).toBeNull()
    expect(chileRsiCostToRecord(reading(R1, 25), null, R1 + 90)).toBeNull()
    expect(chileRsiCostToRecord(undefined, market(), R1 + 90)).toBeNull()
  })
})

const entry = (
  roundStart: number,
  side: 'up' | 'down',
  outcome: 'up' | 'down' | 'flat',
  settledBy: 'kalshi' | 'coinbase' = 'coinbase',
): ChileRsiEntry => ({
  roundStart,
  side,
  rsi: side === 'up' ? 25 : 75,
  open: 100,
  close: outcome === 'up' ? 101 : outcome === 'down' ? 99 : 100,
  outcome,
  settledBy,
})

describe('chileRsiStats', () => {
  it('scores the signals per side, and the priced ones against what they cost', () => {
    const entries = [
      entry(R0, 'up', 'up'),
      entry(R1, 'down', 'up'),
      entry(R2, 'up', 'up'),
      entry(R2 + 900, 'down', 'flat'),
    ]
    const stats = chileRsiStats(entries, { [R0]: 0.55, [R1]: 0.5 })
    expect(stats.scored).toBe(3)
    expect(stats.correct).toBe(2)
    expect(stats.hitRate).toBeCloseTo(2 / 3)
    expect(stats.up).toEqual({ scored: 2, correct: 2 })
    expect(stats.down).toEqual({ scored: 1, correct: 0 })
    expect(stats.priced).toBe(2)
    expect(stats.pricedCorrect).toBe(1)
    expect(stats.averageCost).toBeCloseTo(0.525)
    expect(stats.edge).toBeCloseTo(0.5 - 0.525)
    expect(stats.edgeMargin).toBeCloseTo(1.96 * Math.sqrt(0.25 / 2))
  })

  it('has nothing to say before anything is graded or priced', () => {
    const empty = chileRsiStats([])
    expect(empty.hitRate).toBeNull()
    expect(empty.margin).toBeNull()
    expect(chileRsiStats([entry(R0, 'up', 'up')]).edge).toBeNull()
  })
})

describe('the RSI journal', () => {
  const key = chileRsiJournalKey('coinbase', 'BTC-USD')

  it('keys a journal by market alone', () => {
    expect(key).toBe('coinbase|BTC-USD')
  })

  it('never lets a Coinbase grade replace a Kalshi one', () => {
    const merged = mergeChileRsiEntries(
      [entry(R0, 'up', 'down', 'kalshi'), entry(R1, 'up', 'down')],
      [entry(R0, 'up', 'up'), entry(R1, 'up', 'up', 'kalshi')],
    )
    expect(merged.map((e) => [e.outcome, e.settledBy])).toEqual([
      ['down', 'kalshi'],
      ['up', 'kalshi'],
    ])
  })

  it('returns the same journal when nothing changes, so a tick skips the write', () => {
    const once = recordChileRsiEntries(emptyChileRsiJournal(), key, [entry(R0, 'up', 'up')], 1)
    expect(recordChileRsiEntries(once, key, [entry(R0, 'up', 'up')], 2)).toBe(once)
    expect(recordChileRsiEntries(once, key, [], 2)).toBe(once)
  })

  it('keeps the first price seen for a round, and prices only rounds the entries can reach', () => {
    let journal = recordChileRsiCost(emptyChileRsiJournal(), key, R1, 0.53, 1)
    journal = recordChileRsiCost(journal, key, R1, 0.6, 2)
    expect(journal.markets[key]!.costs).toEqual({ [R1]: 0.53 })
    journal = recordChileRsiCost(journal, key, R0 - 900, 0.5, 3)
    journal = recordChileRsiEntries(journal, key, [entry(R0, 'up', 'up')], 4)
    expect(journal.markets[key]!.costs).toEqual({ [R1]: 0.53 })
  })

  it('drops the least recently updated market past the cap', () => {
    let journal = emptyChileRsiJournal()
    for (let i = 0; i <= CHILE_RSI_JOURNAL_MAX_MARKETS; i++)
      journal = recordChileRsiEntries(journal, `m${i}`, [entry(R0, 'up', 'up')], i)
    expect(Object.keys(journal.markets)).toHaveLength(CHILE_RSI_JOURNAL_MAX_MARKETS)
    expect(journal.markets.m0).toBeUndefined()
  })

  it('reads back only well-formed journals, entries and prices', () => {
    expect(sanitizeChileRsiJournal(null)).toEqual(emptyChileRsiJournal())
    expect(sanitizeChileRsiJournal({ version: 2, markets: {} })).toEqual(emptyChileRsiJournal())
    const clean = sanitizeChileRsiJournal({
      version: 1,
      markets: {
        [key]: {
          updatedAt: 5,
          entries: [entry(R0, 'up', 'up'), { ...entry(R1, 'up', 'up'), settledBy: 'guess' }, 7],
          costs: { [R0]: 0.52, [R1]: 3, bad: 0.5, [R2]: 'x' },
        },
        broken: { updatedAt: 'x', entries: [] },
      },
    })
    expect(Object.keys(clean.markets)).toEqual([key])
    expect(clean.markets[key]!.entries).toEqual([entry(R0, 'up', 'up')])
    expect(clean.markets[key]!.costs).toEqual({ [R0]: 0.52 })
  })
})
