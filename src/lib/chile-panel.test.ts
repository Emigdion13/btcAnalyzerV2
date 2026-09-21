import { describe, expect, it } from 'vitest'
import { chilePanelSnapshot, chileRoundClock } from './chile-panel'
import { calculateChileReversal, type ChileReversalResult } from './chile-reversal'
import { ASSETS, generateCandles } from './market'
import { CHILE_REVERSAL_DEFAULTS, type Candle, type ChileReversalSettings } from './types'

const candle = (
  open: number,
  high: number,
  low: number,
  close: number,
  time: number,
  volume = 10,
): Candle => ({ time, open, high, low, close, volume })

/** A steadily rising series: every bar agrees, so the score lands on one side. */
const trending = (
  count: number,
  step: number,
  direction: 1 | -1,
  firstTime: number,
  start = 100,
): Candle[] =>
  Array.from({ length: count }, (_, i) => {
    const open = start + direction * i
    const close = open + direction
    return candle(
      open,
      Math.max(open, close),
      Math.min(open, close) - 0.5,
      close,
      firstTime + i * step,
    )
  })

const settings = (overrides: Partial<ChileReversalSettings> = {}): ChileReversalSettings => ({
  ...CHILE_REVERSAL_DEFAULTS,
  ...overrides,
})

const LAST_TIME = 31500

/** The same bullish stage the engine tests score: 16 points up, nothing down. */
const rising = () => ({
  candles: trending(40, 60, 1, LAST_TIME - 39 * 60),
  timeframes: {
    '15m': { candles: trending(40, 900, 1, 0) },
    '5m': { candles: trending(40, 300, 1, LAST_TIME - 39 * 300) },
  },
})

const result = (overrides: Partial<ChileReversalSettings> = {}): ChileReversalResult => {
  const input = rising()
  return calculateChileReversal(input.candles, settings(overrides), {
    timeframe: '1m',
    timeframes: input.timeframes,
  })
}

describe('chileRoundClock', () => {
  it('counts down to the next quarter hour', () => {
    // 16:00:00 UTC opens a round; the clock is full and only turns amber at 12 minutes in.
    expect(chileRoundClock(Date.UTC(2026, 8, 7, 16, 0, 0) / 1000, 900)).toEqual({
      totalSeconds: 900,
      text: '15:00',
      urgency: 'steady',
    })
    expect(chileRoundClock(Date.UTC(2026, 8, 7, 16, 12, 1) / 1000, 900).text).toBe('02:59')
  })

  it('turns amber with three minutes left and red in the last minute', () => {
    const at = (seconds: number) =>
      chileRoundClock(Date.UTC(2026, 8, 7, 16, 0, seconds) / 1000, 900)
    expect(at(719).urgency).toBe('steady')
    expect(at(720).urgency).toBe('closing')
    expect(at(839).urgency).toBe('closing')
    expect(at(840).urgency).toBe('final')
    expect(at(899).urgency).toBe('final')
    // The next round opens a second later and the clock resets.
    expect(chileRoundClock(Date.UTC(2026, 8, 7, 16, 15, 0) / 1000, 900).text).toBe('15:00')
  })

  it('follows the round resolution, so a 1h panel counts to the hour', () => {
    expect(chileRoundClock(Date.UTC(2026, 8, 7, 16, 30, 0) / 1000, 3600).text).toBe('30:00')
  })
})

describe('chilePanelSnapshot', () => {
  it('says what it is waiting for instead of scoring zeros', () => {
    const empty = calculateChileReversal([], settings(), { timeframe: '1m', timeframes: {} })
    expect(
      chilePanelSnapshot({ result: empty, settings: settings(), nowSeconds: 0 }).waitingOn,
    ).toBe('data')

    // The round feed never answered: the panel must not fall back to the chart resolution.
    const unfed = calculateChileReversal(rising().candles, settings(), {
      timeframe: '1m',
      timeframes: { '15m': { candles: [] } },
    })
    expect(unfed.missingFeed).toBe(true)
    expect(
      chilePanelSnapshot({ result: unfed, settings: settings(), nowSeconds: 0 }).waitingOn,
    ).toBe('round-feed')

    // The round feed answered but ATR(14) has not warmed up, so there is nothing to score.
    const short = calculateChileReversal(rising().candles.slice(-5), settings(), {
      timeframe: '1m',
      timeframes: { '15m': { candles: trending(6, 900, 1, 0) } },
    })
    const waiting = chilePanelSnapshot({ result: short, settings: settings(), nowSeconds: 0 })
    expect(waiting.waitingOn).toBe('warmup')
    expect(waiting.ready).toBe(false)
    expect(waiting.call).toBe('wait')
    expect(waiting.levelLabel).toBe('SIN NIVEL CERCANO')
    // The clock still runs: it is wall time, not engine state, and epoch 0 opens a round.
    expect(waiting.clock.text).toBe('15:00')
  })

  it('reads the engine’s newest bar, so the panel and the chart cannot disagree', () => {
    const engine = result()
    const snapshot = chilePanelSnapshot({
      result: engine,
      settings: settings(),
      nowSeconds: LAST_TIME + 60,
    })
    const last = engine.last!
    expect(snapshot.ready).toBe(true)
    expect(snapshot.scoreUp).toBe(last.scoreUp)
    expect(snapshot.scoreDown).toBe(last.scoreDown)
    expect(snapshot.fuerzaArriba).toBe((16 / 16) * 100)
    expect(snapshot.advantage).toBe(last.advantage)
    expect(snapshot.factors).toBe(last.factors)
    expect(snapshot.buyers).toBe(last.buyers)
    expect(snapshot.rsiRound).toBe(last.rsiRound)
    expect(snapshot.trendLabel).toBe('ALCISTA')
    expect(snapshot.levelLabel).toBe(last.levelLabel)
    expect(snapshot.call).toBe('up')
    expect(snapshot.official).toBe(last.official)
  })

  it('reports ESPERAR when the edge is too thin to call a round', () => {
    const profile = settings({ minScore: 17 })
    const engine = result(profile)
    const snapshot = chilePanelSnapshot({
      result: engine,
      settings: profile,
      nowSeconds: LAST_TIME,
    })
    expect(snapshot.scoreUp).toBeGreaterThan(snapshot.scoreDown)
    expect(snapshot.call).toBe('wait')
  })

  it('counts down inside the round it is reading', () => {
    const snapshot = chilePanelSnapshot({
      result: result(),
      settings: settings(),
      nowSeconds: Date.UTC(2026, 8, 7, 16, 14, 0) / 1000,
    })
    expect(snapshot.clock.text).toBe('01:00')
    expect(snapshot.clock.urgency).toBe('final')
  })
})

describe('chile panel on the demo feed', () => {
  it('produces a complete readout from generated candles', () => {
    const asset = ASSETS[0]!
    const candles = generateCandles(asset, '1m')
    const profile = settings()
    const engine = calculateChileReversal(candles, profile, {
      timeframe: '1m',
      timeframes: {
        '15m': { candles: generateCandles(asset, '15m') },
        '5m': { candles: generateCandles(asset, '5m') },
      },
    })
    const newest = candles.at(-1)!
    const snapshot = chilePanelSnapshot({
      result: engine,
      settings: profile,
      nowSeconds: newest.time + 30,
    })
    expect(snapshot.ready).toBe(true)
    expect(snapshot.waitingOn).toBe(null)
    expect(snapshot.scoreUp + snapshot.scoreDown).toBeGreaterThan(0)
    expect(snapshot.fuerzaArriba + snapshot.fuerzaAbajo).toBe(100)
    expect(snapshot.clock.text).toMatch(/^\d{2}:\d{2}$/)
    expect(['up', 'down', 'wait']).toContain(snapshot.call)
    expect(snapshot.factors.length).toBeLessThanOrEqual(14)
  })
})
