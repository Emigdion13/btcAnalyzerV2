import { describe, expect, it } from 'vitest'
import {
  buildPriceForecast,
  finishAboveProbability,
  firstPassageBars,
  firstPassageProbability,
  normalCdf,
  type PinnedStrike,
} from './price-forecast'
import type { AgentOpinion, LevelStrengthSummary, SpecializedAgentId } from './market-agents'
import type { Candle } from './types'

const NO_LEVELS: LevelStrengthSummary = {
  nearestSupport: null,
  nearestResistance: null,
  supportPressure: 0,
  resistancePressure: 0,
  imbalance: 0,
}

function candles(count = 120, drift = 0.4): Candle[] {
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < count; i++) {
    const open = price
    const close = price + drift + Math.sin(i / 5) * 0.15
    out.push({
      time: i * 60,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 100,
    })
    price = close
  }
  return out
}

function opinion(id: SpecializedAgentId, score: number, confidence = 0.7): AgentOpinion {
  return {
    id,
    label: id,
    bias: score > 0.12 ? 'bullish' : score < -0.12 ? 'bearish' : 'neutral',
    score,
    confidence,
    reasons: [`${id} reason`],
    warnings: [],
    metrics: {},
  }
}

function weights(specialists: AgentOpinion[], value = 0.12) {
  return new Map<SpecializedAgentId, number>(
    specialists.map((entry) => [entry.id as SpecializedAgentId, value]),
  )
}

function strike(price: number, overrides: Partial<PinnedStrike> = {}): PinnedStrike {
  return {
    price,
    windowStart: 0,
    windowEnd: 900,
    secondsLeft: 300,
    expiryLabel: '9:15',
    provisional: false,
    label: '15m strike',
    ...overrides,
  }
}

describe('price forecast math', () => {
  it('is a proper normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(-1)).toBeCloseTo(1 - normalCdf(1), 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-8)).toBeLessThan(1e-10)
    expect(normalCdf(8)).toBeGreaterThan(1 - 1e-10)
  })

  it('answers the strike question as a coin flip when there is no distance and no drift', () => {
    expect(finishAboveProbability(0, 0, 10)).toBeCloseTo(0.5, 6)
    // Distance and drift both push the finish the way they lean.
    expect(finishAboveProbability(0.5, 0, 10)).toBeGreaterThan(0.5)
    expect(finishAboveProbability(0, 0.5, 10)).toBeGreaterThan(0.5)
    expect(finishAboveProbability(-0.5, 0, 10)).toBeLessThan(0.5)
    // A drifting walk travels further the longer it runs, so the same drift moves less of
    // the distribution the further out the question is asked.
    expect(finishAboveProbability(0, 1, 4)).toBeGreaterThan(finishAboveProbability(0, 1, 40))
  })

  it('prices the chance of touching the strike before the close', () => {
    expect(firstPassageProbability(0, 0.4, 10)).toBe(1)
    // Driftless, a barrier one move-scale away is more likely than not to be touched.
    expect(firstPassageProbability(0.5, 0, 10)).toBeGreaterThan(0.5)
    // Further barriers are less likely, and more bars give the walk more chances.
    expect(firstPassageProbability(1.5, 0, 10)).toBeLessThan(firstPassageProbability(0.5, 0, 10))
    expect(firstPassageProbability(1.5, 0, 10)).toBeLessThan(firstPassageProbability(1.5, 0, 40))
    // Drifting toward the barrier is worth more than drifting away from it.
    expect(firstPassageProbability(1.2, -0.6, 10)).toBeGreaterThan(
      firstPassageProbability(1.2, 0.6, 10),
    )
    // Drifting away makes the touch less likely than standing still, and a strong drift
    // away makes it properly unlikely — never impossible, because the tape is noisy.
    const driftless = firstPassageProbability(2, 0, 10)
    expect(firstPassageProbability(2, 1.5, 10)).toBeLessThan(driftless)
    expect(firstPassageProbability(2, 5, 10)).toBeLessThan(0.2)
    expect(firstPassageProbability(2, 5, 10)).toBeGreaterThan(0)
  })

  it('estimates when touching becomes more likely than not', () => {
    expect(firstPassageBars(0, 0.4, 10)).toBe(1)
    const bars = firstPassageBars(1.5, 0.4, 12)
    expect(bars).not.toBeNull()
    expect(bars!).toBeGreaterThan(1)
    expect(bars!).toBeLessThanOrEqual(12)
    expect(firstPassageBars(8, 0, 5)).toBeNull()
  })
})

describe('buildPriceForecast', () => {
  const bullish = [opinion('trend', 0.7), opinion('momentum', 0.6), opinion('macd', 0.5)]

  it('projects a bullish tape higher and puts the strike call on the side the model favors', () => {
    const tape = candles()
    const price = tape[tape.length - 1].close
    const forecast = buildPriceForecast({
      candles: tape,
      timeframe: '1m',
      horizonBars: 10,
      barSeconds: 60,
      price,
      atr: 0.9,
      regime: 'trend-up',
      specialists: bullish,
      levels: NO_LEVELS,
      weights: weights(bullish),
      strike: strike(price - 2),
      anchorTime: tape[tape.length - 1].time,
    })

    expect(forecast.horizonBars).toBe(10)
    expect(forecast.expectedMoveAtr).toBeGreaterThan(0)
    expect(forecast.expectedPrice).toBeGreaterThan(price)
    expect(forecast.targetLow).toBeLessThan(forecast.expectedPrice)
    expect(forecast.targetHigh).toBeGreaterThan(forecast.expectedPrice)
    // Price is already above a strike two ATR below: the model should not be shy about it.
    expect(forecast.finishAboveProbability!).toBeGreaterThan(0.6)
    expect(forecast.strikeCall).toBe('above')
    expect(forecast.strikeCallProbability!).toBeGreaterThan(0.6)
    expect(forecast.bias).toBe('bullish')
    expect(forecast.headline).toContain('Above')
    expect(forecast.timeline).toHaveLength(3)
    expect(forecast.timeline[0].title).toContain('Bars 1–')
    expect(forecast.reasons[0]).toContain('strike')
    expect(forecast.agents).toHaveLength(bullish.length)
    expect(forecast.agents.every((agent) => agent.driftAtr > 0)).toBe(true)
    expect(forecast.modelNote).toContain('√bars')
    expect(forecast.snapshot.strike).toBe(price - 2)
  })

  it('turns a strike the price has to cross into a harder question than one already held', () => {
    const tape = candles(120, 0.02)
    const price = tape[tape.length - 1].close
    const level = [
      opinion('trend', 0.3),
      opinion('momentum', 0.25),
      opinion('macd', 0.2),
      opinion('level-strength', -0.3),
    ]
    const base = {
      candles: tape,
      timeframe: '5m' as const,
      horizonBars: 10,
      barSeconds: 300,
      price,
      atr: 1,
      regime: 'range' as const,
      specialists: level,
      levels: NO_LEVELS,
      weights: weights(level),
      anchorTime: tape[tape.length - 1].time,
    }
    const close = buildPriceForecast({ ...base, strike: strike(price - 0.5) })
    const far = buildPriceForecast({ ...base, strike: strike(price + 4) })
    expect(close.finishAboveProbability!).toBeGreaterThan(far.finishAboveProbability!)
    // Four ATR above price is a genuine uphill question: the model calls below.
    expect(far.strikeCall).toBe('below')
    expect(far.strikeCallProbability!).toBeGreaterThan(0.5)
    expect(far.strikeTouchProbability!).toBeLessThan(close.strikeTouchProbability!)
    // And it says the distance is the reason, not the drift.
    expect(far.reasons.join(' ')).toContain('strike')
  })

  it('says when the horizon is a coin flip instead of inventing a side', () => {
    const tape = candles(120, 0)
    const price = tape[tape.length - 1].close
    const flat = [opinion('trend', 0.02), opinion('momentum', -0.03), opinion('macd', 0.01)]
    const forecast = buildPriceForecast({
      candles: tape,
      timeframe: '1m',
      horizonBars: 10,
      barSeconds: 300,
      price,
      atr: 1,
      regime: 'chop',
      specialists: flat,
      levels: NO_LEVELS,
      weights: weights(flat),
      strike: strike(price + 0.02),
      anchorTime: tape[tape.length - 1].time,
    })
    expect(forecast.strikeCall).toBe('none')
    expect(forecast.strikeCallProbability!).toBeLessThan(0.55)
    expect(forecast.path === 'range' || forecast.path === 'squeeze').toBe(true)
    expect(forecast.risks.join(' ')).toContain('coin-flip')
  })

  it('prices how reachable the nearest levels are inside the horizon', () => {
    const tape = candles(120, 0.3)
    const price = tape[tape.length - 1].close
    const levels: LevelStrengthSummary = {
      ...NO_LEVELS,
      nearestResistance: {
        price: price + 2.5,
        top: price + 2.7,
        bottom: price + 2.3,
        source: 'pivot',
        strength: 0.6,
        distanceAtr: 2.5,
        touches: 3,
      },
      nearestSupport: {
        price: price - 1,
        top: price - 0.8,
        bottom: price - 1.2,
        source: 'pivot',
        strength: 0.6,
        distanceAtr: 1,
        touches: 2,
      },
    }
    const forecast = buildPriceForecast({
      candles: tape,
      timeframe: '5m',
      horizonBars: 10,
      barSeconds: 300,
      price,
      atr: 1,
      regime: 'trend-up',
      specialists: bullish,
      levels,
      weights: weights(bullish),
      strike: null,
      anchorTime: tape[tape.length - 1].time,
    })
    expect(forecast.supportReachProbability!).toBeGreaterThan(forecast.resistanceReachProbability!)
    expect(forecast.resistanceReachProbability!).toBeGreaterThan(0)
    expect(forecast.timeline[1].title).toBe('Levels in the way')
    expect(forecast.reasons.join(' ')).toContain('Nearest support is inside reach')
    // Without a strike the call is still graded on drift, and never claims a side it cannot.
    expect(forecast.strikeCall).toBe('none')
    expect(forecast.finishAboveProbability).toBeNull()
    expect(forecast.headline).toContain('ATR expected')
  })

  it('reads a squeeze as compression rather than a breakout', () => {
    // Wide bars gave way to narrow ones: the tape is coiling, and the current ATR sits
    // well under the range the window has been travelling.
    const tape = candles(120, 0.02).map((candle, index) => ({
      ...candle,
      high: candle.close + (index < 100 ? 1 : 0.03),
      low: candle.close - (index < 100 ? 1 : 0.03),
    }))
    const price = tape[tape.length - 1].close
    const quiet = [opinion('trend', 0.05), opinion('momentum', 0.05)]
    const forecast = buildPriceForecast({
      candles: tape,
      timeframe: '1m',
      horizonBars: 10,
      barSeconds: 60,
      price,
      atr: 0.18,
      regime: 'chop',
      specialists: quiet,
      levels: NO_LEVELS,
      weights: weights(quiet),
      strike: null,
      anchorTime: tape[tape.length - 1].time,
    })
    expect(forecast.path).toBe('squeeze')
    expect(forecast.thrust).toBe('fade')
    expect(forecast.risks.join(' ')).toContain('squeeze')
  })
})
