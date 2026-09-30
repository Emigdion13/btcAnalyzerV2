/**
 * Support/resistance levels and how strong they are — measured, not assumed.
 *
 * The level pickers here are the ones the market agents have always used: the nearest intact
 * ChartPrime SR box first, the nearest 2-bar fractal pivot as the fallback. What changed is what
 * `strength` means. It used to be a hand-weighted blend of fill opacity, recency, volume, touches
 * and book bucket; replayed on real Coinbase BTC-USD tape, that blend did not separate levels that
 * held from levels that broke (AUC 0.50–0.53 on every timeframe).
 *
 * `strength` is now the level's measured edge over a random price: how much more often a tested
 * level of this kind held on this timeframe than a price picked at random the same distance away,
 * counted only once that edge clears its own 95% confidence interval. On the tape measured so far
 * no level kind clears it on any timeframe, so every level reads strength 0 until the numbers in
 * {@link LEVEL_HOLD_RATES} say otherwise. See `docs/level-strength.md` for the study.
 */
import { scoreZone, type BookStrengthBucket } from '../../shared/order-book'
import type { OrderBookView } from '../../shared/coinbase'
import { calculateSrBreaksRetests } from './sr-breaks-retests'
import { SR_BREAKS_RETESTS_DEFAULTS, type Candle, type Timeframe } from './types'

export type LevelSide = 'support' | 'resistance'
export type LevelSource = 'sr-zone' | 'pivot'

export interface LevelReference {
  price: number
  top: number
  bottom: number
  source: LevelSource
  /** Measured edge over a random price, 0..1 — see {@link levelStrength}. */
  strength: number
  /** How often a tested level of this kind held on this timeframe. */
  holdRate: number
  /** How often a random price the same distance away held under the same test. */
  randomHoldRate: number
  distanceAtr: number
  touches: number
  state?: 'intact' | 'broken'
  bookBucket?: BookStrengthBucket
  bookNotional?: number
}

interface MeasuredRate {
  /** Share of tests that held. */
  rate: number
  /** Tests graded. */
  n: number
}

export interface LevelHoldRates {
  random: MeasuredRate
  pivot: MeasuredRate
  srZone: MeasuredRate
}

/**
 * Hold rates measured on Coinbase BTC-USD, 2026-09-29, by `level-hold.backtest.test.ts`:
 * 1m 30 days, 3m 30 days, 5m/15m/30m 180 days, 1h/2h/4h two years, 1D/1W ten years.
 *
 * A test starts on the first bar that trades through the level's price after closing on the near
 * side of it. It holds if price then trades 1 ATR(14) back away from the level before trading
 * 1 ATR through it, within 60 bars; the touch bar itself can only break. The random control is a
 * price 0.05–1.5 ATR from the close, graded the same way. Under a minute of chop both sides lose
 * slightly more than half, which is why every rate sits under 50%.
 */
export const LEVEL_HOLD_RATES: Record<Timeframe, LevelHoldRates> = {
  '1m': {
    random: { rate: 0.42, n: 25326 },
    pivot: { rate: 0.419, n: 24869 },
    srZone: { rate: 0.415, n: 2163 },
  },
  '3m': {
    random: { rate: 0.456, n: 8417 },
    pivot: { rate: 0.446, n: 8848 },
    srZone: { rate: 0.45, n: 803 },
  },
  '5m': {
    random: { rate: 0.459, n: 30538 },
    pivot: { rate: 0.459, n: 30908 },
    srZone: { rate: 0.449, n: 3064 },
  },
  '15m': {
    random: { rate: 0.472, n: 10034 },
    pivot: { rate: 0.472, n: 9738 },
    srZone: { rate: 0.449, n: 859 },
  },
  '30m': {
    random: { rate: 0.474, n: 4938 },
    pivot: { rate: 0.475, n: 4881 },
    srZone: { rate: 0.431, n: 504 },
  },
  '1h': {
    random: { rate: 0.479, n: 10099 },
    pivot: { rate: 0.476, n: 10146 },
    srZone: { rate: 0.429, n: 895 },
  },
  '2h': {
    random: { rate: 0.473, n: 4928 },
    pivot: { rate: 0.476, n: 5062 },
    srZone: { rate: 0.474, n: 407 },
  },
  '4h': {
    random: { rate: 0.471, n: 2415 },
    pivot: { rate: 0.483, n: 2452 },
    srZone: { rate: 0.486, n: 255 },
  },
  '1D': {
    random: { rate: 0.464, n: 2111 },
    pivot: { rate: 0.47, n: 1680 },
    srZone: { rate: 0.392, n: 102 },
  },
  '1W': {
    random: { rate: 0.455, n: 145 },
    pivot: { rate: 0.409, n: 110 },
    srZone: { rate: 0, n: 6 },
  },
}

/** An edge this large over a random price reads as full strength. */
export const LEVEL_EDGE_FULL_SCALE = 0.1

export function levelHoldRate(timeframe: Timeframe, source: LevelSource): MeasuredRate {
  const rates = LEVEL_HOLD_RATES[timeframe] ?? LEVEL_HOLD_RATES['5m']
  return source === 'pivot' ? rates.pivot : rates.srZone
}

export function randomHoldRate(timeframe: Timeframe): MeasuredRate {
  return (LEVEL_HOLD_RATES[timeframe] ?? LEVEL_HOLD_RATES['5m']).random
}

/**
 * A level kind's strength on a timeframe: its hold-rate edge over a random price, after
 * subtracting the 95% margin of that difference, scaled so a 10-point edge reads 1.
 * An edge the sample cannot tell apart from noise is 0.
 */
export function levelStrength(timeframe: Timeframe, source: LevelSource): number {
  const level = levelHoldRate(timeframe, source)
  const random = randomHoldRate(timeframe)
  if (level.n < 1 || random.n < 1) return 0
  const margin =
    1.96 *
    Math.sqrt(
      (level.rate * (1 - level.rate)) / level.n + (random.rate * (1 - random.rate)) / random.n,
    )
  return clamp((level.rate - random.rate - margin) / LEVEL_EDGE_FULL_SCALE, 0, 1)
}

export type LevelTestOutcome = 'held' | 'broke'

/** Bars a test may take to resolve before it is dropped as undecided. */
export const LEVEL_TEST_HORIZON_BARS = 60

/**
 * Grade one test of a level that bar `touchIndex` traded into. It holds if price trades
 * `reachAtr` back away from the level before trading `reachAtr` through it. The touch bar can
 * only break — its high came before its low for all a bar can tell. Null while undecided.
 */
export function gradeLevelTest(
  candles: Candle[],
  touchIndex: number,
  level: number,
  side: LevelSide,
  atrValue: number,
  reachAtr = 1,
  horizonBars = LEVEL_TEST_HORIZON_BARS,
): LevelTestOutcome | null {
  const reach = reachAtr * atrValue
  const end = Math.min(candles.length, touchIndex + horizonBars)
  for (let i = touchIndex; i < end; i++) {
    const candle = candles[i]
    const through = side === 'support' ? candle.low <= level - reach : candle.high >= level + reach
    if (through) return 'broke'
    if (i === touchIndex) continue
    const away = side === 'support' ? candle.high >= level + reach : candle.low <= level - reach
    if (away) return 'held'
  }
  return null
}

/** Wilder ATR, seeded with the SMA of the first `period` true ranges. */
export function wilderAtr(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null)
  let seed = 0
  let averageRange: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const range =
      i === 0
        ? candle.high - candle.low
        : Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - candles[i - 1].close),
            Math.abs(candle.low - candles[i - 1].close),
          )
    if (i < period - 1) {
      seed += range
      continue
    }
    if (i === period - 1) {
      seed += range
      averageRange = seed / period
    } else averageRange = (averageRange! * (period - 1) + range) / period
    out[i] = averageRange
  }
  return out
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function countTouches(
  candles: Candle[],
  level: number,
  tolerance: number,
  side: LevelSide,
): number {
  let touches = 0
  for (const candle of candles.slice(-80)) {
    if (side === 'support') {
      if (candle.low <= level + tolerance && candle.low >= level - tolerance) touches++
    } else if (candle.high >= level - tolerance && candle.high <= level + tolerance) touches++
  }
  return touches
}

function measured(timeframe: Timeframe, source: LevelSource) {
  return {
    strength: levelStrength(timeframe, source),
    holdRate: levelHoldRate(timeframe, source).rate,
    randomHoldRate: randomHoldRate(timeframe).rate,
  }
}

/** The nearest 2-bar fractal pivot high above price and pivot low below it. */
export function pivotLevels(
  candles: Candle[],
  atrValue: number,
  currentPrice: number,
  timeframe: Timeframe,
) {
  const tolerance = atrValue * 0.25
  const rated = measured(timeframe, 'pivot')
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
    if (pivotHigh && value.high > currentPrice)
      highs.push({
        price: value.high,
        top: value.high + tolerance,
        bottom: value.high - tolerance,
        source: 'pivot',
        ...rated,
        distanceAtr: (value.high - currentPrice) / Math.max(atrValue, 1e-9),
        touches: countTouches(candles, value.high, tolerance, 'resistance'),
      })
    if (pivotLow && value.low < currentPrice)
      lows.push({
        price: value.low,
        top: value.low + tolerance,
        bottom: value.low - tolerance,
        source: 'pivot',
        ...rated,
        distanceAtr: (currentPrice - value.low) / Math.max(atrValue, 1e-9),
        touches: countTouches(candles, value.low, tolerance, 'support'),
      })
  }
  return {
    nearestResistance: highs.sort((a, b) => a.distanceAtr - b.distanceAtr)[0] ?? null,
    nearestSupport: lows.sort((a, b) => a.distanceAtr - b.distanceAtr)[0] ?? null,
  }
}

/** The nearest intact SR box on one side of price, priced against the resting book when there is one. */
export function levelFromSrZone(
  candles: Candle[],
  book: OrderBookView | null | undefined,
  atrValue: number,
  currentPrice: number,
  side: LevelSide,
  timeframe: Timeframe,
): LevelReference | null {
  const result = calculateSrBreaksRetests(candles, SR_BREAKS_RETESTS_DEFAULTS)
  const zone = result.zones
    .filter((candidate) => candidate.side === side && candidate.state === 'intact')
    .filter((candidate) =>
      side === 'support' ? candidate.level < currentPrice : candidate.level > currentPrice,
    )
    .sort(
      (a, b) =>
        Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice) ||
        b.fillOpacity - a.fillOpacity,
    )[0]
  if (!zone) return null
  const fallbackHalfWidth = Math.max(atrValue * 0.4, currentPrice * 0.001)
  const bottom = side === 'support' ? (zone.boundary ?? zone.level - fallbackHalfWidth) : zone.level
  const top = side === 'support' ? zone.level : (zone.boundary ?? zone.level + fallbackHalfWidth)
  const bookScore = book
    ? scoreZone(
        book,
        Math.max(top, bottom),
        Math.min(top, bottom),
        side === 'support' ? 'bid' : 'ask',
      )
    : null
  return {
    price: zone.level,
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
    source: 'sr-zone',
    ...measured(timeframe, 'sr-zone'),
    distanceAtr:
      side === 'support'
        ? (currentPrice - zone.level) / Math.max(atrValue, 1e-9)
        : (zone.level - currentPrice) / Math.max(atrValue, 1e-9),
    touches: countTouches(candles, zone.level, atrValue * 0.25, side),
    state: zone.state,
    bookBucket: bookScore?.bucket,
    bookNotional: bookScore?.notional,
  }
}

/** The levels the agents read: the nearest SR box on each side, else the nearest pivot. */
export function nearestLevels(
  candles: Candle[],
  atrValue: number,
  currentPrice: number,
  timeframe: Timeframe,
  book?: OrderBookView | null,
) {
  const pivots = pivotLevels(candles, atrValue, currentPrice, timeframe)
  const zoneSupport = levelFromSrZone(candles, book, atrValue, currentPrice, 'support', timeframe)
  const zoneResistance = levelFromSrZone(
    candles,
    book,
    atrValue,
    currentPrice,
    'resistance',
    timeframe,
  )
  return {
    support: zoneSupport ?? pivots.nearestSupport,
    resistance: zoneResistance ?? pivots.nearestResistance,
    pivots,
    zones: { support: zoneSupport, resistance: zoneResistance },
  }
}
