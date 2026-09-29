import { describe, expect, it } from 'vitest'
import {
  calculateChileReversal,
  type ChileBarState,
  type ChileCall,
  type ChileReversalResult,
} from './chile-reversal'
import { CHILE_KALSHI_AVERAGE_SECONDS, chileAboveProbability } from './chile-odds'
import {
  CHILE_JOURNAL_MAX_CALLS,
  CHILE_JOURNAL_MAX_PROFILES,
  chileCallStats,
  chileOddsStats,
  chileScorecardKey,
  emptyChileScorecardJournal,
  gradeChileCalls,
  gradeChileOdds,
  mergeChileCalls,
  recordChileCalls,
  sanitizeChileScorecardJournal,
  type ChileGradedCall,
} from './chile-scorecard'
import { CHILE_REVERSAL_DEFAULTS } from './types'

// A 5m chart playing 15m rounds; 16:00 UTC opens the first one.
const STEP = 300
const R0 = Date.UTC(2026, 8, 7, 16, 0, 0) / 1000
const R1 = R0 + 900
const R2 = R1 + 900

const template = calculateChileReversal(
  [{ time: R0, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
  { ...CHILE_REVERSAL_DEFAULTS },
  { timeframe: '5m', timeframes: { '15m': { candles: [] } } },
).bars[0]!

function bar(
  time: number,
  roundOpen: number,
  close: number,
  overrides: Partial<ChileBarState> = {},
): ChileBarState {
  return {
    ...template,
    time,
    close,
    ready: true,
    official: (time + STEP) % 900 === 0,
    confirmed: true,
    round: { ...template.round, open: roundOpen, move: (close - roundOpen) / 10 },
    ...overrides,
  }
}

/** Three 5m bars of one round; the call rides on the bar that closes it. */
const round = (start: number, open: number, closes: number[], call: ChileCall = 'wait') =>
  closes.map((close, i) =>
    bar(start + i * STEP, open, close, i === 2 ? { call, scoreUp: 9, scoreDown: 3 } : {}),
  )

const resultOf = (bars: ChileBarState[]): ChileReversalResult => ({
  ...calculateChileReversal([], { ...CHILE_REVERSAL_DEFAULTS }),
  bars,
  last: bars.at(-1) ?? null,
})

const entry = (roundStart: number, call: ChileCall, outcome: 'up' | 'down' | 'flat') =>
  ({
    roundStart,
    call,
    scoreUp: 8,
    scoreDown: 2,
    open: 100,
    close: outcome === 'up' ? 101 : outcome === 'down' ? 99 : 100,
    outcome,
  }) satisfies ChileGradedCall

describe('gradeChileCalls', () => {
  it('grades a round-close call against the round that opens as it prints', () => {
    const bars = [
      ...round(R0, 100, [101, 102, 103], 'up'),
      ...round(R1, 103, [104, 102, 106], 'down'),
      ...round(R2, 106, [104, 101, 99], 'wait'),
    ]
    const calls = gradeChileCalls(resultOf(bars), '5m', '15m')
    expect(calls).toEqual([
      {
        roundStart: R1,
        call: 'up',
        scoreUp: 9,
        scoreDown: 3,
        open: 103,
        close: 106,
        outcome: 'up',
      },
      {
        roundStart: R2,
        call: 'down',
        scoreUp: 9,
        scoreDown: 3,
        open: 106,
        close: 99,
        outcome: 'down',
      },
    ])
  })

  it('records WAIT as an abstention and grades a flat round as flat', () => {
    const bars = [...round(R0, 100, [101, 102, 103], 'wait'), ...round(R1, 103, [104, 102, 103])]
    expect(gradeChileCalls(resultOf(bars), '5m', '15m')).toEqual([
      expect.objectContaining({ roundStart: R1, call: 'wait', outcome: 'flat' }),
    ])
  })

  it('waits for the graded round to close', () => {
    const forming = [...round(R0, 100, [101, 102, 103], 'up'), ...round(R1, 103, [104, 102])]
    expect(gradeChileCalls(resultOf(forming), '5m', '15m')).toEqual([])

    const unconfirmed = [
      ...round(R0, 100, [101, 102, 103], 'up'),
      ...round(R1, 103, [104, 102, 106]).map((b, i) => (i === 2 ? { ...b, confirmed: false } : b)),
    ]
    expect(gradeChileCalls(resultOf(unconfirmed), '5m', '15m')).toEqual([])
  })

  it('skips a round whose opening bar is missing, since its open would be a mid-round price', () => {
    const bars = [
      ...round(R0, 100, [101, 102, 103], 'up'),
      ...round(R1, 103, [104, 102, 106]).slice(1),
    ]
    expect(gradeChileCalls(resultOf(bars), '5m', '15m')).toEqual([])
  })

  it('grades only bars the engine scored, and nothing on charts coarser than the round', () => {
    const cold = [
      ...round(R0, 100, [101, 102, 103], 'up').map((b) => ({ ...b, ready: false })),
      ...round(R1, 103, [104, 102, 106]),
    ]
    expect(gradeChileCalls(resultOf(cold), '5m', '15m')).toEqual([])
    const bars = [...round(R0, 100, [101, 102, 103], 'up'), ...round(R1, 103, [104, 102, 106])]
    expect(gradeChileCalls(resultOf(bars), '1h', '15m')).toEqual([])
  })
})

describe('gradeChileOdds', () => {
  it('grades every closed bar inside a round against how that round finished', () => {
    const bars = [...round(R0, 100, [101, 99, 102]), ...round(R1, 103, [102, 104, 101])]
    const samples = gradeChileOdds(resultOf(bars), '5m', '15m')
    expect(samples).toEqual([
      {
        roundStart: R0,
        secondsLeft: 600,
        probabilityAbove: chileAboveProbability(0.1, 600, 900),
        finishedAbove: true,
      },
      {
        roundStart: R0,
        secondsLeft: 300,
        probabilityAbove: chileAboveProbability(-0.1, 300, 900),
        finishedAbove: true,
      },
      {
        roundStart: R1,
        secondsLeft: 600,
        probabilityAbove: chileAboveProbability(-0.1, 600, 900),
        finishedAbove: false,
      },
      {
        roundStart: R1,
        secondsLeft: 300,
        probabilityAbove: chileAboveProbability(0.1, 300, 900),
        finishedAbove: false,
      },
    ])
  })

  it('leaves out flat rounds, unfinished rounds and bars that have not closed', () => {
    const bars = [
      ...round(R0, 100, [101, 99, 100]),
      ...round(R1, 103, [102, 104]),
      bar(R2, 104, 105, { confirmed: false }),
    ]
    expect(gradeChileOdds(resultOf(bars), '5m', '15m')).toEqual([])
  })

  it("plays a Kalshi window against Kalshi's strike and grades it on Kalshi's settlement", () => {
    // Coinbase says R0 finished flat and R1 up; Kalshi's own record says otherwise.
    const bars = [...round(R0, 100, [101, 99, 100]), ...round(R1, 103, [102, 104, 104])].map(
      (b, index) => ({ ...b, index }),
    )
    const result = { ...resultOf(bars), atr: bars.map(() => 10) }
    const kalshi = new Map([
      [R0, 100.5], // R0's strike
      [R1, 100.5], // R0 settles exactly on it — a tie resolves up — and R1 strikes there
      [R2, 100], // R1 settles below its strike
    ])
    expect(gradeChileOdds(result, '5m', '15m', kalshi)).toEqual([
      {
        roundStart: R0,
        secondsLeft: 600,
        probabilityAbove: chileAboveProbability(0.05, 600, 900, CHILE_KALSHI_AVERAGE_SECONDS),
        finishedAbove: true,
      },
      {
        roundStart: R0,
        secondsLeft: 300,
        probabilityAbove: chileAboveProbability(-0.15, 300, 900, CHILE_KALSHI_AVERAGE_SECONDS),
        finishedAbove: true,
      },
      {
        roundStart: R1,
        secondsLeft: 600,
        probabilityAbove: chileAboveProbability(0.15, 600, 900, CHILE_KALSHI_AVERAGE_SECONDS),
        finishedAbove: false,
      },
      {
        roundStart: R1,
        secondsLeft: 300,
        probabilityAbove: chileAboveProbability(0.35, 300, 900, CHILE_KALSHI_AVERAGE_SECONDS),
        finishedAbove: false,
      },
    ])
  })

  it('leaves out a Kalshi window whose strike or settlement Kalshi has not published', () => {
    const bars = [...round(R0, 100, [101, 99, 102]), ...round(R1, 103, [102, 104, 101])].map(
      (b, index) => ({ ...b, index }),
    )
    const result = { ...resultOf(bars), atr: bars.map(() => 10) }
    // R0 has a strike but no settlement yet; R1 has a settlement but no strike.
    expect(gradeChileOdds(result, '5m', '15m', new Map([[R0, 100]]))).toEqual([])
    expect(gradeChileOdds(result, '5m', '15m', new Map([[R2, 100]]))).toEqual([])
    // Without an ATR there is no distance to play either.
    const kalshi = new Map([
      [R0, 100],
      [R1, 101],
    ])
    expect(gradeChileOdds({ ...result, atr: [] }, '5m', '15m', kalshi)).toEqual([])
    expect(gradeChileOdds(result, '5m', '15m', kalshi)).toHaveLength(2)
  })
})

describe('chileCallStats', () => {
  it('scores directional calls only, per side, with a 95% interval', () => {
    const stats = chileCallStats([
      entry(R0, 'up', 'up'),
      entry(R1, 'up', 'down'),
      entry(R2, 'down', 'down'),
      entry(R2 + 900, 'down', 'down'),
      entry(R2 + 1800, 'wait', 'up'),
      entry(R2 + 2700, 'up', 'flat'),
    ])
    expect(stats.graded).toBe(6)
    expect(stats.waits).toBe(1)
    expect(stats.scored).toBe(4)
    expect(stats.correct).toBe(3)
    expect(stats.hitRate).toBe(0.75)
    expect(stats.margin).toBeCloseTo(1.96 * Math.sqrt((0.75 * 0.25) / 4))
    expect(stats.up).toEqual({ scored: 2, correct: 1 })
    expect(stats.down).toEqual({ scored: 2, correct: 2 })
  })

  it('has no hit rate before anything is scored', () => {
    const stats = chileCallStats([entry(R0, 'wait', 'up')])
    expect(stats.hitRate).toBeNull()
    expect(stats.margin).toBeNull()
  })
})

describe('chileOddsStats', () => {
  it('counts the favoured side and the Brier score', () => {
    const stats = chileOddsStats([
      { roundStart: R0, secondsLeft: 600, probabilityAbove: 0.8, finishedAbove: true },
      { roundStart: R0, secondsLeft: 300, probabilityAbove: 0.3, finishedAbove: true },
      { roundStart: R1, secondsLeft: 600, probabilityAbove: 0.5, finishedAbove: false },
    ])
    expect(stats.graded).toBe(3)
    expect(stats.correct).toBe(1)
    expect(stats.hitRate).toBeCloseTo(1 / 3)
    expect(stats.brier).toBeCloseTo((0.2 ** 2 + 0.7 ** 2 + 0.5 ** 2) / 3)
    expect(chileOddsStats([]).brier).toBeNull()
  })
})

describe('the saved journal', () => {
  const KEY = 'coinbase|BTC-USD|5m|15m|6|2|2.4|10|2|2|2.5'

  it('keys a profile by market, chart and every input that moves the score', () => {
    const settings = { ...CHILE_REVERSAL_DEFAULTS }
    expect(chileScorecardKey('coinbase', 'BTC-USD', '5m', settings)).toBe(KEY)
    expect(chileScorecardKey('coinbase', 'BTC-USD', '1m', settings)).not.toBe(KEY)
    expect(chileScorecardKey('coinbase', 'BTC-USD', '5m', { ...settings, minScore: 8 })).not.toBe(
      KEY,
    )
  })

  it('merges one entry per round, oldest first, and keeps the newest grade', () => {
    const merged = mergeChileCalls(
      [entry(R1, 'up', 'up'), entry(R0, 'down', 'up')],
      [entry(R1, 'up', 'down'), entry(R2, 'wait', 'up')],
    )
    expect(merged.map((e) => [e.roundStart, e.outcome])).toEqual([
      [R0, 'up'],
      [R1, 'down'],
      [R2, 'up'],
    ])
  })

  it('returns the same journal when nothing new was graded, so the tick skips the write', () => {
    const once = recordChileCalls(emptyChileScorecardJournal(), KEY, [entry(R0, 'up', 'up')], 1)
    expect(once.profiles[KEY]!.calls).toHaveLength(1)
    expect(recordChileCalls(once, KEY, [entry(R0, 'up', 'up')], 2)).toBe(once)
    expect(recordChileCalls(once, KEY, [], 2)).toBe(once)
    const next = recordChileCalls(once, KEY, [entry(R0, 'up', 'up'), entry(R1, 'up', 'down')], 3)
    expect(next).not.toBe(once)
    expect(next.profiles[KEY]).toEqual({
      updatedAt: 3,
      calls: [entry(R0, 'up', 'up'), entry(R1, 'up', 'down')],
    })
  })

  it('settles on a history longer than the cap instead of rewriting every tick', () => {
    const history = Array.from({ length: CHILE_JOURNAL_MAX_CALLS + 150 }, (_, i) =>
      entry(R0 + i * 900, 'up', i % 2 ? 'up' : 'down'),
    )
    const first = recordChileCalls(emptyChileScorecardJournal(), KEY, history, 1)
    const calls = first.profiles[KEY]!.calls
    expect(calls).toHaveLength(CHILE_JOURNAL_MAX_CALLS)
    expect(calls[0]!.roundStart).toBe(history[150]!.roundStart)
    expect(recordChileCalls(first, KEY, history, 2)).toBe(first)
  })

  it('drops the least recently updated profile past the profile cap', () => {
    let journal = emptyChileScorecardJournal()
    for (let i = 0; i <= CHILE_JOURNAL_MAX_PROFILES; i++)
      journal = recordChileCalls(journal, `profile-${i}`, [entry(R0, 'up', 'up')], i)
    expect(Object.keys(journal.profiles)).toHaveLength(CHILE_JOURNAL_MAX_PROFILES)
    expect(journal.profiles['profile-0']).toBeUndefined()
    expect(journal.profiles[`profile-${CHILE_JOURNAL_MAX_PROFILES}`]).toBeDefined()
  })

  it('reads back only well-formed journals and entries', () => {
    expect(sanitizeChileScorecardJournal(null)).toEqual(emptyChileScorecardJournal())
    expect(sanitizeChileScorecardJournal({ version: 2, profiles: {} })).toEqual(
      emptyChileScorecardJournal(),
    )
    const good = entry(R0, 'up', 'up')
    const read = sanitizeChileScorecardJournal({
      version: 1,
      profiles: {
        [KEY]: { updatedAt: 5, calls: [good, { ...good, call: 'sideways' }, null] },
        broken: { updatedAt: 'yesterday', calls: [] },
      },
    })
    expect(read).toEqual({ version: 1, profiles: { [KEY]: { updatedAt: 5, calls: [good] } } })
  })
})
