import { describe, expect, it } from 'vitest'
import { calculateChileReversal, type ChileBarState } from './chile-reversal'
import {
  CHILE_KALSHI_AVERAGE_SECONDS,
  CHILE_ODDS_CAP,
  CHILE_ROUND_SIGMA_ATR,
  chileAboveProbability,
  chileEffectiveSecondsLeft,
  chileKalshiStrike,
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

  it('plays the open when no Kalshi strike is in hand', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND + 60, 0.4),
      atr: 10,
      nowSeconds: ROUND + 90,
      resolution: '15m',
      chartTimeframe: '1m',
    })
    expect(odds.strikeSource).toBe('open')
    expect(odds.strike).toBe(100)
  })
})

describe('chileEffectiveSecondsLeft', () => {
  it('is the clock itself when the settlement is the last print', () => {
    expect(chileEffectiveSecondsLeft(600)).toBe(600)
    expect(chileEffectiveSecondsLeft(600, 0)).toBe(600)
    expect(chileEffectiveSecondsLeft(0, 60)).toBe(0)
  })

  it('takes two thirds of the averaging window off while it is still ahead', () => {
    expect(chileEffectiveSecondsLeft(900, 60)).toBe(860)
    expect(chileEffectiveSecondsLeft(60, 60)).toBe(20)
  })

  it('shrinks with the cube of the time left inside the window, and meets the line at its edge', () => {
    expect(chileEffectiveSecondsLeft(30, 60)).toBeCloseTo(2.5)
    expect(chileEffectiveSecondsLeft(59.999, 60)).toBeCloseTo(chileEffectiveSecondsLeft(60, 60), 2)
    expect(chileEffectiveSecondsLeft(10, 60)).toBeLessThan(chileEffectiveSecondsLeft(20, 60))
  })

  it('makes the same distance a firmer call, most of all in the last minutes', () => {
    const plain = chileAboveProbability(0.1, 120, 900)
    const averaged = chileAboveProbability(0.1, 120, 900, CHILE_KALSHI_AVERAGE_SECONDS)
    expect(averaged).toBeGreaterThan(plain)
    expect(averaged).toBeCloseTo(chileAboveProbability(0.1, 80, 900))
    expect(chileAboveProbability(0, 120, 900, 60)).toBe(0.5)
  })
})

describe('chileRoundOdds on a Kalshi window', () => {
  const kalshi = new Map([
    [ROUND - 900, 101],
    [ROUND, 102.5],
  ])

  it("plays Kalshi's strike and its 60-second settlement", () => {
    // Coinbase says +0.4 ATR from the open at 100; Kalshi's strike is 102.5, so it is +0.15.
    const odds = chileRoundOdds({
      bar: bar(ROUND + 5 * 60, 0.4),
      atr: 10,
      nowSeconds: ROUND + 5 * 60 + 30,
      resolution: '15m',
      chartTimeframe: '1m',
      kalshi,
    })
    expect(odds.strikeSource).toBe('kalshi')
    expect(odds.strike).toBe(102.5)
    expect(odds.deltaAtr).toBeCloseTo(0.15)
    expect(odds.probabilityAbove).toBeCloseTo(
      chileAboveProbability(0.15, 570, 900, CHILE_KALSHI_AVERAGE_SECONDS),
    )
  })

  it('can favour the other side from the one the Coinbase open would', () => {
    const odds = chileRoundOdds({
      bar: bar(ROUND + 60, 0.1),
      atr: 10,
      nowSeconds: ROUND + 90,
      resolution: '15m',
      chartTimeframe: '1m',
      kalshi,
    })
    expect(odds.deltaAtr).toBeCloseTo(-0.15)
    expect(odds.favoured).toBe('below')
  })

  it('falls back to the open without a published strike, an ATR or a 15-minute round', () => {
    const base = {
      bar: bar(ROUND + 60, 0.4),
      atr: 10,
      nowSeconds: ROUND + 90,
      resolution: '15m' as const,
      chartTimeframe: '1m' as const,
    }
    expect(chileRoundOdds({ ...base, kalshi: new Map([[ROUND - 900, 101]]) }).strikeSource).toBe(
      'open',
    )
    expect(chileRoundOdds({ ...base, atr: null, kalshi }).strikeSource).toBe('open')
    expect(chileRoundOdds({ ...base, atr: 0, kalshi }).strikeSource).toBe('open')
    expect(chileKalshiStrike(kalshi, ROUND, 3600)).toBeNull()
    expect(chileKalshiStrike(new Map([[ROUND, Number.NaN]]), ROUND, 900)).toBeNull()
    const open = chileRoundOdds({ ...base, kalshi: null })
    expect(open.probabilityAbove).toBeCloseTo(chileAboveProbability(0.4, 810, 900))
  })
})
