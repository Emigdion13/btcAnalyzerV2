import { describe, expect, it } from 'vitest'
import { calculateChileReversal, type ChileBarState } from './chile-reversal'
import {
  CHILE_ODDS_CAP,
  CHILE_ROUND_SIGMA_ATR,
  chileAboveProbability,
  chileRoundOdds,
} from './chile-odds'
import { normalCdf } from './price-forecast'
import { CHILE_REVERSAL_DEFAULTS, type Candle } from './types'

/** A ready bar whose round opened at 100 and whose close has moved `move` round ATR from it. */
function bar(time: number, move: number, overrides: Partial<ChileBarState> = {}): ChileBarState {
  const engine = calculateChileReversal(
    [{ time, open: 100, high: 101, low: 99, close: 100, volume: 1 }],
    { ...CHILE_REVERSAL_DEFAULTS },
    { timeframe: '1m', timeframes: { '15m': { candles: [] }, '5m': { candles: [] } } },
  )
  return {
    ...engine.bars[0]!,
    ready: true,
    close: 100 + move * 10,
    round: { open: 100, high: 101, low: 99, position: 0.5, move, strong: false, up: move > 0 },
    ...overrides,
  }
}

// 16:00 UTC opens a quarter-hour round.
const ROUND = Date.UTC(2026, 8, 7, 16, 0, 0) / 1000

describe('chileAboveProbability', () => {
  it('is a coin flip on the open and leans with the move', () => {
    expect(chileAboveProbability(0, 600, 900)).toBe(0.5)
    expect(
      chileRoundOdds({
        bar: bar(ROUND, 0),
        nowSeconds: ROUND + 30,
        resolution: '15m',
        chartTimeframe: '1m',
      }).favoured,
    ).toBeNull()
    expect(chileAboveProbability(0.3, 600, 900)).toBeGreaterThan(0.5)
    expect(chileAboveProbability(-0.3, 600, 900)).toBeLessThan(0.5)
    expect(chileAboveProbability(0.3, 600, 900)).toBeCloseTo(
      1 - chileAboveProbability(-0.3, 600, 900),
    )
  })

  it('is the fitted walk: one sigma of move with the whole round left is Φ(1)', () => {
    expect(chileAboveProbability(CHILE_ROUND_SIGMA_ATR, 900, 900)).toBeCloseTo(normalCdf(1), 6)
    // A quarter of the round left halves the spread, so the same move is worth two sigmas.
    expect(chileAboveProbability(CHILE_ROUND_SIGMA_ATR / 2, 225, 900)).toBeCloseTo(normalCdf(1), 6)
  })

  it('firms up as the clock runs down', () => {
    const early = chileAboveProbability(0.2, 840, 900)
    const late = chileAboveProbability(0.2, 60, 900)
    expect(late).toBeGreaterThan(early)
  })

  it('never claims more than the cap while the round is open, and settles once it is not', () => {
    expect(chileAboveProbability(5, 30, 900)).toBe(CHILE_ODDS_CAP)
    expect(chileAboveProbability(-5, 30, 900)).toBeCloseTo(1 - CHILE_ODDS_CAP)
    expect(chileAboveProbability(0.01, 0, 900)).toBe(1)
    expect(chileAboveProbability(-0.01, 0, 900)).toBe(0)
    expect(chileAboveProbability(0, 0, 900)).toBe(0.5)
  })

  it('treats time beyond one round as a full round', () => {
    expect(chileAboveProbability(0.3, 5000, 900)).toBe(chileAboveProbability(0.3, 900, 900))
  })
})

describe('chileRoundOdds', () => {
  it('reads the round the newest bar is in, against its open', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND + 5 * 60, 0.4),
      nowSeconds: ROUND + 5 * 60 + 30,
      resolution: '15m',
      chartTimeframe: '1m',
    })
    expect(odds.state).toBe('live')
    expect(odds.roundStart).toBe(ROUND)
    expect(odds.strike).toBe(100)
    expect(odds.price).toBe(104)
    expect(odds.deltaAtr).toBe(0.4)
    expect(odds.secondsLeft).toBe(9 * 60 + 30)
    expect(odds.probabilityAbove).toBeCloseTo(chileAboveProbability(0.4, 570, 900))
    expect(odds.favoured).toBe('above')
  })

  it('names the side a falling round favours', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND + 60, -0.2),
      nowSeconds: ROUND + 90,
      resolution: '15m',
      chartTimeframe: '1m',
    })
    expect(odds.favoured).toBe('below')
    expect(odds.probabilityAbove!).toBeLessThan(0.5)
  })

  it('settles the round once its close has passed', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND + 14 * 60, 0.1),
      nowSeconds: ROUND + 900 + 2,
      resolution: '15m',
      chartTimeframe: '1m',
    })
    expect(odds.state).toBe('closed')
    expect(odds.secondsLeft).toBe(0)
    expect(odds.probabilityAbove).toBe(1)
    expect(odds.favoured).toBe('above')
  })

  it('has nothing to say before the engine is ready', () => {
    const cold = chileRoundOdds({
      bar: bar(ROUND, 0.4, { ready: false }),
      nowSeconds: ROUND + 30,
      resolution: '15m',
      chartTimeframe: '1m',
    })
    expect(cold.state).toBe('unavailable')
    expect(cold.probabilityAbove).toBeNull()
    expect(
      chileRoundOdds({ bar: null, nowSeconds: 0, resolution: '15m', chartTimeframe: '1m' }).state,
    ).toBe('unavailable')
  })

  it('has no round to play when one chart bar spans several rounds', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND, 0.4),
      nowSeconds: ROUND + 30,
      resolution: '15m',
      chartTimeframe: '1h',
    })
    expect(odds.state).toBe('unavailable')
  })

  it('plays the chart bar itself when the chart is the round resolution', () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: ROUND - (29 - i) * 900,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1,
    }))
    const engine = calculateChileReversal(
      candles,
      { ...CHILE_REVERSAL_DEFAULTS },
      {
        timeframe: '15m',
        timeframes: { '5m': { candles: [] } },
      },
    )
    const odds = chileRoundOdds({
      bar: engine.last,
      nowSeconds: ROUND + 300,
      resolution: '15m',
      chartTimeframe: '15m',
    })
    expect(odds.state).toBe('live')
    expect(odds.strike).toBe(129)
    expect(odds.secondsLeft).toBe(600)
    expect(odds.favoured).toBe('above')
  })
})
