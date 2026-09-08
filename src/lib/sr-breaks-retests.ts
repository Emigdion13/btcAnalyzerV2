import {
  SR_BREAKS_RETESTS_DEFAULTS,
  type Candle,
  type Indicator,
  type SrBreaksRetestsSettings,
} from './types'

/**
 * Atlas port of ChartPrime's "Support and Resistance (High Volume Boxes)",
 * published on TradingView with the short title "SR Breaks and Retests
 * [ChartPrime]" and rendered there as "SR Breaks and Retests (20, 2, 1)".
 * The original Pine Script v5 source is published by ChartPrime under the
 * Mozilla Public License 2.0; see THIRD_PARTY_NOTICES.md and
 * docs/sr-breaks-retests.md for attribution and the behavioral contract.
 *
 * The engine below reproduces the published calculation bar by bar, in the
 * original statement order, so every state transition matches:
 *
 * 1. Delta volume: +volume on up candles, −volume on down candles; doji bars
 *    inherit the last non-flat direction (`var isBuyVolume = true`).
 * 2. Zones form at close-based pivots (`ta.pivothigh/pivotlow(close, L, L)`,
 *    confirmed L bars later) when the delta volume beats
 *    `ta.highest(Vol / 2.5, vol_len)` (support) or undercuts
 *    `ta.lowest(Vol / 2.5, vol_len)` (resistance).
 * 3. A zone's depth is `ta.atr(200) × box width`. The support zone hangs below
 *    its level, the resistance zone sits above it.
 * 4. `ta.crossover(low, resistance + depth)` is a resistance break;
 *    `ta.crossunder(high, resistance)` means resistance holds. Support is
 *    symmetric. Crosses compare against the previous bar's post-update level
 *    series, exactly like Pine's `var` history.
 * 5. Broken zones flip role and color (dashed, faint fill); a hold restores the
 *    volume-graded fill. Role flags persist across replacements, so a fresh
 *    zone can print a retest diamond instead of a break label — as in the
 *    original.
 *
 * One deliberate deviation, documented in docs/sr-breaks-retests.md: the
 * original hides the very first "Break" label because `not na_flag` evaluates
 * to `na`. TradingView's multi-thousand-bar history makes that invisible; on
 * Atlas's shorter candle windows an unlabeled break would read as a defect, so
 * an unset flag counts as `false` and the label is shown.
 */

/** Pine `ta.atr(200)` length used for the adaptive zone depth. */
export const SR_ATR_LENGTH = 200
/** Pine `max_boxes_count = 50`; older zones are garbage-collected. */
export const SR_MAX_ZONES = 50
/** Gradient window for the volume-graded fill: `ta.highest(Vol, 25)`. */
const GRADIENT_WINDOW = 25
/** Delta-volume filter scaling: `ta.highest(Vol / 2.5, vol_len)`. */
const VOLUME_FILTER_DIVISOR = 2.5
/** `color.new(color.green, 30)` / `color.new(color.red, 30)` → 70% opacity. */
export const SR_ZONE_FILL_OPACITY = 0.7
/** `color.new(color.red, 80)` / `color.new(color.green, 80)` → 20% opacity. */
export const SR_BROKEN_FILL_OPACITY = 0.2

/** Published Pine colors, kept verbatim for visual parity. */
export const SR_BREAKS_RETESTS_COLORS = {
  /** Pine `color.green` (#4caf50): intact support / broken resistance border. */
  support: '#4caf50',
  /** Pine `color.red` (#f44336): intact resistance / broken support border. */
  resistance: '#f44336',
  /** Green ◆ (#20ca26): support holds, resistance-as-support holds. */
  holdBelow: '#20ca26',
  /** Red ◆ (#e92929): resistance holds, support-as-resistance holds. */
  holdAbove: '#e92929',
  /** "Break Sup" label color (#7e1e1e); drawn as an outline, never a filled plate. */
  breakSupport: '#7e1e1e',
  /** "Break Res" label color (#2b6d2d); drawn as an outline, never a filled plate. */
  breakResistance: '#2b6d2d',
  /** `#7e1e1e` lightened — the label text has to read without a filled plate behind it. */
  breakSupportText: '#f2808a',
  /** `#2b6d2d` lightened — the label text has to read without a filled plate behind it. */
  breakResistanceText: '#6fd477',
  /** Pine `chart.fg_color` on dark themes. */
  foreground: '#d1d4dc',
} as const

export type SrZoneSide = 'support' | 'resistance'
export type SrZoneState = 'intact' | 'broken'
export type SrMarkerKind =
  'resistance-holds' | 'support-holds' | 'resistance-as-support' | 'support-as-resistance'
export type SrBreakLabelKind = 'break-support' | 'break-resistance'

export interface SrZone {
  id: string
  side: SrZoneSide
  /** Index of the pivot bar; the box's left edge (`bar_index - lookback`). */
  pivotIndex: number
  /** Detection bar; the pivot is confirmed once `lookback` bars follow it. */
  createdIndex: number
  /**
   * Right edge index. While the zone is current it is re-anchored one bar past
   * the newest bar each update (`sup.set_right(bar_index + 1)`); a replacement
   * freezes the previous zone at the replacement bar.
   */
  rightIndex: number
  /** Pivot close that defines the level. */
  level: number
  /**
   * Zone boundary — `level − depth` for support, `level + depth` for
   * resistance. Null while ATR(200) is still warming up, matching Pine's `na`.
   */
  boundary: number | null
  /** Signed delta volume on the detection bar. */
  volume: number
  /** Box text exactly as the original renders it: "Vol: " + rounded value. */
  volumeText: string
  /** Volume-graded fill opacity, from 0 (transparent) to 0.7. */
  fillOpacity: number
  /** `broken` zones render dashed with the role-reversed color and faint fill. */
  state: SrZoneState
}

export interface SrMarker {
  kind: SrMarkerKind
  /** The annotated bar. Pine plots every diamond with `offset = -1`. */
  index: number
  location: 'above' | 'below'
  color: string
}

export interface SrBreakLabel {
  kind: SrBreakLabelKind
  /** Anchor bar (`bar_index[1]`). */
  index: number
  /** Anchor price: the previous bar's level value (`supportLevel[1]`). */
  price: number
  color: string
}

export interface SrBreaksRetestsResult {
  /** Up to 50 zones, oldest first, mirroring `max_boxes_count`. */
  zones: SrZone[]
  markers: SrMarker[]
  labels: SrBreakLabel[]
}

export function isSrBreaksRetestsSettings(value: unknown): value is SrBreaksRetestsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as SrBreaksRetestsSettings
  return (
    Number.isInteger(settings.lookbackPeriod) &&
    settings.lookbackPeriod >= 1 &&
    settings.lookbackPeriod <= 500 &&
    Number.isInteger(settings.volumeFilterLength) &&
    settings.volumeFilterLength >= 1 &&
    settings.volumeFilterLength <= 500 &&
    Number.isFinite(settings.boxWidth) &&
    settings.boxWidth >= 0 &&
    settings.boxWidth <= 1000
  )
}

export function srBreaksRetestsSettings(indicator: Indicator): SrBreaksRetestsSettings {
  return isSrBreaksRetestsSettings(indicator.sr) ? indicator.sr : { ...SR_BREAKS_RETESTS_DEFAULTS }
}

/** TradingView renders the legend as `SR Breaks and Retests [ChartPrime] (20, 2, 1)`. */
export function srBreaksRetestsIndicatorLabel(indicator: Indicator): string {
  const settings = srBreaksRetestsSettings(indicator)
  return `SR Breaks and Retests (${settings.lookbackPeriod}, ${settings.volumeFilterLength}, ${settings.boxWidth})`
}

/**
 * Pine `ta.pivothigh(src, left, right)` observed at bar `i` confirms the value
 * at `i − right`. The center must be the most recent occurrence of the window
 * maximum: values to the future (right) must be strictly lower, values to the
 * past (left) may tie. This matches the reverse-engineered built-in behavior
 * (`array.lastindexof(array.max(window)) == left`) and marks only the second
 * top of an exact double top, as TradingView does.
 */
function pivotHighAt(closes: number[], i: number, left: number, right: number): number | null {
  const center = i - right
  if (center - left < 0) return null
  const value = closes[center]
  for (let k = center + 1; k <= i; k++) if (closes[k] >= value) return null
  for (let k = center - left; k < center; k++) if (closes[k] > value) return null
  return value
}

/** `ta.pivotlow`: mirror image — strictly higher future bars, ties allowed in the past. */
function pivotLowAt(closes: number[], i: number, left: number, right: number): number | null {
  const center = i - right
  if (center - left < 0) return null
  const value = closes[center]
  for (let k = center + 1; k <= i; k++) if (closes[k] <= value) return null
  for (let k = center - left; k < center; k++) if (closes[k] < value) return null
  return value
}

/**
 * Pine `ta.atr(length)`: RMA of true range, seeded by the SMA of the first
 * `length` true ranges, so it stays `na` (null) until `length` bars exist —
 * exactly the original warm-up, which leaves early zones without a boundary.
 */
function pineAtr(candles: Candle[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null)
  let seedSum = 0
  let average: number | null = null
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
    if (i < length - 1) {
      seedSum += range
      continue
    }
    if (i === length - 1) {
      seedSum += range
      average = seedSum / length
    } else average = (average! * (length - 1) + range) / length
    out[i] = average
  }
  return out
}

/** `ta.crossover(a, b)`: `a[1] <= b[1]` and `a > b`, using post-update levels. */
function crossedUp(
  previousA: number,
  a: number,
  previousB: number | null,
  b: number | null,
): boolean {
  return previousB !== null && b !== null && previousA <= previousB && a > b
}

/** `ta.crossunder(a, b)`: `a[1] >= b[1]` and `a < b`. */
function crossedDown(
  previousA: number,
  a: number,
  previousB: number | null,
  b: number | null,
): boolean {
  return previousB !== null && b !== null && previousA >= previousB && a < b
}

function windowExtreme(
  values: number[],
  end: number,
  length: number,
  pick: (a: number, b: number) => number,
): number | null {
  if (end < length - 1) return null
  let extreme = values[end - length + 1]
  for (let k = end - length + 2; k <= end; k++) extreme = pick(extreme, values[k])
  return extreme
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Volume-graded fill opacity. Both gradients reduce to
 * `0.7 × clamp01(Vol / window extreme)`:
 * support maps Vol from [0, highest(Vol, 25)] to [transparent, green@30];
 * resistance maps Vol from [lowest(Vol, 25), 0] to [red@30, transparent].
 */
function gradientOpacity(volRaw: number[], i: number, vol: number, side: SrZoneSide): number {
  const extreme =
    side === 'support'
      ? windowExtreme(volRaw, i, GRADIENT_WINDOW, Math.max)
      : windowExtreme(volRaw, i, GRADIENT_WINDOW, Math.min)
  if (extreme === null || extreme === 0) return 0
  return SR_ZONE_FILL_OPACITY * clamp01(vol / extreme)
}

/** `"Vol: " + str.tostring(math.round(Vol, 2))` — half away from zero, no padding. */
export function srVolumeText(vol: number): string {
  const factor = 100
  const rounded = (Math.round(Math.abs(vol) * factor) / factor) * (vol < 0 ? -1 : 1)
  return `Vol: ${rounded}`
}

function createZone(
  side: SrZoneSide,
  pivotIndex: number,
  createdIndex: number,
  level: number,
  boundary: number | null,
  vol: number,
  fillOpacity: number,
): SrZone {
  return {
    id: `${side}:${pivotIndex}:${createdIndex}`,
    side,
    pivotIndex,
    createdIndex,
    rightIndex: createdIndex,
    level,
    boundary,
    volume: vol,
    volumeText: srVolumeText(vol),
    fillOpacity,
    state: 'intact',
  }
}

export function calculateSrBreaksRetests(
  candles: Candle[],
  settings: SrBreaksRetestsSettings,
): SrBreaksRetestsResult {
  if (!isSrBreaksRetestsSettings(settings))
    throw new Error('Invalid SR Breaks and Retests settings.')
  const lookback = settings.lookbackPeriod
  const volLen = settings.volumeFilterLength
  const closes = candles.map((candle) => candle.close)
  const atr = pineAtr(candles, SR_ATR_LENGTH)

  const zones: SrZone[] = []
  const markers: SrMarker[] = []
  const labels: SrBreakLabel[] = []
  const volRaw: number[] = []
  // Post-update level series per bar; Pine's crosses read these as `[1]`.
  const supportLevels: (number | null)[] = []
  const supportBoundaries: (number | null)[] = []
  const resistanceLevels: (number | null)[] = []
  const resistanceBoundaries: (number | null)[] = []

  let isBuyVolume = true
  let supportLevel: number | null = null
  let supportBoundary: number | null = null
  let resistanceLevel: number | null = null
  let resistanceBoundary: number | null = null
  let resIsSup: boolean | null = null
  let supIsRes: boolean | null = null
  let currentSupport: SrZone | null = null
  let currentResistance: SrZone | null = null

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]

    // Delta volume. A doji keeps the last non-flat direction, per the original.
    if (candle.close > candle.open) isBuyVolume = true
    else if (candle.close < candle.open) isBuyVolume = false
    const vol = isBuyVolume ? candle.volume : -candle.volume
    volRaw.push(vol)

    // vol_hi / vol_lo. `na` until the window is full, which disables detection.
    const volHiScaled =
      i >= volLen - 1 ? windowExtreme(volRaw, i, volLen, Math.max)! / VOLUME_FILTER_DIVISOR : null
    const volLoScaled =
      i >= volLen - 1 ? windowExtreme(volRaw, i, volLen, Math.min)! / VOLUME_FILTER_DIVISOR : null

    const pivotHigh = pivotHighAt(closes, i, lookback, lookback)
    const pivotLow = pivotLowAt(closes, i, lookback, lookback)
    const depth = atr[i] === null ? null : atr[i]! * settings.boxWidth

    // Support: positive delta volume above the filter at a confirmed pivot low.
    if (pivotLow !== null && volHiScaled !== null && vol > volHiScaled) {
      supportLevel = pivotLow
      supportBoundary = depth === null ? null : pivotLow - depth
      currentSupport = createZone(
        'support',
        i - lookback,
        i,
        pivotLow,
        supportBoundary,
        vol,
        gradientOpacity(volRaw, i, vol, 'support'),
      )
      zones.push(currentSupport)
    }

    // Resistance: negative delta volume below the filter at a confirmed pivot high.
    if (pivotHigh !== null && volLoScaled !== null && vol < volLoScaled) {
      resistanceLevel = pivotHigh
      resistanceBoundary = depth === null ? null : pivotHigh + depth
      currentResistance = createZone(
        'resistance',
        i - lookback,
        i,
        pivotHigh,
        resistanceBoundary,
        vol,
        gradientOpacity(volRaw, i, vol, 'resistance'),
      )
      zones.push(currentResistance)
    }

    // The live boxes re-anchor one bar past the newest bar on every update.
    if (currentSupport) currentSupport.rightIndex = i + 1
    if (currentResistance) currentResistance.rightIndex = i + 1

    supportLevels.push(supportLevel)
    supportBoundaries.push(supportBoundary)
    resistanceLevels.push(resistanceLevel)
    resistanceBoundaries.push(resistanceBoundary)

    if (i === 0) continue
    const previous = candles[i - 1]

    // Break and hold crosses, evaluated against the previous bar's levels.
    const brekoutRes = crossedUp(
      previous.low,
      candle.low,
      resistanceBoundaries[i - 1],
      resistanceBoundary,
    )
    const resHolds = crossedDown(
      previous.high,
      candle.high,
      resistanceLevels[i - 1],
      resistanceLevel,
    )
    const supHolds = crossedUp(previous.low, candle.low, supportLevels[i - 1], supportLevel)
    const brekoutSup = crossedDown(
      previous.high,
      candle.high,
      supportBoundaries[i - 1],
      supportBoundary,
    )

    // Recolor the live zones: a break flips the role, a hold restores it.
    if (brekoutSup && currentSupport) currentSupport.state = 'broken'
    if (supHolds && currentSupport) currentSupport.state = 'intact'
    if (brekoutRes && currentResistance) currentResistance.state = 'broken'
    if (resHolds && currentResistance) currentResistance.state = 'intact'

    // Diamonds and labels annotate the previous bar (`offset = -1`,
    // `bar_index[1]`), reading the role flags as of that bar.
    if (resHolds)
      markers.push({
        kind: 'resistance-holds',
        index: i - 1,
        location: 'above',
        color: SR_BREAKS_RETESTS_COLORS.holdAbove,
      })
    if (supHolds)
      markers.push({
        kind: 'support-holds',
        index: i - 1,
        location: 'below',
        color: SR_BREAKS_RETESTS_COLORS.holdBelow,
      })
    if (brekoutRes && resIsSup === true)
      markers.push({
        kind: 'resistance-as-support',
        index: i - 1,
        location: 'below',
        color: SR_BREAKS_RETESTS_COLORS.holdBelow,
      })
    if (brekoutSup && supIsRes === true)
      markers.push({
        kind: 'support-as-resistance',
        index: i - 1,
        location: 'above',
        color: SR_BREAKS_RETESTS_COLORS.holdAbove,
      })
    if (brekoutSup && supIsRes !== true && supportLevels[i - 1] !== null)
      labels.push({
        kind: 'break-support',
        index: i - 1,
        price: supportLevels[i - 1]!,
        color: SR_BREAKS_RETESTS_COLORS.breakSupport,
      })
    if (brekoutRes && resIsSup !== true && resistanceLevels[i - 1] !== null)
      labels.push({
        kind: 'break-resistance',
        index: i - 1,
        price: resistanceLevels[i - 1]!,
        color: SR_BREAKS_RETESTS_COLORS.breakResistance,
      })

    // Role-reversal flags. They persist across zone replacements, so the first
    // break of a fresh zone can legitimately print a retest diamond instead of
    // a break label — that is the original behavior, not a defect.
    if (brekoutRes) resIsSup = true
    else if (resHolds) resIsSup = false
    if (brekoutSup) supIsRes = true
    else if (supHolds) supIsRes = false
  }

  return { zones: zones.slice(-SR_MAX_ZONES), markers, labels }
}
