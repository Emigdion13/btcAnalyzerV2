/**
 * Behavioral port of ChartPrime's "Support and Resistance (High Volume Boxes)",
 * published on TradingView under the short title "SR Breaks and Retests
 * [ChartPrime]" (MPL-2.0, © ChartPrime). Provenance: docs/sr-breaks-retests.md.
 *
 * This is an independent native TypeScript implementation of that indicator's
 * documented calculations and drawing rules - not a Pine interpreter and not a
 * copy of the original source text. The three published inputs (Lookback
 * Period, Delta Volume Filter Length, Adjust Box Width) map to `lookbackPeriod`,
 * `volumeFilterLength` and `boxWidth`; the original's fixed ATR(200), the
 * 25-bar gradient window and `max_boxes_count = 50` are exposed as settings so
 * the exact original profile stays reachable.
 */
import { SR_BREAKS_DEFAULTS } from './types'
import type { Candle, Indicator, SrBreaksSettings } from './types'

export const SR_BREAKS_SOURCE =
  'https://www.tradingview.com/script/Uz2AJ0i4-Support-and-Resistance-High-Volume-Boxes-ChartPrime/'

/** Pine's named `color.green` / `color.red`, plus the exact signal colors. */
export const SR_COLORS = {
  supportBorder: '#008000',
  supportFill: '#008000',
  resistanceBorder: '#ff0000',
  resistanceFill: '#ff0000',
  supportBroken: '#ff0000',
  resistanceBroken: '#008000',
  holdSupport: '#20ca26',
  holdResistance: '#e92929',
  breakSupportLabel: '#7e1e1e',
  breakResistanceLabel: '#2b6d2d',
  text: '#d7dce3',
} as const

/** Re-exported so callers can reach the defaults from either module. */
export const SR_DEFAULTS = SR_BREAKS_DEFAULTS

export type SrSide = 'support' | 'resistance'

export interface SrBox {
  id: string
  kind: SrSide
  /** Left edge: the pivot bar, `bar_index - lookbackPeriod` at creation. */
  startIndex: number
  /** Right edge in bar-index space; `candles.length` is one bar past the last candle. */
  endIndex: number
  /** The pivot close the level is drawn at. */
  level: number
  /** Outer edge: `level - width` for support, `level + width` for resistance. */
  outer: number
  /** Signed delta volume measured when the box was created. */
  volume: number
  /** 0..1 background opacity from the original `color.from_gradient` call. */
  fillOpacity: number
  /** Final palette state. Pine recolors the whole box object in place. */
  state: 'active' | 'broken'
}

export type SrSignalKind =
  'support-holds' | 'resistance-holds' | 'resistance-as-support' | 'support-as-resistance'

export interface SrSignal {
  /** Bar where the crossover/crossunder was detected. */
  index: number
  /** Bar the diamond is drawn on. The original plots with `offset = -1`. */
  plotIndex: number
  kind: SrSignalKind
  /** `location.abovebar` / `location.belowbar` anchor on the plotted bar. */
  price: number
}

export interface SrBreakLabel {
  /** Anchor bar: `bar_index[1]`, one bar before detection. */
  index: number
  /** `supportLevel[1]` / `resistanceLevel[1]` from the bar before detection. */
  price: number
  kind: SrSide
  text: 'Break Sup' | 'Break Res'
}

/**
 * The box caption: `math.round(Vol, 2)` in the original, abbreviated once the
 * number would no longer fit inside the box.
 */
export function srVolumeText(volume: number): string {
  const rounded = Math.round(volume * 100) / 100
  if (Math.abs(rounded) < 100000) return `Vol: ${rounded}`
  const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(rounded)
  return `Vol: ${compact}`
}

/** The four `plotchar` titles from the original, used for pointer tooltips. */
export const SR_SIGNAL_TITLES: Record<SrSignalKind, string> = {
  'support-holds': 'Support Holds',
  'resistance-holds': 'Resistance Holds',
  'resistance-as-support': 'Resistance as Support Holds',
  'support-as-resistance': 'Support as Resistance Holds',
}

export interface SrBreaksResult {
  boxes: SrBox[]
  signals: SrSignal[]
  labels: SrBreakLabel[]
  /** Signed per-bar volume: `+volume` on buy bars, `-volume` on sell bars. */
  deltaVolume: number[]
  atr: (number | null)[]
}

export function isSrBreaksSettings(value: unknown): value is SrBreaksSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as SrBreaksSettings
  const integers: [number, number, number][] = [
    [settings.lookbackPeriod, 1, 2000],
    [settings.volumeFilterLength, 1, 2000],
    [settings.atrLength, 1, 2000],
    [settings.maxBoxes, 1, 500],
  ]
  return (
    integers.every(
      ([value, min, max]) => Number.isInteger(value) && value >= min && value <= max,
    ) &&
    Number.isFinite(settings.boxWidth) &&
    settings.boxWidth >= 0 &&
    settings.boxWidth <= 1000 &&
    [
      settings.showBoxes,
      settings.showVolumeText,
      settings.showHoldSignals,
      settings.showRetestSignals,
      settings.showBreakLabels,
    ].every((flag) => typeof flag === 'boolean')
  )
}

export function srBreaksSettings(indicator: Indicator): SrBreaksSettings {
  return isSrBreaksSettings(indicator.sr) ? indicator.sr : { ...SR_DEFAULTS }
}

export function srBreaksIndicatorLabel(indicator: Indicator): string {
  const settings = srBreaksSettings(indicator)
  return `SR Breaks and Retests [ChartPrime] (${settings.lookbackPeriod}, ${settings.volumeFilterLength}, ${settings.boxWidth})`
}

/**
 * Pine's `upAndDownVolume()`: the buy/sell flag is a `var`, so a doji keeps the
 * previous bar's direction instead of resetting.
 */
export function srDeltaVolume(candles: Candle[]): number[] {
  let isBuyVolume = true
  return candles.map((candle) => {
    if (candle.close > candle.open) isBuyVolume = true
    else if (candle.close < candle.open) isBuyVolume = false
    return isBuyVolume ? candle.volume : -candle.volume
  })
}

/**
 * Rolling extremes that include the current bar, exactly like `ta.highest`.
 * With `partial` the window shrinks instead of returning `undefined` during
 * warm-up; that mode is only used for the gradient bound.
 */
function rollingExtremes(
  values: number[],
  length: number,
  mode: 'max' | 'min',
  partial = false,
): (number | null)[] {
  return values.map((_, index) => {
    const start = partial ? 0 : index - length + 1
    if (start < 0) return null
    let result = values[start]
    for (let cursor = start + 1; cursor <= index; cursor++) {
      const value = values[cursor]
      if (mode === 'max' ? value > result : value < result) result = value
    }
    return result
  })
}

function trueRanges(candles: Candle[]): number[] {
  return candles.map((candle, index) => {
    const previous = candles[index - 1]?.close
    return previous === undefined
      ? candle.high - candle.low
      : Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - previous),
          Math.abs(candle.low - previous),
        )
  })
}

/**
 * Pine's `ta.rma`: seeded with the SMA of the first `length` values, so the
 * series is undefined until `length` bars exist. This is what makes the box
 * width unavailable during the first `atrLength` bars.
 */
export function srRma(values: number[], length: number): (number | null)[] {
  if (!Number.isInteger(length) || length < 1)
    throw new Error('RMA length must be an integer of at least 1.')
  const alpha = 1 / length
  let previous: number | null = null
  let sum = 0
  let count = 0
  return values.map((value) => {
    if (previous === null) {
      sum += value
      count++
      if (count < length) return null
      previous = sum / length
    } else previous = alpha * value + (1 - alpha) * previous
    return previous
  })
}

export function srAtr(candles: Candle[], length: number): (number | null)[] {
  return srRma(trueRanges(candles), length)
}

/**
 * `ta.pivothigh` / `ta.pivotlow` on the close series. The pivot is confirmed
 * `length` bars after it forms, so index `i` reports the price at `i - length`.
 * Pine compares with `>=`, so a bar equal to its neighbours still qualifies.
 */
export function srPivots(
  closes: number[],
  length: number,
  kind: 'high' | 'low',
): (number | null)[] {
  if (!Number.isInteger(length) || length < 1)
    throw new Error('Pivot length must be an integer of at least 1.')
  const pivots: (number | null)[] = new Array(closes.length).fill(null)
  for (let index = length * 2; index < closes.length; index++) {
    const candidate = closes[index - length]
    let qualifies = true
    for (let cursor = index - length * 2; cursor <= index; cursor++) {
      if (cursor === index - length) continue
      const value = closes[cursor]
      if (kind === 'high' ? value > candidate : value < candidate) {
        qualifies = false
        break
      }
    }
    if (qualifies) pivots[index] = candidate
  }
  return pivots
}

/** `color.from_gradient` restricted to the alpha channel, which is all the original varies. */
export function srGradient(
  value: number,
  bottomValue: number,
  topValue: number,
  bottomOpacity: number,
  topOpacity: number,
): number {
  const span = topValue - bottomValue
  const ratio = span === 0 ? (value >= topValue ? 1 : 0) : (value - bottomValue) / span
  const clamped = Math.min(1, Math.max(0, ratio))
  // Pine stores alpha as a byte, so four decimals is beyond its precision and
  // keeps float noise out of the emitted SVG attributes.
  return Math.round((bottomOpacity + (topOpacity - bottomOpacity) * clamped) * 10000) / 10000
}

/** `ta.crossover`: both series must have a previous value, so warm-up bars never fire. */
function crossesAbove(
  current: number,
  previous: number,
  level: number | null,
  previousLevel: number | null,
): boolean {
  if (level === null || previousLevel === null) return false
  return current > level && previous <= previousLevel
}

/** `ta.crossunder`. */
function crossesBelow(
  current: number,
  previous: number,
  level: number | null,
  previousLevel: number | null,
): boolean {
  if (level === null || previousLevel === null) return false
  return current < level && previous >= previousLevel
}

export function calculateSrBreaks(candles: Candle[], settings: SrBreaksSettings): SrBreaksResult {
  if (!isSrBreaksSettings(settings)) throw new Error('Invalid SR Breaks and Retests settings.')
  if (!candles.length) return { boxes: [], signals: [], labels: [], deltaVolume: [], atr: [] }

  const { lookbackPeriod, volumeFilterLength, boxWidth, atrLength, maxBoxes } = settings
  const deltaVolume = srDeltaVolume(candles)
  const scaled = deltaVolume.map((value) => value / 2.5)
  const volumeHigh = rollingExtremes(scaled, volumeFilterLength, 'max')
  const volumeLow = rollingExtremes(scaled, volumeFilterLength, 'min')
  // `ta.highest(Vol, 25)` / `ta.lowest(Vol, 25)` bound the fill gradient. The
  // original leaves them undefined for 24 bars, which made early boxes fully
  // transparent; Atlas uses the longest window available instead.
  const gradientHigh = rollingExtremes(deltaVolume, 25, 'max', true)
  const gradientLow = rollingExtremes(deltaVolume, 25, 'min', true)
  const atr = srAtr(candles, atrLength)
  const closes = candles.map((candle) => candle.close)
  const pivotHigh = srPivots(closes, lookbackPeriod, 'high')
  const pivotLow = srPivots(closes, lookbackPeriod, 'low')

  const boxes: SrBox[] = []
  const signals: SrSignal[] = []
  const labels: SrBreakLabel[] = []

  // Pine tracks exactly one live support box and one live resistance box. Older
  // boxes stay on the chart, frozen at the right edge and palette they had when
  // a newer box replaced them.
  let supportLevel: number | null = null
  let supportOuter: number | null = null
  let resistanceLevel: number | null = null
  let resistanceOuter: number | null = null
  let supportBox: SrBox | null = null
  let resistanceBox: SrBox | null = null
  let resistanceIsSupport: boolean | null = null
  let supportIsResistance: boolean | null = null
  let sequence = 0

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]
    const previous = candles[index - 1]
    const previousSupportLevel = supportLevel
    const previousSupportOuter = supportOuter
    const previousResistanceLevel = resistanceLevel
    const previousResistanceOuter = resistanceOuter
    const volume = deltaVolume[index]
    const width = atr[index] === null ? null : (atr[index] as number) * boxWidth

    const pivotLowValue = pivotLow[index]
    const volumeHighValue = volumeHigh[index]
    if (pivotLowValue !== null && volumeHighValue !== null && volume > volumeHighValue) {
      if (supportBox) {
        supportBox.endIndex = index
        boxes.push(supportBox)
      }
      const outer = width === null ? null : pivotLowValue - width
      supportLevel = pivotLowValue
      supportOuter = outer
      // The original draws a box whose lower edge is `level - atr * width`; with
      // no ATR yet there is no drawable box, so the level is tracked only.
      supportBox =
        outer === null
          ? null
          : {
              id: `support:${index}:${sequence++}`,
              kind: 'support',
              startIndex: index - lookbackPeriod,
              endIndex: index + 1,
              level: pivotLowValue,
              outer,
              volume,
              fillOpacity: srGradient(volume, 0, gradientHigh[index] ?? 0, 0, 0.7),
              state: 'active',
            }
    }

    const pivotHighValue = pivotHigh[index]
    const volumeLowValue = volumeLow[index]
    if (pivotHighValue !== null && volumeLowValue !== null && volume < volumeLowValue) {
      if (resistanceBox) {
        resistanceBox.endIndex = index
        boxes.push(resistanceBox)
      }
      const outer = width === null ? null : pivotHighValue + width
      resistanceLevel = pivotHighValue
      resistanceOuter = outer
      resistanceBox =
        outer === null
          ? null
          : {
              id: `resistance:${index}:${sequence++}`,
              kind: 'resistance',
              startIndex: index - lookbackPeriod,
              endIndex: index + 1,
              level: pivotHighValue,
              outer,
              volume,
              fillOpacity: srGradient(volume, gradientLow[index] ?? 0, 0, 0.7, 0),
              state: 'active',
            }
    }

    // Every live box stretches one bar past the current bar on every tick.
    if (supportBox) supportBox.endIndex = index + 1
    if (resistanceBox) resistanceBox.endIndex = index + 1

    const low = candle.low
    const high = candle.high
    // `ta.crossover`/`ta.crossunder` are false on the first bar: there is no
    // previous value to compare against.
    const previousLow = previous?.low
    const previousHigh = previous?.high
    const breakoutResistance =
      previousLow !== undefined &&
      crossesAbove(low, previousLow, resistanceOuter, previousResistanceOuter)
    const resistanceHolds =
      previousHigh !== undefined &&
      crossesBelow(high, previousHigh, resistanceLevel, previousResistanceLevel)
    const supportHolds =
      previousLow !== undefined &&
      crossesAbove(low, previousLow, supportLevel, previousSupportLevel)
    const breakoutSupport =
      previousHigh !== undefined &&
      crossesBelow(high, previousHigh, supportOuter, previousSupportOuter)

    if (breakoutSupport && supportBox) supportBox.state = 'broken'
    if (supportHolds && supportBox) supportBox.state = 'active'
    if (breakoutResistance && resistanceBox) resistanceBox.state = 'broken'
    if (resistanceHolds && resistanceBox) resistanceBox.state = 'active'

    if (index > 0 && previous) {
      // `location.abovebar` anchors on the plotted bar's high, `belowbar` on its low.
      const aboveBar = previous.high
      const belowBar = previous.low
      if (resistanceHolds)
        signals.push({ index, plotIndex: index - 1, kind: 'resistance-holds', price: aboveBar })
      if (supportHolds)
        signals.push({ index, plotIndex: index - 1, kind: 'support-holds', price: belowBar })
      // The retest diamonds use the previous bar's flip flags, `res_is_sup[1]`.
      if (breakoutResistance && resistanceIsSupport === true)
        signals.push({
          index,
          plotIndex: index - 1,
          kind: 'resistance-as-support',
          price: belowBar,
        })
      if (breakoutSupport && supportIsResistance === true)
        signals.push({
          index,
          plotIndex: index - 1,
          kind: 'support-as-resistance',
          price: aboveBar,
        })
      // Pine treats `na` as false, so `not sup_is_res[1]` is true before any flip.
      if (breakoutSupport && supportIsResistance !== true && previousSupportLevel !== null)
        labels.push({
          index: index - 1,
          price: previousSupportLevel,
          kind: 'support',
          text: 'Break Sup',
        })
      if (breakoutResistance && resistanceIsSupport !== true && previousResistanceLevel !== null)
        labels.push({
          index: index - 1,
          price: previousResistanceLevel,
          kind: 'resistance',
          text: 'Break Res',
        })
    }

    if (breakoutResistance) resistanceIsSupport = true
    else if (resistanceHolds) resistanceIsSupport = false
    if (breakoutSupport) supportIsResistance = true
    else if (supportHolds) supportIsResistance = false
  }

  if (supportBox) {
    supportBox.endIndex = candles.length
    boxes.push(supportBox)
  }
  if (resistanceBox) {
    resistanceBox.endIndex = candles.length
    boxes.push(resistanceBox)
  }

  return {
    // `max_boxes_count = 50`: TradingView drops the oldest boxes first.
    boxes: boxes.slice(-maxBoxes),
    signals,
    labels,
    deltaVolume,
    atr,
  }
}
