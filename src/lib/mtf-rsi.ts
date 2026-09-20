/**
 * Multi-timeframe RSI tendency — the arithmetic behind the floating MTF RSI window.
 *
 * The window answers two questions per timeframe (1m · 5m · 15m · 30m · 1h): what is the RSI,
 * and which way is that timeframe leaning — bullish, bearish, or in range. The second question
 * is deliberately not answered from RSI alone, because momentum-only classifiers are exactly
 * the ones that whipsaw: RSI is a momentum oscillator, and a rising market spends most of its
 * time above 50 — while a healthy pullback inside an uptrend spends time below it. The pieces
 * used here are the ones the technical-analysis literature converges on:
 *
 * 1. Wilder RSI(14) — the momentum readout, and one of three direction votes.
 * 2. Wilder ADX(14) with +DI/−DI — directional strength. Consensus readings: above ~25 the
 *    market is trending, below ~20 it is range-bound. ADX does not know direction; the
 *    DI lines do.
 * 3. Kaufman efficiency ratio (20) — net move divided by the path travelled, 0..1. Near one
 *    the market went somewhere; near zero it churned. Independent of ADX: ADX smooths
 *    directional movement, the ratio measures path quality, and they miss different fakes.
 * 4. ATR(14)-normalized EMA(20) slope — trend velocity in volatility units, so a $60k BTC and
 *    a $120k BTC slope the same number for the same behaviour.
 *
 * The three strength measures fuse into one 0..100 "trend quality" score (45% ADX, 35%
 * efficiency, 20% slope — the published weighting that keeps no single measure dominant).
 * The score drives a hysteresis gate — trending in at ≥ 55, out below 45, dead-band between —
 * and the direction is a two-of-three vote of +DI/−DI, the slope's sign, and RSI against its
 * 45–55 no-man's land. A confirmed call only changes after two consecutive disagreements, so
 * a single noisy bar can never repaint the verdict.
 *
 * Pure by design (no DOM, no fetch), like every other window module here — testable without a
 * browser, and shared verbatim by the UI.
 */
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import { ta } from './indicator-runtime'
import { peekRsiZone } from './timeframe-peek'
import type { PeekRsiZone } from './timeframe-peek'

/** The resolutions the window watches, fastest first. Exactly the scalper's ladder. */
export const MTF_RSI_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h'] as const
export type MtfRsiTimeframe = (typeof MTF_RSI_TIMEFRAMES)[number]

/** The classic Wilder momentum read. */
export const MTF_RSI_PERIOD = 14
/** ADX/DI look-back — Wilder's own setting, and still the calibration the thresholds assume. */
export const MTF_ADX_PERIOD = 14
/** Kaufman efficiency window: long enough to span a swing, short enough to stay current. */
export const MTF_EFFICIENCY_PERIOD = 20
/** The trend backbone whose slope feeds the velocity term. */
export const MTF_SLOPE_EMA_PERIOD = 20
export const MTF_ATR_PERIOD = 14

/** A reading needs this many closes before every component exists (ADX is the last to land). */
export const MTF_RSI_MIN_BARS = MTF_ADX_PERIOD * 2

/** Trend-quality weights — no single measure dominant, per the published 45/35/20 fusion. */
export const MTF_QUALITY_WEIGHTS = { adx: 0.45, efficiency: 0.35, slope: 0.2 } as const

/** Hysteresis gate: trending in at 55, out below 45; in between the previous regime stands. */
export const MTF_TREND_ENTER_SCORE = 55
export const MTF_TREND_EXIT_SCORE = 45

/** RSI votes only outside the 45–55 no-man's land — a coin-flip reading abstains. */
export const MTF_RSI_NEUTRAL_LOW = 45
export const MTF_RSI_NEUTRAL_HIGH = 55

/** The DI lines need at least this spread to vote; a hair's breadth is noise. */
export const MTF_DI_MIN_SPREAD = 2
/** The slope must move at least 0.02 ATR per bar to vote. */
export const MTF_SLOPE_MIN = 0.02

/** Consecutive disagreeing readings before the confirmed tendency changes. */
export const MTF_TENDENCY_CONFIRMATIONS = 2

export type MtfTendency = 'bullish' | 'bearish' | 'range'
export type MtfStrength = 'weak' | 'moderate' | 'strong'

/**
 * One timeframe's live arithmetic. `null` fields mean "not enough history yet" — a missing
 * component abstains from every vote instead of being read as neutral.
 */
export interface MtfRsiReading {
  bars: number
  /** Wilder RSI of the closes, forming bar included — the app's honesty rule for live reads. */
  rsi: number | null
  rsiZone: PeekRsiZone | null
  adx: number | null
  plusDi: number | null
  minusDi: number | null
  /** Kaufman efficiency ratio over MTF_EFFICIENCY_PERIOD closes, 0..1. */
  efficiency: number | null
  /** EMA slope per bar in ATR units, signed: +0.1 is a hard push up. */
  slope: number | null
  /** 0..100 fusion of ADX, efficiency and |slope| — the trend-quality score. */
  score: number | null
}

export interface MtfTendencyState {
  tendency: MtfTendency
  /** The raw classification on the previous update, so only consecutive disagreements count. */
  lastRaw: MtfTendency | null
  /** How many updates in a row have carried a raw classification other than `tendency`. */
  streak: number
}

export interface MtfRsiVerdict {
  tendency: MtfTendency
  strength: MtfStrength
  /** The quality score behind the call, for the window's strength bar. */
  score: number | null
}

/**
 * Wilder's smoothing (the RMA): seed with the mean of the first `period` inputs, then
 * `previous + (value − previous) / period`. A gap in the input resets the seed, the same
 * contract `ta.ema` keeps.
 */
export function wilderSmooth(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  let seen = 0
  let previous: number | null = null
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      sum = 0
      seen = 0
      previous = null
      out.push(null)
      continue
    }
    if (previous === null) {
      sum += value
      seen++
      if (seen < period) {
        out.push(null)
        continue
      }
      previous = sum / period
    } else {
      previous = previous + (value - previous) / period
    }
    out.push(previous)
  }
  return out
}

/**
 * Kaufman's efficiency ratio per bar: the net move over `period` closes divided by the sum of
 * the bar-to-bar moves that produced it. One is a straight line, zero is a sawtooth.
 */
export function efficiencyRatio(closes: number[], period: number): (number | null)[] {
  return closes.map((close, i) => {
    if (i < period) return null
    const start = closes[i - period]
    let path = 0
    for (let j = i - period + 1; j <= i; j++) {
      const step = closes[j] - closes[j - 1]
      if (!Number.isFinite(step)) return null
      path += Math.abs(step)
    }
    if (path === 0) return close === start ? 0 : null
    return Math.abs(close - start) / path
  })
}

/**
 * Wilder's DMI: true range and directional movement smoothed over `period`, then the DI pair
 * and the ADX of the DX series. Also returns the ATR the DI pair is normalized by, so callers
 * never recompute the true ranges. Returned arrays are aligned with the input (leading nulls),
 * so the last index reads alongside the other components.
 */
export function adx(
  candles: { high: number; low: number; close: number }[],
  period: number,
): {
  adx: (number | null)[]
  plusDi: (number | null)[]
  minusDi: (number | null)[]
  atr: (number | null)[]
} {
  const count = candles.length
  const tr: (number | null)[] = [null]
  const plusDm: (number | null)[] = [null]
  const minusDm: (number | null)[] = [null]
  for (let i = 1; i < count; i++) {
    const current = candles[i]
    const previous = candles[i - 1]
    const usable =
      Number.isFinite(current.high) &&
      Number.isFinite(current.low) &&
      Number.isFinite(current.close) &&
      Number.isFinite(previous.high) &&
      Number.isFinite(previous.low) &&
      Number.isFinite(previous.close)
    if (!usable) {
      tr.push(null)
      plusDm.push(null)
      minusDm.push(null)
      continue
    }
    tr.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    )
    const upMove = current.high - previous.high
    const downMove = previous.low - current.low
    // A gap that jumps both lines counts only for the direction it actually moved.
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }
  const trSmoothed = wilderSmooth(tr, period)
  const plusSmoothed = wilderSmooth(plusDm, period)
  const minusSmoothed = wilderSmooth(minusDm, period)
  const plusDi: (number | null)[] = []
  const minusDi: (number | null)[] = []
  const dx: (number | null)[] = []
  for (let i = 0; i < count; i++) {
    const range = trSmoothed[i]
    const up = plusSmoothed[i]
    const down = minusSmoothed[i]
    if (range === null || up === null || down === null || range === 0) {
      plusDi.push(null)
      minusDi.push(null)
      dx.push(null)
      continue
    }
    const diUp = (100 * up) / range
    const diDown = (100 * down) / range
    plusDi.push(diUp)
    minusDi.push(diDown)
    const sum = diUp + diDown
    dx.push(sum === 0 ? 0 : (100 * Math.abs(diUp - diDown)) / sum)
  }
  return { adx: wilderSmooth(dx, period), plusDi, minusDi, atr: trSmoothed }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

/**
 * Every component for the newest bar of one timeframe. The forming bar's live close is the
 * newest input — the same rule `peekRsi` keeps, so the window never quotes a stale number in
 * the minute it takes a candle to close.
 */
export function analyzeMtfRsi(
  candles: { high: number; low: number; close: number }[],
): MtfRsiReading {
  const bars = candles.length
  const empty: MtfRsiReading = {
    bars,
    rsi: null,
    rsiZone: null,
    adx: null,
    plusDi: null,
    minusDi: null,
    efficiency: null,
    slope: null,
    score: null,
  }
  if (!bars) return empty
  const closes = candles.map((candle) => candle.close)
  const last = bars - 1

  const rsiSeries = ta.rsi(closes, MTF_RSI_PERIOD)
  const rsi = lastValue(rsiSeries)
  const emaSeries = ta.ema(closes, MTF_SLOPE_EMA_PERIOD)

  const {
    adx: adxSeries,
    plusDi: plusDiSeries,
    minusDi: minusDiSeries,
    atr: atrSeries,
  } = adx(candles, MTF_ADX_PERIOD)
  const erSeries = efficiencyRatio(closes, MTF_EFFICIENCY_PERIOD)

  const adxValue = lastValue(adxSeries)
  const plusDi = lastValue(plusDiSeries)
  const minusDi = lastValue(minusDiSeries)
  const efficiency = lastValue(erSeries)
  const atr = lastValue(atrSeries)
  const ema = lastValue(emaSeries)
  const emaBefore = emaSeries[last - 1]

  // Slope per bar in ATR units: the backbone's velocity against the market's own ruler.
  const slope =
    ema !== null && emaBefore !== null && atr !== null && atr > 0 ? (ema - emaBefore) / atr : null

  const score =
    adxValue === null || efficiency === null || slope === null
      ? null
      : round(
          100 *
            (MTF_QUALITY_WEIGHTS.adx * Math.min(adxValue / 50, 1) +
              MTF_QUALITY_WEIGHTS.efficiency * Math.min(Math.max(efficiency, 0), 1) +
              MTF_QUALITY_WEIGHTS.slope * Math.min(Math.abs(slope) * 10, 1)),
          1,
        )

  return {
    bars,
    rsi: rsi !== null ? round(rsi, 1) : null,
    rsiZone: peekRsiZone(rsi),
    adx: adxValue !== null ? round(adxValue, 1) : null,
    plusDi: plusDi !== null ? round(plusDi, 1) : null,
    minusDi: minusDi !== null ? round(minusDi, 1) : null,
    efficiency: efficiency !== null ? round(efficiency, 3) : null,
    slope: slope !== null ? round(slope, 3) : null,
    score,
  }
}

function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]
    if (value !== null && Number.isFinite(value)) return value
  }
  return null
}

export interface MtfDirectionVotes {
  di: -1 | 0 | 1
  slope: -1 | 0 | 1
  rsi: -1 | 0 | 1
  net: number
}

/**
 * The three direction votes. RSI abstains inside 45–55, the DI pair needs a two-point spread,
 * the slope needs to move 0.02 ATR per bar — an abstention is not a neutral, it is silence.
 */
export function mtfDirectionVotes(reading: MtfRsiReading): MtfDirectionVotes {
  const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0)
  const di =
    reading.plusDi === null || reading.minusDi === null
      ? 0
      : reading.plusDi - reading.minusDi >= MTF_DI_MIN_SPREAD
        ? 1
        : reading.minusDi - reading.plusDi >= MTF_DI_MIN_SPREAD
          ? -1
          : 0
  const slope =
    reading.slope === null ? 0 : Math.abs(reading.slope) < MTF_SLOPE_MIN ? 0 : sign(reading.slope)
  const rsi =
    reading.rsi === null
      ? 0
      : reading.rsi >= MTF_RSI_NEUTRAL_HIGH
        ? 1
        : reading.rsi <= MTF_RSI_NEUTRAL_LOW
          ? -1
          : 0
  return { di, slope, rsi, net: di + slope + rsi }
}

/**
 * The raw (unconfirmed) classification for one update.
 *
 * The quality gate is hysteretic: a score at or above 55 is a trend, below 45 is a range, and
 * between the two the previous regime stands — so a trend has to decay through the dead-band
 * before the window calls it a range, and a range has to earn its way past 55 to be called a
 * trend. Inside a trend the direction is the two-of-three vote; a trend the votes cannot agree
 * on a direction for reads as `range` — conflicted, not half-bullish.
 */
export function rawMtfTendency(
  reading: MtfRsiReading,
  previous: MtfTendencyState | null,
): MtfTendency | null {
  const score = reading.score
  if (score === null) return null
  if (score < MTF_TREND_EXIT_SCORE) return 'range'
  if (score >= MTF_TREND_ENTER_SCORE) {
    const votes = mtfDirectionVotes(reading)
    if (votes.net >= 2) return 'bullish'
    if (votes.net <= -2) return 'bearish'
    return 'range'
  }
  return previous?.tendency ?? 'range'
}

/**
 * The confirmed-tendency state machine. A call only changes after
 * `MTF_TENDENCY_CONFIRMATIONS` consecutive updates carrying a different raw classification,
 * so one loud tick cannot repaint the verdict — and a genuine shift is only ever one update
 * behind. A missing raw (not enough history, dead feed) leaves the state untouched.
 */
export function advanceMtfTendency(
  raw: MtfTendency | null,
  previous: MtfTendencyState | null,
): MtfTendencyState {
  if (raw === null) return previous ?? { tendency: 'range', lastRaw: null, streak: 0 }
  if (!previous) return { tendency: raw, lastRaw: raw, streak: 0 }
  if (raw === previous.tendency) return { tendency: raw, lastRaw: raw, streak: 0 }
  const streak = raw === previous.lastRaw ? previous.streak + 1 : 1
  const tendency = streak >= MTF_TENDENCY_CONFIRMATIONS ? raw : previous.tendency
  return { tendency, lastRaw: raw, streak }
}

/** Read a reading through the state machine: raw classification in, confirmed verdict out. */
export function classifyMtfRsi(
  reading: MtfRsiReading,
  previous: MtfTendencyState | null,
): { verdict: MtfRsiVerdict; state: MtfTendencyState } {
  const state = advanceMtfTendency(rawMtfTendency(reading, previous), previous)
  const score = reading.score
  const strength: MtfStrength =
    score !== null && score >= MTF_TREND_ENTER_SCORE + 20
      ? 'strong'
      : score !== null && score >= MTF_TREND_ENTER_SCORE
        ? 'moderate'
        : 'weak'
  return { verdict: { tendency: state.tendency, strength, score }, state }
}

/**
 * How heavily each timeframe counts in the overall bias. Higher timeframes lead — the top-down
 * rule every multi-timeframe methodology agrees on — on a plain arithmetic ladder (1 through 5,
 * so the 1h carries five times the 1m's vote). Two agreeing higher timeframes can therefore
 * call the bias against all three lower ones, and a lone fast-timeframe signal cannot.
 */
export const MTF_TENDENCY_WEIGHTS: Record<MtfRsiTimeframe, number> = {
  '1m': 1,
  '5m': 2,
  '15m': 3,
  '30m': 4,
  '1h': 5,
}

export interface MtfAlignment {
  bias: 'bullish' | 'bearish' | 'mixed' | 'unavailable'
  /** Timeframes with a confirmed tendency, out of those with any data. */
  trending: number
  /** Timeframes whose feed produced a classification at all. */
  classified: number
  /** Share of the weighted tendency mass that is bullish / bearish, 0..1. */
  bullShare: number
  bearShare: number
}

/**
 * The window's one-line summary: higher timeframes weigh more (see MTF_TENDENCY_WEIGHTS),
 * ranges abstain outright — they are the absence of a call, not a vote against one — and a
 * bias needs a 60% supermajority of the weighted tendency mass, with anything less reported
 * honestly as mixed.
 */
export function mtfAlignment(
  verdicts: Partial<Record<MtfRsiTimeframe, MtfTendency | null>>,
): MtfAlignment {
  let bull = 0
  let bear = 0
  let total = 0
  let trending = 0
  let classified = 0
  for (const timeframe of MTF_RSI_TIMEFRAMES) {
    const tendency = verdicts[timeframe]
    if (!tendency) continue
    classified++
    if (tendency === 'range') continue
    trending++
    const weight = MTF_TENDENCY_WEIGHTS[timeframe]
    total += weight
    if (tendency === 'bullish') bull += weight
    else bear += weight
  }
  if (total === 0)
    return { bias: 'unavailable', trending: 0, classified: 0, bullShare: 0, bearShare: 0 }
  const bullShare = bull / total
  const bearShare = bear / total
  const bias = bullShare >= 0.6 ? 'bullish' : bearShare >= 0.6 ? 'bearish' : ('mixed' as const)
  return { bias, trending, classified, bullShare, bearShare }
}

/** Compact per-row detail for a tooltip — every input that went into the call, on one line. */
export function mtfReadingDetail(reading: MtfRsiReading, verdict: MtfRsiVerdict): string {
  const parts: string[] = []
  parts.push(reading.rsi !== null ? `RSI ${reading.rsi.toFixed(1)}` : 'RSI warming up')
  if (reading.adx !== null) parts.push(`ADX ${reading.adx.toFixed(1)}`)
  if (reading.plusDi !== null && reading.minusDi !== null)
    parts.push(`+DI ${reading.plusDi.toFixed(1)} / −DI ${reading.minusDi.toFixed(1)}`)
  if (reading.efficiency !== null) parts.push(`efficiency ${reading.efficiency.toFixed(2)}`)
  if (reading.slope !== null)
    parts.push(`slope ${reading.slope >= 0 ? '+' : ''}${(reading.slope * 100).toFixed(1)}% ATR/bar`)
  if (reading.score !== null) parts.push(`quality ${reading.score.toFixed(0)}/100`)
  const votes = mtfDirectionVotes(reading)
  parts.push(`votes D${votes.di} S${votes.slope} R${votes.rsi}`)
  parts.push(`${verdict.tendency} · ${verdict.strength}`)
  parts.push(`${reading.bars} bars`)
  return parts.join(' · ')
}

/** Whole seconds one bar of a timeframe spans — used to explain the ladder in the sub-line. */
export function mtfTimeframeSeconds(timeframe: MtfRsiTimeframe): number {
  return INTERVAL_SECONDS[timeframe]
}
