import { scoreZone, type BookStrengthBucket } from '../../shared/order-book'
import type { ConnectionState, OrderBookView } from '../../shared/coinbase'
import { ta } from './indicator-runtime'
import {
  SR_BREAKS_RETESTS_DEFAULTS,
  type Candle,
  type Timeframe,
} from './types'
import { calculateSrBreaksRetests } from './sr-breaks-retests'

export type AgentBias = 'bullish' | 'bearish' | 'neutral'
export type SpecializedAgentId =
  | 'regime'
  | 'trend'
  | 'momentum'
  | 'level-strength'
  | 'structure'
  | 'context'
export type AgentId = SpecializedAgentId | 'ensemble'
export type MarketRegime =
  | 'trend-up'
  | 'trend-down'
  | 'range'
  | 'breakout'
  | 'breakdown'
  | 'chop'

export interface ContextSignal {
  timeframe: Timeframe
  bias: AgentBias
  score: number
  confidence: number
  regime: MarketRegime
}

export interface AnalysisSnapshot {
  candles: Candle[]
  timeframe: Timeframe
  book?: OrderBookView | null
  context?: ContextSignal[]
}

export interface AgentOpinion {
  id: AgentId
  label: string
  bias: AgentBias
  /** Signed directional score in [-1, 1]. */
  score: number
  /** Confidence in [0, 1]. */
  confidence: number
  reasons: string[]
  warnings: string[]
  metrics: Record<string, number | string | boolean | null>
}

export type SpecializedOpinion<T extends SpecializedAgentId = SpecializedAgentId> = AgentOpinion & {
  id: T
}

export interface LevelReference {
  price: number
  top: number
  bottom: number
  source: 'sr-zone' | 'pivot'
  strength: number
  distanceAtr: number
  touches: number
  state?: 'intact' | 'broken'
  bookBucket?: BookStrengthBucket
  bookNotional?: number
}

export interface LevelStrengthSummary {
  nearestSupport: LevelReference | null
  nearestResistance: LevelReference | null
  supportPressure: number
  resistancePressure: number
  imbalance: number
}

export interface MarketAnalysis {
  regime: MarketRegime
  bias: AgentBias
  score: number
  confidence: number
  reasons: string[]
  risks: string[]
  agents: AgentOpinion[]
  learningRecord: LearningRecord
  summary: {
    currentPrice: number
    atr: number
    nearestSupport: LevelReference | null
    nearestResistance: LevelReference | null
  }
}

export interface LearningRecord {
  timeframe: Timeframe
  regime: MarketRegime
  ensemble: Pick<AgentOpinion, 'id' | 'bias' | 'score' | 'confidence'>
  agents: Pick<AgentOpinion, 'id' | 'bias' | 'score' | 'confidence'>[]
}

/** One higher timeframe feeding the ensemble, with the state of its own feed. */
export interface ContextAnalysis {
  timeframe: Timeframe
  state?: ConnectionState | 'paused'
  analysis: MarketAnalysis | null
}

interface PerformanceCell {
  skill: number
  samples: number
}

interface AgentLearningEntry {
  overall: PerformanceCell
  byRegime: Partial<Record<MarketRegime, PerformanceCell>>
  byTimeframe: Partial<Record<Timeframe, PerformanceCell>>
}

export interface AgentLearningState {
  version: 1
  updatedAt: string
  agents: Partial<Record<AgentId, AgentLearningEntry>>
}

export interface LearningOutcome {
  /** Fractional move over the settled horizon: 0.01 = +1%, -0.005 = -0.5%. */
  move: number
  /** Moves inside ±threshold are treated as flat / no directional edge. Default 0.2%. */
  flatThreshold?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const last = <T>(values: T[]) => values[values.length - 1]
const numberOrNull = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const nonNullTail = (values: (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i] as number
  return null
}
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const sumAbsDiff = (values: number[]) => {
  let total = 0
  for (let i = 1; i < values.length; i++) total += Math.abs(values[i] - values[i - 1])
  return total
}
const biasFromScore = (score: number, threshold = 0.18): AgentBias =>
  score >= threshold ? 'bullish' : score <= -threshold ? 'bearish' : 'neutral'
const distanceWeight = (distanceAtr: number | null) =>
  distanceAtr === null ? 0 : clamp(1.3 - distanceAtr / 2.2, 0, 1)
const bookBucketWeight = (bucket?: BookStrengthBucket) =>
  bucket === 'strong' ? 1 : bucket === 'medium' ? 0.7 : bucket === 'weak' ? 0.35 : 0
const TIMEFRAME_ORDER: Timeframe[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1D', '1W']
const timeframeRank = (timeframe: Timeframe) => TIMEFRAME_ORDER.indexOf(timeframe)

function atr(candles: Candle[], period: number): (number | null)[] {
  const ranges: (number | null)[] = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low
    const previousClose = candles[index - 1].close
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    )
  })
  const out: (number | null)[] = new Array(candles.length).fill(null)
  let seed = 0
  let averageRange: number | null = null
  for (let i = 0; i < ranges.length; i++) {
    const value = ranges[i]!
    if (i < period - 1) {
      seed += value
      continue
    }
    if (i === period - 1) {
      seed += value
      averageRange = seed / period
    } else averageRange = (averageRange! * (period - 1) + value) / period
    out[i] = averageRange
  }
  return out
}

function slopeScore(values: (number | null)[], lookback: number, normalizer: number): number {
  const endIndex = values.length - 1
  const end = numberOrNull(values[endIndex])
  if (end === null) return 0
  for (let i = endIndex - lookback; i >= 0; i--) {
    const start = numberOrNull(values[i])
    if (start === null) continue
    const bars = Math.max(1, endIndex - i)
    return clamp((end - start) / Math.max(normalizer * bars, 1e-9), -1, 1)
  }
  return 0
}

function macd(close: number[]) {
  const fast = ta.ema(close, 12)
  const slow = ta.ema(close, 26)
  const line = fast.map((value, index) =>
    value === null || slow[index] === null ? null : value - slow[index]!,
  )
  const signal = ta.ema(line, 9)
  const histogram = line.map((value, index) =>
    value === null || signal[index] === null ? null : value - signal[index]!,
  )
  return { line, signal, histogram }
}

function countTouches(
  candles: Candle[],
  level: number,
  tolerance: number,
  side: 'support' | 'resistance',
): number {
  let touches = 0
  for (const candle of candles.slice(-80)) {
    if (side === 'support') {
      if (candle.low <= level + tolerance && candle.low >= level - tolerance) touches++
    } else if (candle.high >= level - tolerance && candle.high <= level + tolerance) touches++
  }
  return touches
}

function pivotLevels(candles: Candle[], atrValue: number, currentPrice: number) {
  const tolerance = atrValue * 0.25
  const highs: LevelReference[] = []
  const lows: LevelReference[] = []
  for (let i = 3; i < candles.length - 3; i++) {
    const value = candles[i]
    const pivotHigh =
      value.high > candles[i - 1].high &&
      value.high >= candles[i - 2].high &&
      value.high > candles[i + 1].high &&
      value.high >= candles[i + 2].high
    const pivotLow =
      value.low < candles[i - 1].low &&
      value.low <= candles[i - 2].low &&
      value.low < candles[i + 1].low &&
      value.low <= candles[i + 2].low
    if (pivotHigh && value.high > currentPrice) {
      const touches = countTouches(candles, value.high, tolerance, 'resistance')
      highs.push({
        price: value.high,
        top: value.high + tolerance,
        bottom: value.high - tolerance,
        source: 'pivot',
        strength: clamp(touches / 5, 0.2, 0.8),
        distanceAtr: (value.high - currentPrice) / Math.max(atrValue, 1e-9),
        touches,
      })
    }
    if (pivotLow && value.low < currentPrice) {
      const touches = countTouches(candles, value.low, tolerance, 'support')
      lows.push({
        price: value.low,
        top: value.low + tolerance,
        bottom: value.low - tolerance,
        source: 'pivot',
        strength: clamp(touches / 5, 0.2, 0.8),
        distanceAtr: (currentPrice - value.low) / Math.max(atrValue, 1e-9),
        touches,
      })
    }
  }
  return {
    nearestResistance:
      highs.sort((a, b) => a.distanceAtr - b.distanceAtr || b.strength - a.strength)[0] ?? null,
    nearestSupport:
      lows.sort((a, b) => a.distanceAtr - b.distanceAtr || b.strength - a.strength)[0] ?? null,
  }
}

function levelFromSrZone(
  candles: Candle[],
  book: OrderBookView | null | undefined,
  atrValue: number,
  currentPrice: number,
  side: 'support' | 'resistance',
): LevelReference | null {
  const result = calculateSrBreaksRetests(candles, SR_BREAKS_RETESTS_DEFAULTS)
  const zone = result.zones
    .filter((candidate) => candidate.side === side && candidate.state === 'intact')
    .filter((candidate) =>
      side === 'support' ? candidate.level < currentPrice : candidate.level > currentPrice,
    )
    .sort(
      (a, b) =>
        Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice) || b.fillOpacity - a.fillOpacity,
    )[0]
  if (!zone) return null
  const fallbackHalfWidth = Math.max(atrValue * 0.4, currentPrice * 0.001)
  const bottom = side === 'support' ? zone.boundary ?? zone.level - fallbackHalfWidth : zone.level
  const top = side === 'support' ? zone.level : zone.boundary ?? zone.level + fallbackHalfWidth
  const touches = countTouches(candles, zone.level, atrValue * 0.25, side)
  const bookScore = book
    ? scoreZone(book, Math.max(top, bottom), Math.min(top, bottom), side === 'support' ? 'bid' : 'ask')
    : null
  const volumeBaseline = average(candles.slice(-30).map((candle) => candle.volume)) || 1
  const volumeScore = clamp(Math.abs(zone.volume) / (volumeBaseline * 2.5), 0, 1)
  const recency = clamp(1 - (candles.length - 1 - zone.createdIndex) / 100, 0.15, 1)
  const zoneStrength = clamp(zone.fillOpacity / 0.7, 0, 1)
  const strength = clamp(
    0.35 * zoneStrength +
      0.2 * recency +
      0.2 * volumeScore +
      0.15 * clamp(touches / 5, 0, 1) +
      0.1 * bookBucketWeight(bookScore?.bucket),
    0,
    1,
  )
  return {
    price: zone.level,
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
    source: 'sr-zone',
    strength,
    distanceAtr:
      side === 'support'
        ? (currentPrice - zone.level) / Math.max(atrValue, 1e-9)
        : (zone.level - currentPrice) / Math.max(atrValue, 1e-9),
    touches,
    state: zone.state,
    bookBucket: bookScore?.bucket,
    bookNotional: bookScore?.notional,
  }
}

function chooseLevel(primary: LevelReference | null, fallback: LevelReference | null) {
  if (primary) return primary
  return fallback
}

function analyzeRegime(currentPrice: number, atrValue: number, candles: Candle[]): SpecializedOpinion<'regime'> & {
  regime: MarketRegime
} {
  const close = candles.map((candle) => candle.close)
  const ema20 = ta.ema(close, 20)
  const ema50 = ta.ema(close, 50)
  const lastEma20 = nonNullTail(ema20)
  const lastEma50 = nonNullTail(ema50)
  const recent = close.slice(-21)
  const net = recent.length >= 2 ? Math.abs(last(recent) - recent[0]) : 0
  const gross = sumAbsDiff(recent)
  const efficiency = gross > 0 ? net / gross : 0
  const atrSeries = atr(candles, 14)
  const lastAtr = nonNullTail(atrSeries) ?? atrValue
  const atrMean = average(atrSeries.slice(-10).filter((value): value is number => value !== null)) || lastAtr
  const breakoutHigh = Math.max(...candles.slice(-21, -1).map((candle) => candle.high))
  const breakoutLow = Math.min(...candles.slice(-21, -1).map((candle) => candle.low))
  const ema50Slope = slopeScore(ema50, 10, lastAtr)
  let regime: MarketRegime = 'chop'
  if (currentPrice > breakoutHigh + lastAtr * 0.25 && lastAtr >= atrMean * 1.03) regime = 'breakout'
  else if (currentPrice < breakoutLow - lastAtr * 0.25 && lastAtr >= atrMean * 1.03)
    regime = 'breakdown'
  else if (efficiency >= 0.48 && ema50Slope > 0.06 && currentPrice > (lastEma50 ?? currentPrice))
    regime = 'trend-up'
  else if (efficiency >= 0.48 && ema50Slope < -0.06 && currentPrice < (lastEma50 ?? currentPrice))
    regime = 'trend-down'
  else if (
    efficiency <= 0.28 &&
    lastEma20 !== null &&
    Math.abs(currentPrice - lastEma20) <= lastAtr * 1.1
  )
    regime = 'range'

  const score =
    regime === 'trend-up'
      ? 0.7
      : regime === 'trend-down'
        ? -0.7
        : regime === 'breakout'
          ? 0.9
          : regime === 'breakdown'
            ? -0.9
            : 0
  const confidence =
    regime === 'range'
      ? clamp(0.45 + (0.32 - efficiency), 0.4, 0.82)
      : regime === 'chop'
        ? 0.42
        : clamp(0.5 + efficiency * 0.45 + Math.abs(ema50Slope) * 0.25, 0.45, 0.95)
  const reasons = [
    `Efficiency ratio ${efficiency.toFixed(2)}${efficiency >= 0.48 ? ' suggests directional flow' : efficiency <= 0.28 ? ' suggests range conditions' : ' is indecisive'}.`,
  ]
  if (regime === 'breakout') reasons.push(`Price cleared the recent 20-bar high by ${(currentPrice - breakoutHigh).toFixed(2)}.`)
  if (regime === 'breakdown') reasons.push(`Price lost the recent 20-bar low by ${(breakoutLow - currentPrice).toFixed(2)}.`)
  if (regime === 'trend-up' || regime === 'trend-down')
    reasons.push(`EMA 50 slope is ${ema50Slope > 0 ? 'rising' : 'falling'} (${ema50Slope.toFixed(2)} normalized).`)
  if (regime === 'range') reasons.push('Price is staying close to the 20 EMA while directional efficiency remains low.')
  if (regime === 'chop') reasons.push('Trend and range tests disagree, so the environment is being treated as chop.')
  return {
    id: 'regime',
    label: 'Regime Agent',
    regime,
    bias: biasFromScore(score),
    score,
    confidence,
    reasons,
    warnings: regime === 'chop' ? ['Choppy conditions reduce the reliability of directional signals.'] : [],
    metrics: {
      regime,
      efficiency,
      atr: lastAtr,
      atrMean,
      ema50Slope,
      breakoutHigh,
      breakoutLow,
    },
  }
}

function analyzeTrend(currentPrice: number, atrValue: number, candles: Candle[]): SpecializedOpinion<'trend'> {
  const close = candles.map((candle) => candle.close)
  const ema20 = ta.ema(close, 20)
  const ema50 = ta.ema(close, 50)
  const ema200 = ta.ema(close, 200)
  const last20 = nonNullTail(ema20)
  const last50 = nonNullTail(ema50)
  const last200 = nonNullTail(ema200)
  if (last20 === null || last50 === null)
    return {
      id: 'trend',
      label: 'Trend Agent',
      bias: 'neutral',
      score: 0,
      confidence: 0.2,
      reasons: ['Not enough candles to form reliable EMA trend context.'],
      warnings: [],
      metrics: {},
    }

  const slope20 = slopeScore(ema20, 8, atrValue)
  const slope50 = slopeScore(ema50, 13, atrValue)
  const slope200 = last200 !== null ? slopeScore(ema200, 21, atrValue) : 0
  const extensionAtr = (currentPrice - last20) / Math.max(atrValue, 1e-9)
  let score = 0
  score += currentPrice > last20 ? 0.18 : -0.18
  score += currentPrice > last50 ? 0.24 : -0.24
  score += last20 > last50 ? 0.18 : -0.18
  score += clamp(slope20 * 0.18, -0.18, 0.18)
  score += clamp(slope50 * 0.18, -0.18, 0.18)
  if (last200 !== null) {
    score += currentPrice > last200 ? 0.11 : -0.11
    score += last50 > last200 ? 0.11 : -0.11
    score += clamp(slope200 * 0.1, -0.1, 0.1)
  }
  if (Math.abs(extensionAtr) > 2.4) score *= 0.85
  score = clamp(score, -1, 1)
  const reasons = [
    `Price is ${currentPrice > last20 ? 'above' : 'below'} the 20 EMA and ${currentPrice > last50 ? 'above' : 'below'} the 50 EMA.`,
    `EMA alignment is ${last20 > last50 ? 'bullish' : 'bearish'} on the fast/medium pair.`,
    `EMA slopes: 20=${slope20.toFixed(2)}, 50=${slope50.toFixed(2)}${last200 !== null ? `, 200=${slope200.toFixed(2)}` : ''}.`,
  ]
  const warnings =
    Math.abs(extensionAtr) > 2.4
      ? [`Price is stretched ${extensionAtr.toFixed(2)} ATR from the 20 EMA; continuation may need a pullback.`]
      : []
  return {
    id: 'trend',
    label: 'Trend Agent',
    bias: biasFromScore(score),
    score,
    confidence: clamp(0.4 + Math.abs(score) * 0.45, 0.35, 0.95),
    reasons,
    warnings,
    metrics: {
      ema20: last20,
      ema50: last50,
      ema200: last200,
      slope20,
      slope50,
      slope200: last200 !== null ? slope200 : null,
      extensionAtr,
    },
  }
}

function analyzeMomentum(
  currentPrice: number,
  atrValue: number,
  candles: Candle[],
  regime: MarketRegime,
): SpecializedOpinion<'momentum'> {
  const close = candles.map((candle) => candle.close)
  const rsi = ta.rsi(close, 14)
  const { line, signal, histogram } = macd(close)
  const lastRsi = nonNullTail(rsi)
  const lastLine = nonNullTail(line)
  const lastSignal = nonNullTail(signal)
  const lastHist = nonNullTail(histogram)
  if (lastRsi === null || lastLine === null || lastSignal === null || lastHist === null)
    return {
      id: 'momentum',
      label: 'Momentum Agent',
      bias: 'neutral',
      score: 0,
      confidence: 0.25,
      reasons: ['Not enough candles to build RSI and MACD momentum context.'],
      warnings: [],
      metrics: {},
    }
  const previousRsi = numberOrNull(rsi[rsi.length - 4]) ?? lastRsi
  const previousHist = numberOrNull(histogram[histogram.length - 2]) ?? lastHist
  const rsiBase = clamp((lastRsi - 50) / 20, -1, 1)
  const rsiSlope = clamp((lastRsi - previousRsi) / 8, -1, 1)
  const histNorm = clamp((lastHist / Math.max(atrValue, currentPrice * 0.0005)) * 4, -1, 1)
  const histDelta = clamp(((lastHist - previousHist) / Math.max(atrValue, currentPrice * 0.0005)) * 10, -1, 1)
  const macdCross = lastLine > lastSignal ? 1 : -1
  let score = 0.42 * rsiBase + 0.18 * rsiSlope + 0.25 * histNorm + 0.1 * histDelta + 0.05 * macdCross
  if (regime === 'range' && lastRsi > 68) score -= 0.18
  if (regime === 'range' && lastRsi < 32) score += 0.18
  if ((regime === 'trend-up' || regime === 'breakout') && lastRsi > 68 && rsiSlope >= 0) score += 0.07
  if ((regime === 'trend-down' || regime === 'breakdown') && lastRsi < 32 && rsiSlope <= 0) score -= 0.07
  score = clamp(score, -1, 1)
  const reasons = [
    `RSI is ${lastRsi.toFixed(1)} and ${lastRsi >= previousRsi ? 'rising' : 'falling'} from ${previousRsi.toFixed(1)}.`,
    `MACD is ${lastLine > lastSignal ? 'above' : 'below'} signal with histogram ${lastHist >= 0 ? 'positive' : 'negative'} (${lastHist.toFixed(3)}).`,
  ]
  const warnings: string[] = []
  if (lastRsi > 72) warnings.push('RSI is extended; upside momentum is strong but vulnerable to exhaustion.')
  if (lastRsi < 28) warnings.push('RSI is stretched lower; downside momentum is strong but vulnerable to snapback.')
  return {
    id: 'momentum',
    label: 'Momentum Agent',
    bias: biasFromScore(score),
    score,
    confidence: clamp(0.38 + Math.abs(score) * 0.48, 0.3, 0.95),
    reasons,
    warnings,
    metrics: {
      rsi: lastRsi,
      rsiSlope,
      macd: lastLine,
      signal: lastSignal,
      histogram: lastHist,
      histogramDelta: histDelta,
    },
  }
}

function analyzeLevelStrength(
  currentPrice: number,
  atrValue: number,
  candles: Candle[],
  book: OrderBookView | null | undefined,
): SpecializedOpinion<'level-strength'> & { summary: LevelStrengthSummary } {
  const pivots = pivotLevels(candles, atrValue, currentPrice)
  const support = chooseLevel(levelFromSrZone(candles, book, atrValue, currentPrice, 'support'), pivots.nearestSupport)
  const resistance = chooseLevel(
    levelFromSrZone(candles, book, atrValue, currentPrice, 'resistance'),
    pivots.nearestResistance,
  )
  const supportPressure = support ? support.strength * distanceWeight(support.distanceAtr) : 0
  const resistancePressure = resistance ? resistance.strength * distanceWeight(resistance.distanceAtr) : 0
  const imbalance = clamp(book?.imbalance ?? 0, -1, 1)
  const score = clamp(supportPressure - resistancePressure + imbalance * 0.18, -1, 1)
  const reasons: string[] = []
  if (support)
    reasons.push(
      `Nearest support is ${support.source} at ${support.price.toFixed(2)} with strength ${support.strength.toFixed(2)}${support.bookBucket ? ` and book bucket ${support.bookBucket}` : ''}.`,
    )
  if (resistance)
    reasons.push(
      `Nearest resistance is ${resistance.source} at ${resistance.price.toFixed(2)} with strength ${resistance.strength.toFixed(2)}${resistance.bookBucket ? ` and book bucket ${resistance.bookBucket}` : ''}.`,
    )
  if (!support && !resistance) reasons.push('No nearby structure level could be confirmed from SR zones or pivots.')
  if (book) reasons.push(`Near-mid book imbalance is ${imbalance.toFixed(2)}.`)
  const warnings: string[] = []
  if (resistance && resistance.distanceAtr <= 0.8 && resistance.strength >= 0.7)
    warnings.push('A strong resistance level is very close above price.')
  if (support && support.distanceAtr <= 0.8 && support.strength >= 0.7)
    warnings.push('A strong support level is very close below price.')
  return {
    id: 'level-strength',
    label: 'Level Strength Agent',
    bias: biasFromScore(score, 0.12),
    score,
    confidence: clamp(0.35 + Math.max(supportPressure, resistancePressure) * 0.5, 0.28, 0.9),
    reasons,
    warnings,
    metrics: {
      supportPrice: support?.price ?? null,
      supportStrength: support?.strength ?? null,
      supportDistanceAtr: support?.distanceAtr ?? null,
      resistancePrice: resistance?.price ?? null,
      resistanceStrength: resistance?.strength ?? null,
      resistanceDistanceAtr: resistance?.distanceAtr ?? null,
      imbalance,
    },
    summary: {
      nearestSupport: support,
      nearestResistance: resistance,
      supportPressure,
      resistancePressure,
      imbalance,
    },
  }
}

function analyzeStructure(
  currentPrice: number,
  atrValue: number,
  summary: LevelStrengthSummary,
): SpecializedOpinion<'structure'> {
  const support = summary.nearestSupport
  const resistance = summary.nearestResistance
  if (!support && !resistance)
    return {
      id: 'structure',
      label: 'Structure Agent',
      bias: 'neutral',
      score: 0,
      confidence: 0.2,
      reasons: ['Structure is unavailable because no nearby support/resistance pair was found.'],
      warnings: [],
      metrics: {},
    }

  let score = 0
  const reasons: string[] = []
  const warnings: string[] = []
  if (support && resistance && resistance.price > support.price) {
    const width = resistance.price - support.price
    const position = clamp((currentPrice - support.price) / Math.max(width, 1e-9), 0, 1)
    const roomUpAtr = (resistance.price - currentPrice) / Math.max(atrValue, 1e-9)
    const roomDownAtr = (currentPrice - support.price) / Math.max(atrValue, 1e-9)
    score += clamp((0.5 - position) * 1.3, -0.65, 0.65)
    score += clamp((roomUpAtr - roomDownAtr) / 4, -0.25, 0.25)
    reasons.push(
      `Price sits ${(position * 100).toFixed(0)}% of the way from support to resistance; room up is ${roomUpAtr.toFixed(2)} ATR, room down is ${roomDownAtr.toFixed(2)} ATR.`,
    )
    if (position > 0.72) warnings.push('Price is trading in the upper portion of its nearest structure range.')
    if (position < 0.28) warnings.push('Price is trading in the lower portion of its nearest structure range.')
  } else if (resistance) {
    score -= clamp(distanceWeight(resistance.distanceAtr) * 0.55, 0, 0.55)
    reasons.push(`Nearest confirmed structure is resistance ${resistance.distanceAtr.toFixed(2)} ATR above.`)
  } else if (support) {
    score += clamp(distanceWeight(support.distanceAtr) * 0.55, 0, 0.55)
    reasons.push(`Nearest confirmed structure is support ${support.distanceAtr.toFixed(2)} ATR below.`)
  }
  if (support && support.distanceAtr <= 0.8) score += support.strength * 0.22
  if (resistance && resistance.distanceAtr <= 0.8) score -= resistance.strength * 0.22
  score = clamp(score, -1, 1)
  return {
    id: 'structure',
    label: 'Structure Agent',
    bias: biasFromScore(score, 0.12),
    score,
    confidence: clamp(0.32 + Math.abs(score) * 0.42 + (support && resistance ? 0.1 : 0), 0.25, 0.88),
    reasons,
    warnings,
    metrics: {
      support: support?.price ?? null,
      resistance: resistance?.price ?? null,
      supportDistanceAtr: support?.distanceAtr ?? null,
      resistanceDistanceAtr: resistance?.distanceAtr ?? null,
    },
  }
}

function analyzeContext(
  timeframe: Timeframe,
  contexts: ContextSignal[],
): SpecializedOpinion<'context'> | null {
  const usable = contexts.filter(
    (context) =>
      Number.isFinite(context.score) &&
      Number.isFinite(context.confidence) &&
      timeframeRank(context.timeframe) > timeframeRank(timeframe),
  )
  if (!usable.length) return null
  let weightedScore = 0
  let totalWeight = 0
  let confidenceNumerator = 0
  let bullishWeight = 0
  let bearishWeight = 0
  for (const context of usable) {
    const distance = Math.max(1, timeframeRank(context.timeframe) - timeframeRank(timeframe))
    const timeframeWeight = clamp(1 + distance * 0.22, 1, 1.75)
    const convictionWeight = clamp(0.65 + context.confidence * 0.55, 0.65, 1.2)
    const weight = timeframeWeight * convictionWeight
    weightedScore += clamp(context.score, -1, 1) * weight
    totalWeight += weight
    confidenceNumerator += clamp(context.confidence, 0, 1) * weight
    if (context.score >= 0.12) bullishWeight += weight
    else if (context.score <= -0.12) bearishWeight += weight
  }
  if (!totalWeight) return null
  const score = clamp(weightedScore / totalWeight, -1, 1)
  const confidenceBase = confidenceNumerator / totalWeight
  const agreement =
    bullishWeight + bearishWeight > 0
      ? Math.abs(bullishWeight - bearishWeight) / (bullishWeight + bearishWeight)
      : 0
  const bullish = usable.filter((context) => context.score >= 0.12).map((context) => context.timeframe)
  const bearish = usable.filter((context) => context.score <= -0.12).map((context) => context.timeframe)
  const mixed = bullish.length > 0 && bearish.length > 0
  const reasons: string[] = []
  if (bullish.length && !bearish.length)
    reasons.push(`Higher-timeframe context is bullish on ${bullish.join(' and ')}.`)
  else if (bearish.length && !bullish.length)
    reasons.push(`Higher-timeframe context is bearish on ${bearish.join(' and ')}.`)
  else reasons.push('Higher-timeframe context is mixed across the monitored frames.')
  reasons.push(
    usable
      .map(
        (context) =>
          `${context.timeframe} ${context.regime} ${context.bias} (${Math.round(context.confidence * 100)}%)`,
      )
      .join(' · '),
  )
  const warnings: string[] = []
  if (mixed) warnings.push('Higher-timeframe context is split, so chart-timeframe signals deserve caution.')
  return {
    id: 'context',
    label: 'Context Agent',
    bias: biasFromScore(score, 0.1),
    score,
    confidence: clamp(0.26 + confidenceBase * 0.42 + agreement * 0.22 + Math.abs(score) * 0.12, 0.24, 0.92),
    reasons,
    warnings,
    metrics: {
      frames: usable.length,
      agreement,
      bullishFrames: bullish.length,
      bearishFrames: bearish.length,
      weightedScore: score,
    },
  }
}

const BASE_WEIGHTS: Record<
  MarketRegime,
  Record<SpecializedAgentId, number>
> = {
  'trend-up': {
    regime: 0.13,
    trend: 0.28,
    momentum: 0.2,
    'level-strength': 0.12,
    structure: 0.1,
    context: 0.17,
  },
  'trend-down': {
    regime: 0.13,
    trend: 0.28,
    momentum: 0.2,
    'level-strength': 0.12,
    structure: 0.1,
    context: 0.17,
  },
  range: {
    regime: 0.13,
    trend: 0.07,
    momentum: 0.22,
    'level-strength': 0.24,
    structure: 0.2,
    context: 0.14,
  },
  breakout: {
    regime: 0.12,
    trend: 0.21,
    momentum: 0.23,
    'level-strength': 0.17,
    structure: 0.1,
    context: 0.17,
  },
  breakdown: {
    regime: 0.12,
    trend: 0.21,
    momentum: 0.23,
    'level-strength': 0.17,
    structure: 0.1,
    context: 0.17,
  },
  chop: {
    regime: 0.15,
    trend: 0.08,
    momentum: 0.19,
    'level-strength': 0.21,
    structure: 0.22,
    context: 0.15,
  },
}

function neutralCell(): PerformanceCell {
  return { skill: 0.5, samples: 0 }
}

export function defaultAgentLearningState(): AgentLearningState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    agents: {},
  }
}

function readCell(cell?: PerformanceCell): PerformanceCell {
  return cell ? { skill: cell.skill, samples: cell.samples } : neutralCell()
}

function effectiveAgentWeight(
  learning: AgentLearningState,
  agentId: AgentId,
  regime: MarketRegime,
  timeframe: Timeframe,
): number {
  const entry = learning.agents[agentId]
  if (!entry) return 1
  const overall = readCell(entry.overall)
  const byRegime = readCell(entry.byRegime[regime])
  const byTimeframe = readCell(entry.byTimeframe[timeframe])
  const weightedSkill = 0.55 * overall.skill + 0.25 * byRegime.skill + 0.2 * byTimeframe.skill
  return clamp(0.6 + weightedSkill * 0.8, 0.55, 1.4)
}

function buildEnsemble(
  regime: MarketRegime,
  timeframe: Timeframe,
  learning: AgentLearningState,
  specialists: SpecializedOpinion[],
): AgentOpinion {
  const weights = BASE_WEIGHTS[regime]
  let weightedScore = 0
  let totalWeight = 0
  let bullishWeight = 0
  let bearishWeight = 0
  let confidenceNumerator = 0
  const reasons: string[] = []
  const warnings: string[] = []
  const aligned = [...specialists].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
  for (const opinion of specialists) {
    const adaptive = effectiveAgentWeight(learning, opinion.id, regime, timeframe)
    const weight = weights[opinion.id] * adaptive
    weightedScore += opinion.score * weight
    totalWeight += weight
    confidenceNumerator += opinion.confidence * weight
    if (opinion.score >= 0.12) bullishWeight += weight
    else if (opinion.score <= -0.12) bearishWeight += weight
  }
  let score = totalWeight > 0 ? clamp(weightedScore / totalWeight, -1, 1) : 0
  const agreement =
    bullishWeight + bearishWeight > 0
      ? Math.abs(bullishWeight - bearishWeight) / (bullishWeight + bearishWeight)
      : 0
  const averageConfidence = totalWeight > 0 ? confidenceNumerator / totalWeight : 0.3
  const context = specialists.find((opinion) => opinion.id === 'context')
  const chartImpulse = average(
    specialists
      .filter((opinion) => ['trend', 'momentum', 'level-strength', 'structure'].includes(opinion.id))
      .map((opinion) => opinion.score),
  )
  const contextAlignment = context ? chartImpulse * context.score : 0
  if (context) {
    if (contextAlignment > 0.08) score = clamp(score + context.score * 0.06, -1, 1)
    else if (contextAlignment < -0.08) score = clamp(score + context.score * 0.1, -1, 1)
  }
  const confidence = clamp(
    0.28 +
      Math.abs(score) * 0.38 +
      agreement * 0.22 +
      averageConfidence * 0.18 +
      (contextAlignment > 0.08 ? 0.04 : contextAlignment < -0.08 ? -0.08 : 0),
    0.2,
    0.97,
  )
  for (const opinion of aligned.slice(0, 3)) {
    if (biasFromScore(score) === opinion.bias && opinion.bias !== 'neutral') reasons.push(opinion.reasons[0] ?? opinion.label)
    else if (opinion.bias !== 'neutral' && Math.abs(opinion.score) >= 0.2)
      warnings.push(opinion.warnings[0] ?? `${opinion.label} disagrees with the current ensemble bias.`)
  }
  if (contextAlignment < -0.08 && context)
    warnings.push('Higher-timeframe context is fighting the chart-timeframe impulse.')
  if (contextAlignment > 0.08 && context) reasons.push('Higher-timeframe context agrees with the chart-timeframe setup.')
  if (!reasons.length) reasons.push('Specialists are mixed, so the ensemble is favoring caution over conviction.')
  return {
    id: 'ensemble',
    label: 'Decision Agent',
    bias: biasFromScore(score),
    score,
    confidence,
    reasons,
    warnings,
    metrics: {
      agreement,
      bullishWeight,
      bearishWeight,
      averageConfidence,
      contextAlignment: context ? contextAlignment : null,
    },
  }
}

export function analyzeMarket(
  snapshot: AnalysisSnapshot,
  learning: AgentLearningState = defaultAgentLearningState(),
): MarketAnalysis {
  const candles = snapshot.candles.filter(
    (candle) =>
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.high >= candle.low,
  )
  if (candles.length < 30) throw new Error('At least 30 candles are required for market-agent analysis.')
  const currentPrice = last(candles).close
  const atrValue = nonNullTail(atr(candles, 14)) ?? Math.max(currentPrice * 0.003, 1)
  const regime = analyzeRegime(currentPrice, atrValue, candles)
  const trend = analyzeTrend(currentPrice, atrValue, candles)
  const momentum = analyzeMomentum(currentPrice, atrValue, candles, regime.regime)
  const levelStrength = analyzeLevelStrength(currentPrice, atrValue, candles, snapshot.book)
  const structure = analyzeStructure(currentPrice, atrValue, levelStrength.summary)
  const context = analyzeContext(snapshot.timeframe, snapshot.context ?? [])
  const specialists: SpecializedOpinion[] = [
    regime,
    trend,
    momentum,
    levelStrength,
    structure,
    ...(context ? [context] : []),
  ]
  const ensemble = buildEnsemble(regime.regime, snapshot.timeframe, learning, specialists)
  const risks = [
    ...new Set(
      specialists
        .flatMap((opinion) => opinion.warnings)
        .filter(Boolean)
        .slice(0, 5),
    ),
  ]
  return {
    regime: regime.regime,
    bias: ensemble.bias,
    score: ensemble.score,
    confidence: ensemble.confidence,
    reasons: ensemble.reasons,
    risks,
    agents: [...specialists, ensemble],
    learningRecord: {
      timeframe: snapshot.timeframe,
      regime: regime.regime,
      ensemble: {
        id: ensemble.id,
        bias: ensemble.bias,
        score: ensemble.score,
        confidence: ensemble.confidence,
      },
      agents: specialists.map((opinion) => ({
        id: opinion.id,
        bias: opinion.bias,
        score: opinion.score,
        confidence: opinion.confidence,
      })),
    },
    summary: {
      currentPrice,
      atr: atrValue,
      nearestSupport: levelStrength.summary.nearestSupport,
      nearestResistance: levelStrength.summary.nearestResistance,
    },
  }
}

export function actualBiasFromOutcome(outcome: LearningOutcome): AgentBias {
  const threshold = Math.abs(outcome.flatThreshold ?? 0.002)
  return outcome.move >= threshold ? 'bullish' : outcome.move <= -threshold ? 'bearish' : 'neutral'
}

function utility(prediction: Pick<AgentOpinion, 'score'>, actual: AgentBias) {
  const actualValue = actual === 'bullish' ? 1 : actual === 'bearish' ? -1 : 0
  return clamp(1 - Math.abs(prediction.score - actualValue) / 2, 0, 1)
}

function updateCell(previous: PerformanceCell | undefined, score: number): PerformanceCell {
  const cell = readCell(previous)
  const alpha = cell.samples < 25 ? 0.18 : 0.08
  return {
    skill: clamp(cell.skill * (1 - alpha) + score * alpha, 0, 1),
    samples: cell.samples + 1,
  }
}

function upsertAgentEntry(
  state: AgentLearningState,
  agentId: AgentId,
  regime: MarketRegime,
  timeframe: Timeframe,
  score: number,
) {
  const entry = state.agents[agentId] ?? {
    overall: neutralCell(),
    byRegime: {},
    byTimeframe: {},
  }
  entry.overall = updateCell(entry.overall, score)
  entry.byRegime[regime] = updateCell(entry.byRegime[regime], score)
  entry.byTimeframe[timeframe] = updateCell(entry.byTimeframe[timeframe], score)
  state.agents[agentId] = entry
}

export function learnFromOutcome(
  previous: AgentLearningState,
  record: LearningRecord,
  outcome: LearningOutcome,
): AgentLearningState {
  const next: AgentLearningState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: structuredClone(previous.agents),
  }
  const actual = actualBiasFromOutcome(outcome)
  for (const opinion of [...record.agents, record.ensemble]) {
    upsertAgentEntry(next, opinion.id, record.regime, record.timeframe, utility(opinion, actual))
  }
  return next
}
