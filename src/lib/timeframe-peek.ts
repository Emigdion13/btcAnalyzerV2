/**
 * Timeframe peek — the logic behind the floating “other timeframe” window.
 *
 * The window shows the most recent bars of a resolution *other* than the chart's, including the
 * bar that is still forming, so a 1m chart can be traded with an honest look at what the 15m
 * candle is doing right now. A forming bar is a live range, not a close: everything here reports
 * it separately so the UI can never imply that an unfinished candle has settled.
 *
 * Pure by design (no DOM, no fetch) so the geometry and the resolution math stay testable.
 */
import { bucketStart, INTERVAL_SECONDS, isInterval } from '../../shared/coinbase'
import { TIMEFRAMES } from './market'
import type { Candle, Timeframe } from './types'

/** `auto` follows the chart: it always peeks at a resolution meaningfully above it. */
export const PEEK_AUTO = 'auto' as const
export type PeekResolution = typeof PEEK_AUTO | Timeframe
export const PEEK_RESOLUTIONS: readonly PeekResolution[] = [PEEK_AUTO, ...TIMEFRAMES]

export const PEEK_BARS_MIN = 4
export const PEEK_BARS_MAX = 40
export const PEEK_BARS_DEFAULT = 12

export interface TimeframePeekSettings {
  /** `auto` = the next resolution up from the chart; anything else is pinned by the user. */
  resolution: PeekResolution
  /** How many bars stay in the window, the forming bar included. */
  bars: number
  showVolume: boolean
}

export const TIMEFRAME_PEEK_DEFAULTS: Readonly<TimeframePeekSettings> = {
  resolution: PEEK_AUTO,
  bars: PEEK_BARS_DEFAULT,
  showVolume: true,
}

/** The plot's own coordinate system: the panel scales it, and the axis beside it is CSS. */
export const PEEK_LAYOUT = {
  plotWidth: 186,
  priceHeight: 92,
  volumeHeight: 18,
  gap: 5,
  padTop: 4,
} as const

export const isPeekResolution = (value: unknown): value is PeekResolution =>
  value === PEEK_AUTO || isInterval(value)

export function isTimeframePeekSettings(value: unknown): value is TimeframePeekSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as TimeframePeekSettings
  return (
    isPeekResolution(settings.resolution) &&
    Number.isInteger(settings.bars) &&
    settings.bars >= PEEK_BARS_MIN &&
    settings.bars <= PEEK_BARS_MAX &&
    typeof settings.showVolume === 'boolean'
  )
}

/** Out-of-range counts snap to the nearest bound; unusable values fall back to the default. */
export function clampPeekBars(value: unknown): number {
  const bars = Number(value)
  if (value == null || value === '' || Number.isNaN(bars)) return TIMEFRAME_PEEK_DEFAULTS.bars
  return Math.min(PEEK_BARS_MAX, Math.max(PEEK_BARS_MIN, Math.round(bars)))
}

/** Preferences live in localStorage and are user-editable: a bad value degrades, never crashes. */
export function timeframePeekSettings(value: unknown): TimeframePeekSettings {
  const settings = (value ?? {}) as Partial<TimeframePeekSettings>
  return {
    resolution: isPeekResolution(settings.resolution)
      ? settings.resolution
      : TIMEFRAME_PEEK_DEFAULTS.resolution,
    bars: clampPeekBars(settings.bars),
    showVolume: settings.showVolume !== false,
  }
}

/**
 * How much larger an auto peek bar should be than a chart bar. Fifteen is the ratio that gives a
 * 1m chart its 15m context, a 5m chart its 1h, a 1h chart its daily — a second opinion that is
 * genuinely a different zoom, not the same squiggle with new labels.
 */
export const PEEK_AUTO_RATIO = 15

/** Fraction of the window's own range left clear above and below the drawn bars. */
const PEEK_EDGE_PADDING = 0.06

/**
 * `auto` picks the available resolution nearest that ratio *above* the chart, so it never mirrors
 * the chart or reads its own future; with nothing larger to offer (a weekly chart) it steps down.
 */
export function peekResolution(
  settings: Pick<TimeframePeekSettings, 'resolution'>,
  chart: Timeframe,
): Timeframe {
  if (settings.resolution !== PEEK_AUTO) return settings.resolution
  const chartSeconds = INTERVAL_SECONDS[chart]
  const above = TIMEFRAMES.filter((interval) => INTERVAL_SECONDS[interval] > chartSeconds)
  if (!above.length) return TIMEFRAMES[TIMEFRAMES.length - 2]
  // Log distance, so 6× and 42× are judged as equally-far steps either side of 15×.
  const distance = (interval: Timeframe) =>
    Math.abs(Math.log(INTERVAL_SECONDS[interval] / chartSeconds) - Math.log(PEEK_AUTO_RATIO))
  return above.reduce(
    (best, interval) => (distance(interval) < distance(best) ? interval : best),
    above[0],
  )
}

/** Bars of the charted resolution per peek bar (or the inverse, when peeking below the chart). */
export function peekRatio(peek: Timeframe, chart: Timeframe): number {
  return INTERVAL_SECONDS[peek] / INTERVAL_SECONDS[chart]
}

export function peekRatioLabel(peek: Timeframe, chart: Timeframe): string {
  const ratio = peekRatio(peek, chart)
  if (ratio === 1) return 'same resolution as this chart'
  if (ratio > 1) {
    const rounded = Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(1)
    return `1 bar = ${rounded} chart bar${rounded === '1' ? '' : 's'}`
  }
  const inverse = 1 / ratio
  const rounded = Number.isInteger(inverse) ? String(inverse) : inverse.toFixed(1)
  return `${rounded} bars = 1 chart bar`
}

/** The most recent `bars` candles, oldest first. Short feeds are returned whole. */
export function peekWindow(candles: Candle[], bars: number): Candle[] {
  if (!candles.length) return []
  const size = clampPeekBars(bars)
  return candles.length <= size ? [...candles] : candles.slice(-size)
}

/** A bar is still forming while the clock is inside its bucket — the same rule the chart uses. */
export const peekIsForming = (
  candle: Candle | undefined,
  interval: Timeframe,
  nowSeconds: number,
): boolean => !!candle && bucketStart(nowSeconds, interval) === candle.time

/** Seconds left in the forming bar; 0 once it has closed. */
export function peekTimeRemaining(
  candle: Candle | undefined,
  interval: Timeframe,
  nowSeconds: number,
): number {
  if (!candle) return 0
  return Math.max(0, candle.time + INTERVAL_SECONDS[interval] - nowSeconds)
}

export function formatPeekCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total >= 86400) return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

export interface PeekStats {
  last: Candle
  /** Forming/last bar close against the previous bar's close — the usual "what is it doing" read. */
  change: number | null
  windowHigh: number
  windowLow: number
  /** 0..1 where the current close sits inside the window's range; 0.5 when the range is flat. */
  position: number
  /** Sum of the window's volume, forming bar included. */
  volume: number
  bars: number
}

export function peekStats(candles: Candle[]): PeekStats | null {
  const last = candles.at(-1)
  if (!last) return null
  const previous = candles.length > 1 ? candles[candles.length - 2] : undefined
  let windowHigh = -Infinity,
    windowLow = Infinity,
    volume = 0
  for (const candle of candles) {
    if (candle.high > windowHigh) windowHigh = candle.high
    if (candle.low < windowLow) windowLow = candle.low
    volume += Number.isFinite(candle.volume) ? candle.volume : 0
  }
  const reference = previous?.close ?? last.open
  const range = windowHigh - windowLow
  return {
    last,
    change: reference > 0 ? (last.close / reference - 1) * 100 : null,
    windowHigh,
    windowLow,
    position: range > 0 ? Math.min(1, Math.max(0, (last.close - windowLow) / range)) : 0.5,
    volume,
    bars: candles.length,
  }
}

export interface PeekBarGeometry {
  time: number
  /** Slot centre, in SVG user units. */
  x: number
  slot: number
  width: number
  wickTop: number
  wickBottom: number
  bodyTop: number
  bodyHeight: number
  volumeTop: number
  volumeHeight: number
  up: boolean
  forming: boolean
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Vertical band the panel draws in; the CSS sizes the surrounding chrome around it. */
export interface PeekLayoutSizes {
  priceHeight: number
  volumeHeight: number
  gap: number
  padTop: number
}

export interface PeekLayout {
  bars: PeekBarGeometry[]
  width: number
  height: number
  priceTop: number
  priceBottom: number
  volumeTop: number
  /** Padded extremes the vertical scale was built from. */
  high: number
  low: number
  /** Gridlines worth labeling, highest first. */
  levels: { price: number; y: number }[]
  /** Where the current close sits, so the axis marker and the plot agree. */
  lastCloseY: number
  lastClose: number
  volumeMax: number
}

/**
 * Project a window of candles into the panel's fixed-size plot. Prices are scaled to the window
 * itself (never to the chart), so the peek reads its own structure rather than a squashed copy of
 * the main chart, and every bar is clamped inside the canvas so a stray tick can't draw off-panel.
 */
export function layoutPeekBars(
  candles: Candle[],
  options: {
    forming?: boolean
    showVolume?: boolean
    width?: number
    sizes?: PeekLayoutSizes
  } = {},
): PeekLayout {
  const width = options.width ?? PEEK_LAYOUT.plotWidth
  const sizes = options.sizes ?? PEEK_LAYOUT
  const showVolume = options.showVolume ?? false
  const priceTop = sizes.padTop
  const priceBottom = priceTop + sizes.priceHeight
  const volumeTop = showVolume ? priceBottom + sizes.gap : priceBottom
  const volumeBottom = showVolume ? volumeTop + sizes.volumeHeight : priceBottom
  const height = volumeBottom + sizes.padTop
  const bars: PeekBarGeometry[] = []
  if (!candles.length)
    return {
      bars,
      width,
      height,
      priceTop,
      priceBottom,
      volumeTop,
      high: 0,
      low: 0,
      levels: [],
      lastCloseY: priceTop,
      lastClose: NaN,
      volumeMax: 0,
    }

  let high = -Infinity,
    low = Infinity,
    volumeMax = 0
  for (const candle of candles) {
    if (candle.high > high) high = candle.high
    if (candle.low < low) low = candle.low
    if (candle.volume > volumeMax) volumeMax = candle.volume
  }
  // Six percent of the window's range of air above and below, so the top and bottom wicks are
  // never flush with the canvas. A flat window still needs a span to divide by: 0.1% of price.
  const range = high - low
  const span =
    range > 0 ? range * (1 + PEEK_EDGE_PADDING * 2) : Math.max(Math.abs(high) * 0.001, 1e-9)
  const top = high + range * PEEK_EDGE_PADDING
  const y = (price: number) =>
    priceTop + Math.min(1, Math.max(0, (top - price) / span)) * sizes.priceHeight
  const slot = width / candles.length
  const bodyWidth = Math.min(14, Math.max(1, slot * 0.62))
  const last = candles.length - 1
  const volumeFloor = (candle: Candle) => (candle.volume > 0 ? 1 : 0)
  candles.forEach((candle, index) => {
    const bodyTop = y(Math.max(candle.open, candle.close))
    const bodyBottom = y(Math.min(candle.open, candle.close))
    const volumeFraction =
      volumeMax > 0 && Number.isFinite(candle.volume) ? Math.min(1, candle.volume / volumeMax) : 0
    // A bar with volume always gets a visible line, even against a much louder neighbour.
    const volumeBar = Math.max(volumeFloor(candle), volumeFraction * sizes.volumeHeight)
    bars.push({
      time: candle.time,
      x: index * slot + slot / 2,
      slot,
      width: bodyWidth,
      wickTop: y(candle.high),
      wickBottom: y(candle.low),
      bodyTop,
      // Doji bars keep a hairline body; a zero-height rect reads as a missing bar.
      bodyHeight: Math.max(1, bodyBottom - bodyTop),
      volumeTop: volumeBottom - volumeBar,
      volumeHeight: volumeBar,
      up: candle.close >= candle.open,
      forming: !!options.forming && index === last,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })
  })
  const lastCandle = candles[last]
  return {
    bars,
    width,
    height,
    priceTop,
    priceBottom,
    volumeTop,
    high,
    low,
    levels: [0.25, 0.5, 0.75].map((fraction) => ({
      price: top - span * fraction,
      y: priceTop + fraction * sizes.priceHeight,
    })),
    lastCloseY: y(lastCandle.close),
    lastClose: lastCandle.close,
    volumeMax,
  }
}

/** Bar time as a compact UTC clock; the panel always speaks the exchange's timezone. */
export function peekBarTime(seconds: number, interval: Timeframe): string {
  const date = new Date(seconds * 1000)
  if (interval === '1D' || interval === '1W')
    return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Label for a dropdown entry; `auto` names the resolution it currently resolves to. */
export function peekResolutionLabel(resolution: PeekResolution, chart: Timeframe): string {
  if (resolution === PEEK_AUTO) return `Auto · ${peekResolution({ resolution }, chart)}`
  return resolution === chart ? `${resolution} · this chart` : resolution
}
