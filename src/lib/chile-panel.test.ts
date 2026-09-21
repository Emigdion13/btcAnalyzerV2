import { describe, expect, it } from 'vitest'
import { chilePanelRequestedTimeframes, chilePanelSnapshot, chileRoundClock } from './chile-panel'
import type { ChileReversalResult, ChileLevel, ChileSignal } from './chile-reversal'
import { calculateChileReversal } from './chile-reversal'
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

/**
 * A steadily rising (or falling) series. Every bar makes a higher high and a higher low, closes
 * at its own extreme, and moves one point — enough for the EMA stacks, the RSI and the supertrend
 * to agree without a single counter-trend bar.
 */
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
    const high = Math.max(open, close)
    const low = Math.min(open, close) - 0.5
    return candle(open, high, low, close, firstTime + i * step)
  })

const settings = (overrides: Partial<ChileReversalSettings> = {}): ChileReversalSettings => ({
  ...CHILE_REVERSAL_DEFAULTS,
  ...overrides,
})

/** The overlay engine's result, hand-built so a test can place one reversal event on one bar. */
const reversal = (
  chartBars: number,
  overrides: Partial<ChileReversalResult> = {},
  levels: ChileLevel[] = [],
  signals: ChileSignal[] = [],
): ChileReversalResult => ({
  levels,
  signals,
  atr: Array.from({ length: chartBars }, () => 4),
  warmupBars: 14,
  resolution: '15m',
  missingFeed: false,
  ...overrides,
})

const level = (kind: ChileLevel['kind'], price: number): ChileLevel => ({
  kind,
  side: kind.startsWith('R') ? 'resistance' : 'support',
  price,
  zone: 0.4,
  fallback: false,
})

const signal = (
  kind: ChileSignal['kind'],
  index: number,
  price: number,
  levelKind: ChileSignal['levelKind'],
): ChileSignal => ({
  kind,
  index,
  time: 0,
  level: price,
  levelKind,
  price,
  side: kind === 'bounce-support' || kind === 'break-resistance' ? 'bullish' : 'bearish',
  confirmed: true,
})

/**
 * The shared bullish stage: a 1m chart whose last bar opens a fresh 15m round, a rising 15m feed
 * whose last *closed* bar is index 34, and a rising 5m feed. Everything the score reads leans up.
 */
const bullish = () => {
  const roundCandles = trending(40, 900, 1, 0)
  const lastTime = 31500
  const candles = trending(40, 60, 1, lastTime - 39 * 60)
  const momentumCandles = trending(40, 300, 1, lastTime - 39 * 300)
  return {
    candles,
    timeframe: '1m' as const,
    settings: settings(),
    reversal: reversal(candles.length),
    roundCandles,
    momentumCandles,
    nowSeconds: lastTime + 30,
  }
}

const bearish = () => {
  const input = bullish()
  const lastTime = 31500
  return {
    ...input,
    candles: trending(40, 60, -1, lastTime - 39 * 60, 200),
    roundCandles: trending(40, 900, -1, 0, 200),
    momentumCandles: trending(40, 300, -1, lastTime - 39 * 300, 200),
  }
}

describe('chileRoundClock', () => {
  it('counts down to the next round boundary', () => {
    // 1000 s into the epoch is 100 s past the 900 s boundary; the next one is at 1800 s.
    expect(chileRoundClock(1000, 900)).toEqual({
      totalSeconds: 800,
      text: '13:20',
      urgency: 'steady',
    })
  })

  it('zero-pads and never goes negative', () => {
    // Pine floors the remaining milliseconds, so the last partial second reads 00:00.
    expect(chileRoundClock(1799.4, 900).text).toBe('00:00')
    expect(chileRoundClock(1798.9, 900).text).toBe('00:01')
    expect(chileRoundClock(1800, 900).totalSeconds).toBe(900)
    expect(chileRoundClock(9000, 900).text).toBe('15:00')
  })

  it('uses the Pine colour cuts: red at a minute, amber at three', () => {
    expect(chileRoundClock(1740, 900).urgency).toBe('final')
    expect(chileRoundClock(1739, 900).urgency).toBe('closing')
    expect(chileRoundClock(1620, 900).urgency).toBe('closing')
    expect(chileRoundClock(1619, 900).urgency).toBe('steady')
  })
})

describe('chilePanelRequestedTimeframes', () => {
  it('asks for the round resolution and the 5m momentum read, never the chart itself', () => {
    expect(chilePanelRequestedTimeframes(settings(), '1m')).toEqual(['15m', '5m'])
    expect(chilePanelRequestedTimeframes(settings({ resolution: '1h' }), '15m')).toEqual([
      '1h',
      '5m',
    ])
  })

  it('drops the chart resolution, which the chart candles already serve', () => {
    expect(chilePanelRequestedTimeframes(settings(), '15m')).toEqual(['5m'])
    expect(chilePanelRequestedTimeframes(settings({ resolution: '5m' }), '15m')).toEqual(['5m'])
  })
})

describe('chilePanelSnapshot readiness', () => {
  it('waits for chart data', () => {
    const snapshot = chilePanelSnapshot({ ...bullish(), candles: [] })
    expect(snapshot.ready).toBe(false)
    expect(snapshot.waitingOn).toBe('data')
    expect(snapshot.call).toBe('wait')
  })

  it('reports a missing round feed instead of scoring against nothing', () => {
    const snapshot = chilePanelSnapshot({
      ...bullish(),
      settings: settings({ resolution: '1h' }),
      roundCandles: [],
    })
    expect(snapshot.ready).toBe(false)
    expect(snapshot.waitingOn).toBe('round-feed')
  })

  it('waits while the round ATR is still warming, which the lateral filter and round move need', () => {
    const input = bullish()
    const snapshot = chilePanelSnapshot({
      ...input,
      reversal: reversal(input.candles.length, {
        atr: input.candles.map(() => null),
      }),
    })
    expect(snapshot.ready).toBe(false)
    expect(snapshot.waitingOn).toBe('warmup')
  })

  it('still scores without a 5m feed — a missing momentum read simply contributes nothing', () => {
    const snapshot = chilePanelSnapshot({ ...bullish(), momentumCandles: [] })
    expect(snapshot.ready).toBe(true)
    expect(snapshot.factors.some((factor) => factor.key === 'momentum')).toBe(false)
    // The other eleven bullish contributions are unaffected.
    expect(snapshot.scoreUp).toBe(14)
  })
})

describe('chilePanelSnapshot score', () => {
  it('scores every bullish contribution and calls up', () => {
    const snapshot = chilePanelSnapshot(bullish())
    expect(snapshot.ready).toBe(true)
    expect(snapshot.lateral).toBe(false)
    // robex 2 + round EMA 2 + slope 1 + round RSI 2 + higher high 1 + higher low 1 + 5m momentum 2
    // + pressure 1 + VWAP 1 + buyers 1 + round 2
    expect(snapshot.scoreUp).toBe(16)
    expect(snapshot.scoreDown).toBe(0)
    expect(snapshot.fuerzaArriba).toBe(100)
    expect(snapshot.fuerzaAbajo).toBe(0)
    expect(snapshot.advantage).toBe(16)
    expect(snapshot.call).toBe('up')
    expect(snapshot.trend).toBe('up')
    expect(snapshot.trendLabel).toBe('ALCISTA')
    expect(snapshot.supertrendUp).toBe(true)
    expect(snapshot.buyers).toBe(100)
    expect(snapshot.sellers).toBe(0)
    expect(snapshot.volume).toBe('normal')
    // Factors come back strongest first, for the chips in the window.
    expect(snapshot.factors[0]!.points).toBe(2)
    expect(snapshot.factors.every((f) => f.side === 'up')).toBe(true)
  })

  it('mirrors the same score on the way down', () => {
    const snapshot = chilePanelSnapshot(bearish())
    expect(snapshot.scoreUp).toBe(0)
    expect(snapshot.scoreDown).toBe(16)
    expect(snapshot.fuerzaArriba).toBe(0)
    expect(snapshot.fuerzaAbajo).toBe(100)
    expect(snapshot.call).toBe('down')
    expect(snapshot.trend).toBe('down')
    expect(snapshot.trendLabel).toBe('BAJISTA')
    expect(snapshot.supertrendUp).toBe(false)
    // The fixture's falling bars close a third of the way up their range (the wick is below the
    // body), so sellers read 67% rather than 100% — still past the 60% "strong" line.
    expect(snapshot.sellers).toBe(67)
  })

  it('needs both the minimum score and the minimum edge', () => {
    const input = bullish()
    // 16 points up is not enough once the bar is set above it.
    expect(chilePanelSnapshot({ ...input, settings: settings({ panelMinScore: 17 }) }).call).toBe(
      'wait',
    )
    // Nor is it enough once the edge has to be wider than the gap, even with the score met.
    expect(chilePanelSnapshot({ ...input, settings: settings({ panelMinEdge: 8 }) }).call).toBe(
      'up',
    )
    const bear = bearish()
    expect(chilePanelSnapshot({ ...bear, settings: settings({ panelMinScore: 17 }) }).call).toBe(
      'wait',
    )
  })

  it('stays silent in a lateral market no matter how the score reads', () => {
    const input = bullish()
    // A flat chart and a flat round: the EMA gap collapses and the local RSI sits on 50.
    const snapshot = chilePanelSnapshot({
      ...input,
      candles: input.candles.map((c) => candle(100, 100.5, 99.5, 100, c.time)),
      roundCandles: input.roundCandles.map((c) => candle(100, 100.5, 99.5, 100, c.time)),
      reversal: reversal(input.candles.length),
    })
    expect(snapshot.ready).toBe(true)
    expect(snapshot.lateral).toBe(true)
    expect(snapshot.call).toBe('wait')
  })

  it('reads buyers and sellers off where the close landed in the bar', () => {
    const input = bullish()
    const last = input.candles.length - 1
    const candles = [...input.candles]
    // A bar that closes a third of the way up its range: 33% buyers, 67% sellers.
    candles[last] = candle(100, 103, 99, 100.32, candles[last]!.time)
    const snapshot = chilePanelSnapshot({ ...input, candles })
    expect(snapshot.buyers).toBe(33)
    expect(snapshot.sellers).toBe(67)
  })

  it('calls the volume state off the 20-bar average', () => {
    const input = bullish()
    const last = input.candles.length - 1
    const candles = [...input.candles]
    candles[last] = { ...candles[last]!, volume: candles[last]!.volume * 1.7 }
    // The average includes the bar itself, so the ratio is 1.7 × 19/20 ≈ 1.62.
    expect(chilePanelSnapshot({ ...input, candles }).volume).toBe('very-high')
  })

  it('flags the bar that closes a round, the one Pine prints its signals on', () => {
    const input = bullish()
    expect(chilePanelSnapshot(input).official).toBe(false)
    const candles = [...input.candles]
    const last = candles.length - 1
    candles[last] = { ...candles[last]!, time: candles[last]!.time - 60 }
    // 31440 + 60 lands exactly on the 15m boundary.
    expect(chilePanelSnapshot({ ...input, candles }).official).toBe(true)
  })
})

describe('chilePanelSnapshot levels and reversal points', () => {
  it('scores the reversal events the overlay engine reported, and names them', () => {
    const input = bullish()
    const last = input.candles.length - 1
    const snapshot = chilePanelSnapshot({
      ...input,
      reversal: reversal(
        input.candles.length,
        {},
        [level('S1', 99)],
        [signal('bounce-support', last, 99, 'S1')],
      ),
    })
    const bounce = snapshot.factors.find((factor) => factor.key === 'bounce')
    expect(bounce?.points).toBe(3)
    expect(snapshot.scoreUp).toBe(19)
    expect(snapshot.level).toBe('bounce')
    expect(snapshot.levelLabel).toBe('REBOTE SOPORTE')
  })

  it('scores a rejection against the call and says so', () => {
    const input = bullish()
    const last = input.candles.length - 1
    const snapshot = chilePanelSnapshot({
      ...input,
      reversal: reversal(
        input.candles.length,
        {},
        [level('R1', 140)],
        [signal('reject-resistance', last, 140, 'R1')],
      ),
    })
    expect(snapshot.factors.find((factor) => factor.key === 'reject')?.points).toBe(3)
    expect(snapshot.scoreDown).toBe(3)
    expect(snapshot.level).toBe('reject')
  })

  it('reports proximity inside 0.20 ATR, and nothing beyond it', () => {
    const input = bullish()
    const close = input.candles[input.candles.length - 1]!.close
    const near = chilePanelSnapshot({
      ...input,
      reversal: reversal(input.candles.length, {}, [level('R1', close + 0.5)]),
    })
    // ATR is 4, so the proximity band is 0.8 — 0.5 away is inside it.
    expect(near.level).toBe('near-r1')
    expect(near.levelLabel).toBe('CERCA R1')

    const far = chilePanelSnapshot({
      ...input,
      reversal: reversal(input.candles.length, {}, [level('R1', close + 1.5)]),
    })
    expect(far.level).toBe('none')
    expect(far.levelLabel).toBe('SIN NIVEL CERCANO')
  })

  it('lets a break outrank proximity, as the Pine panel assigns srTexto in order', () => {
    const input = bullish()
    const last = input.candles.length - 1
    const close = input.candles[last]!.close
    const snapshot = chilePanelSnapshot({
      ...input,
      reversal: reversal(
        input.candles.length,
        {},
        [level('R1', close + 0.2)],
        [signal('break-resistance', last, close + 0.2, 'R1')],
      ),
    })
    expect(snapshot.level).toBe('break-resistance')
    expect(snapshot.scoreUp).toBe(19)
  })
})

describe('chilePanelSnapshot on the workspace demo feeds', () => {
  it('is ready and scores the synthetic history the app generates', () => {
    // The default offline workspace: a 1m chart with generated 15m and 5m feeds. This is the exact
    // input the floating window gets in demo mode, so the panel has to be ready on it rather than
    // sitting on a "feed loading" line.
    const asset = ASSETS[0]!
    const candles = generateCandles(asset, '1m')
    const roundCandles = generateCandles(asset, '15m')
    const demo = settings()
    const snapshot = chilePanelSnapshot({
      candles,
      timeframe: '1m',
      settings: demo,
      reversal: calculateChileReversal(candles, demo, {
        timeframe: '1m',
        timeframes: { '15m': { candles: roundCandles } },
      }),
      roundCandles,
      momentumCandles: generateCandles(asset, '5m'),
      nowSeconds: candles[candles.length - 1]!.time,
    })

    expect(snapshot.ready).toBe(true)
    expect(snapshot.waitingOn).toBe(null)
    // A mixed synthetic market scores on both sides, and the two shares have to add up.
    expect(snapshot.scoreUp).toBeGreaterThan(0)
    expect(snapshot.scoreDown).toBeGreaterThan(0)
    expect(snapshot.fuerzaArriba + snapshot.fuerzaAbajo).toBeGreaterThanOrEqual(99)
    expect(snapshot.fuerzaArriba + snapshot.fuerzaAbajo).toBeLessThanOrEqual(101)
    // The call follows the same two gates whatever the numbers turn out to be.
    const called =
      snapshot.scoreUp >= demo.panelMinScore && snapshot.advantage >= demo.panelMinEdge
        ? 'up'
        : snapshot.scoreDown >= demo.panelMinScore && -snapshot.advantage >= demo.panelMinEdge
          ? 'down'
          : 'wait'
    expect(snapshot.lateral ? 'wait' : called).toBe(snapshot.call)
    expect(snapshot.clock.text).toMatch(/^\d{2}:\d{2}$/)
  })
})
