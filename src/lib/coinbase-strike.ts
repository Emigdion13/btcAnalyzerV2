import type { Candle, Indicator, Plot } from './types'
import { formatPrice } from './market'

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

export function coinbaseStrikePlots(candles: Candle[], indicator: Indicator): Plot[] {
  const settings = coinbaseStrikeSettings(indicator)
  const result = calculateCoinbaseStrike(candles, settings)

  const plots: Plot[] = [
    {
      title: `Strike (${settings.intervalMinutes}m)`,
      color: settings.strikeColor,
      values: result.strikeLine,
      pane: 'price',
      lineWidth: 2,
    },
  ]

  if (settings.showTargets && settings.buffer > 0) {
    plots.push({
      title: `Strike +$${formatPrice(settings.buffer, false)}`,
      color: settings.upColor,
      values: result.upperTarget,
      pane: 'price',
      lineWidth: 1,
    })
    plots.push({
      title: `Strike -$${formatPrice(settings.buffer, false)}`,
      color: settings.downColor,
      values: result.lowerTarget,
      pane: 'price',
      lineWidth: 1,
    })
  }

  return plots
}
