import type { Candle, Indicator } from './types'
import {
  estimateStrikeFromCandles,
  KALSHI_WINDOW_SECONDS,
  type KalshiStrike,
  type KalshiStrikeSource,
} from '../../shared/kalshi'

export interface CoinbaseStrikeSettings {
  /** Contract interval in minutes: 5, 15, 30, 60, 240, 1440, etc. Default 15. */
  intervalMinutes: number
  /** Buffer / Target spread in USD (e.g. 50, 100). If 0, target buffer lines are hidden. */
  buffer: number
  /** Whether to show upper/lower target buffer lines. */
  showTargets: boolean
  /** Whether to display the live UP/DOWN status badge on the chart. */
  showStatusBadge: boolean
  /** Optional custom fixed strike price override (0 = auto interval open price). */
  customStrike: number
  /** Strike line color. Default: #f5a623 (amber). */
  strikeColor: string
  /** Bullish / UP winning color. Default: #2bb99b (emerald). */
  upColor: string
  /** Bearish / DOWN winning color. Default: #ed6773 (coral). */
  downColor: string
}

export const COINBASE_STRIKE_DEFAULTS: Readonly<CoinbaseStrikeSettings> = {
  intervalMinutes: 15,
  buffer: 50,
  showTargets: false,
  showStatusBadge: true,
  customStrike: 0,
  strikeColor: '#f5a623',
  upColor: '#2bb99b',
  downColor: '#ed6773',
}

export function isCoinbaseStrikeSettings(value: unknown): value is CoinbaseStrikeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.intervalMinutes === 'number' &&
    Number.isInteger(s.intervalMinutes) &&
    s.intervalMinutes >= 1 &&
    s.intervalMinutes <= 10080 &&
    typeof s.buffer === 'number' &&
    Number.isFinite(s.buffer) &&
    s.buffer >= 0 &&
    s.buffer <= 100000 &&
    typeof s.showTargets === 'boolean' &&
    typeof s.showStatusBadge === 'boolean' &&
    typeof s.customStrike === 'number' &&
    Number.isFinite(s.customStrike) &&
    s.customStrike >= 0 &&
    typeof s.strikeColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(s.strikeColor) &&
    typeof s.upColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(s.upColor) &&
    typeof s.downColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(s.downColor)
  )
}

export function coinbaseStrikeSettings(indicator: Indicator): CoinbaseStrikeSettings {
  const custom = indicator.strike
  if (custom && isCoinbaseStrikeSettings(custom)) return custom
  return {
    ...COINBASE_STRIKE_DEFAULTS,
    intervalMinutes:
      typeof indicator.period === 'number' && indicator.period >= 1
        ? indicator.period
        : COINBASE_STRIKE_DEFAULTS.intervalMinutes,
    strikeColor: indicator.color || COINBASE_STRIKE_DEFAULTS.strikeColor,
  }
}

export interface CoinbaseStrikeResult {
  strikeLine: (number | null)[]
  upperTarget: (number | null)[]
  lowerTarget: (number | null)[]
  currentStrike: number | null
  currentPrice: number | null
  delta: number | null
  deltaPercent: number | null
  isUp: boolean
  intervalStart: number
  intervalEnd: number
  timeRemainingSeconds: number
}

export interface CoinbaseStrikePriceLevel {
  role: 'strike' | 'upper-target' | 'lower-target'
  price: number
  color: string
  /** Only the strike gets a price-scale tag; target levels stay visually quiet. */
  axisLabelVisible: boolean
  title: string
}

export function calculateCoinbaseStrike(
  candles: Candle[],
  settings: CoinbaseStrikeSettings,
): CoinbaseStrikeResult {
  if (!candles.length) {
    return {
      strikeLine: [],
      upperTarget: [],
      lowerTarget: [],
      currentStrike: null,
      currentPrice: null,
      delta: null,
      deltaPercent: null,
      isUp: true,
      intervalStart: 0,
      intervalEnd: 0,
      timeRemainingSeconds: 0,
    }
  }

  const intervalSec = Math.max(60, settings.intervalMinutes * 60)
  const strikeLine: (number | null)[] = []
  const upperTarget: (number | null)[] = []
  const lowerTarget: (number | null)[] = []

  let activeStrike: number | null = null
  let activeIntervalStart = -1

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const intervalStart = Math.floor(candle.time / intervalSec) * intervalSec

    if (settings.customStrike > 0) {
      activeStrike = settings.customStrike
      activeIntervalStart = intervalStart
    } else if (intervalStart !== activeIntervalStart) {
      activeIntervalStart = intervalStart
      activeStrike = candle.open
    }

    strikeLine.push(activeStrike)

    if (settings.showTargets && activeStrike !== null && settings.buffer > 0) {
      upperTarget.push(activeStrike + settings.buffer)
      lowerTarget.push(activeStrike - settings.buffer)
    } else {
      upperTarget.push(null)
      lowerTarget.push(null)
    }
  }

  const lastCandle = candles[candles.length - 1]
  const currentStrike = strikeLine[strikeLine.length - 1] ?? null
  const currentPrice = lastCandle.close
  const delta = currentStrike !== null ? currentPrice - currentStrike : null
  const deltaPercent =
    currentStrike !== null && currentStrike > 0 && delta !== null
      ? (delta / currentStrike) * 100
      : null
  const isUp = delta !== null ? delta >= 0 : true

  const curIntervalStart = Math.floor(lastCandle.time / intervalSec) * intervalSec
  const curIntervalEnd = curIntervalStart + intervalSec
  const timeRemainingSeconds = Math.max(0, curIntervalEnd - lastCandle.time)

  return {
    strikeLine,
    upperTarget,
    lowerTarget,
    currentStrike,
    currentPrice,
    delta,
    deltaPercent,
    isUp,
    intervalStart: curIntervalStart,
    intervalEnd: curIntervalEnd,
    timeRemainingSeconds,
  }
}

/**
 * The strike the chart should actually draw, and where it came from.
 *
 * `calculateCoinbaseStrike` derives a strike from candle opens. That is a reasonable
 * local estimate, but it is NOT the number Kalshi settles against: Kalshi's rule is a
 * 60-second average of CF Benchmarks' real-time index, on a basket of venues, not a
 * single Coinbase print at the boundary. This resolver therefore prefers Kalshi's own
 * published `floor_strike` whenever it lines up with the window on screen, and falls
 * back to an estimate that at least averages the same 60 seconds — never to the raw
 * boundary open while a better estimate exists.
 *
 * Everything is reported side by side (authoritative price, estimate, naive open, and
 * the basis between them) so the UI can show its work instead of asserting a number.
 */
export interface ResolvedStrike {
  /** The price to draw. Null when nothing defensible exists. */
  price: number | null
  source: KalshiStrikeSource
  /** True when the price is Kalshi's published strike, or the user pinned it. */
  authoritative: boolean
  /** True when `settings.customStrike` pinned the level by hand. */
  manual: boolean
  /** Coinbase 60-second-average estimate, kept even when the published strike wins. */
  estimate: number | null
  /** The naive boundary-open strike the line used to draw. */
  naiveOpen: number | null
  /** `estimate − price`: the Coinbase↔index basis, in dollars. */
  basis: number | null
  windowStart: number
  windowEnd: number
  roundDigits: number
  /** Kalshi market ticker, e.g. "KXBTC15M-26SEP131715-15". */
  ticker: string | null
  /** Verbatim settlement rule, for the UI to show what is being measured. */
  rule: string | null
  /** Kalshi resolves a dead-even tie UP (`strike_type: greater_or_equal`). */
  tieGoesUp: boolean
}

export function resolveStrike(
  result: CoinbaseStrikeResult,
  kalshi: KalshiStrike | null,
  settings: CoinbaseStrikeSettings,
  candles: Candle[],
  intervalSeconds: number,
): ResolvedStrike {
  const windowStart = result.intervalStart
  const windowEnd = result.intervalEnd
  const manual = settings.customStrike > 0
  const naiveOpen = manual ? null : result.currentStrike
  const estimate = manual ? null : estimateStrikeFromCandles(candles, windowStart, intervalSeconds)

  const shared = {
    windowStart,
    windowEnd,
    estimate,
    naiveOpen,
    roundDigits: 2,
    ticker: null,
    rule: null,
    tieGoesUp: true,
  }

  if (manual)
    return {
      ...shared,
      price: settings.customStrike,
      source: 'estimate',
      authoritative: true,
      manual: true,
      basis: null,
    }

  // Kalshi's published strike only speaks to its own 15-minute ladder, and only to the
  // window currently on screen. Anything else is a mismatch, not an authority.
  const usable =
    kalshi !== null &&
    settings.intervalMinutes * 60 === KALSHI_WINDOW_SECONDS &&
    kalshi.windowStart === windowStart &&
    kalshi.windowEnd === windowEnd

  if (usable && kalshi)
    return {
      price: kalshi.strike,
      source: 'kalshi',
      authoritative: true,
      manual: false,
      estimate,
      naiveOpen,
      basis: estimate !== null ? estimate - kalshi.strike : null,
      windowStart: kalshi.windowStart,
      windowEnd: kalshi.windowEnd,
      roundDigits: kalshi.roundDigits,
      ticker: kalshi.ticker,
      rule: kalshi.rule || null,
      tieGoesUp: kalshi.tieGoesUp,
    }

  // No published strike: fall back to the averaged estimate, and only to the boundary
  // open when the candle grid is too coarse to average a 60-second window.
  return {
    ...shared,
    price: estimate ?? naiveOpen,
    source: 'estimate',
    authoritative: false,
    manual: false,
    basis: null,
  }
}

/**
 * Return only the active contract levels for native price-scale markers.
 * Historical strike arrays remain available in the calculation result for hover readouts, but
 * deliberately are not emitted as chart plots: the active strike belongs on the right price
 * scale, like the market's current-price marker.
 *
 * Pass a `resolved` strike to draw Kalshi's published number; omit it to keep the
 * purely Coinbase-derived behaviour.
 */
export function coinbaseStrikePriceLevels(
  result: CoinbaseStrikeResult,
  settings: CoinbaseStrikeSettings,
  resolved?: ResolvedStrike | null,
): CoinbaseStrikePriceLevel[] {
  const strike = resolved ? resolved.price : result.currentStrike
  if (strike === null) return []

  const levels: CoinbaseStrikePriceLevel[] = [
    {
      role: 'strike',
      price: strike,
      color: settings.strikeColor,
      axisLabelVisible: true,
      title: resolved?.authoritative ? 'KALSHI STRIKE' : 'STRIKE (EST)',
    },
  ]

  if (settings.showTargets && settings.buffer > 0) {
    levels.push({
      role: 'upper-target',
      price: strike + settings.buffer,
      color: settings.upColor,
      axisLabelVisible: false,
      title: '',
    })
    levels.push({
      role: 'lower-target',
      price: strike - settings.buffer,
      color: settings.downColor,
      axisLabelVisible: false,
      title: '',
    })
  }

  return levels
}
