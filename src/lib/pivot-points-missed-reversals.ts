import {
  PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
  type Candle,
  type Indicator,
  type PivotPointsMissedReversalsSettings,
} from './types'

/**
 * Atlas port of LuxAlgo's "Pivot Points High Low & Missed Reversal Levels",
 * published open-source on TradingView (Pine Script v5, February 2022) under
 * the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 license. The
 * TradingView legend renders it as
 * "Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)". See
 * THIRD_PARTY_NOTICES.md and docs/pivot-points-missed-reversals.md for the
 * attribution, license terms and behavioral contract.
 *
 * The engine below walks the candles oldest-to-newest and reproduces the
 * original statement order bar by bar, so every `var` transition and every
 * `[1]` history read matches Pine:
 *
 * 1. `ph = ta.pivothigh(length, length)` / `pl = ta.pivotlow(length, length)`
 *    confirm a pivot `length` bars after it forms; the pivot bar is
 *    `bar_index − length`.
 * 2. Running extremes over `high[length]` / `low[length]`: `max`/`min` since
 *    the last regular pivot (with the bars where they were set, `max_x1` /
 *    `min_x1`), plus `follow_max` (highest high since the last new `min`) and
 *    `follow_min` (lowest low since the last new `max`). Their `_x1` bars only
 *    move when the extreme strictly beats the previous bar's value — a quirk
 *    of the original that is kept.
 * 3. Two pivots of the same type in a row (`os[1] == 1` at a pivot high,
 *    `os[1] == 0` at a pivot low) mean a reversal was missed between them:
 *    a 👻 label prints at the running opposite extreme, the zig-zag detours
 *    through it (dashed), and a ghost level starts there.
 * 4. A pivot high below the running `max` (`ph < max`) — or a pivot low above
 *    the running `min` (`pl > min`) — means two reversals were missed: the
 *    running extreme and the `follow_*` extreme after it. Both get labels,
 *    dashed zig-zag legs and levels.
 * 5. The current ghost level is extended to every new bar
 *    (`line.set_x2(ghost_level[1], n)`); when the next missed reversal is
 *    found the previous level is cut back to end at that reversal's bar.
 * 6. Regular pivots print ▼ / ▲ labels; the zig-zag leg into a regular pivot
 *    is dashed when a reversal was missed on the way, solid otherwise.
 * 7. On the last bar the original estimates the next reversal: the lowest low
 *    (after a pivot high) or highest high (after a pivot low) since the last
 *    regular pivot — a trailing 👻 label, a dashed leg and a level that are
 *    redrawn every bar.
 *
 * Zig-zag legs rising into a high use the missed-low color, legs falling into
 * a low use the missed-high color (the original colors every leg from the
 * missed palette, even the legs into regular pivots). Historical ghost levels
 * use the *regular* palette at 50% opacity; the estimated level uses the leg
 * color instead — the published behavior, reproduced as is.
 *
 * One deliberate deviation, documented in docs/pivot-points-missed-reversals.md:
 * the original's zig-zag origin is the uninitialised `px1 = 0, py1 = 0.` —
 * bar 0 at price 0 — so its very first leg is anchored there. That leg is
 * invisible on TradingView's deep history but would cut across a 300–900
 * candle window, so Atlas treats the origin as `na` and does not draw a leg
 * (or estimate leg) until a real pivot exists.
 */

/** Pine `max_labels_count = 500`; older labels are garbage-collected. */
export const PIVOT_MAX_LABELS = 500
/** Pine `max_lines_count = 500`, shared by zig-zag legs and ghost levels. */
export const PIVOT_MAX_LINES = 500
/** Pine `max_bars_back = 500` bounds `high[length]`, hence the input. */
export const PIVOT_MAX_LENGTH = 500

export type PivotLabelKind = 'regular-high' | 'regular-low' | 'missed-high' | 'missed-low'
export type PivotColorRole = PivotLabelKind

export interface PivotLabel {
  kind: PivotLabelKind
  /** Anchor bar: the pivot bar (`bar_index − length`) or the missed extreme. */
  index: number
  price: number
  /** Pine `label.style_label_down` sits above its anchor; `label_up` hangs below. */
  style: 'down' | 'up'
  /** `str.tostring(price, '#.####')`, the original tooltip. */
  tooltip: string
  /** The trailing estimate; the original deletes and redraws it every bar. */
  estimate: boolean
}

export interface PivotZigzagSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  /**
   * Legs into a high are `up` and use the missed-low color; legs into a low
   * are `down` and use the missed-high color.
   */
  direction: 'up' | 'down'
  dashed: boolean
  estimate: boolean
  /** Creation order, shared with levels for the 500-line budget. */
  order: number
}

export interface PivotLevel {
  /** Bar of the missed reversal (or of the estimate). */
  x1: number
  /**
   * Right end. The current level follows the newest bar; a superseded level
   * ends at the bar of the missed reversal that replaced it.
   */
  x2: number
  price: number
  side: 'high' | 'low'
  /**
   * Historical levels use the regular palette (`color.new(reg_*_css, 50)`);
   * the estimated level uses the leg color, so an estimated low is tinted with
   * the missed-high color — as published.
   */
  color: PivotColorRole
  estimate: boolean
  /** Creation order, shared with zig-zag legs for the 500-line budget. */
  order: number
}

export interface PivotEstimate {
  index: number
  price: number
  side: 'high' | 'low'
}

export interface PivotPointsMissedReversalsResult {
  labels: PivotLabel[]
  zigzag: PivotZigzagSegment[]
  levels: PivotLevel[]
  /** The trailing reversal estimate, or null when no bar can carry one. */
  estimate: PivotEstimate | null
  /** Bars a pivot needs to confirm: `2 × length + 1`. */
  warmupBars: number
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isPivotPointsMissedReversalsSettings(
  value: unknown,
): value is PivotPointsMissedReversalsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  return (
    typeof settings.pivotLength === 'number' &&
    Number.isInteger(settings.pivotLength) &&
    settings.pivotLength >= 1 &&
    settings.pivotLength <= PIVOT_MAX_LENGTH &&
    typeof settings.showRegular === 'boolean' &&
    typeof settings.showMissed === 'boolean' &&
    (
      [
        'regularHighColor',
        'regularLowColor',
        'missedHighColor',
        'missedLowColor',
        'labelTextColor',
      ] as const
    ).every((key) => typeof settings[key] === 'string' && HEX_COLOR.test(settings[key] as string))
  )
}

export function pivotPointsMissedReversalsSettings(
  indicator: Indicator,
): PivotPointsMissedReversalsSettings {
  return isPivotPointsMissedReversalsSettings(indicator.pivots)
    ? indicator.pivots
    : { ...PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS }
}

/** TradingView renders the legend as `Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)`. */
export function pivotPointsMissedReversalsIndicatorLabel(indicator: Indicator): string {
  return `Pivot Points High Low & Missed Reversal Levels (${pivotPointsMissedReversalsSettings(indicator).pivotLength})`
}

/** Pine `str.tostring(value, '#.####')`: at most four decimals, no trailing zeros. */
export function pivotTooltip(price: number): string {
  const rounded = Math.round(price * 1e4) / 1e4
  return String(rounded === 0 ? 0 : rounded)
}

/**
 * Pine `ta.pivothigh(left, right)` observed at bar `i` confirms the high at
 * `i − right`. The center must be the most recent occurrence of the window
 * maximum: future (right) highs must be strictly lower, past (left) highs may
 * tie — the reverse-engineered built-in behavior, which marks only the second
 * top of an exact double top.
 */
function pivotHighAt(highs: number[], i: number, left: number, right: number): number | null {
  const center = i - right
  if (center - left < 0) return null
  const value = highs[center]
  for (let k = center + 1; k <= i; k++) if (highs[k] >= value) return null
  for (let k = center - left; k < center; k++) if (highs[k] > value) return null
  return value
}

/** `ta.pivotlow`: mirror image — strictly higher future lows, ties allowed in the past. */
function pivotLowAt(lows: number[], i: number, left: number, right: number): number | null {
  const center = i - right
  if (center - left < 0) return null
  const value = lows[center]
  for (let k = center + 1; k <= i; k++) if (lows[k] <= value) return null
  for (let k = center - left; k < center; k++) if (lows[k] < value) return null
  return value
}

/** Pine `math.max`: `na` in, `na` out. */
const pineMax = (a: number | null, b: number | null) =>
  a === null || b === null ? null : Math.max(a, b)
/** Pine `math.min`: `na` in, `na` out. */
const pineMin = (a: number | null, b: number | null) =>
  a === null || b === null ? null : Math.min(a, b)
/** Pine comparisons involving `na` are false. */
const greater = (a: number | null, b: number | null) => a !== null && b !== null && a > b
const less = (a: number | null, b: number | null) => a !== null && b !== null && a < b

export function calculatePivotPointsMissedReversals(
  candles: Candle[],
  settings: PivotPointsMissedReversalsSettings,
): PivotPointsMissedReversalsResult {
  if (!isPivotPointsMissedReversalsSettings(settings))
    throw new Error('Invalid Pivot Points High Low & Missed Reversal Levels settings.')
  const length = settings.pivotLength
  const { showRegular, showMissed } = settings
  const highs = candles.map((candle) => candle.high)
  const lows = candles.map((candle) => candle.low)

  const labels: PivotLabel[] = []
  const zigzag: PivotZigzagSegment[] = []
  const levels: PivotLevel[] = []
  let lineOrder = 0

  // Pine `var` state. `max`/`min`/`follow_*` start `na` in effect: the
  // original seeds them with 0 but `math.max(high[length], max)` is `na` until
  // a pivot resets them, and `na` propagates. `py1` is the zig-zag origin;
  // null marks the uninitialised origin (see the deviation note above).
  let max: number | null = null
  let min: number | null = null
  let maxX1 = 0
  let minX1 = 0
  let followMax: number | null = null
  let followMaxX1 = 0
  let followMin: number | null = null
  let followMinX1 = 0
  let os = 0
  let py1: number | null = null
  let px1 = 0
  let ghostLevel: PivotLevel | null = null
  // Previous-bar (`[1]`) values, committed at the end of each bar.
  let prevMax: number | null = null
  let prevMin: number | null = null
  let prevFollowMax: number | null = null
  let prevFollowMin: number | null = null
  let prevOs = 0

  const addLabel = (
    kind: PivotLabelKind,
    index: number,
    price: number | null,
    style: 'down' | 'up',
    estimate = false,
  ) => {
    // A label at an `na` price is created but never displayed in Pine.
    if (price === null) return
    labels.push({ kind, index, price, style, tooltip: pivotTooltip(price), estimate })
  }
  const addSegment = (
    x1: number,
    y1: number | null,
    x2: number,
    y2: number | null,
    direction: 'up' | 'down',
    dashed: boolean,
    estimate = false,
  ) => {
    // A line with an `na` coordinate is not displayed in Pine.
    if (y1 === null || y2 === null) return
    zigzag.push({ x1, y1, x2, y2, direction, dashed, estimate, order: lineOrder++ })
  }
  const addLevel = (x: number, price: number | null, side: 'high' | 'low'): PivotLevel | null => {
    if (price === null) return null
    const level: PivotLevel = {
      x1: x,
      x2: x,
      price,
      side,
      color: side === 'high' ? 'regular-high' : 'regular-low',
      estimate: false,
      order: lineOrder++,
    }
    levels.push(level)
    return level
  }

  for (let n = 0; n < candles.length; n++) {
    const source = n - length
    const highBack = source >= 0 ? highs[source] : null
    const lowBack = source >= 0 ? lows[source] : null
    const ph = pivotHighAt(highs, n, length, length)
    const pl = pivotLowAt(lows, n, length, length)

    max = pineMax(highBack, max)
    min = pineMin(lowBack, min)
    followMax = pineMax(highBack, followMax)
    followMin = pineMin(lowBack, followMin)

    if (greater(max, prevMax)) {
      maxX1 = source
      followMin = lowBack
    }
    if (less(min, prevMin)) {
      minX1 = source
      followMax = highBack
    }
    if (less(followMin, prevFollowMin)) followMinX1 = source
    if (greater(followMax, prevFollowMax)) followMaxX1 = source

    // `line.set_x2(ghost_level[1], n)`: the current level follows the bar.
    if (ghostLevel) ghostLevel.x2 = n

    if (ph !== null) {
      const missedBelowMax = max !== null && ph < max
      if (showMissed) {
        if (prevOs === 1) {
          // Two pivot highs in a row: the low between them was missed.
          addLabel('missed-low', minX1, min, 'up')
          addSegment(px1, py1, minX1, min, 'down', true)
          px1 = minX1
          py1 = min
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'low')
        } else if (missedBelowMax) {
          // A lower high after the running max: the max and the low that
          // followed it were both missed.
          addLabel('missed-high', maxX1, max, 'down')
          addLabel('missed-low', followMinX1, followMin, 'up')
          addSegment(px1, py1, maxX1, max, 'up', true)
          px1 = maxX1
          py1 = max
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'high')
          addSegment(px1, py1, followMinX1, followMin, 'down', true)
          px1 = followMinX1
          py1 = followMin
          // `line.set_x2(ghost_level, px1)`: the level just created ends at the missed low.
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'low')
        }
      }
      if (showRegular) {
        addLabel('regular-high', source, ph, 'down')
        addSegment(px1, py1, source, ph, 'up', missedBelowMax || prevOs === 1)
      }
      py1 = ph
      px1 = source
      os = 1
      max = ph
      min = ph
    }

    if (pl !== null) {
      const missedAboveMin = min !== null && pl > min
      if (showMissed) {
        if (prevOs === 0) {
          // Two pivot lows in a row: the high between them was missed.
          addLabel('missed-high', maxX1, max, 'down')
          addSegment(px1, py1, maxX1, max, 'up', true)
          px1 = maxX1
          py1 = max
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'high')
        } else if (missedAboveMin) {
          // A higher low after the running min: the min and the high that
          // followed it were both missed.
          addLabel('missed-high', followMaxX1, followMax, 'down')
          addLabel('missed-low', minX1, min, 'up')
          addSegment(px1, py1, minX1, min, 'down', true)
          px1 = minX1
          py1 = min
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'low')
          addSegment(px1, py1, followMaxX1, followMax, 'up', true)
          px1 = followMaxX1
          py1 = followMax
          if (ghostLevel) ghostLevel.x2 = px1
          ghostLevel = addLevel(px1, py1, 'high')
        }
      }
      if (showRegular) {
        addLabel('regular-low', source, pl, 'up')
        addSegment(px1, py1, source, pl, 'down', missedAboveMin || prevOs === 0)
      }
      py1 = pl
      px1 = source
      os = 0
      max = pl
      min = pl
    }

    prevMax = max
    prevMin = min
    prevFollowMax = followMax
    prevFollowMin = followMin
    prevOs = os
  }

  // `barstate.islast`: estimate the next reversal from the bars after the last
  // regular pivot (`for i = 0 to n - px1 - 1`, newest first). `array.indexof`
  // returns the first match, so ties resolve to the newest bar.
  let estimate: PivotEstimate | null = null
  const last = candles.length - 1
  if (last >= 0 && last - px1 - 1 >= 0) {
    let best: number | null = null
    let bestIndex = last
    for (let i = 0; i <= last - px1 - 1; i++) {
      const bar = last - i
      const value = os === 1 ? lows[bar] : highs[bar]
      if (best === null || (os === 1 ? value < best : value > best)) {
        best = value
        bestIndex = bar
      }
    }
    if (best !== null) {
      const side: 'high' | 'low' = os === 1 ? 'low' : 'high'
      estimate = { index: bestIndex, price: best, side }
      if (showMissed) {
        addLabel(
          side === 'low' ? 'missed-low' : 'missed-high',
          bestIndex,
          best,
          side === 'low' ? 'up' : 'down',
          true,
        )
        addSegment(px1, py1, bestIndex, best, side === 'low' ? 'down' : 'up', true, true)
      }
      // Drawn even with missed pivots hidden — it sits outside `if show_miss`.
      levels.push({
        x1: bestIndex,
        x2: last,
        price: best,
        side,
        color: side === 'low' ? 'missed-high' : 'missed-low',
        estimate: true,
        order: lineOrder++,
      })
    }
  }

  // Garbage collection, oldest first, like TradingView's drawing limits.
  const keptLabels = labels.length > PIVOT_MAX_LABELS ? labels.slice(-PIVOT_MAX_LABELS) : labels
  const lineCutoff = lineOrder - PIVOT_MAX_LINES
  const keptZigzag = lineCutoff > 0 ? zigzag.filter((line) => line.order >= lineCutoff) : zigzag
  const keptLevels = lineCutoff > 0 ? levels.filter((line) => line.order >= lineCutoff) : levels

  return {
    labels: keptLabels,
    zigzag: keptZigzag,
    levels: keptLevels,
    estimate,
    warmupBars: 2 * length + 1,
  }
}
