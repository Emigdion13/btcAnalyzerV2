/**
 * MACD AI — a forward-looking forecast group for CM_Ult_MacD_MTF.
 *
 * The market-agent ensemble answers "what is the market doing right now".
 * This group answers the opposite question: "what will the CM MACD do AFTER
 * now" — when the MACD line will touch and cross its signal, whether that
 * touch rejects or slices through, whether the cross climbs from below the
 * mid (zero) line to the upper side, and whether the move comes out strong
 * to the other side or fizzles.
 *
 * Five specialists vote, each on its own subtask:
 * - cross-timer: direction + bars until the next MACD/signal cross.
 * - zero-scout: direction + bars until the next mid-line (zero) flip.
 * - touch-judge: touch-and-bounce (reversal) vs touch-and-break (cross).
 * - thrust-reader: post-cross strength — strong push vs soft dribble.
 * - memory: what this browser has learned from settled MACD forecasts here.
 *
 * A director ensemble weights them with learned trust, exactly like the
 * market agents: only the weights adapt, the reasons stay visible. Forecasts
 * are journaled on closed bars and resolved against what the CM MACD
 * actually printed afterwards, so timing calibration (bars bias) and trust
 * improve the longer it runs. All learning is local; nothing trades.
 */
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import { cmHistogramColor, type CmMacdValues } from './cm-ult-macd'
import { uid } from './storage'
import type { Candle, DataSource, Timeframe } from './types'

export type MacdCrossDir = 'bullish' | 'bearish'
export type MacdZeroDir = 'up' | 'down'
export type MacdTouchVerdict = 'break' | 'bounce' | 'none'
export type MacdThrust = 'strong' | 'mild' | 'weak'
export type MacdForecastRegime =
  | 'approaching-cross'
  | 'touch-zone'
  | 'fresh-cross'
  | 'diverging'
  | 'coil'
export type MacdAgentId =
  | 'cross-timer'
  | 'zero-scout'
  | 'touch-judge'
  | 'thrust-reader'
  | 'memory'
  | 'ensemble'
export type MacdBias = 'bullish' | 'bearish' | 'neutral'

export interface MacdAgentOpinion {
  id: MacdAgentId
  label: string
  bias: MacdBias
  /** Signed directional lean of the coming move, in [-1, 1]. */
  score: number
  /** Confidence in [0, 1]. */
  confidence: number
  reasons: string[]
  warnings: string[]
  metrics: Record<string, number | string | boolean | null>
}

export interface MacdTimelineStep {
  title: string
  detail: string
}

export interface MacdForecastSnapshot {
  macd: number
  signal: number
  histogram: number
  swing: number
  zeroSide: 'above' | 'below'
  signalZeroSide: 'above' | 'below'
  gapSwing: number
  closurePerBar: number
  barsSinceCross: number | null
  lastCrossDir: MacdCrossDir | null
  resolution: Timeframe
}

export interface MacdLearningPrediction {
  crossDir: MacdCrossDir | null
  crossBars: number | null
  zeroDir: MacdZeroDir | null
  zeroBars: number | null
  touch: MacdTouchVerdict
  thrust: MacdThrust
}

export interface MacdLearningRecord {
  timeframe: Timeframe
  regime: MacdForecastRegime
  ensemble: Pick<MacdAgentOpinion, 'id' | 'bias' | 'score' | 'confidence'>
  agents: Pick<MacdAgentOpinion, 'id' | 'bias' | 'score' | 'confidence'>[]
  prediction: MacdLearningPrediction
}

export interface MacdForecast {
  regime: MacdForecastRegime
  headline: string
  bias: MacdBias
  score: number
  confidence: number
  crossDir: MacdCrossDir | null
  crossBars: number | null
  zeroDir: MacdZeroDir | null
  zeroBars: number | null
  touch: MacdTouchVerdict
  touchBars: number | null
  thrust: MacdThrust
  timeline: MacdTimelineStep[]
  reasons: string[]
  risks: string[]
  agents: MacdAgentOpinion[]
  learningRecord: MacdLearningRecord
  snapshot: MacdForecastSnapshot
}

export interface MacdMemoryStats {
  samples: number
  hitRate: number | null
  avgCrossBarsErr: number | null
  bounceRate: number | null
}

export interface MacdForecastInput {
  candles: Candle[]
  timeframe: Timeframe
  values: CmMacdValues
  resolution: Timeframe
  settingsLabel: string
  symbol: string
  memory?: MacdMemoryStats
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const last = <T>(values: T[]): T => values[values.length - 1]

const MIN_CANDLES = 30
const MIN_VALID_BARS = 20
const SWING_LOOKBACK = 30
const HORIZON_BARS = 10
const MAX_BARS = 12
const MAX_JOURNAL_ENTRIES = 300
/** |MACD − signal| at or under this fraction of the swing counts as touching. */
const TOUCH_SWING = 0.06
/** Normalized per-bar closing speed under this counts as stalled. */
const STALL_SPEED = 0.004

/** Compact MACD-native formatting: BTC-scale values stay short, dust stays visible. */
export function formatMacdValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(1)
  if (abs >= 1) return value.toFixed(2)
  if (abs >= 0.01) return value.toFixed(3)
  return value.toFixed(4)
}

interface ValidBar {
  index: number
  macd: number
  signal: number
  hist: number
}

interface MacdFeatures {
  valid: ValidBar[]
  cur: ValidBar
  swing: number
  flat: boolean
  gapSwing: number
  closureN: number
  closureSteps: number
  decelN: number
  macdVelN: number
  signalVelN: number
  histDeltaN: number
  zeroSide: 'above' | 'below'
  signalZeroSide: 'above' | 'below'
  distZeroSwing: number
  zeroRegime: number
  barsSinceCross: number | null
  lastCrossDir: MacdCrossDir | null
  yellowLast5: number
  thrustStreak: number
  touchZone: boolean
}

function validBars(values: CmMacdValues): ValidBar[] {
  const out: ValidBar[] = []
  for (let i = 0; i < values.macd.length; i++) {
    const macd = values.macd[i]
    const signal = values.signal[i]
    const hist = values.histogram[i]
    if (macd === null || signal === null || hist === null) continue
    if (!Number.isFinite(macd) || !Number.isFinite(signal) || !Number.isFinite(hist)) continue
    out.push({ index: i, macd, signal, hist })
  }
  return out
}

/** Strict original cross semantics: a strict flip after a non-strict hold. */
function crossDir(delta: number, previous: number): MacdCrossDir | null {
  if (delta > 0 && previous <= 0) return 'bullish'
  if (delta < 0 && previous >= 0) return 'bearish'
  return null
}

function extractFeatures(candles: Candle[], values: CmMacdValues): MacdFeatures | null {
  if (candles.length < MIN_CANDLES) return null
  if (
    values.macd.length !== candles.length ||
    values.signal.length !== candles.length ||
    values.histogram.length !== candles.length
  )
    return null
  const valid = validBars(values)
  if (valid.length < MIN_VALID_BARS) return null
  const cur = last(valid)

  // The swing spans both lines: MACD alone can print flat while separated from
  // the signal, which would explode gapSwing/closureN into nonsense.
  const swingWindow = valid.slice(-SWING_LOOKBACK).flatMap((bar) => [bar.macd, bar.signal])
  const swingRaw = Math.max(...swingWindow) - Math.min(...swingWindow)
  const flat = !(swingRaw > 1e-9)
  const swing = flat ? 1 : swingRaw

  // Per-bar closing speed of |histogram|, over the last three valid steps.
  const steps = Math.min(3, valid.length - 1)
  const rates: number[] = []
  for (let k = 0; k < steps; k++) {
    const newer = valid[valid.length - 1 - k]
    const older = valid[valid.length - 2 - k]
    const span = Math.max(1, newer.index - older.index)
    rates.push((Math.abs(older.hist) - Math.abs(newer.hist)) / span)
  }
  const closureN = rates.length
    ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length / swing
    : 0
  const closureSteps = rates.filter((rate) => rate > 0).length
  const recent = rates[0] ?? 0
  const earlier = rates.length > 1 ? rates.slice(1).reduce((a, b) => a + b, 0) / (rates.length - 1) : recent
  const decelN = (earlier - recent) / swing

  const back = Math.min(5, valid.length - 1)
  const anchor = valid[valid.length - 1 - back]
  const span = Math.max(1, cur.index - anchor.index)
  const macdVelN = (cur.macd - anchor.macd) / span / swing
  const signalVelN = (cur.signal - anchor.signal) / span / swing
  const prevBar = valid[valid.length - 2]
  const histDeltaN =
    (cur.hist - prevBar.hist) / Math.max(1, cur.index - prevBar.index) / swing

  let barsSinceCross: number | null = null
  let lastCrossDir: MacdCrossDir | null = null
  for (let j = valid.length - 1; j >= 1; j--) {
    const dir = crossDir(valid[j].hist, valid[j - 1].hist)
    if (dir) {
      lastCrossDir = dir
      barsSinceCross = cur.index - valid[j].index
      break
    }
  }

  let yellowLast5 = 0
  const tail = valid.slice(-6)
  for (let j = 1; j < tail.length; j++) {
    if (cmHistogramColor(tail[j].hist, tail[j - 1].hist) === '#ffff00') yellowLast5++
  }
  const strongColor = cur.hist >= 0 ? '#00ffff' : '#ff0000'
  let thrustStreak = 0
  for (let j = valid.length - 1; j >= 1 && thrustStreak < 6; j--) {
    if (cmHistogramColor(valid[j].hist, valid[j - 1].hist) === strongColor) thrustStreak++
    else break
  }

  return {
    valid,
    cur,
    swing,
    flat,
    gapSwing: Math.abs(cur.hist) / swing,
    closureN,
    closureSteps,
    decelN,
    macdVelN,
    signalVelN,
    histDeltaN,
    zeroSide: cur.macd >= 0 ? 'above' : 'below',
    signalZeroSide: cur.signal >= 0 ? 'above' : 'below',
    distZeroSwing: Math.abs(cur.macd) / swing,
    zeroRegime: clamp(cur.macd / swing, -1, 1),
    barsSinceCross,
    lastCrossDir,
    yellowLast5,
    thrustStreak,
    touchZone: Math.abs(cur.hist) / swing <= TOUCH_SWING,
  }
}

function biasFromDir(dir: MacdCrossDir | null): MacdBias {
  return dir === 'bullish' ? 'bullish' : dir === 'bearish' ? 'bearish' : 'neutral'
}

const dirWord = (dir: MacdCrossDir) => (dir === 'bullish' ? 'Bullish' : 'Bearish')
const sideWord = (dir: MacdCrossDir) => (dir === 'bullish' ? 'upside' : 'downside')
const upDownWord = (dir: MacdCrossDir) => (dir === 'bullish' ? 'up' : 'down')

interface CrossTimerResult extends MacdAgentOpinion {
  dir: MacdCrossDir | null
  bars: number | null
}

function analyzeCrossTimer(
  features: MacdFeatures,
  calibration: MacdCalibration,
): CrossTimerResult {
  const base = {
    id: 'cross-timer' as const,
    label: 'Cross Timer',
    metrics: {} as Record<string, number | string | boolean | null>,
  }
  const { cur, swing, gapSwing, closureN, closureSteps, decelN } = features
  const implied: MacdCrossDir =
    cur.hist > 0 ? 'bearish' : cur.hist < 0 ? 'bullish' : features.histDeltaN >= 0 ? 'bullish' : 'bearish'

  if (closureN <= STALL_SPEED) {
    const diverging = closureN < -STALL_SPEED
    return {
      ...base,
      dir: null,
      bars: null,
      bias: 'neutral',
      score: 0,
      confidence: diverging ? 0.55 : 0.4,
      reasons: [
        diverging
          ? `MACD and the signal are drifting apart (${formatMacdValue(Math.abs(cur.hist))} gap and widening) — no cross is forming after this bar.`
          : `MACD is holding ${formatMacdValue(Math.abs(cur.hist))} from the signal with no closing speed — no cross is forming after this bar.`,
      ],
      warnings: diverging ? [] : ['A stalled gap can spring either way — the next push decides.'],
      metrics: { gap: cur.hist, gapSwing, closurePerBar: closureN * swing, diverging },
    }
  }

  const rawBars = gapSwing / closureN
  if (rawBars > MAX_BARS + 4) {
    return {
      ...base,
      dir: implied,
      bars: null,
      bias: biasFromDir(implied),
      score: (implied === 'bullish' ? 1 : -1) * 0.15,
      confidence: 0.3,
      reasons: [
        `MACD is converging on the signal, but at this crawl the ${upDownWord(implied)} cross sits beyond ${MAX_BARS} bars — nothing tradeable on the near radar.`,
      ],
      warnings: ['Slow convergences usually morph before they land — treat this as a watch, not a call.'],
      metrics: { gap: cur.hist, gapSwing, closurePerBar: closureN * swing, rawBars },
    }
  }

  let pace = rawBars
  if (decelN > 0.012) pace *= 1.35
  else if (decelN < -0.012) pace *= 0.8
  const bars = clamp(Math.round(pace + calibration.crossBarsBias), 1, MAX_BARS)
  const consistency = closureSteps / 3
  const closeness = 1 - Math.min(1, gapSwing / 0.5)
  const confidence = clamp(0.35 + consistency * 0.3 + closeness * 0.25, 0.2, 0.92)
  const reasons = [
    `MACD is ${cur.hist > 0 ? 'falling' : 'climbing'} toward the signal — at this pace they meet in ~${bars} bar${bars === 1 ? '' : 's'} and MACD crosses ${upDownWord(implied)}.`,
  ]
  if (decelN > 0.012)
    reasons.push('The approach is decelerating, so the cross lands later than a straight-line read says.')
  const warnings: string[] = []
  if (decelN > 0.03) warnings.push('Closing speed is fading fast — the cross can stall into a touch-and-hold.')
  if (bars >= 9) warnings.push('A far-off cross is a weather forecast, not an appointment — re-check it in a few bars.')
  return {
    ...base,
    dir: implied,
    bars,
    bias: biasFromDir(implied),
    score: (implied === 'bullish' ? 1 : -1) * clamp(0.3 + confidence * 0.6, 0, 0.95),
    confidence,
    reasons,
    warnings,
    metrics: {
      gap: cur.hist,
      gapSwing,
      closurePerBar: closureN * swing,
      rawBars,
      decel: decelN,
      calibrationBias: calibration.crossBarsBias,
    },
  }
}

interface ZeroScoutResult extends MacdAgentOpinion {
  zeroDir: MacdZeroDir | null
  zeroBars: number | null
}

function analyzeZeroScout(
  features: MacdFeatures,
  calibration: MacdCalibration,
): ZeroScoutResult {
  const base = {
    id: 'zero-scout' as const,
    label: 'Zero-Line Scout',
    metrics: {} as Record<string, number | string | boolean | null>,
  }
  const { cur, swing, macdVelN, distZeroSwing, zeroSide } = features
  const towardZero = (cur.macd > 0 && macdVelN < 0) || (cur.macd < 0 && macdVelN > 0)

  if (distZeroSwing <= 0.05) {
    const dir: MacdZeroDir | null =
      Math.abs(macdVelN) <= STALL_SPEED ? null : macdVelN > 0 ? 'up' : 'down'
    return {
      ...base,
      zeroDir: dir,
      zeroBars: dir ? 1 : null,
      bias: dir === 'up' ? 'bullish' : dir === 'down' ? 'bearish' : 'neutral',
      score: dir === 'up' ? 0.55 : dir === 'down' ? -0.55 : 0,
      confidence: dir ? 0.72 : 0.4,
      reasons: [
        dir
          ? `MACD is sitting on the mid line and pushing ${dir === 'up' ? 'up through it' : 'down through it'} — the flip resolves in the next bar or two.`
          : 'MACD is sitting exactly on the mid line, flat — the next push decides the flip.',
      ],
      warnings: dir ? [] : ['A flat mid-line sit is a coin flip until velocity returns.'],
      metrics: { macd: cur.macd, distZeroSwing, velocityPerBar: macdVelN * swing, onTheLine: true },
    }
  }

  if (!towardZero || Math.abs(macdVelN) <= STALL_SPEED) {
    const flat = Math.abs(macdVelN) <= STALL_SPEED
    return {
      ...base,
      zeroDir: null,
      zeroBars: null,
      bias: 'neutral',
      score: 0,
      confidence: flat ? 0.35 : 0.55,
      reasons: [
        flat
          ? `MACD is parked ${zeroSide} the mid line with no vertical speed — no flip is forming after this bar.`
          : `MACD is ${zeroSide} the mid line and drifting further ${zeroSide === 'below' ? 'down' : 'up'} — the flip is not on the radar.`,
      ],
      warnings: [],
      metrics: { macd: cur.macd, distZeroSwing, velocityPerBar: macdVelN * swing, towardZero },
    }
  }

  const dir: MacdZeroDir = cur.macd < 0 ? 'up' : 'down'
  const rawBars = distZeroSwing / Math.abs(macdVelN)
  if (rawBars > MAX_BARS + 4) {
    return {
      ...base,
      zeroDir: dir,
      zeroBars: null,
      bias: dir === 'up' ? 'bullish' : 'bearish',
      score: (dir === 'up' ? 1 : -1) * 0.15,
      confidence: 0.3,
      reasons: [
        `MACD is inching toward the mid line from ${zeroSide}, but the ${zeroSide} → ${zeroSide === 'below' ? 'above' : 'below'} flip sits beyond ${MAX_BARS} bars.`,
      ],
      warnings: ['Distant mid-line reads usually morph before they land.'],
      metrics: { macd: cur.macd, distZeroSwing, velocityPerBar: macdVelN * swing, rawBars },
    }
  }
  const bars = clamp(Math.round(rawBars + calibration.zeroBarsBias), 1, MAX_BARS)
  // Velocity consistency: how many of the last three valid MACD steps moved toward zero.
  const tail = features.valid.slice(-4)
  let aligned = 0
  for (let j = 1; j < tail.length; j++) {
    const step = tail[j].macd - tail[j - 1].macd
    if ((cur.macd < 0 && step > 0) || (cur.macd > 0 && step < 0)) aligned++
  }
  const closeness = 1 - Math.min(1, distZeroSwing / 1.5)
  const confidence = clamp(0.35 + (aligned / 3) * 0.3 + closeness * 0.25, 0.2, 0.92)
  return {
    ...base,
    zeroDir: dir,
    zeroBars: bars,
    bias: dir === 'up' ? 'bullish' : 'bearish',
    score: (dir === 'up' ? 1 : -1) * clamp(0.3 + confidence * 0.6, 0, 0.95),
    confidence,
    reasons: [
      `MACD sits ${zeroSide} the mid line and is ${dir === 'up' ? 'climbing' : 'falling'} — the ${zeroSide} → ${dir === 'up' ? 'above' : 'below'} flip lands in ~${bars} bar${bars === 1 ? '' : 's'} if this pace holds.`,
    ],
    warnings:
      aligned <= 1
        ? ['The climb toward the mid line is choppy — one flat bar pushes the flip back.']
        : [],
    metrics: {
      macd: cur.macd,
      distZeroSwing,
      velocityPerBar: macdVelN * swing,
      rawBars,
      alignedSteps: aligned,
      calibrationBias: calibration.zeroBarsBias,
    },
  }
}

interface TouchJudgeResult extends MacdAgentOpinion {
  touch: MacdTouchVerdict
}

function analyzeTouchJudge(
  features: MacdFeatures,
  crossDir: MacdCrossDir | null,
  crossBars: number | null,
  memory: MacdMemoryStats | undefined,
): TouchJudgeResult {
  const base = {
    id: 'touch-judge' as const,
    label: 'Touch & Reject Judge',
    metrics: {} as Record<string, number | string | boolean | null>,
  }
  const { cur, gapSwing, closureN, decelN, zeroRegime, yellowLast5, macdVelN } = features

  if (gapSwing > 0.25 || closureN <= STALL_SPEED) {
    const far = gapSwing > 0.25
    return {
      ...base,
      touch: 'none',
      bias: 'neutral',
      score: 0,
      confidence: far ? 0.6 : 0.4,
      reasons: [
        far
          ? `MACD is still ${formatMacdValue(Math.abs(cur.hist))} from the signal — no touch is on the radar, so there is nothing to bounce or break yet.`
          : 'MACD is not moving toward the signal — the touch question is moot until it turns.',
      ],
      warnings: [],
      metrics: { gap: cur.hist, gapSwing, closurePerBar: closureN, touchZone: false },
    }
  }

  let breakScore = 0
  let bounceScore = 0
  if (closureN > 0.06) breakScore += 0.35
  else if (closureN > 0.03) breakScore += 0.15
  else bounceScore += 0.15
  if (closureN < 0.02) bounceScore += 0.3
  if (decelN < -0.008) breakScore += 0.15
  if (decelN > 0.012) bounceScore += 0.2
  if (features.thrustStreak >= 2) breakScore += 0.15
  if (yellowLast5 >= 3) bounceScore += 0.15
  const crossSign = crossDir === 'bullish' ? 1 : crossDir === 'bearish' ? -1 : 0
  const regimeSign = zeroRegime > 0.12 ? 1 : zeroRegime < -0.12 ? -1 : 0
  if (crossSign !== 0 && regimeSign !== 0) {
    if (crossSign === regimeSign && Math.abs(zeroRegime) > 0.35) breakScore += 0.2
    else if (crossSign !== regimeSign && Math.abs(zeroRegime) > 0.4) bounceScore += 0.3
  }
  if (Math.abs(macdVelN) > 0.05 && crossSign !== 0 && Math.sign(macdVelN) === crossSign)
    breakScore += 0.1
  // Already on the signal with steady closure while the timer agrees the cross
  // is imminent: proximity beats normalized speed — this slices through.
  if (
    features.touchZone &&
    features.closureSteps >= 2 &&
    crossDir !== null &&
    crossBars !== null &&
    crossBars <= 5
  )
    breakScore += 0.5
  if (memory && memory.samples >= 5 && memory.bounceRate !== null && memory.bounceRate > 0.6)
    bounceScore += 0.1

  const diff = breakScore - bounceScore
  const touch: MacdTouchVerdict = diff > 0.05 ? 'break' : diff < -0.05 ? 'bounce' : crossDir ? 'break' : 'bounce'
  const confidence = clamp(0.32 + Math.abs(diff) * 1.2, 0.25, 0.9)
  const regimeWord =
    regimeSign > 0
      ? 'the bullish mid-line regime holds'
      : regimeSign < 0
        ? 'the bearish mid-line regime holds'
        : 'momentum is flat'
  const bounceSide: MacdCrossDir = cur.hist >= 0 ? 'bullish' : 'bearish'

  if (touch === 'break') {
    const dir = crossDir ?? (cur.hist >= 0 ? 'bearish' : 'bullish')
    return {
      ...base,
      touch,
      bias: biasFromDir(dir),
      score: (dir === 'bullish' ? 1 : -1) * clamp(0.35 + confidence * 0.5, 0, 0.9),
      confidence,
      reasons: [
        `MACD is driving into the signal with speed — expect the touch near ${formatMacdValue(cur.signal)} to slice straight through into a ${upDownWord(dir)} cross, not a bounce.`,
      ],
      warnings:
        bounceScore > 0.25
          ? ['The approach has some hesitation — a one-bar kiss before the break would still count as through.']
          : [],
      metrics: { gap: cur.hist, gapSwing, breakScore, bounceScore, regime: zeroRegime },
    }
  }
  return {
    ...base,
    touch,
    bias: biasFromDir(bounceSide),
    score: (bounceSide === 'bullish' ? 1 : -1) * clamp(0.35 + confidence * 0.5, 0, 0.9),
    confidence,
    reasons: [
      `MACD is gliding into the signal at a shallow angle while ${regimeWord} — expect a touch near ${formatMacdValue(cur.signal)} first, then a reversal back ${upDownWord(bounceSide)}, not a cross through.`,
    ],
    warnings:
      breakScore > 0.25
        ? ['If the next bar accelerates into the signal, the bounce fails and the cross happens instead.']
        : [],
    metrics: { gap: cur.hist, gapSwing, breakScore, bounceScore, regime: zeroRegime },
  }
}

interface ThrustReaderResult extends MacdAgentOpinion {
  thrust: MacdThrust
}

function analyzeThrustReader(
  features: MacdFeatures,
  crossDir: MacdCrossDir | null,
): ThrustReaderResult {
  const base = {
    id: 'thrust-reader' as const,
    label: 'Breakout Thrust Reader',
    metrics: {} as Record<string, number | string | boolean | null>,
  }
  // A fresh cross has its own thrust story even when no new cross is coming.
  const fresh = features.barsSinceCross !== null && features.barsSinceCross <= 2
  const dir = crossDir ?? (fresh ? features.lastCrossDir : null)
  if (!dir) {
    return {
      ...base,
      thrust: 'weak',
      bias: 'neutral',
      score: 0,
      confidence: 0.45,
      reasons: [
        'No cross is forming, so there is no breakout thrust to project — expect MACD to drift, not to explode.',
      ],
      warnings: [],
      metrics: { thrust: 'weak', reason: 'no-cross' },
    }
  }
  const sign = dir === 'bullish' ? 1 : -1
  let strength = 0
  const reasons: string[] = []
  const warnings: string[] = []
  const macdAligned = Math.sign(features.macdVelN) === sign && Math.abs(features.macdVelN) > 0.008
  const signalAligned =
    Math.sign(features.signalVelN) === sign && Math.abs(features.signalVelN) > 0.004
  if (macdAligned && signalAligned) {
    strength += 0.3
    reasons.push(
      `Both lines already point ${upDownWord(dir)} — the ${upDownWord(dir)} cross lands with the slope, not against it.`,
    )
  } else if (!macdAligned && !signalAligned) {
    warnings.push('Neither line points the thrust way yet — the cross would land cold.')
  } else {
    strength += 0.12
  }
  const histPush = features.histDeltaN * sign
  if (histPush > 0.02) {
    strength += 0.2
    reasons.push('The histogram is accelerating into the move — momentum is building, not fading.')
  } else if (histPush < -0.005) {
    warnings.push('Histogram momentum is fading into the cross — thrust may disappoint.')
  }
  if (Math.sign(features.zeroRegime) === sign && Math.abs(features.zeroRegime) > 0.35) {
    strength += 0.2
    reasons.push(
      `MACD already lives on the ${dir === 'bullish' ? 'upper' : 'lower'} side of the mid line with room to run.`,
    )
  } else if (Math.sign(features.zeroRegime) === -sign && Math.abs(features.zeroRegime) > 0.4) {
    warnings.push(
      `The mid-line regime still favors the other side — the thrust must fight ${dir === 'bullish' ? 'overhead' : 'underlying'} gravity.`,
    )
  }
  if (Math.abs(features.macdVelN) > 0.06 && macdAligned) strength += 0.15
  if (features.yellowLast5 >= 4) {
    strength -= 0.1
    warnings.push('Recent flat yellow bars say coiled, not loaded — the first push can be a head-fake.')
  }
  if (features.thrustStreak >= 3) strength += 0.08

  const thrust: MacdThrust = strength >= 0.55 ? 'strong' : strength >= 0.3 ? 'mild' : 'weak'
  if (thrust === 'strong')
    reasons.unshift(
      `After the ${upDownWord(dir)} cross, expect MACD to come out strong to the ${sideWord(dir)} — widening bars, not a dribble.`,
    )
  else if (thrust === 'mild')
    reasons.unshift(
      `After the ${upDownWord(dir)} cross, expect a steady ${sideWord(dir)} push — real follow-through, but not an explosion.`,
    )
  else
    reasons.unshift(
      `After the ${upDownWord(dir)} cross, expect a soft, flat follow-through — the kind of cross that flips back.`,
    )
  return {
    ...base,
    thrust,
    bias: biasFromDir(dir),
    score: sign * (thrust === 'strong' ? 0.75 : thrust === 'mild' ? 0.45 : 0.2),
    confidence: clamp(0.4 + Math.abs(strength - 0.4) + (macdAligned && signalAligned ? 0.1 : 0), 0.3, 0.9),
    reasons,
    warnings,
    metrics: {
      thrust,
      strength,
      macdAligned,
      signalAligned,
      histPush,
      zeroRegime: features.zeroRegime,
    },
  }
}

function analyzeMemory(
  features: MacdFeatures,
  crossDir: MacdCrossDir | null,
  memory: MacdMemoryStats | undefined,
  symbol: string,
  timeframe: Timeframe,
): MacdAgentOpinion {
  const metrics: Record<string, number | string | boolean | null> = {
    samples: memory?.samples ?? 0,
    hitRate: memory?.hitRate ?? null,
    avgCrossBarsErr: memory?.avgCrossBarsErr ?? null,
    bounceRate: memory?.bounceRate ?? null,
  }
  if (!memory || memory.samples === 0) {
    return {
      id: 'memory',
      label: 'Pattern Memory',
      bias: 'neutral',
      score: 0,
      confidence: 0.25,
      reasons: [
        `No settled MACD forecasts yet on ${symbol} ${timeframe} — the group starts learning from the next closed bars.`,
      ],
      warnings: [],
      metrics,
    }
  }
  const hitRate = memory.hitRate ?? 0.5
  const lean = clamp((hitRate - 0.5) * 2, -1, 1)
  const dir = crossDir ?? features.lastCrossDir
  const bias: MacdBias = !dir || Math.abs(lean) < 0.08 ? 'neutral' : biasFromDir(dir)
  const reasons = [
    hitRate >= 0.6
      ? `The last ${memory.samples} settled MACD forecasts here hit ${Math.round(hitRate * 100)}% — this setup reads true.`
      : hitRate <= 0.4
        ? `The last ${memory.samples} settled MACD forecasts here hit only ${Math.round(hitRate * 100)}% — size this call down.`
        : `The last ${memory.samples} settled MACD forecasts here split ${Math.round(hitRate * 100)}% — the jury is still out.`,
  ]
  if (memory.avgCrossBarsErr !== null && Math.abs(memory.avgCrossBarsErr) >= 1)
    reasons.push(
      memory.avgCrossBarsErr > 0
        ? `Recent crosses landed ~${Math.abs(memory.avgCrossBarsErr).toFixed(1)} bars later than timed — timing is adjusted for the lag.`
        : `Recent crosses landed ~${Math.abs(memory.avgCrossBarsErr).toFixed(1)} bars earlier than timed — timing is adjusted for the rush.`,
    )
  if (memory.bounceRate !== null && memory.samples >= 8)
    reasons.push(
      memory.bounceRate >= 0.6
        ? 'Touches here usually bounce — rejection is the base case until the tape says otherwise.'
        : memory.bounceRate <= 0.35
          ? 'Touches here usually slice through — breaks are the base case until the tape says otherwise.'
          : 'Touches here split between bounces and breaks — let the approach angle decide.',
    )
  return {
    id: 'memory',
    label: 'Pattern Memory',
    bias,
    score: bias === 'neutral' ? 0 : (bias === 'bullish' ? 1 : -1) * Math.abs(lean) * 0.8,
    confidence: clamp(0.3 + memory.samples / 60, 0.3, 0.85),
    reasons,
    warnings: hitRate <= 0.4 ? ['Cold streak — every specialist gets less rope until forecasts start landing.'] : [],
    metrics,
  }
}

function classifyRegime(features: MacdFeatures, timerBars: number | null, closing: boolean): MacdForecastRegime {
  if (features.flat) return 'coil'
  if (features.barsSinceCross !== null && features.barsSinceCross <= 1) return 'fresh-cross'
  if (features.touchZone) return 'touch-zone'
  if (closing && timerBars !== null) return 'approaching-cross'
  if (features.yellowLast5 >= 3) return 'coil'
  return 'diverging'
}

const BASE_WEIGHTS: Record<MacdForecastRegime, Record<Exclude<MacdAgentId, 'ensemble'>, number>> = {
  'approaching-cross': {
    'cross-timer': 0.34,
    'zero-scout': 0.16,
    'touch-judge': 0.2,
    'thrust-reader': 0.12,
    memory: 0.18,
  },
  'touch-zone': {
    'cross-timer': 0.22,
    'zero-scout': 0.12,
    'touch-judge': 0.38,
    'thrust-reader': 0.12,
    memory: 0.16,
  },
  'fresh-cross': {
    'cross-timer': 0.1,
    'zero-scout': 0.22,
    'touch-judge': 0.1,
    'thrust-reader': 0.38,
    memory: 0.2,
  },
  diverging: {
    'cross-timer': 0.3,
    'zero-scout': 0.2,
    'touch-judge': 0.12,
    'thrust-reader': 0.08,
    memory: 0.3,
  },
  coil: {
    'cross-timer': 0.18,
    'zero-scout': 0.14,
    'touch-judge': 0.24,
    'thrust-reader': 0.1,
    memory: 0.34,
  },
}

interface PerformanceCell {
  skill: number
  samples: number
}

interface MacdAgentLearningEntry {
  overall: PerformanceCell
  byRegime: Partial<Record<MacdForecastRegime, PerformanceCell>>
  byTimeframe: Partial<Record<Timeframe, PerformanceCell>>
}

export interface MacdCalibration {
  crossBarsBias: number
  zeroBarsBias: number
  samples: number
}

export interface MacdAiLearningState {
  version: 1
  updatedAt: string
  agents: Partial<Record<MacdAgentId, MacdAgentLearningEntry>>
  calibration: MacdCalibration
}

export function defaultMacdAiLearningState(): MacdAiLearningState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    agents: {},
    calibration: { crossBarsBias: 0, zeroBarsBias: 0, samples: 0 },
  }
}

export function normalizeMacdAiLearningState(value: unknown): MacdAiLearningState {
  const fallback = defaultMacdAiLearningState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const raw = value as Partial<MacdAiLearningState>
  if (raw.version !== 1 || !raw.agents || typeof raw.agents !== 'object') return fallback
  const calibration = (raw as { calibration?: unknown }).calibration as
    | Partial<MacdCalibration>
    | undefined
  const numberOr = (input: unknown, otherwise: number) =>
    typeof input === 'number' && Number.isFinite(input) ? input : otherwise
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallback.updatedAt,
    agents: raw.agents,
    calibration: {
      crossBarsBias: clamp(numberOr(calibration?.crossBarsBias, 0), -4, 4),
      zeroBarsBias: clamp(numberOr(calibration?.zeroBarsBias, 0), -4, 4),
      samples: Math.max(0, Math.round(numberOr(calibration?.samples, 0))),
    },
  }
}

function neutralCell(): PerformanceCell {
  return { skill: 0.5, samples: 0 }
}

function readCell(cell?: PerformanceCell): PerformanceCell {
  return cell ? { skill: cell.skill, samples: cell.samples } : neutralCell()
}

function effectiveMacdWeight(
  learning: MacdAiLearningState,
  agentId: MacdAgentId,
  regime: MacdForecastRegime,
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

export function macdLearningHeadline(
  learning: MacdAiLearningState,
  agentId: MacdAgentId,
): string {
  const entry = learning.agents[agentId]
  if (!entry) return 'No settled outcomes yet.'
  const skill = clamp(entry.overall.skill, 0, 1)
  const samples = entry.overall.samples
  return `${Math.round(skill * 100)}% skill · ${samples} settled ${samples === 1 ? 'sample' : 'samples'}`
}

function buildHeadline(
  regime: MacdForecastRegime,
  timer: CrossTimerResult,
  zero: ZeroScoutResult,
  touch: TouchJudgeResult,
  thrust: ThrustReaderResult,
  features: MacdFeatures,
): { headline: string; touchBars: number | null } {
  let touchBars: number | null = null
  if (features.closureN > STALL_SPEED && features.gapSwing > TOUCH_SWING) {
    touchBars = clamp(
      Math.ceil((features.gapSwing - TOUCH_SWING) / features.closureN),
      1,
      MAX_BARS,
    )
  } else if (features.touchZone) touchBars = 0

  if (regime === 'fresh-cross' && features.lastCrossDir) {
    const dir = features.lastCrossDir
    if (thrust.thrust === 'strong')
      return { headline: `${dirWord(dir)} cross just printed — strong ${sideWord(dir)} thrust next`, touchBars }
    if (thrust.thrust === 'mild')
      return { headline: `${dirWord(dir)} cross just printed — steady ${sideWord(dir)} push next`, touchBars }
    return { headline: `${dirWord(dir)} cross just printed — weak follow-through, flip risk`, touchBars }
  }
  if (regime === 'touch-zone') {
    if (touch.touch === 'bounce') {
      const side = features.cur.hist >= 0 ? 'bullish' : 'bearish'
      return { headline: `Touch the signal, reverse ${upDownWord(side)} — no cross through`, touchBars }
    }
    if (timer.dir && timer.bars !== null)
      return {
        headline: `${dirWord(timer.dir)} cross ~${timer.bars} bars — straight through the signal`,
        touchBars,
      }
    return { headline: 'MACD is on the signal — the next bar decides break or bounce', touchBars }
  }
  // A bounce verdict overrules a far timed cross: the judge's rejection wins
  // over a 9+ bar straight-line extrapolation, so the story is the rejection.
  if (touch.touch === 'bounce' && (timer.bars === null || timer.bars >= 9)) {
    const side = features.cur.hist >= 0 ? 'bullish' : 'bearish'
    if (touchBars === 0)
      return { headline: `Touching the signal now — reverse ${upDownWord(side)}, no cross through`, touchBars }
    return {
      headline: `Touch the signal in ~${touchBars ?? 1} bars, then reverse ${upDownWord(side)} — no cross through`,
      touchBars,
    }
  }
  if (regime === 'approaching-cross' && timer.dir && timer.bars !== null) {
    if (touch.touch === 'bounce' && touchBars !== null && touchBars >= 1)
      return {
        headline: `Touch first (~${touchBars} bars), bounce — then ${upDownWord(timer.dir)} cross`,
        touchBars,
      }
    return { headline: `${dirWord(timer.dir)} cross in ~${timer.bars} bars`, touchBars }
  }
  if (regime === 'coil')
    return { headline: 'Coiling near the signal — waiting for the break', touchBars }
  if (zero.zeroDir && zero.zeroBars !== null && zero.confidence >= 0.55) {
    const from = features.zeroSide
    const to = zero.zeroDir === 'up' ? 'above' : 'below'
    return { headline: `No signal cross — but mid line flips ${from} → ${to} ~${zero.zeroBars} bars`, touchBars }
  }
  return { headline: 'No cross on the radar — lines are drifting apart', touchBars }
}

function buildTimeline(
  regime: MacdForecastRegime,
  timer: CrossTimerResult,
  zero: ZeroScoutResult,
  touch: TouchJudgeResult,
  thrust: ThrustReaderResult,
  features: MacdFeatures,
  touchBars: number | null,
): MacdTimelineStep[] {
  const steps: MacdTimelineStep[] = []
  const crossStands = !(touch.touch === 'bounce' && (timer.bars === null || timer.bars >= 9))
  const dir = crossStands
    ? (timer.dir ?? (regime === 'fresh-cross' ? features.lastCrossDir : null))
    : null

  if (regime === 'fresh-cross' && features.lastCrossDir) {
    const cross = features.lastCrossDir
    steps.push({
      title:
        thrust.thrust === 'strong'
          ? `Strong push to the ${sideWord(cross)} (next 1–3 bars)`
          : thrust.thrust === 'mild'
            ? `Steady push to the ${sideWord(cross)} (next 1–3 bars)`
            : `Soft follow-through — flip-back risk (next 1–3 bars)`,
      detail: thrust.reasons[0] ?? '',
    })
    if (zero.zeroDir && zero.zeroBars !== null)
      steps.push({
        title: `Mid-line flip ${features.zeroSide} → ${zero.zeroDir === 'up' ? 'above' : 'below'} (~${zero.zeroBars} bars)`,
        detail: zero.reasons[0] ?? '',
      })
    else
      steps.push({
        title: 'Mid line holds its side',
        detail: zero.reasons[0] ?? 'No mid-line flip is forming behind this cross.',
      })
    return steps.slice(0, 4)
  }

  if (touch.touch !== 'none' && features.closureN > STALL_SPEED) {
    if (touch.touch === 'bounce') {
      const side = features.cur.hist >= 0 ? 'bullish' : 'bearish'
      steps.push({
        title:
          touchBars === 0
            ? 'Touch the signal now — then reverse'
            : `Touch the signal (~${touchBars ?? 1} bars) — then reverse ${upDownWord(side)}`,
        detail: touch.reasons[0] ?? '',
      })
    } else if (dir) {
      steps.push({
        title:
          touchBars === 0
            ? 'Touch the signal now — then slice through'
            : `Touch the signal (~${touchBars ?? 1} bars) — then slice through`,
        detail: touch.reasons[0] ?? '',
      })
    }
  }

  if (dir && timer.bars !== null)
    steps.push({
      title: `${dirWord(dir)} cross (~${timer.bars} bars)`,
      detail: timer.reasons[0] ?? '',
    })

  if (zero.zeroDir && zero.zeroBars !== null)
    steps.push({
      title: `Mid-line flip ${features.zeroSide} → ${zero.zeroDir === 'up' ? 'above' : 'below'} (~${zero.zeroBars} bars)`,
      detail: zero.reasons[0] ?? '',
    })
  else if (dir)
    steps.push({
      title: 'Mid line holds its side',
      detail: zero.reasons[0] ?? 'No mid-line flip behind this cross.',
    })

  if (dir)
    steps.push({
      title:
        thrust.thrust === 'strong'
          ? `Come out strong to the ${sideWord(dir)}`
          : thrust.thrust === 'mild'
            ? `Steady follow-through to the ${sideWord(dir)}`
            : `Weak follow-through — flip-back risk`,
      detail: thrust.reasons[0] ?? '',
    })

  if (!steps.length) {
    steps.push({
      title: 'Stand by — no MACD event is forming',
      detail:
        regime === 'coil'
          ? 'MACD is coiling flat near the signal. The first histogram bar that stops printing yellow names the direction.'
          : 'MACD and the signal are moving apart. The forecast wakes up when the gap starts closing again.',
    })
    if (zero.zeroDir && zero.zeroBars !== null)
      steps.push({
        title: `Mid-line flip ${features.zeroSide} → ${zero.zeroDir === 'up' ? 'above' : 'below'} (~${zero.zeroBars} bars)`,
        detail: zero.reasons[0] ?? '',
      })
  }
  return steps.slice(0, 4)
}

function buildEnsemble(
  regime: MacdForecastRegime,
  timeframe: Timeframe,
  learning: MacdAiLearningState,
  specialists: MacdAgentOpinion[],
): MacdAgentOpinion {
  const weights = BASE_WEIGHTS[regime]
  let weightedScore = 0
  let totalWeight = 0
  let bullishWeight = 0
  let bearishWeight = 0
  let confidenceNumerator = 0
  for (const opinion of specialists) {
    if (opinion.id === 'ensemble') continue
    const adaptive = effectiveMacdWeight(learning, opinion.id, regime, timeframe)
    const weight = weights[opinion.id as Exclude<MacdAgentId, 'ensemble'>] * adaptive
    weightedScore += opinion.score * weight
    totalWeight += weight
    confidenceNumerator += opinion.confidence * weight
    if (opinion.score >= 0.12) bullishWeight += weight
    else if (opinion.score <= -0.12) bearishWeight += weight
  }
  const score = totalWeight > 0 ? clamp(weightedScore / totalWeight, -1, 1) : 0
  const agreement =
    bullishWeight + bearishWeight > 0
      ? Math.abs(bullishWeight - bearishWeight) / (bullishWeight + bearishWeight)
      : 0
  const averageConfidence = totalWeight > 0 ? confidenceNumerator / totalWeight : 0.3
  const bias: MacdBias = score >= 0.15 ? 'bullish' : score <= -0.15 ? 'bearish' : 'neutral'
  const confidence = clamp(
    0.24 + Math.abs(score) * 0.4 + agreement * 0.22 + averageConfidence * 0.18,
    0.2,
    0.95,
  )
  const lead = [...specialists].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]
  const reasons = [
    lead && lead.bias !== 'neutral' && Math.abs(lead.score) >= 0.15
      ? `${lead.label} leads: ${lead.reasons[0] ?? ''}`
      : 'Specialists are split, so the director favors caution over conviction.',
  ]
  const warnings: string[] = []
  if (agreement < 0.4 && (bullishWeight > 0 || bearishWeight > 0))
    warnings.push('Specialists disagree on the direction of the coming move — expect chop first.')
  return {
    id: 'ensemble',
    label: 'MACD Director',
    bias,
    score,
    confidence,
    reasons,
    warnings,
    metrics: { agreement, bullishWeight, bearishWeight, averageConfidence },
  }
}

export function analyzeMacdForecast(
  input: MacdForecastInput,
  learning: MacdAiLearningState = defaultMacdAiLearningState(),
): MacdForecast | null {
  const features = extractFeatures(input.candles, input.values)
  if (!features) return null
  const calibration = learning.calibration ?? defaultMacdAiLearningState().calibration

  if (features.flat) {
    const flatOpinion = (id: MacdAgentId, label: string): MacdAgentOpinion => ({
      id,
      label,
      bias: 'neutral',
      score: 0,
      confidence: 0.3,
      reasons: ['MACD is printing flat — no velocity, no convergence, nothing to time.'],
      warnings: [],
      metrics: {},
    })
    const specialists = [
      flatOpinion('cross-timer', 'Cross Timer'),
      flatOpinion('zero-scout', 'Zero-Line Scout'),
      flatOpinion('touch-judge', 'Touch & Reject Judge'),
      flatOpinion('thrust-reader', 'Breakout Thrust Reader'),
      analyzeMemory(features, null, input.memory, input.symbol, input.timeframe),
    ]
    const ensemble = buildEnsemble('coil', input.timeframe, learning, specialists)
    return {
      regime: 'coil',
      headline: 'MACD is flat — nothing to time yet',
      bias: 'neutral',
      score: ensemble.score,
      confidence: ensemble.confidence,
      crossDir: null,
      crossBars: null,
      zeroDir: null,
      zeroBars: null,
      touch: 'none',
      touchBars: null,
      thrust: 'weak',
      timeline: [
        {
          title: 'Stand by — MACD is flat',
          detail: 'With no slope and no gap movement there is no coming event. The first directional bars wake the group up.',
        },
      ],
      reasons: ['MACD is printing a flat line, so every forward read is a wait.'],
      risks: [],
      agents: [...specialists, ensemble],
      learningRecord: {
        timeframe: input.timeframe,
        regime: 'coil',
        ensemble: { id: 'ensemble', bias: ensemble.bias, score: ensemble.score, confidence: ensemble.confidence },
        agents: specialists.map((opinion) => ({
          id: opinion.id,
          bias: opinion.bias,
          score: opinion.score,
          confidence: opinion.confidence,
        })),
        prediction: { crossDir: null, crossBars: null, zeroDir: null, zeroBars: null, touch: 'none', thrust: 'weak' },
      },
      snapshot: {
        macd: features.cur.macd,
        signal: features.cur.signal,
        histogram: features.cur.hist,
        swing: features.swing,
        zeroSide: features.zeroSide,
        signalZeroSide: features.signalZeroSide,
        gapSwing: features.gapSwing,
        closurePerBar: features.closureN * features.swing,
        barsSinceCross: features.barsSinceCross,
        lastCrossDir: features.lastCrossDir,
        resolution: input.resolution,
      },
    }
  }

  const timer = analyzeCrossTimer(features, calibration)
  const zero = analyzeZeroScout(features, calibration)
  const touch = analyzeTouchJudge(features, timer.dir, timer.bars, input.memory)
  const thrust = analyzeThrustReader(features, timer.dir)
  const memory = analyzeMemory(features, timer.dir, input.memory, input.symbol, input.timeframe)
  const specialists: MacdAgentOpinion[] = [timer, zero, touch, thrust, memory]
  // The director sides with the judge over a far timer extrapolation: a bounce
  // means no cross through, so the cross fields go quiet with the headline.
  const crossSuppressed = touch.touch === 'bounce' && (timer.bars === null || timer.bars >= 9)
  const crossDir = crossSuppressed ? null : timer.dir
  const crossBars = crossSuppressed ? null : timer.bars
  const regime = classifyRegime(features, timer.bars, timer.dir !== null && timer.bars !== null)
  const ensemble = buildEnsemble(regime, input.timeframe, learning, specialists)
  const { headline, touchBars } = buildHeadline(regime, timer, zero, touch, thrust, features)
  const timeline = buildTimeline(regime, timer, zero, touch, thrust, features, touchBars)

  const reasons = [timeline[0]?.detail ?? headline]
  if (crossDir && crossBars !== null) reasons.push(timer.reasons[0])
  if (zero.zeroDir && zero.zeroBars !== null) reasons.push(zero.reasons[0])
  else if (zero.reasons[0] && regime !== 'diverging') reasons.push(zero.reasons[0])
  if (touch.touch !== 'none' && touch.reasons[0]) reasons.push(touch.reasons[0])

  const risks = [
    ...new Set(
      [...ensemble.warnings, ...specialists.flatMap((opinion) => opinion.warnings)]
        .filter(Boolean)
        .slice(0, 5),
    ),
  ]
  if (crossDir && crossBars !== null)
    risks.unshift(
      `If the histogram starts widening again, the ${upDownWord(crossDir)} cross is off and this timeline resets.`,
    )
  if (input.resolution !== input.timeframe)
    risks.push(
      `This reads the ${input.resolution} CM projection on a ${input.timeframe} chart — the developing bar can still repaint.`,
    )

  const bias: MacdBias =
    ensemble.bias !== 'neutral'
      ? ensemble.bias
      : crossDir
        ? biasFromDir(crossDir)
        : regime === 'fresh-cross' && features.lastCrossDir
          ? biasFromDir(features.lastCrossDir)
          : 'neutral'

  const prediction: MacdLearningPrediction = {
    crossDir,
    crossBars,
    zeroDir: zero.zeroDir,
    zeroBars: zero.zeroBars,
    touch: touch.touch,
    thrust: thrust.thrust,
  }
  return {
    regime,
    headline,
    bias,
    score: ensemble.score,
    confidence: ensemble.confidence,
    crossDir,
    crossBars,
    zeroDir: zero.zeroDir,
    zeroBars: zero.zeroBars,
    touch: touch.touch,
    touchBars,
    thrust: thrust.thrust,
    timeline,
    reasons: [...new Set(reasons)].slice(0, 4),
    risks: risks.slice(0, 5),
    agents: [...specialists, ensemble],
    learningRecord: {
      timeframe: input.timeframe,
      regime,
      ensemble: { id: 'ensemble', bias: ensemble.bias, score: ensemble.score, confidence: ensemble.confidence },
      agents: specialists.map((opinion) => ({
        id: opinion.id,
        bias: opinion.bias,
        score: opinion.score,
        confidence: opinion.confidence,
      })),
      prediction,
    },
    snapshot: {
      macd: features.cur.macd,
      signal: features.cur.signal,
      histogram: features.cur.hist,
      swing: features.swing,
      zeroSide: features.zeroSide,
      signalZeroSide: features.signalZeroSide,
      gapSwing: features.gapSwing,
      closurePerBar: features.closureN * features.swing,
      barsSinceCross: features.barsSinceCross,
      lastCrossDir: features.lastCrossDir,
      resolution: input.resolution,
    },
  }
}

// ---------------------------------------------------------------------------
// Outcomes, learning and journal
// ---------------------------------------------------------------------------

export interface MacdOutcomeDetail {
  crossDir: MacdCrossDir | null
  crossBars: number | null
  zeroDir: MacdZeroDir | null
  zeroBars: number | null
  touched: boolean
  touchResult: MacdTouchVerdict
  thrust: MacdThrust | null
}

export interface MacdScores {
  cross: number
  zero: number
  touch: number
  thrust: number
  ensemble: number
}

function crossScore(pred: MacdLearningPrediction, actual: MacdOutcomeDetail): number {
  if (!pred.crossDir && !actual.crossDir) return 0.7
  if (!pred.crossDir && actual.crossDir) return 0.15
  if (pred.crossDir && !actual.crossDir) return 0.25
  if (pred.crossDir !== actual.crossDir) return 0.05
  const err = Math.abs((pred.crossBars ?? 0) - (actual.crossBars ?? 0))
  return clamp(1 - err / 6, 0.3, 1)
}

function zeroScore(pred: MacdLearningPrediction, actual: MacdOutcomeDetail): number {
  if (!pred.zeroDir && !actual.zeroDir) return 0.7
  if (!pred.zeroDir && actual.zeroDir) return 0.2
  if (pred.zeroDir && !actual.zeroDir) return 0.3
  if (pred.zeroDir !== actual.zeroDir) return 0.05
  const err = Math.abs((pred.zeroBars ?? 0) - (actual.zeroBars ?? 0))
  return clamp(1 - err / 8, 0.3, 1)
}

function touchScore(pred: MacdLearningPrediction, actual: MacdOutcomeDetail): number {
  if (pred.touch === actual.touchResult) return 1
  if (pred.touch === 'none' || actual.touchResult === 'none') return 0.3
  return 0.1
}

function thrustScore(pred: MacdLearningPrediction, actual: MacdOutcomeDetail): number {
  if (!actual.crossDir || !actual.thrust) return pred.thrust === 'weak' ? 0.6 : 0.3
  const rank: Record<MacdThrust, number> = { strong: 2, mild: 1, weak: 0 }
  const distance = Math.abs(rank[pred.thrust] - rank[actual.thrust])
  return distance === 0 ? 1 : distance === 1 ? 0.5 : 0.1
}

export function scoreMacdOutcome(
  prediction: MacdLearningPrediction,
  actual: MacdOutcomeDetail,
): MacdScores {
  const cross = crossScore(prediction, actual)
  const zero = zeroScore(prediction, actual)
  const touch = touchScore(prediction, actual)
  const thrust = thrustScore(prediction, actual)
  return { cross, zero, touch, thrust, ensemble: (cross + zero + touch + thrust) / 4 }
}

function updateCell(previous: PerformanceCell | undefined, score: number): PerformanceCell {
  const cell = readCell(previous)
  const alpha = cell.samples < 25 ? 0.18 : 0.08
  return {
    skill: clamp(cell.skill * (1 - alpha) + score * alpha, 0, 1),
    samples: cell.samples + 1,
  }
}

function upsertMacdEntry(
  state: MacdAiLearningState,
  agentId: MacdAgentId,
  regime: MacdForecastRegime,
  timeframe: Timeframe,
  score: number,
) {
  const entry = state.agents[agentId] ?? { overall: neutralCell(), byRegime: {}, byTimeframe: {} }
  entry.overall = updateCell(entry.overall, score)
  entry.byRegime[regime] = updateCell(entry.byRegime[regime], score)
  entry.byTimeframe[timeframe] = updateCell(entry.byTimeframe[timeframe], score)
  state.agents[agentId] = entry
}

export function learnFromMacdOutcome(
  previous: MacdAiLearningState,
  record: MacdLearningRecord,
  actual: MacdOutcomeDetail,
): MacdAiLearningState {
  const next: MacdAiLearningState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: structuredClone(previous.agents),
    calibration: { ...previous.calibration },
  }
  const scores = scoreMacdOutcome(record.prediction, actual)
  const perAgent: Record<MacdAgentId, number> = {
    'cross-timer': scores.cross,
    'zero-scout': scores.zero,
    'touch-judge': scores.touch,
    'thrust-reader': scores.thrust,
    memory: scores.ensemble,
    ensemble: scores.ensemble,
  }
  for (const opinion of [...record.agents, record.ensemble]) {
    upsertMacdEntry(next, opinion.id, record.regime, record.timeframe, perAgent[opinion.id] ?? 0.5)
  }
  // Timing calibration: the literal "learn when the cross lands" loop.
  const alpha = next.calibration.samples < 25 ? 0.2 : 0.08
  if (
    record.prediction.crossDir &&
    actual.crossDir &&
    record.prediction.crossDir === actual.crossDir &&
    record.prediction.crossBars !== null &&
    actual.crossBars !== null
  ) {
    const err = actual.crossBars - record.prediction.crossBars
    next.calibration.crossBarsBias = clamp(
      next.calibration.crossBarsBias + alpha * (err - next.calibration.crossBarsBias),
      -4,
      4,
    )
    next.calibration.samples += 1
  }
  if (
    record.prediction.zeroDir &&
    actual.zeroDir &&
    record.prediction.zeroDir === actual.zeroDir &&
    record.prediction.zeroBars !== null &&
    actual.zeroBars !== null
  ) {
    const err = actual.zeroBars - record.prediction.zeroBars
    next.calibration.zeroBarsBias = clamp(
      next.calibration.zeroBarsBias + alpha * (err - next.calibration.zeroBarsBias),
      -4,
      4,
    )
    next.calibration.samples += 1
  }
  return next
}

export type MacdJournalResult = 'hit' | 'partial' | 'miss' | 'stale'

export interface MacdForecastEntry {
  id: string
  source: DataSource
  symbol: string
  timeframe: Timeframe
  resolution: Timeframe
  createdAt: string
  candleTime: number
  settingsKey: string
  horizonBars: number
  targetTime: number
  regime: MacdForecastRegime
  confidence: number
  headline: string
  crossDir: MacdCrossDir | null
  crossBars: number | null
  zeroDir: MacdZeroDir | null
  zeroBars: number | null
  touch: MacdTouchVerdict
  thrust: MacdThrust
  swing: number
  learningRecord: MacdLearningRecord
  resolvedAt?: string
  actual?: MacdOutcomeDetail
  scores?: MacdScores
  result?: MacdJournalResult
}

export interface MacdForecastJournal {
  version: 1
  updatedAt: string
  autoJournal: boolean
  entries: MacdForecastEntry[]
}

export interface MacdJournalStats {
  total: number
  pending: number
  resolved: number
  hit: number
  partial: number
  miss: number
  stale: number
  hitRate: number | null
}

export function defaultMacdForecastJournal(): MacdForecastJournal {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    autoJournal: true,
    entries: [],
  }
}

export function macdJournalStats(journal: MacdForecastJournal): MacdJournalStats {
  const stats: MacdJournalStats = {
    total: journal.entries.length,
    pending: 0,
    resolved: 0,
    hit: 0,
    partial: 0,
    miss: 0,
    stale: 0,
    hitRate: null,
  }
  for (const entry of journal.entries) {
    if (!entry.resolvedAt || !entry.result) {
      stats.pending++
      continue
    }
    if (entry.result === 'stale') {
      stats.stale++
      continue
    }
    stats.resolved++
    if (entry.result === 'hit') stats.hit++
    else if (entry.result === 'partial') stats.partial++
    else stats.miss++
  }
  stats.hitRate =
    stats.resolved > 0 ? (stats.hit + stats.partial * 0.5) / stats.resolved : null
  return stats
}

export function recordMacdForecast(
  journal: MacdForecastJournal,
  params: {
    source: DataSource
    symbol: string
    timeframe: Timeframe
    candles: Candle[]
    forecast: MacdForecast
    settingsKey: string
  },
): MacdForecastJournal {
  if (!journal.autoJournal || params.candles.length < 2) return journal
  const anchor = last(params.candles)
  const duplicate = journal.entries.some(
    (entry) =>
      entry.source === params.source &&
      entry.symbol === params.symbol &&
      entry.timeframe === params.timeframe &&
      entry.candleTime === anchor.time,
  )
  if (duplicate) return journal
  const nextEntry: MacdForecastEntry = {
    id: uid(),
    source: params.source,
    symbol: params.symbol,
    timeframe: params.timeframe,
    resolution: params.forecast.snapshot.resolution,
    createdAt: new Date(anchor.time * 1000).toISOString(),
    candleTime: anchor.time,
    settingsKey: params.settingsKey,
    horizonBars: HORIZON_BARS,
    targetTime: anchor.time + HORIZON_BARS * (INTERVAL_SECONDS[params.timeframe] ?? 60),
    regime: params.forecast.regime,
    confidence: params.forecast.confidence,
    headline: params.forecast.headline,
    crossDir: params.forecast.crossDir,
    crossBars: params.forecast.crossBars,
    zeroDir: params.forecast.zeroDir,
    zeroBars: params.forecast.zeroBars,
    touch: params.forecast.touch,
    thrust: params.forecast.thrust,
    swing: params.forecast.snapshot.swing,
    learningRecord: params.forecast.learningRecord,
  }
  return {
    ...journal,
    updatedAt: new Date().toISOString(),
    entries: [...journal.entries, nextEntry].slice(-MAX_JOURNAL_ENTRIES),
  }
}

/** What the CM MACD actually printed in the bars after a journaled forecast. */
function scanOutcome(
  candles: Candle[],
  values: CmMacdValues,
  startIndex: number,
  horizonBars: number,
  swing: number,
): MacdOutcomeDetail | null {
  const ruler = swing > 1e-9 ? swing : 1
  let prevHist: number | null = null
  let prevMacd: number | null = null
  let foundCross: MacdCrossDir | null = null
  let crossBars: number | null = null
  let crossIndex = -1
  let zeroDir: MacdZeroDir | null = null
  let zeroBars: number | null = null
  let touched = false
  // Seed from the entry bar so a cross on the very next bar still counts.
  const seedHist = values.histogram[startIndex]
  const seedMacd = values.macd[startIndex]
  if (seedHist !== null && Number.isFinite(seedHist)) prevHist = seedHist
  if (seedMacd !== null && Number.isFinite(seedMacd)) prevMacd = seedMacd
  const end = Math.min(candles.length - 1, startIndex + horizonBars)
  for (let i = startIndex + 1; i <= end; i++) {
    const hist = values.histogram[i]
    const macd = values.macd[i]
    if (hist !== null && Number.isFinite(hist)) {
      if (Math.abs(hist) / ruler <= TOUCH_SWING) touched = true
      if (prevHist !== null && !foundCross) {
        const dir = crossDir(hist, prevHist)
        if (dir) {
          foundCross = dir
          crossBars = i - startIndex
          crossIndex = i
        }
      }
      prevHist = hist
    }
    if (macd !== null && Number.isFinite(macd)) {
      if (prevMacd !== null && !zeroDir) {
        if (macd > 0 && prevMacd <= 0) {
          zeroDir = 'up'
          zeroBars = i - startIndex
        } else if (macd < 0 && prevMacd >= 0) {
          zeroDir = 'down'
          zeroBars = i - startIndex
        }
      }
      prevMacd = macd
    }
  }
  // A touch that slices into a cross within two bars is a break; a touch with
  // no cross behind it is a bounce; leaping over the signal counts as through.
  const touchResult: MacdTouchVerdict =
    foundCross && (!touched || crossIndex - startIndex <= 3) ? 'break' : touched ? 'bounce' : 'none'
  let thrust: MacdThrust | null = null
  if (foundCross && crossIndex >= 0) {
    let peak = 0
    for (let i = crossIndex + 1; i <= Math.min(crossIndex + 3, end); i++) {
      const hist = values.histogram[i]
      if (hist !== null && Number.isFinite(hist)) peak = Math.max(peak, Math.abs(hist) / ruler)
    }
    thrust = peak >= 0.4 ? 'strong' : peak >= 0.18 ? 'mild' : 'weak'
  }
  return { crossDir: foundCross, crossBars, zeroDir, zeroBars, touched, touchResult, thrust }
}

export function resolveMacdJournal(
  journal: MacdForecastJournal,
  learning: MacdAiLearningState,
  params: {
    source: DataSource
    symbol: string
    timeframe: Timeframe
    candles: Candle[]
    values: CmMacdValues
    settingsKey: string
  },
): {
  journal: MacdForecastJournal
  learning: MacdAiLearningState
  resolved: MacdForecastEntry[]
} {
  if (
    !journal.entries.length ||
    !params.candles.length ||
    params.values.histogram.length !== params.candles.length
  )
    return { journal, learning, resolved: [] }
  const resolved: MacdForecastEntry[] = []
  let nextLearning = learning
  let changed = false
  const entries = journal.entries.map((entry) => {
    if (
      entry.resolvedAt ||
      entry.source !== params.source ||
      entry.symbol !== params.symbol ||
      entry.timeframe !== params.timeframe ||
      entry.settingsKey !== params.settingsKey
    )
      return entry
    const startIndex = params.candles.findIndex((candle) => candle.time === entry.candleTime)
    if (startIndex < 0) {
      // History rotated past this entry: it can never resolve fairly.
      if (entry.candleTime < params.candles[0].time) {
        changed = true
        const stale: MacdForecastEntry = {
          ...entry,
          resolvedAt: new Date().toISOString(),
          result: 'stale',
        }
        resolved.push(stale)
        return stale
      }
      return entry
    }
    if (params.candles.length - startIndex - 1 < entry.horizonBars) return entry
    const actual = scanOutcome(
      params.candles,
      params.values,
      startIndex,
      entry.horizonBars,
      entry.swing,
    )
    if (!actual) return entry
    const scores = scoreMacdOutcome(entry.learningRecord.prediction, actual)
    const result: MacdJournalResult =
      scores.ensemble >= 0.7 ? 'hit' : scores.ensemble >= 0.4 ? 'partial' : 'miss'
    nextLearning = learnFromMacdOutcome(nextLearning, entry.learningRecord, actual)
    changed = true
    const resolvedEntry: MacdForecastEntry = {
      ...entry,
      resolvedAt: new Date(params.candles[startIndex + entry.horizonBars].time * 1000).toISOString(),
      actual,
      scores,
      result,
    }
    resolved.push(resolvedEntry)
    return resolvedEntry
  })
  if (!changed) return { journal, learning, resolved: [] }
  return {
    journal: {
      ...journal,
      updatedAt: new Date().toISOString(),
      entries: entries.slice(-MAX_JOURNAL_ENTRIES),
    },
    learning: nextLearning,
    resolved,
  }
}

export function macdMemoryStats(
  journal: MacdForecastJournal,
  symbol: string,
  timeframe: Timeframe,
  limit = 30,
): MacdMemoryStats {
  const settled = journal.entries.filter(
    (entry) =>
      entry.symbol === symbol &&
      entry.timeframe === timeframe &&
      entry.resolvedAt &&
      entry.result &&
      entry.result !== 'stale',
  )
  const recent = settled.slice(-limit)
  if (!recent.length) return { samples: 0, hitRate: null, avgCrossBarsErr: null, bounceRate: null }
  const hits = recent.filter((entry) => entry.result === 'hit').length
  const partials = recent.filter((entry) => entry.result === 'partial').length
  const timed = recent.filter(
    (entry) =>
      entry.crossDir &&
      entry.actual?.crossDir === entry.crossDir &&
      entry.crossBars !== null &&
      entry.actual.crossBars !== null,
  )
  const avgCrossBarsErr = timed.length
    ? timed.reduce((sum, entry) => sum + (entry.actual!.crossBars! - entry.crossBars!), 0) / timed.length
    : null
  const touches = recent.filter(
    (entry) => entry.actual && (entry.actual.touchResult === 'break' || entry.actual.touchResult === 'bounce'),
  )
  const bounceRate = touches.length
    ? touches.filter((entry) => entry.actual!.touchResult === 'bounce').length / touches.length
    : null
  return {
    samples: recent.length,
    hitRate: (hits + partials * 0.5) / recent.length,
    avgCrossBarsErr,
    bounceRate,
  }
}

export function normalizeMacdForecastJournal(value: unknown): MacdForecastJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultMacdForecastJournal()
  const raw = value as Partial<MacdForecastJournal>
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(
        (entry): entry is MacdForecastEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as MacdForecastEntry).id === 'string' &&
          typeof (entry as MacdForecastEntry).symbol === 'string' &&
          typeof (entry as MacdForecastEntry).timeframe === 'string' &&
          typeof (entry as MacdForecastEntry).candleTime === 'number' &&
          !!(entry as MacdForecastEntry).learningRecord,
      )
    : []
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    autoJournal: raw.autoJournal !== false,
    entries: entries.slice(-MAX_JOURNAL_ENTRIES),
  }
}

export const MACD_AI_AGENT_ORDER: MacdAgentId[] = [
  'cross-timer',
  'zero-scout',
  'touch-judge',
  'thrust-reader',
  'memory',
  'ensemble',
]

export const MACD_FORECAST_HORIZON_BARS = HORIZON_BARS
