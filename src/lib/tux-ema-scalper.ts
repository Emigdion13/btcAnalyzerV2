import { ta } from './indicator-runtime'
import type { Candle, Indicator, Plot, TuxEmaScalperSettings } from './types'
import { TUX_EMA_SCALPER_DEFAULTS } from './types'

/** The published chart colors: EMA blue, bullish SuperTrend green, bearish pink. */
export const TUX_EMA_SCALPER_COLORS = {
  ema: '#3157a6',
  upTrend: '#35a86b',
  downTrend: '#d14b83',
  buy: '#39b978',
  sell: '#d14b83',
} as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export interface TuxEmaScalperSignal {
  index: number
  side: 'buy' | 'sell'
  time: number
  /** Candle low for BUY arrows and candle high for SELL arrows. */
  price: number
  close: number
  ema: number | null
  supertrend: number | null
  trend: 'up' | 'down' | null
}

export interface TuxEmaScalperResult {
  ema: (number | null)[]
  atr: (number | null)[]
  supertrend: (number | null)[]
  direction: (1 | -1 | null)[]
  upTrend: (number | null)[]
  downTrend: (number | null)[]
  signals: TuxEmaScalperSignal[]
  warmupBars: number
}

export function isTuxEmaScalperSettings(value: unknown): value is TuxEmaScalperSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.factor === 'number' &&
    Number.isFinite(s.factor) &&
    s.factor >= 0.1 &&
    s.factor <= 100 &&
    typeof s.atrPeriod === 'number' &&
    Number.isInteger(s.atrPeriod) &&
    s.atrPeriod >= 1 &&
    s.atrPeriod <= 2000 &&
    typeof s.emaLength === 'number' &&
    Number.isInteger(s.emaLength) &&
    s.emaLength >= 1 &&
    s.emaLength <= 2000 &&
    s.source === 'close' &&
    typeof s.showEma === 'boolean' &&
    typeof s.showSuperTrend === 'boolean' &&
    typeof s.showLabels === 'boolean' &&
    typeof s.buyColor === 'string' &&
    HEX_COLOR.test(s.buyColor) &&
    typeof s.sellColor === 'string' &&
    HEX_COLOR.test(s.sellColor)
  )
}

export function tuxEmaScalperSettings(indicator: Indicator): TuxEmaScalperSettings {
  const custom = indicator.tuxEmaScalper
  if (custom && isTuxEmaScalperSettings(custom)) return custom
  return {
    ...TUX_EMA_SCALPER_DEFAULTS,
    emaLength:
      Number.isInteger(indicator.period) && indicator.period >= 1 && indicator.period <= 2000
        ? indicator.period
        : TUX_EMA_SCALPER_DEFAULTS.emaLength,
    buyColor:
      typeof indicator.color === 'string' && HEX_COLOR.test(indicator.color)
        ? indicator.color
        : TUX_EMA_SCALPER_DEFAULTS.buyColor,
  }
}

export function tuxEmaScalperIndicatorLabel(indicator: Indicator): string {
  const s = tuxEmaScalperSettings(indicator)
  return `TUX EMA Scalper+SuperTrend (${s.factor}, ${s.atrPeriod}, ${s.emaLength}, ${s.source})`
}

/**
 * Wilder ATR used by the original SuperTrend family of scripts. The first
 * value is an SMA seed, then the standard RMA recurrence is used.
 */
function atr(candles: Candle[], period: number): (number | null)[] {
  const values: (number | null)[] = []
  let sum = 0
  let rma: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const previousClose = candles[i - 1]?.close
    const range =
      previousClose === undefined
        ? candles[i].high - candles[i].low
        : Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - previousClose),
            Math.abs(candles[i].low - previousClose),
          )
    if (i < period) {
      sum += range
      if (i === period - 1) rma = sum / period
    } else rma = (rma! * (period - 1) + range) / period
    values.push(rma)
  }
  return values
}

/**
 * Calculate the visible pieces of the protected TUX combination without
 * copying its closed source. It combines the public TonyUX EMA-cross idea
 * with the conventional ATR SuperTrend calculation:
 *
 * - BUY: close crosses above EMA(source, length) and is rising versus the
 *   previous close;
 * - SELL: close crosses below that EMA and is falling versus the previous
 *   close;
 * - SuperTrend is a directional context line, not a hidden signal filter.
 *   This matches the published description that calls the EMA mechanism the
 *   Buy/Sell signal and the SuperTrend an overlay.
 *
 * Signals are confirmed from the current candle's OHLC values. They do not
 * predict an unfinished candle; the live candle can therefore change its
 * arrow until it closes, just like a chart indicator.
 */
export function calculateTuxEmaScalper(
  candles: Candle[],
  settings: TuxEmaScalperSettings,
): TuxEmaScalperResult {
  if (!isTuxEmaScalperSettings(settings)) throw new Error('Invalid TUX EMA Scalper settings')
  if (!candles.length) {
    return {
      ema: [],
      atr: [],
      supertrend: [],
      direction: [],
      upTrend: [],
      downTrend: [],
      signals: [],
      warmupBars: Math.max(settings.atrPeriod, settings.emaLength),
    }
  }

  const midpoint = candles.map((c) => (c.high + c.low) / 2)
  const ema = ta.ema(
    candles.map((c) => c.close),
    settings.emaLength,
  )
  const atrValues = atr(candles, settings.atrPeriod)
  const basicUpper = midpoint.map((value, i) =>
    atrValues[i] === null ? null : value + settings.factor * atrValues[i]!,
  )
  const basicLower = midpoint.map((value, i) =>
    atrValues[i] === null ? null : value - settings.factor * atrValues[i]!,
  )
  const finalUpper: (number | null)[] = new Array(candles.length).fill(null)
  const finalLower: (number | null)[] = new Array(candles.length).fill(null)
  const supertrend: (number | null)[] = new Array(candles.length).fill(null)
  const direction: (1 | -1 | null)[] = new Array(candles.length).fill(null)

  for (let i = 0; i < candles.length; i++) {
    const upper = basicUpper[i]
    const lower = basicLower[i]
    if (upper === null || lower === null) continue

    const previousUpper = finalUpper[i - 1]
    const previousLower = finalLower[i - 1]
    finalUpper[i] =
      previousUpper === null || upper < previousUpper || candles[i - 1].close > previousUpper
        ? upper
        : previousUpper
    finalLower[i] =
      previousLower === null || lower > previousLower || candles[i - 1].close < previousLower
        ? lower
        : previousLower

    const previousSupertrend = supertrend[i - 1]
    const previousDirection = direction[i - 1]
    if (previousSupertrend === null || previousDirection === null) {
      // The first usable bar starts in the conventional down state. The next
      // confirmed close above its upper band can flip it to up.
      direction[i] = 1
    } else if (previousSupertrend === previousUpper) {
      direction[i] = candles[i].close > finalUpper[i]! ? -1 : 1
    } else {
      direction[i] = candles[i].close < finalLower[i]! ? 1 : -1
    }
    supertrend[i] = direction[i] === -1 ? finalLower[i] : finalUpper[i]
  }

  const upTrend = supertrend.map((value, i) => (direction[i] === -1 ? value : null))
  const downTrend = supertrend.map((value, i) => (direction[i] === 1 ? value : null))
  const signals: TuxEmaScalperSignal[] = []
  const closes = candles.map((c) => c.close)
  for (let i = 1; i < candles.length; i++) {
    const currentEma = ema[i]
    const previousEma = ema[i - 1]
    if (currentEma === null || previousEma === null) continue
    const buy = closes[i] > currentEma && closes[i - 1] <= previousEma && closes[i] > closes[i - 1]
    const sell = closes[i] < currentEma && closes[i - 1] >= previousEma && closes[i] < closes[i - 1]
    const side = buy ? 'buy' : sell ? 'sell' : null
    if (!side) continue
    signals.push({
      index: i,
      side,
      time: candles[i].time,
      price: side === 'buy' ? candles[i].low : candles[i].high,
      close: candles[i].close,
      ema: currentEma,
      supertrend: supertrend[i],
      trend: direction[i] === -1 ? 'up' : direction[i] === 1 ? 'down' : null,
    })
  }

  return {
    ema,
    atr: atrValues,
    supertrend,
    direction,
    upTrend,
    downTrend,
    signals,
    warmupBars: Math.max(settings.atrPeriod, settings.emaLength),
  }
}

export function tuxEmaScalperPlots(candles: Candle[], indicator: Indicator): Plot[] {
  const settings = tuxEmaScalperSettings(indicator)
  const result = calculateTuxEmaScalper(candles, settings)
  const plots: Plot[] = []
  if (settings.showEma) {
    plots.push({
      title: `EMA ${settings.emaLength}`,
      color: TUX_EMA_SCALPER_COLORS.ema,
      values: result.ema,
      pane: 'price',
      lineWidth: 2,
    })
  }
  if (settings.showSuperTrend) {
    plots.push(
      {
        title: 'SuperTrend Up',
        color: TUX_EMA_SCALPER_COLORS.upTrend,
        values: result.upTrend,
        pane: 'price',
        lineWidth: 2,
      },
      {
        title: 'SuperTrend Down',
        color: TUX_EMA_SCALPER_COLORS.downTrend,
        values: result.downTrend,
        pane: 'price',
        lineWidth: 2,
      },
    )
  }
  return plots
}
