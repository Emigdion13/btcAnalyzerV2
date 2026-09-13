/**
 * Price forecast — the forward half of the main-chart AI.
 *
 * The specialists in `market-agents.ts` read what the tape is doing *now*. This
 * module turns those reads into the question a trader actually has to answer:
 * over the next N bars, where does price go, and does it finish above or below
 * the strike line that is drawn on the chart?
 *
 * The projection is deliberately explicit and falsifiable rather than a black
 * box. Each specialist keeps its own read (score, confidence, regime) and gains
 * a horizon forecast:
 *
 * - `driftAtr` — the move its evidence is worth over the horizon, in ATR units.
 *   A fast read (a whale sweep, a momentum pop) is worth its full carry only
 *   for the couple of bars it lasts, so it decays by sqrt(persistence/horizon);
 *   a slow read (trend, higher-timeframe context) keeps pushing across the
 *   whole horizon. The result is capped at a third of the excursion price can
 *   be expected to travel over that many bars, so no single agent can invent a
 *   trend that is not there.
 * - `finishAboveProbability` — the chance the horizon close sits above the
 *   pinned strike, from a drift-plus-volatility walk: Φ((Δ + μ) / √h), where Δ
 *   is the distance to the strike in ATR, μ the expected drift in ATR and √h
 *   the horizon's move scale. One ATR per bar is the volatility stand-in.
 * - `strikeTouchProbability` / `strikeBars` — the chance the strike is *traded
 *   through* at some point before the horizon closes (a first-passage/barrier
 *   probability, so a touch can count even when the finish is on the other
 *   side), and the first bar by which that is more likely than not.
 * - `touchVerdict` — what the strike does when it is reached: hold or break,
 *   judged by how much funding sits at that price (levels, resting book) and by
 *   how far past it the expected path carries.
 *
 * The director then weights the specialists with the same learned trust the
 * live ensemble uses and reports the ensemble horizon call: the expected finish
 * and its band, the strike probability, the path shape (continuation, reversal,
 * range, squeeze), the timeline of what happens next, and the reasons and risks
 * behind it.
 *
 * This is a model, stated as one: recent ATR scaled by √bars, Gaussian tails,
 * no regime switching, no news. It is recorded in the journal and graded
 * against what actually printed, and nothing here places trades.
 */
import { formatPrice } from './market'
import type {
  AgentBias,
  AgentOpinion,
  LevelStrengthSummary,
  MarketRegime,
  SpecializedAgentId,
} from './market-agents'
import type { Candle, Timeframe } from './types'

export type ForecastPath = 'continuation' | 'reversal' | 'range' | 'squeeze'
export type ForecastThrust = 'strong' | 'mild' | 'fade'
export type TouchVerdict = 'hold' | 'break' | 'none'
export type StrikeCall = 'above' | 'below' | 'none'
export type FinishSide = 'above' | 'below'

/** The strike line pinned by the forecast: the level, its window and its clock. */
export interface PinnedStrike {
  price: number
  windowStart: number
  windowEnd: number
  secondsLeft: number
  expiryLabel: string
  provisional: boolean
  /** Where the level came from: the strike indicator's interval, a custom level, or the window. */
  label: string
}

/** One specialist's read of the horizon. */
export interface AgentForecast {
  /** Expected net move over the horizon, signed, in ATR units. */
  driftAtr: number
  /** Probability the horizon close is above the strike; null with no strike. */
  finishAboveProbability: number | null
  /** Probability the strike is traded through before the horizon closes. */
  strikeTouchProbability: number | null
  /** Whether that chance is at least even. */
  strikeTouch: boolean
  /** First bar by which touching the strike is more likely than not. */
  strikeBars: number | null
  /** What the strike does if it is reached. */
  touchVerdict: TouchVerdict
  path: ForecastPath
  thrust: ForecastThrust
  /** Confidence in this agent's horizon read, in [0, 1]. */
  confidence: number
}

export interface ForecastStep {
  title: string
  detail: string
}

export interface PriceForecastInput {
  candles: Candle[]
  timeframe: Timeframe
  /** Bars ahead that this forecast answers for. */
  horizonBars: number
  /** Seconds per chart bar, so the target time lands on the chart's own grid. */
  barSeconds: number
  price: number
  atr: number
  regime: MarketRegime
  specialists: AgentOpinion[]
  levels: LevelStrengthSummary
  /** Learned trust weight per specialist, already regime/timeframe-adjusted. */
  weights: Map<SpecializedAgentId, number>
  strike: PinnedStrike | null
  /** Anchor bar time (the last closed candle). */
  anchorTime: number
}

export interface PriceForecastSnapshot {
  price: number
  atr: number
  horizonBars: number
  targetTime: number
  /** Horizon move scale in ATR units: √bars. */
  sigmaAtr: number
  /** Ensemble expected drift over the horizon, in ATR units. */
  driftAtr: number
  strike: number | null
  strikeLabel: string | null
  strikeSide: FinishSide | null
  strikeDeltaAtr: number | null
  strikeProvisional: boolean
  strikeExpiryLabel: string | null
  secondsLeft: number | null
}

export interface PriceForecast {
  timeframe: Timeframe
  horizonBars: number
  targetTime: number
  /** Ensemble expected close, and the band one move scale wide either side of it. */
  expectedPrice: number
  expectedMoveAtr: number
  targetLow: number
  targetHigh: number
  /** Chance the horizon close sits above the strike; null without one. */
  finishAboveProbability: number | null
  strikeCall: StrikeCall
  /** Probability of the leading side — the number behind the call. */
  strikeCallProbability: number | null
  strikeTouchProbability: number | null
  strikeTouch: boolean
  strikeBars: number | null
  touchVerdict: TouchVerdict
  /** Chance the horizon's own extremes reach the nearest known levels. */
  supportReachProbability: number | null
  resistanceReachProbability: number | null
  path: ForecastPath
  thrust: ForecastThrust
  bias: AgentBias
  score: number
  confidence: number
  headline: string
  timeline: ForecastStep[]
  reasons: string[]
  risks: string[]
  /** Per-specialist horizon forecasts, in the specialists' own order. */
  agents: AgentForecast[]
  /** Text the UI can show about the model itself, so the number is never a black box. */
  modelNote: string
  snapshot: PriceForecastSnapshot
}

/** How each specialist's read carries into the horizon. */
interface ProjectionProfile {
  /** Drift the read is worth, in ATR, when it carries the whole horizon. */
  carryAtr: number
  /** Bars its evidence keeps pushing at full strength before it fades. */
  persistenceBars: number
}

const PROJECTION: Record<SpecializedAgentId, ProjectionProfile> = {
  regime: { carryAtr: 0.85, persistenceBars: 18 },
  trend: { carryAtr: 1.15, persistenceBars: 30 },
  momentum: { carryAtr: 0.8, persistenceBars: 5 },
  macd: { carryAtr: 0.85, persistenceBars: 7 },
  'level-strength': { carryAtr: 0.7, persistenceBars: 30 },
  structure: { carryAtr: 0.7, persistenceBars: 30 },
  whale: { carryAtr: 0.5, persistenceBars: 2 },
  context: { carryAtr: 1.05, persistenceBars: 60 },
}

/** No single specialist may project more than this share of a horizon's excursion. */
const EXCURSION_CAP = 0.35
/** Ensemble drift below this (in ATR) reads as a range rather than a move. */
const RANGE_DRIFT = 0.22
/** Drift at or above this (in ATR) is a strong push. */
const STRONG_DRIFT = 0.9
/** Drift at or above this (in ATR) is a real move rather than drift. */
const MILD_DRIFT = 0.35
/** Probability inside this band around one half is called a coin flip, not a side. */
const COIN_FLIP_BAND = 0.03
/** A level within this many ATR of the strike counts as funding the strike. */
const WALL_PROXIMITY_ATR = 0.6
/** Fast agents voting this hard against the slow trend turn the path into a reversal. */
const REVERSAL_OPPOSITION = 0.3

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Error function, Abramowitz & Stegun 7.1.26 — accurate well past what a price band needs. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Probability the horizon close is above the strike.
 *
 * Δ is the current distance to the strike in ATR (positive = price above), μ the
 * expected drift over the whole horizon in ATR, and √bars the move scale of the
 * horizon. With no distance and no drift this is exactly a coin flip.
 */
export function finishAboveProbability(deltaAtr: number, driftAtr: number, bars: number): number {
  const sigma = Math.sqrt(Math.max(bars, 1))
  return clamp(normalCdf((deltaAtr + driftAtr) / sigma), 0, 1)
}

/**
 * Probability a barrier `startAtr` away (in the opposite direction to the start)
 * is reached within `bars` — the first-passage probability of a drifting walk,
 * so a touch counts even when price ends up back on its own side afterwards.
 */
export function firstPassageProbability(startAtr: number, driftAtr: number, bars: number): number {
  const distance = Math.abs(startAtr)
  if (distance <= 1e-9) return 1
  const horizon = Math.max(bars, 1)
  const sigma = Math.sqrt(horizon)
  // Mirror the walk so the barrier sits above zero and the drift points at it, then use
  // the standard first-passage result for a drifting Brownian motion. Drift is per bar in
  // ATR units and the per-bar move scale is one ATR, so the exponential term is 2·μ·a.
  const toward = (startAtr > 0 ? -driftAtr : driftAtr) / horizon
  const z1 = (toward * horizon - distance) / sigma
  const z2 = (-toward * horizon - distance) / sigma
  const exponent = clamp(2 * toward * distance, -60, 60)
  return clamp(normalCdf(z1) + Math.exp(exponent) * normalCdf(z2), 0, 1)
}

/** First bar by which reaching the barrier is more likely than not, or null. */
export function firstPassageBars(startAtr: number, driftAtr: number, bars: number): number | null {
  if (firstPassageProbability(startAtr, driftAtr, bars) < 0.5) return null
  for (let step = 1; step <= bars; step++)
    if (firstPassageProbability(startAtr, driftAtr, step) >= 0.5) return step
  return bars
}

function thrustOf(driftAtr: number): ForecastThrust {
  const magnitude = Math.abs(driftAtr)
  if (magnitude >= STRONG_DRIFT) return 'strong'
  if (magnitude >= MILD_DRIFT) return 'mild'
  return 'fade'
}

/**
 * How much funding a price has behind it: the strength of the nearest level that
 * sits on it (fill density, touches, volume) reinforced by the resting book.
 */
function wallStrengthAt(levels: LevelStrengthSummary, price: number, atrValue: number): number {
  let best = 0
  for (const level of [levels.nearestSupport, levels.nearestResistance]) {
    if (!level) continue
    const distanceAtr = Math.abs(level.price - price) / Math.max(atrValue, 1e-9)
    if (distanceAtr > WALL_PROXIMITY_ATR) continue
    const book =
      level.bookBucket === 'strong'
        ? 0.8
        : level.bookBucket === 'medium'
          ? 0.5
          : level.bookBucket === 'weak'
            ? 0.25
            : 0
    const proximity = clamp(1 - distanceAtr / WALL_PROXIMITY_ATR, 0, 1)
    best = Math.max(best, clamp(level.strength * 0.7 + book * 0.5, 0, 1) * proximity)
  }
  return best
}

/** One agent's horizon forecast, from its live read and the market it is reading. */
function projectAgent(
  opinion: AgentOpinion,
  params: {
    bars: number
    deltaAtr: number | null
    wall: number
    cap: number
  },
): AgentForecast {
  const profile = PROJECTION[opinion.id as SpecializedAgentId] ?? {
    carryAtr: 0.8,
    persistenceBars: params.bars,
  }
  const decay = Math.sqrt(Math.min(1, profile.persistenceBars / Math.max(params.bars, 1)))
  const driftAtr = clamp(opinion.score * profile.carryAtr * decay, -params.cap, params.cap)
  const finishAbove =
    params.deltaAtr === null ? null : finishAboveProbability(params.deltaAtr, driftAtr, params.bars)
  const touchProbability =
    params.deltaAtr === null
      ? null
      : firstPassageProbability(params.deltaAtr, driftAtr, params.bars)
  const touchBars =
    params.deltaAtr === null ? null : firstPassageBars(params.deltaAtr, driftAtr, params.bars)
  const touch = touchProbability !== null && touchProbability >= 0.5
  const expectedFinish = params.deltaAtr === null ? null : params.deltaAtr + driftAtr
  const touchVerdict: TouchVerdict = !touch
    ? 'none'
    : expectedFinish !== null && (Math.abs(expectedFinish) >= 0.35 || params.wall < 0.4)
      ? 'break'
      : 'hold'
  return {
    driftAtr,
    finishAboveProbability: finishAbove,
    strikeTouchProbability: touchProbability,
    strikeTouch: touch,
    strikeBars: touchBars,
    touchVerdict,
    path: Math.abs(driftAtr) < RANGE_DRIFT ? 'range' : 'continuation',
    thrust: thrustOf(driftAtr),
    confidence: clamp(opinion.confidence * (0.55 + 0.45 * decay), 0, 1),
  }
}

/** Mean high-low range over the tail of the window, the compression baseline. */
function meanRange(candles: Candle[], bars: number): number {
  const slice = candles.slice(-Math.max(2, bars))
  const ranges = slice
    .map((candle) => candle.high - candle.low)
    .filter((value) => Number.isFinite(value) && value >= 0)
  if (!ranges.length) return 0
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length
}

function pathOf(driftAtr: number, specialists: AgentOpinion[], compressed: boolean): ForecastPath {
  if (Math.abs(driftAtr) < RANGE_DRIFT) return compressed ? 'squeeze' : 'range'
  const slowTrend = specialists.find((opinion) => opinion.id === 'trend')?.score ?? 0
  const driftSign = Math.sign(driftAtr)
  const trendSign = Math.sign(slowTrend)
  const fast = specialists
    .filter((opinion) => ['whale', 'momentum', 'macd'].includes(opinion.id))
    .map((opinion) => opinion.score)
  const opposition = fast.length
    ? fast.reduce(
        (sum, score) => sum + (Math.sign(score) === -driftSign ? Math.abs(score) : 0),
        0,
      ) / fast.length
    : 0
  if (trendSign !== 0 && driftSign !== trendSign && opposition >= REVERSAL_OPPOSITION)
    return 'reversal'
  return 'continuation'
}

function buildTimeline(
  forecast: Omit<PriceForecast, 'timeline'>,
  context: { strike: PinnedStrike | null; atr: number; wall: number; compression: boolean },
): ForecastStep[] {
  const { snapshot } = forecast
  const steps: ForecastStep[] = []
  const horizonLabel = `${forecast.horizonBars} bar${forecast.horizonBars === 1 ? '' : 's'}`
  const band = `${formatPrice(forecast.targetLow)} – ${formatPrice(forecast.targetHigh)}`
  const reach =
    forecast.strikeBars !== null
      ? `first touch odds pass even around bar ${forecast.strikeBars}`
      : 'a touch stays the less likely outcome'

  if (context.strike && snapshot.strikeDeltaAtr !== null) {
    const sideWord = snapshot.strikeSide === 'above' ? 'above' : 'below'
    const gapAtr = Math.abs(snapshot.strikeDeltaAtr).toFixed(2)
    // "an 8%" but "a 46%" — the article follows the number's sound, not its spelling.
    const touchPercent = Math.round((forecast.strikeTouchProbability ?? 0) * 100)
    const article = /^(8|11|18|80|81|82|83|84|85|86|87|88|89)$/.test(String(touchPercent))
      ? 'an'
      : 'a'
    steps.push({
      title: `Bars 1–${Math.max(1, Math.min(forecast.horizonBars, forecast.strikeBars ?? 3))} · ${forecast.strikeTouch ? 'test the strike' : 'hold the side'}`,
      detail: forecast.strikeTouch
        ? `Price is ${gapAtr} ATR ${sideWord} the ${formatPrice(context.strike.price, true)} strike and the ${horizonLabel} give the level ${article} ${touchPercent}% chance of being traded through — ${reach}.`
        : `Price is ${gapAtr} ATR ${sideWord} the ${formatPrice(context.strike.price, true)} strike and the model expects the distance to hold: ${Math.round((1 - (forecast.strikeTouchProbability ?? 0)) * 100)}% against a touch before the close.`,
    })
    steps.push({
      title:
        forecast.touchVerdict === 'break'
          ? 'At the strike · expect a break'
          : forecast.touchVerdict === 'hold'
            ? 'At the strike · expect it to hold'
            : 'At the strike · not the fight',
      detail:
        forecast.touchVerdict === 'break'
          ? `The expected path carries ${Math.abs(snapshot.driftAtr).toFixed(2)} ATR past the level, and ${
              context.wall < 0.25
                ? 'nothing on the chart is funding that price'
                : `only a ${Math.round(context.wall * 100)}% wall sits behind it`
            }, so a test is read as a slice rather than a rejection.`
          : forecast.touchVerdict === 'hold'
            ? `Levels and resting book around ${formatPrice(context.strike.price, true)} fund the strike (a ${Math.round(context.wall * 100)}% wall), so a test is expected to reject before the close.`
            : 'No touch is expected, so what the strike would do on contact is not the question — the side is.',
    })
  } else {
    steps.push({
      title: `Bars 1–${Math.max(1, Math.ceil(forecast.horizonBars / 3))} · ${forecast.path === 'range' || forecast.path === 'squeeze' ? 'stay inside the range' : 'hold the push'}`,
      detail:
        forecast.path === 'squeeze'
          ? `Volatility is compressed (${context.atr.toFixed(2)} ATR per bar against a narrower recent range), so the near bars are read as a coil rather than a breakout.`
          : `The ensemble expects ${snapshot.driftAtr >= 0 ? '+' : ''}${snapshot.driftAtr.toFixed(2)} ATR of drift over the horizon, ${forecast.thrust === 'fade' ? 'which is barely a lean' : `a ${forecast.thrust} push`}.`,
    })
    steps.push({
      title: 'Levels in the way',
      detail:
        forecast.resistanceReachProbability !== null && forecast.supportReachProbability !== null
          ? `Nearest resistance has a ${Math.round(forecast.resistanceReachProbability * 100)}% chance of being reached inside the horizon, nearest support ${Math.round(forecast.supportReachProbability * 100)}%. Whichever is reached first is where the forecast is tested.`
          : 'No confirmed level sits inside reach of this horizon, so the forecast is running on volatility and drift alone.',
    })
  }

  steps.push({
    title: `Bar ${forecast.horizonBars} · finish`,
    detail: `Expected close ${formatPrice(forecast.expectedPrice)} with a one-scale band of ${band}.${
      forecast.finishAboveProbability !== null
        ? ` ${Math.round(forecast.finishAboveProbability * 100)}% of the band's mass is above the strike.`
        : ''
    }`,
  })
  return steps
}

function buildHeadline(forecast: Omit<PriceForecast, 'timeline'>): string {
  const bars = `${forecast.horizonBars} bar${forecast.horizonBars === 1 ? '' : 's'}`
  if (forecast.snapshot.strike !== null && forecast.finishAboveProbability !== null) {
    const price = formatPrice(forecast.snapshot.strike, true)
    if (forecast.strikeCall === 'none')
      return `Coin flip at the ${price} strike — ${Math.round(forecast.finishAboveProbability * 100)}% above in ${bars}`
    const side = forecast.strikeCall === 'above' ? 'Above' : 'Below'
    return `${side} the ${price} strike — ${Math.round((forecast.strikeCallProbability ?? 0.5) * 100)}% in ${bars}`
  }
  const lean =
    forecast.bias === 'bullish' ? 'Higher' : forecast.bias === 'bearish' ? 'Lower' : 'Sideways'
  return `${lean} over ${bars} — ${forecast.expectedMoveAtr >= 0 ? '+' : ''}${forecast.expectedMoveAtr.toFixed(2)} ATR expected`
}

/**
 * Build the horizon forecast: per-specialist projections, the director's
 * weighted call, the strike answer, the timeline and its honest caveats.
 */
export function buildPriceForecast(input: PriceForecastInput): PriceForecast {
  const { candles, specialists, levels, strike, horizonBars, price, atr } = input
  const bars = Math.max(1, Math.round(horizonBars))
  const sigmaAtr = Math.sqrt(bars)
  const cap = EXCURSION_CAP * sigmaAtr
  const deltaAtr = strike ? (price - strike.price) / Math.max(atr, 1e-9) : null
  const wall = strike ? wallStrengthAt(levels, strike.price, atr) : 0
  const compression = atr / Math.max(meanRange(candles, 50), 1e-9)
  const spacing = Math.max(1, input.barSeconds)
  const compressed = Number.isFinite(compression) && compression < 0.85

  const agents = specialists.map((opinion) => projectAgent(opinion, { bars, deltaAtr, wall, cap }))

  let weightedDrift = 0
  let totalWeight = 0
  let confidenceSum = 0
  let bullishWeight = 0
  let bearishWeight = 0
  specialists.forEach((opinion, index) => {
    const weight = input.weights.get(opinion.id as SpecializedAgentId) ?? 1
    const agent = agents[index]
    weightedDrift += agent.driftAtr * weight
    confidenceSum += agent.confidence * weight
    totalWeight += weight
    if (agent.driftAtr >= RANGE_DRIFT) bullishWeight += weight
    else if (agent.driftAtr <= -RANGE_DRIFT) bearishWeight += weight
  })
  const driftAtr = totalWeight > 0 ? clamp(weightedDrift / totalWeight, -cap, cap) : 0
  const agreement =
    bullishWeight + bearishWeight > 0
      ? Math.abs(bullishWeight - bearishWeight) / (bullishWeight + bearishWeight)
      : 0
  const averageAgentConfidence = totalWeight > 0 ? confidenceSum / totalWeight : 0.3

  const finishAbove = deltaAtr === null ? null : finishAboveProbability(deltaAtr, driftAtr, bars)
  const touchProbability =
    deltaAtr === null ? null : firstPassageProbability(deltaAtr, driftAtr, bars)
  const touchBars = deltaAtr === null ? null : firstPassageBars(deltaAtr, driftAtr, bars)
  const strikeTouch = touchProbability !== null && touchProbability >= 0.5

  const expectedPrice = price + driftAtr * atr
  const targetLow = expectedPrice - sigmaAtr * atr
  const targetHigh = expectedPrice + sigmaAtr * atr

  const strikeCall: StrikeCall =
    finishAbove === null
      ? 'none'
      : finishAbove >= 0.5 + COIN_FLIP_BAND
        ? 'above'
        : finishAbove <= 0.5 - COIN_FLIP_BAND
          ? 'below'
          : 'none'
  const strikeCallProbability = finishAbove === null ? null : Math.max(finishAbove, 1 - finishAbove)

  const reachProbability = (level: { price: number } | null) =>
    level === null
      ? null
      : firstPassageProbability((price - level.price) / Math.max(atr, 1e-9), driftAtr, bars)
  const supportReachProbability = reachProbability(levels.nearestSupport)
  const resistanceReachProbability = reachProbability(levels.nearestResistance)

  const path = pathOf(driftAtr, specialists, compressed)
  const thrust = thrustOf(driftAtr)
  const bias: AgentBias =
    strikeCall === 'above'
      ? 'bullish'
      : strikeCall === 'below'
        ? 'bearish'
        : driftAtr >= RANGE_DRIFT
          ? 'bullish'
          : driftAtr <= -RANGE_DRIFT
            ? 'bearish'
            : 'neutral'
  // The score keeps the ensemble's own meaning — directional conviction — in the horizon's terms.
  const score = clamp(driftAtr / (cap || 1), -1, 1)

  const expectedFinish = deltaAtr === null ? null : deltaAtr + driftAtr
  const touchVerdict: TouchVerdict = !strikeTouch
    ? 'none'
    : expectedFinish !== null && (Math.abs(expectedFinish) >= MILD_DRIFT || wall < 0.4)
      ? 'break'
      : 'hold'

  const callStrength =
    finishAbove === null ? Math.min(1, Math.abs(driftAtr) / 1.5) : Math.abs(finishAbove - 0.5) * 2
  const confidence = clamp(
    0.3 + callStrength * 0.34 + agreement * 0.2 + averageAgentConfidence * 0.16,
    0.2,
    0.97,
  )

  const targetTime = input.anchorTime + bars * spacing
  const draft: Omit<PriceForecast, 'timeline'> = {
    timeframe: input.timeframe,
    horizonBars: bars,
    targetTime,
    expectedPrice,
    expectedMoveAtr: driftAtr,
    targetLow,
    targetHigh,
    finishAboveProbability: finishAbove,
    strikeCall,
    strikeCallProbability,
    strikeTouchProbability: touchProbability,
    strikeTouch,
    strikeBars: touchBars,
    touchVerdict,
    supportReachProbability,
    resistanceReachProbability,
    path,
    thrust,
    bias,
    score,
    confidence,
    headline: '',
    reasons: [],
    risks: [],
    agents,
    modelNote:
      "Drift-and-volatility projection: each specialist's current read becomes an expected move in ATR, the ensemble weighs them with learned trust, and the strike probability is Φ((distance + drift) / √bars) — a Gaussian walk with ATR as the per-bar scale, one ATR per bar. Fat tails, news and regime breaks are not in it.",
    snapshot: {
      price,
      atr,
      horizonBars: bars,
      targetTime,
      sigmaAtr,
      driftAtr,
      strike: strike ? strike.price : null,
      strikeLabel: strike ? strike.label : null,
      strikeSide: deltaAtr === null ? null : deltaAtr >= 0 ? 'above' : 'below',
      strikeDeltaAtr: deltaAtr,
      strikeProvisional: strike ? strike.provisional : false,
      strikeExpiryLabel: strike ? strike.expiryLabel : null,
      secondsLeft: strike ? strike.secondsLeft : null,
    },
  }
  const timeline = buildTimeline(draft, { strike, atr, wall, compression: compressed })
  const withTimeline: PriceForecast = {
    ...draft,
    timeline,
    headline: buildHeadline(draft),
  }

  const risks = buildRisks(withTimeline, specialists)
  if (strike && strike.windowEnd - strike.windowStart <= spacing)
    risks.push(
      "The strike window is narrower than one candle on this chart, so the line resets every bar — read the call as finishing above this candle's open, not above a fixed level.",
    )
  return { ...withTimeline, reasons: buildReasons(withTimeline, specialists), risks }
}

function buildReasons(forecast: PriceForecast, specialists: AgentOpinion[]): string[] {
  const reasons: string[] = []
  const { snapshot } = forecast
  const bars = `${forecast.horizonBars} bar${forecast.horizonBars === 1 ? '' : 's'}`
  if (snapshot.strike !== null && forecast.finishAboveProbability !== null) {
    const side = snapshot.strikeSide === 'above' ? 'above' : 'below'
    const delta = `${snapshot.strikeDeltaAtr! >= 0 ? '+' : '−'}${Math.abs(snapshot.strikeDeltaAtr!).toFixed(2)} ATR`
    reasons.push(
      `Price sits ${delta} ${side} the ${formatPrice(snapshot.strike, true)} strike; over ${bars} the model puts ${Math.round(forecast.finishAboveProbability * 100)}% on the close finishing above it.`,
    )
    if (forecast.strikeTouch)
      reasons.push(
        `The strike is expected to be traded through${forecast.strikeBars ? ` around bar ${forecast.strikeBars}` : ''}, then ${forecast.touchVerdict === 'break' ? 'break' : 'reject'}.`,
      )
    else
      reasons.push(
        `The distance is expected to hold: ${Math.round((1 - (forecast.strikeTouchProbability ?? 0)) * 100)}% against the strike being touched before the close.`,
      )
  }
  reasons.push(
    `The ensemble projects ${forecast.expectedMoveAtr >= 0 ? '+' : '−'}${Math.abs(forecast.expectedMoveAtr).toFixed(2)} ATR of drift into ${formatPrice(forecast.expectedPrice)} — a ${forecast.thrust === 'fade' ? 'barely-there' : forecast.thrust} ${forecast.path.replace('-', ' ')}.`,
  )
  const aligned = [...specialists]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .filter((opinion) => Math.sign(opinion.score) === Math.sign(forecast.expectedMoveAtr || 1))
  for (const opinion of aligned.slice(0, 2)) {
    const reason = opinion.reasons[0]
    if (reason) reasons.push(`${opinion.label}: ${reason}`)
  }
  if (forecast.resistanceReachProbability !== null && forecast.resistanceReachProbability >= 0.25)
    reasons.push(
      `Nearest resistance is inside reach: ${Math.round(forecast.resistanceReachProbability * 100)}% chance of being tested inside the horizon.`,
    )
  if (forecast.supportReachProbability !== null && forecast.supportReachProbability >= 0.25)
    reasons.push(
      `Nearest support is inside reach: ${Math.round(forecast.supportReachProbability * 100)}% chance of being tested inside the horizon.`,
    )
  return reasons
}

function buildRisks(forecast: PriceForecast, specialists: AgentOpinion[]): string[] {
  const risks: string[] = []
  const { snapshot } = forecast
  if (forecast.strikeCall === 'none' && forecast.finishAboveProbability !== null)
    risks.push(
      `The strike call is inside the coin-flip band (${Math.round(forecast.finishAboveProbability * 100)}% above) — the model is not choosing a side here.`,
    )
  if (snapshot.strikeDeltaAtr !== null) {
    const band = forecast.snapshot.sigmaAtr
    if (band >= Math.abs(snapshot.strikeDeltaAtr) * 0.9)
      risks.push(
        `The horizon's own band (±${band.toFixed(2)} ATR) is wider than the distance to the strike (${Math.abs(snapshot.strikeDeltaAtr).toFixed(2)} ATR) — a small wiggle re-prices this call.`,
      )
  }
  const opposing = [...specialists]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .find((opinion) => Math.sign(opinion.score) === -Math.sign(forecast.expectedMoveAtr || 1))
  if (opposing)
    risks.push(
      `${opposing.label} still leans the other way (${opposing.score >= 0 ? '+' : ''}${opposing.score.toFixed(2)}): ${opposing.warnings[0] ?? opposing.reasons[0] ?? 'its read is not aligned with the horizon call.'}`,
    )
  if (snapshot.strikeProvisional)
    risks.push(
      'The strike is provisional — a live print standing in until a candle opens inside the window.',
    )
  if (forecast.path === 'squeeze')
    risks.push(
      'Volatility is compressed: a squeeze resolves in either direction, and this projection is a lean rather than a trigger.',
    )
  risks.push(
    'The projection assumes ATR keeps scaling as √bars. News, liquidation cascades and regime changes are outside the model.',
  )
  return risks.slice(0, 5)
}
