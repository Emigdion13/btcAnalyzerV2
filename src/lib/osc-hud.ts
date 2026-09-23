/**
 * Floating windows for the oscillators you watch all day: the last twenty minutes of
 * CM_Ult_MacD_MTF, WaveTrend [LazyBear], RSI Divergence, CM_Williams_Vix_Fix, TMO Scalper
 * and Bayesian/nQQE/BankFunds,
 * drawn as their own little chart instead of squeezed into a full-height pane at the bottom
 * of the screen.
 *
 * Everything here is the arithmetic the cards render from — which bars belong in the window, how
 * the y-scale is chosen, what the numbers and the call are for the bar the crosshair is on. No
 * React, so the trading-relevant part of a floating widget can be tested without a browser.
 *
 * Two rules shape the design:
 *
 * 1. The window is a _view of the indicator_, never a second opinion about it. Values come from
 *    `calculateCmMacd` / `calculateWaveTrend` / `calculateWilliamsVixFix` over the chart's own
 *    candles, so a widget and a pane on the same chart can never disagree, and the settings the
 *    pane uses are the settings the widget uses.
 * 2. "Zoomed" is an autoscaling rule, not a fixed scale: the y range is the largest absolute value
 *    in the window, padded. Oscillators are read around zero, so the scale is symmetric about it —
 *    that keeps the histogram's sign honest at any zoom, and the WaveTrend 53/60 levels walk into
 *    the picture exactly when the oscillator gets close enough for them to matter.
 */
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import { CM_COLORS, cmHistogramColor, cmMacdSettings } from './cm-ult-macd'
import type { CmMacdValues } from './cm-ult-macd'
import { WT_COLORS } from './wave-trend'
import type { WaveTrendValues } from './wave-trend'
import { WVF_COLORS } from './cm-williams-vix-fix'
import type { WilliamsVixFixValues } from './cm-williams-vix-fix'
import {
  TMO_COLORS,
  TMO_CUTOFF,
  TMO_SCALPER_DEFAULTS,
  tmoResolutionLabel,
  tmoScalperFeeds,
  tmoScalperSettings,
} from './tmo-scalper'
import type { TmoScalperValues } from './tmo-scalper'
import {
  BAYES_COLORS,
  bankerBodyColor,
  bayesianSideways,
  nqqeColor,
} from './bayesian-nqqe-bankfunds'
import type { BayesianNqqeValues } from './bayesian-nqqe-bankfunds'
import { formatPrice } from './market'
import { ta } from './indicator-runtime'
import { detectMacdDivergences } from './macd-divergence'
import type { Divergence } from './macd-divergence'
import type { BayesianNqqeSettings, Candle, CmMacdSettings, DivergenceSettings, Indicator, Timeframe, TmoScalperSettings, WaveTrendSettings, WilliamsVixFixSettings } from './types'

/** The five windows, keyed by the indicator kind they mirror. */
export type OscHudKind = Extract<
  Indicator['kind'],
  | 'cm-ult-macd'
  | 'wave-trend'
  | 'rsi-divergence'
  | 'cm-williams-vix-fix'
  | 'tmo-scalper'
  | 'bayesian-nqqe-bankfunds'
>

export const OSC_HUD_KINDS: OscHudKind[] = [
  'cm-ult-macd',
  'wave-trend',
  'rsi-divergence',
  'cm-williams-vix-fix',
  'tmo-scalper',
  'bayesian-nqqe-bankfunds',
]

/**
 * How far back a window looks, in chart minutes. Twenty is a scalper's "what is happening right
 * now": long enough to see a wave complete, short enough that each bar is a chunk you can read
 * without leaning in.
 */
export const OSC_HUD_WINDOW_MINUTES = 20

/**
 * A window of bars, not of minutes, is what a chart can actually draw: on a 15m chart twenty
 * minutes is 1.3 bars. So the window is twenty minutes rounded up, with a floor of bars that keep
 * a wave looking like a wave, and a ceiling past which the mini chart is just the main chart.
 */
export const OSC_HUD_MIN_BARS = 8
export const OSC_HUD_MAX_BARS = 48

/** One step on the zoom stepper. Small, because a 20-bar window is already tight. */
export const OSC_HUD_BAR_STEP = 4

/** Every window starts open: they are the reason this widget set exists, and one keystroke hides them. */
export const OSC_HUD_DEFAULT_VISIBLE = true

/** Share of the window's own magnitude left as air above and below the extremes. */
export const OSC_HUD_EDGE_PADDING = 0.14

export interface OscHudWidget {
  kind: OscHudKind
  /** Card title. */
  title: string
  /** Toolbar and menu label. */
  button: string
  /** Dot, title bar, and the card's glow. */
  accent: string
  /** localStorage key for the open/closed choice, so App and the card never drift. */
  visibilityKey: string
  positionKey: string
  minimizedKey: string
}

export const OSC_HUD_WIDGETS: Record<OscHudKind, OscHudWidget> = {
  'cm-ult-macd': {
    kind: 'cm-ult-macd',
    title: 'CM_Ult_MacD_MTF',
    button: 'CM MACD',
    accent: '#8ee06a',
    visibilityKey: 'osc-hud-visible:cm-ult-macd',
    positionKey: 'osc-hud-pos:cm-ult-macd',
    minimizedKey: 'osc-hud-min:cm-ult-macd',
  },
  'wave-trend': {
    kind: 'wave-trend',
    title: 'WaveTrend [LazyBear]',
    button: 'WaveTrend',
    accent: '#5b9dff',
    visibilityKey: 'osc-hud-visible:wave-trend',
    positionKey: 'osc-hud-pos:wave-trend',
    minimizedKey: 'osc-hud-min:wave-trend',
  },
  'rsi-divergence': {
    kind: 'rsi-divergence',
    title: 'RSI Divergence',
    button: 'RSI Div',
    accent: '#ad91e5',
    visibilityKey: 'osc-hud-visible:rsi-divergence',
    positionKey: 'osc-hud-pos:rsi-divergence',
    minimizedKey: 'osc-hud-min:rsi-divergence',
  },
  'cm-williams-vix-fix': {
    kind: 'cm-williams-vix-fix',
    title: 'CM_Williams_Vix_Fix',
    button: 'VIX Fix',
    accent: '#4ade80',
    visibilityKey: 'osc-hud-visible:cm-williams-vix-fix',
    positionKey: 'osc-hud-pos:cm-williams-vix-fix',
    minimizedKey: 'osc-hud-min:cm-williams-vix-fix',
  },
  'tmo-scalper': {
    kind: 'tmo-scalper',
    title: 'TMO Scalper',
    button: 'TMO Scalper',
    accent: '#7cfc00',
    visibilityKey: 'osc-hud-visible:tmo-scalper',
    positionKey: 'osc-hud-pos:tmo-scalper',
    minimizedKey: 'osc-hud-min:tmo-scalper',
  },
  'bayesian-nqqe-bankfunds': {
    kind: 'bayesian-nqqe-bankfunds',
    title: 'Bayesian/nQQE/BankFunds',
    button: 'Bayesian',
    accent: '#f0c14a',
    visibilityKey: 'osc-hud-visible:bayesian-nqqe-bankfunds',
    positionKey: 'osc-hud-pos:bayesian-nqqe-bankfunds',
    minimizedKey: 'osc-hud-min:bayesian-nqqe-bankfunds',
  },
}

/** Same contract as the RSI meter: `null` is "never chosen", which defers to the default. */
export function oscHudVisible(preference: boolean | null): boolean {
  return preference ?? OSC_HUD_DEFAULT_VISIBLE
}

/** Out-of-range counts snap to the nearest bound; garbage falls back to the full window. */
export function clampOscHudBars(value: unknown, timeframe: Timeframe): number {
  const seconds = INTERVAL_SECONDS[timeframe] ?? 60
  const fallback = Math.ceil((OSC_HUD_WINDOW_MINUTES * 60) / seconds)
  const bars = Number(value)
  const chosen =
    value == null || value === '' || !Number.isFinite(bars) ? fallback : Math.round(bars)
  return Math.min(OSC_HUD_MAX_BARS, Math.max(OSC_HUD_MIN_BARS, chosen))
}

/**
 * Bars in the window: twenty minutes of the chart's own bars, or the floor when the bars are
 * longer than that. A stored zoom for this widget wins over the timeframe default.
 */
export function oscHudBars(timeframe: Timeframe, override?: unknown): number {
  return clampOscHudBars(override ?? null, timeframe)
}

/**
 * Axis labels are scale, not measurement: a window of MACD values does not need to be read to
 * four decimals to know how big its own swing is.
 */
export function oscHudScaleLabel(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : abs >= 0.01 ? 3 : 5
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** How wide the window really is, for the label the card shows so nothing looks like a lie. */
export function oscHudSpan(bars: number, timeframe: Timeframe): string {
  const seconds = (INTERVAL_SECONDS[timeframe] ?? 60) * bars
  const minutes = seconds / 60
  const trim = (value: number) => String(Math.round(value * 10) / 10)
  if (minutes < 60) return `${trim(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${trim(hours)}h`
  const days = hours / 24
  return days < 7 ? `${trim(days)}d` : `${trim(days / 7)}w`
}

/**
 * The symmetric y-scale described in the file header. The zero line always sits dead centre, so
 * "how far from neutral" is a glance, not a measurement, and the window's own extremes set the
 * magnification. A perfectly flat window still needs a span to divide by.
 */
export interface OscHudDomain {
  min: number
  max: number
}

/**
 * The scale for a series that is not read around zero. Unlike `oscHudDomain`, this does not
 * mirror the extremes: the window spans the actual min and max, padded, the same idea as the
 * VIX Fix card's one-sided range. A flat window still needs a span to divide by.
 */
export function oscHudDataDomain(series: (number | null)[][]): OscHudDomain {
  let min = Infinity
  let max = -Infinity
  for (const values of series) {
    for (const value of values) {
      if (value !== null && Number.isFinite(value)) {
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * OSC_HUD_EDGE_PADDING)
    return { min: min - pad, max: max + pad }
  }
  const pad = (max - min) * OSC_HUD_EDGE_PADDING
  return { min: min - pad, max: max + pad }
}

export function oscHudDomain(series: (number | null)[][]): OscHudDomain {
  let bound = 0
  for (const values of series) {
    for (const value of values) {
      if (value !== null && Number.isFinite(value)) bound = Math.max(bound, Math.abs(value))
    }
  }
  if (!(bound > 0)) bound = 1
  const padded = bound * (1 + OSC_HUD_EDGE_PADDING)
  return { min: -padded, max: padded }
}

export const OSC_HUD_LAYOUT = {
  width: 226,
  height: 104,
  padTop: 8,
  padBottom: 8,
} as const

export interface OscHudGeometry {
  width: number
  height: number
  plotHeight: number
  /** Horizontal room one bar gets, in view units. */
  slot: number
  /** Histogram bar width: most of the slot, so the bars read as blocks at this size. */
  barWidth: number
  /** Centre x of each bar, oldest first. */
  x: number[]
  /** Pixel y of a value, clamped into the plot box so a stray spike cannot escape the card. */
  y: (value: number) => number
  /** The zero line, which by construction is the middle of the box. */
  zeroY: number
}

export function oscHudGeometry(
  count: number,
  domain: OscHudDomain,
  width: number = OSC_HUD_LAYOUT.width,
  height: number = OSC_HUD_LAYOUT.height,
): OscHudGeometry {
  const plotHeight = Math.max(1, height - OSC_HUD_LAYOUT.padTop - OSC_HUD_LAYOUT.padBottom)
  const slot = count > 0 ? width / count : width
  const span = domain.max - domain.min || 1
  const at = (value: number) =>
    OSC_HUD_LAYOUT.padTop + Math.min(1, Math.max(0, (domain.max - value) / span)) * plotHeight
  const x = Array.from({ length: count }, (_, index) => index * slot + slot / 2)
  return {
    width,
    height,
    plotHeight,
    slot,
    barWidth: Math.min(11, Math.max(2, slot * 0.66)),
    x,
    y: at,
    zeroY: at(0),
  }
}

/** Levels are drawn only while the window's own scale can show them; see rule 2 above. */
export function oscHudLevels(levels: OscHudLevel[], domain: OscHudDomain): OscHudLevel[] {
  return levels.filter((level) => level.value >= domain.min && level.value <= domain.max)
}

export type OscHudTone = 'bull' | 'bear' | 'ob' | 'os' | 'flat'

export interface OscHudTrace {
  title: string
  color: string
  /** Already sliced to the window, oldest first. */
  values: (number | null)[]
  width: number
  style: 'line' | 'dots' | 'area' | 'tri-up' | 'tri-down'
  /** Pine `transp`, for the area fills the originals used. */
  transp?: number
  dash?: string
  /** Legend/tooltip order hint — higher draws last, so it sits on top. */
  z?: number
}

export interface OscHudHistogram {
  values: (number | null)[]
  colors: string[]
}

/** A column drawn between two prices, not from zero. Absent unless the window asks for it. */
export interface OscHudColumns {
  high: (number | null)[]
  low: (number | null)[]
  colors: string[]
}

export interface OscHudLevel {
  value: number
  color: string
  label: string
  dashed: boolean
}

export interface OscHudReadout {
  label: string
  value: string
  color?: string
  title?: string
}

export interface OscHudVerdict {
  text: string
  tone: OscHudTone
  detail: string
}

export interface OscHudModel {
  kind: OscHudKind
  title: string
  /** Settings summary, so the card can say what it is measuring. */
  subtitle: string
  accent: string
  times: number[]
  traces: OscHudTrace[]
  histogram?: OscHudHistogram
  /** Banker fund columns. When set, the card does not also draw a zero-based histogram. */
  columns?: OscHudColumns
  levels: OscHudLevel[]
  domain: OscHudDomain
  /** Index into `times` the readouts speak about; null when the crosshair is outside the window. */
  activeIndex: number | null
  /** Whether the active bar is a historical/hovered one rather than the live bar. */
  hovered: boolean
  bars: number
  spanLabel: string
  readouts: OscHudReadout[]
  verdict: OscHudVerdict
  /** True when the window holds a number the chart can show. */
  ready: boolean
  /** Why there is nothing to show, when that is the case. */
  note: string | null
  /** Whether the settings came from the chart's own indicator or from the published defaults. */
  settingsSource: 'chart' | 'defaults'
}

export interface OscHudModelInput {
  /** Chart bar times, full length. */
  times: number[]
  timeframe: Timeframe
  bars: number
  /** Full-length index to read the numbers from — the hovered bar, or the latest one. */
  index: number
  /** True when that index is a hovered historical bar. */
  hovered?: boolean
  /** Shown when the window is empty, so "no data" explains itself. */
  note?: string | null
  settingsSource?: 'chart' | 'defaults'
}

/** Window start, so every series and the times are cut on the same line. */
function windowStart(length: number, bars: number): number {
  return Math.max(0, length - bars)
}

/**
 * Gaps for the mini chart: null, undefined and anything not finite all mean "no value here".
 * A borrowed series can carry a NaN — a synthetic asset with no price yet, or a zero-divided-by-
 * zero in the channel index — and one NaN in a point list is enough to drop the whole polyline,
 * so it becomes a gap instead of a coordinate.
 */
const finite = (values: (number | null)[]): (number | null)[] =>
  values.map((value) =>
    value === null || value === undefined || !Number.isFinite(value) ? null : value,
  )

const trim = (value: number | null): string => (value === null ? '—' : formatPrice(value))

/** Change from one bar to the next, in the unit the indicator itself is quoted in. */
export function oscHudDelta(
  values: (number | null)[],
  index: number,
): { delta: number | null; text: string | null } {
  const current = values[index]
  const previous = index > 0 ? values[index - 1] : null
  if (current === null || current === undefined || previous === null || previous === undefined)
    return { delta: null, text: null }
  const delta = current - previous
  return { delta, text: `${delta >= 0 ? '+' : ''}${trim(delta)}` }
}

/**
 * ChrisMoody's call, in the order the original teaches it: the signal-line cross first, then the
 * standing relationship, with the histogram's direction and which side of zero the MACD is on as
 * the small print.
 */
export function cmMacdVerdict(
  macd: number | null,
  signal: number | null,
  previousMacd: number | null,
  previousSignal: number | null,
  histogram: number | null,
  previousHistogram: number | null,
): OscHudVerdict {
  if (macd === null || signal === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  const above = macd >= signal
  const crossed =
    previousMacd !== null && previousSignal !== null && above !== previousMacd >= previousSignal
  const rising =
    histogram !== null && previousHistogram !== null ? histogram > previousHistogram : null
  const aboveZero = macd >= 0
  const zeroCross = previousMacd !== null && aboveZero !== previousMacd >= 0
  const detail = [
    `histogram ${rising === null ? 'level' : rising ? 'rising' : 'falling'}`,
    `MACD ${aboveZero ? 'above' : 'below'} zero${zeroCross ? ' (just crossed)' : ''}`,
  ].join(' · ')
  if (crossed)
    return {
      text: above ? '▲ MACD CROSSed ABOVE SIGNAL' : '▼ MACD CROSSed BELOW SIGNAL',
      tone: above ? 'bull' : 'bear',
      detail,
    }
  return {
    text: above ? '▲ ABOVE SIGNAL' : '▼ BELOW SIGNAL',
    tone: above ? 'bull' : 'bear',
    detail,
  }
}

/**
 * LazyBear's call: the wt1/wt2 cross, and the 53/60 band that turns an ordinary cross into the
 * one worth taking. Zone first when the oscillator is parked in it, because that is the fact.
 */
export function waveTrendVerdict(
  wt1: number | null,
  wt2: number | null,
  previousWt1: number | null,
  previousWt2: number | null,
  settings: WaveTrendSettings,
): OscHudVerdict {
  if (wt1 === null || wt2 === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  const crossedUp =
    previousWt1 !== null && previousWt2 !== null && wt1 > wt2 && previousWt1 <= previousWt2
  const crossedDown =
    previousWt1 !== null && previousWt2 !== null && wt1 < wt2 && previousWt1 >= previousWt2
  const inOversold = wt1 <= settings.osLevel2
  const inOverbought = wt1 >= settings.obLevel2
  if (crossedUp)
    return {
      text: inOversold ? '▲ CROSS UP IN OVERSOLD' : '▲ WT1 CROSSED ABOVE WT2',
      tone: 'bull',
      detail: `wt1 ${trim(wt1)} · osc ${trim(wt1 - wt2)}`,
    }
  if (crossedDown)
    return {
      text: inOverbought ? '▼ CROSS DOWN IN OVERBOUGHT' : '▼ WT1 CROSSED BELOW WT2',
      tone: 'bear',
      detail: `wt1 ${trim(wt1)} · osc ${trim(wt1 - wt2)}`,
    }
  if (wt1 >= settings.obLevel1)
    return {
      text: '🔥 OVERBOUGHT',
      tone: 'ob',
      detail: `above ${trim(settings.obLevel1)} · ${inOverbought ? 'past' : 'before'} the ${trim(
        settings.obLevel2,
      )} mark`,
    }
  if (wt1 <= settings.osLevel1)
    return {
      text: '⚡ OVERSOLD',
      tone: 'os',
      detail: `below ${trim(settings.osLevel1)} · ${inOversold ? 'past' : 'before'} the ${trim(
        settings.osLevel2,
      )} mark`,
    }
  return {
    text: wt1 >= wt2 ? '▲ RISING' : '▼ FALLING',
    tone: wt1 >= wt2 ? 'bull' : 'bear',
    detail: `wt1 ${trim(wt1)} · osc ${trim(wt1 - wt2)}`,
  }
}

/**
 * The CM MACD window. Values arrive full-length (that is what `calculateCmMacd` returns, and what
 * the pane plots), so the histogram's colours can know their own predecessor across the window
 * edge and the crosshair can land on an older bar.
 */
export function cmMacdHudModel(
  values: CmMacdValues,
  settings: CmMacdSettings,
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const macd = finite(cut(values.macd))
  const signal = finite(cut(values.signal))
  const histogram = finite(cut(values.histogram))
  // Colour is decided against the previous bar of the full series, across the window edge: a bar
  // is aqua because it rose, and the bar it rose from can sit outside the twenty minutes.
  const colors = cut(
    values.histogram.map((value, index) =>
      cmHistogramColor(
        Number.isFinite(value) ? value : null,
        Number.isFinite(values.histogram[index - 1]) ? values.histogram[index - 1] : null,
        settings.histogramColorChange,
      ),
    ),
  )
  const domain = oscHudDomain([
    macd,
    signal,
    settings.showHistogram ? histogram : [],
    settings.showLines ? [] : macd,
  ])
  const activeIndex = input.index - start
  const at = (source: (number | null)[]) =>
    activeIndex >= 0 && activeIndex < source.length ? (source[activeIndex] ?? null) : null
  const activeMacd = at(macd)
  const activeSignal = at(signal)
  const activeHistogram = at(histogram)
  const previousIndex = activeIndex - 1
  const before = (source: (number | null)[]) =>
    previousIndex >= 0 && previousIndex < source.length ? (source[previousIndex] ?? null) : null

  const traces: OscHudTrace[] = []
  if (settings.showLines) {
    traces.push({
      title: 'MACD',
      color: settings.macdColorChange ? CM_COLORS.lime : CM_COLORS.red,
      values: macd,
      width: 2,
      style: 'line',
      z: 2,
    })
    traces.push({
      title: 'Signal Line',
      color: settings.macdColorChange ? CM_COLORS.yellow : CM_COLORS.lime,
      values: signal,
      width: 1.5,
      style: 'line',
      z: 1,
    })
  }
  if (settings.showDots) {
    // `cross()` in the original: a marker on the signal line at the bar that crossed.
    const dots = macd.map((value, index) => {
      const prior = index > 0 ? macd[index - 1] : null
      const priorSignal = index > 0 ? signal[index - 1] : null
      const here = value ?? null
      const line = signal[index] ?? null
      if (
        here === null ||
        line === null ||
        prior === null ||
        priorSignal === null ||
        start + index === 0
      )
        return null
      return (here >= line && prior < priorSignal) || (here < line && prior >= priorSignal)
        ? line
        : null
    })
    traces.push({
      title: 'Cross',
      color: settings.macdColorChange ? CM_COLORS.lime : CM_COLORS.red,
      values: dots,
      width: 3.4,
      style: 'dots',
      z: 3,
    })
  }

  const delta =
    activeHistogram !== null && previousIndex >= 0
      ? oscHudDelta(histogram, activeIndex)
      : { delta: null, text: null }

  return {
    kind: 'cm-ult-macd',
    title: OSC_HUD_WIDGETS['cm-ult-macd'].title,
    subtitle: `${cmMacdResolutionsLabel(settings, input.timeframe)} · ${settings.fastLength}/${
      settings.slowLength
    }/${settings.signalLength}`,
    accent: OSC_HUD_WIDGETS['cm-ult-macd'].accent,
    times,
    traces,
    histogram: settings.showHistogram ? { values: histogram, colors } : undefined,
    levels: oscHudLevels([{ value: 0, color: CM_COLORS.white, label: '0', dashed: false }], domain),
    domain,
    activeIndex: activeIndex >= 0 && activeIndex < times.length ? activeIndex : null,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      { label: 'MACD', value: trim(activeMacd), color: CM_COLORS.lime },
      { label: 'Signal', value: trim(activeSignal), color: CM_COLORS.yellow },
      {
        label: 'Hist',
        value: trim(activeHistogram),
        color: activeHistogram === null ? undefined : colors[activeIndex ?? 0],
        title: delta.text === null ? undefined : `Bar over bar: ${delta.text}`,
      },
    ],
    verdict: cmMacdVerdict(
      activeMacd,
      activeSignal,
      before(macd),
      before(signal),
      activeHistogram,
      before(histogram),
    ),
    ready: macd.some((value) => value !== null) || histogram.some((value) => value !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/** What resolution the MACD is being computed on, spelled the way the card reads. */
function cmMacdResolutionsLabel(settings: CmMacdSettings, chart: Timeframe): string {
  const resolution = settings.useCurrentRes ? chart : settings.resCustom
  return `${resolution}${resolution === chart ? ' (chart)' : ' (MTF)'}`
}

/** The WaveTrend window: wt1, the dotted wt2, and the area between them the original plots. */
export function waveTrendHudModel(
  values: WaveTrendValues,
  settings: WaveTrendSettings,
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const wt1 = finite(cut(values.wt1))
  const wt2 = finite(cut(values.wt2))
  const diff = finite(cut(values.diff))
  const domain = oscHudDomain([wt1, wt2, diff])
  const activeIndex = input.index - start
  const at = (source: (number | null)[]) =>
    activeIndex >= 0 && activeIndex < source.length ? (source[activeIndex] ?? null) : null
  const activeWt1 = at(wt1)
  const activeWt2 = at(wt2)
  const activeDiff = at(diff)
  const previousIndex = activeIndex - 1
  const before = (source: (number | null)[]) =>
    previousIndex >= 0 && previousIndex < source.length ? (source[previousIndex] ?? null) : null

  const levels = oscHudLevels(
    [
      {
        value: settings.obLevel1,
        color: WT_COLORS.red,
        label: `${settings.obLevel1}`,
        dashed: false,
      },
      {
        value: settings.obLevel2,
        color: WT_COLORS.red,
        label: `${settings.obLevel2}`,
        dashed: true,
      },
      {
        value: settings.osLevel2,
        color: WT_COLORS.green,
        label: `${settings.osLevel2}`,
        dashed: true,
      },
      {
        value: settings.osLevel1,
        color: WT_COLORS.green,
        label: `${settings.osLevel1}`,
        dashed: false,
      },
      { value: 0, color: WT_COLORS.gray, label: '0', dashed: false },
    ],
    domain,
  )

  return {
    kind: 'wave-trend',
    title: OSC_HUD_WIDGETS['wave-trend'].title,
    subtitle: `Wave ${settings.channelLength} · avg ${settings.averageLength} · wt2 sma 4`,
    accent: OSC_HUD_WIDGETS['wave-trend'].accent,
    times,
    traces: [
      {
        title: 'WT1 - WT2',
        color: WT_COLORS.blue,
        values: diff,
        width: 1,
        style: 'area',
        transp: 80,
        z: 0,
      },
      {
        title: 'WT1',
        color: WT_COLORS.green,
        values: wt1,
        width: 2,
        style: 'line',
        z: 2,
      },
      {
        // The published `style=cross` series: at this size a dashed line is the same
        // information — a second, slower trace you can read against wt1 — without the dots
        // dissolving into noise between the bars.
        title: 'WT2',
        color: WT_COLORS.red,
        values: wt2,
        width: 1.6,
        style: 'line',
        dash: '2 2',
        z: 1,
      },
    ],
    levels,
    domain,
    activeIndex: activeIndex >= 0 && activeIndex < times.length ? activeIndex : null,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      { label: 'WT1', value: trim(activeWt1), color: WT_COLORS.green },
      { label: 'WT2', value: trim(activeWt2), color: WT_COLORS.red },
      {
        label: 'Osc',
        value: trim(activeDiff),
        color: WT_COLORS.blue,
        title:
          activeDiff === null || before(diff) === null
            ? undefined
            : `Bar over bar: ${activeDiff - (before(diff) as number) >= 0 ? '+' : ''}${trim(
                activeDiff - (before(diff) as number),
              )}`,
      },
    ],
    verdict: waveTrendVerdict(activeWt1, activeWt2, before(wt1), before(wt2), settings),
    ready: wt1.some((value) => value !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/**
 * Verdict logic for RSI Divergence:
 * Priority: confirmed divergence on the bar, then recent divergence (within 3 bars),
 * then overbought (>= 70), oversold (<= 30), and lastly midline momentum (>= 50 or < 50).
 */
export function rsiDivergenceVerdict(
  activeRsi: number | null,
  previousRsi: number | null,
  activeDiv: Divergence | null,
  recentDiv: Divergence | null,
  currentIndex: number,
): OscHudVerdict {
  if (activeRsi === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  if (activeDiv) {
    const tone = activeDiv.bullish ? 'bull' : 'bear'
    const name = activeDiv.hidden ? 'HIDDEN' : 'REGULAR'
    const side = activeDiv.bullish ? 'BULL' : 'BEAR'
    return {
      text: `${activeDiv.bullish ? '▲' : '▼'} ${name} ${side} DIVERGENCE`,
      tone,
      detail: `${activeDiv.label} · RSI ${activeRsi.toFixed(1)}`,
    }
  }
  if (recentDiv && currentIndex - recentDiv.toIndex <= 3) {
    const barsAgo = currentIndex - recentDiv.toIndex
    const tone = recentDiv.bullish ? 'bull' : 'bear'
    return {
      text: `${recentDiv.bullish ? '▲' : '▼'} ${recentDiv.label.toUpperCase()} (${barsAgo}b ago)`,
      tone,
      detail: `${recentDiv.kind} · RSI ${activeRsi.toFixed(1)}`,
    }
  }
  if (activeRsi >= 70) {
    return {
      text: '🔥 OVERBOUGHT',
      tone: 'ob',
      detail: `RSI ${activeRsi.toFixed(1)} ≥ 70`,
    }
  }
  if (activeRsi <= 30) {
    return {
      text: '⚡ OVERSOLD',
      tone: 'os',
      detail: `RSI ${activeRsi.toFixed(1)} ≤ 30`,
    }
  }
  const rising = previousRsi !== null ? activeRsi > previousRsi : null
  if (activeRsi >= 50) {
    return {
      text: '▲ BULLISH MOMENTUM',
      tone: 'bull',
      detail: `RSI ${activeRsi.toFixed(1)} ≥ 50${rising !== null ? ` · ${rising ? 'rising' : 'falling'}` : ''}`,
    }
  }
  return {
    text: '▼ BEARISH MOMENTUM',
    tone: 'bear',
    detail: `RSI ${activeRsi.toFixed(1)} < 50${rising !== null ? ` · ${rising ? 'rising' : 'falling'}` : ''}`,
  }
}

/**
 * The RSI Divergence window: Wilder RSI line, 70/50/30 levels, divergence dots, and momentum verdict.
 */
export function rsiDivergenceHudModel(
  candles: Candle[],
  settings: { period: number; divergence: DivergenceSettings },
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const close = candles.map((c) => c.close)
  const fullRsi = ta.rsi(close, settings.period)
  const fullDivs = detectMacdDivergences(candles, fullRsi, settings.divergence)
  const rsi = finite(cut(fullRsi))

  const valid = rsi.filter((v): v is number => v !== null)
  const rawMin = valid.length ? Math.min(...valid) : 50
  const rawMax = valid.length ? Math.max(...valid) : 50
  const maxDev = Math.max(25, Math.abs(rawMax - 50), Math.abs(50 - rawMin))
  const paddedDev = Math.min(50, Math.ceil(maxDev * 1.15))
  const domain: OscHudDomain = {
    min: Math.max(0, 50 - paddedDev),
    max: Math.min(100, 50 + paddedDev),
  }

  const activeIndex = input.index - start
  const at = (source: (number | null)[]) =>
    activeIndex >= 0 && activeIndex < source.length ? (source[activeIndex] ?? null) : null
  const activeRsi = at(rsi)
  const previousIndex = activeIndex - 1
  const before = (source: (number | null)[]) =>
    previousIndex >= 0 && previousIndex < source.length ? (source[previousIndex] ?? null) : null
  const previousRsi = before(rsi)

  const activeDiv =
    input.index >= 0 ? (fullDivs.find((d) => d.toIndex === input.index) ?? null) : null
  const recentDiv =
    input.index >= 0 ? (fullDivs.filter((d) => d.toIndex <= input.index).at(-1) ?? null) : null

  const levels = oscHudLevels(
    [
      { value: 70, color: '#ef5350', label: '70', dashed: false },
      { value: 50, color: '#6b7280', label: '50', dashed: true },
      { value: 30, color: '#26a69a', label: '30', dashed: false },
    ],
    domain,
  )

  const traces: OscHudTrace[] = [
    {
      title: 'RSI',
      color: '#ad91e5',
      values: rsi,
      width: 2,
      style: 'line',
      z: 2,
    },
  ]

  const divDots = rsi.map((val, idx) => {
    const fullIdx = start + idx
    const match = fullDivs.find((d) => d.toIndex === fullIdx)
    return match && val !== null ? val : null
  })
  if (divDots.some((v) => v !== null)) {
    traces.push({
      title: 'Divergence',
      color: '#ffffff',
      values: divDots,
      width: 3.4,
      style: 'dots',
      z: 3,
    })
  }

  const delta =
    activeRsi !== null && previousIndex >= 0
      ? oscHudDelta(rsi, activeIndex)
      : { delta: null, text: null }

  const divReadoutText = activeDiv
    ? activeDiv.label
    : recentDiv && input.index - recentDiv.toIndex <= 5
      ? `${recentDiv.label} (${input.index - recentDiv.toIndex}b)`
      : 'None'

  const divReadoutColor = activeDiv
    ? activeDiv.color
    : recentDiv && input.index - recentDiv.toIndex <= 5
      ? recentDiv.color
      : undefined

  return {
    kind: 'rsi-divergence',
    title: OSC_HUD_WIDGETS['rsi-divergence'].title,
    subtitle: `RSI ${settings.period} · lookback ${settings.divergence.pivotLookback}`,
    accent: OSC_HUD_WIDGETS['rsi-divergence'].accent,
    times,
    traces,
    levels,
    domain,
    activeIndex: activeIndex >= 0 && activeIndex < times.length ? activeIndex : null,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      { label: 'RSI', value: activeRsi !== null ? activeRsi.toFixed(1) : '—', color: '#ad91e5' },
      {
        label: 'Delta',
        value: delta.text ?? '—',
        color: delta.delta !== null ? (delta.delta >= 0 ? '#26a69a' : '#ef5350') : undefined,
        title: delta.text ? `Bar over bar: ${delta.text}` : undefined,
      },
      {
        label: 'Div',
        value: divReadoutText,
        color: divReadoutColor,
      },
    ],
    verdict: rsiDivergenceVerdict(activeRsi, previousRsi, activeDiv, recentDiv, input.index),
    ready: rsi.some((v) => v !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/**
 * ChrisMoody's call: a lime bar — WVF at or above its Bollinger upper band or its percentile
 * range-high — is the fear spike the indicator exists to find. Below that, closeness to the
 * nearest trigger is the fact worth naming, and anything else is a quiet tape.
 */
export function williamsVixFixVerdict(
  wvf: number | null,
  upperBand: number | null,
  rangeHigh: number | null,
  previousWvf: number | null,
  green: boolean,
  previousGreen: boolean | null,
): OscHudVerdict {
  if (wvf === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  const fixed = (value: number) => value.toFixed(2)
  if (green) {
    const triggers: string[] = []
    if (upperBand !== null && wvf >= upperBand) triggers.push(`upper ${fixed(upperBand)}`)
    if (rangeHigh !== null && wvf >= rangeHigh) triggers.push(`range-high ${fixed(rangeHigh)}`)
    const detail = triggers.length ? `WVF ${fixed(wvf)} ≥ ${triggers.join(' + ')}` : `WVF ${fixed(wvf)}`
    if (previousGreen === true) return { text: '▲ BOTTOM SIGNAL HOLDS', tone: 'bull', detail }
    return { text: '▲ POTENTIAL BOTTOM', tone: 'bull', detail }
  }
  const triggers: { name: string; value: number }[] = []
  if (upperBand !== null) triggers.push({ name: 'upper', value: upperBand })
  if (rangeHigh !== null) triggers.push({ name: 'range-high', value: rangeHigh })
  const nearest = triggers.length
    ? triggers.reduce((a, b) => (a.value <= b.value ? a : b))
    : null
  const direction =
    previousWvf === null
      ? ''
      : wvf > previousWvf
        ? ' · rising'
        : wvf < previousWvf
          ? ' · falling'
          : ' · level'
  if (!nearest)
    return {
      text: '— QUIET',
      tone: 'flat',
      detail: `WVF ${fixed(wvf)} · bands warming up${direction}`,
    }
  // A non-green bar sits below every trigger, and WVF never goes negative, so the nearest
  // trigger is always positive here and the ratio is the honest distance to a spike.
  const ratio = nearest.value > 0 ? wvf / nearest.value : 1
  if (ratio >= 0.85)
    return {
      text: '⚠ NEAR TRIGGER',
      tone: 'os',
      detail: `WVF ${fixed(wvf)} · ${Math.round(ratio * 100)}% of ${nearest.name} ${fixed(nearest.value)}`,
    }
  return {
    text: '— QUIET',
    tone: 'flat',
    detail: `WVF ${fixed(wvf)} · trigger ${nearest.name} ${fixed(nearest.value)}${direction}`,
  }
}

/**
 * The Williams VIX Fix window: the lime/gray fear histogram rising from zero, with the Bollinger
 * upper band and the percentile range-high exactly when the pane draws them — the same toggles,
 * the same values. The scale is one-sided: WVF lives at and above zero, so a symmetric
 * zero-centred window would waste half the card on values the series never takes. The range-low
 * stays out of the window: no bottom signal ever references it.
 */
export function williamsVixFixHudModel(
  values: WilliamsVixFixValues,
  settings: WilliamsVixFixSettings,
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const wvf = finite(cut(values.wvf))
  const upperBand = finite(cut(values.upperBand))
  const rangeHigh = finite(cut(values.rangeHigh))
  const green = cut(values.isGreen)
  let bound = 0
  for (const series of [wvf, upperBand, rangeHigh]) {
    for (const value of series) {
      if (value !== null && Number.isFinite(value)) bound = Math.max(bound, value)
    }
  }
  if (!(bound > 0)) bound = 1
  const domain: OscHudDomain = { min: 0, max: bound * (1 + OSC_HUD_EDGE_PADDING) }

  const activeIndex = input.index - start
  const at = (source: (number | null)[]) =>
    activeIndex >= 0 && activeIndex < source.length ? (source[activeIndex] ?? null) : null
  const activeWvf = at(wvf)
  const activeUpper = at(upperBand)
  const activeRange = at(rangeHigh)
  const activeGreen =
    activeIndex >= 0 && activeIndex < green.length ? (green[activeIndex] ?? false) : false
  // The previous bar can sit outside the window, so it is read from the full series.
  const rawPreviousWvf = input.index > 0 ? values.wvf[input.index - 1] : null
  const previousWvf =
    rawPreviousWvf !== null && rawPreviousWvf !== undefined && Number.isFinite(rawPreviousWvf)
      ? rawPreviousWvf
      : null
  const previousGreen = input.index > 0 ? (values.isGreen[input.index - 1] ?? null) : null

  const traces: OscHudTrace[] = []
  if (settings.showStdDevLine) {
    traces.push({
      title: 'Upper Band',
      color: WVF_COLORS.aqua,
      values: upperBand,
      width: 1.5,
      style: 'line',
      z: 1,
    })
  }
  if (settings.showHighRange) {
    traces.push({
      title: 'Range High',
      color: WVF_COLORS.orange,
      values: rangeHigh,
      width: 1.5,
      style: 'line',
      z: 1,
    })
  }

  const fixed = (value: number | null) => (value === null ? '—' : value.toFixed(2))
  return {
    kind: 'cm-williams-vix-fix',
    title: OSC_HUD_WIDGETS['cm-williams-vix-fix'].title,
    subtitle: `WVF (${settings.pd}, ${settings.bbl}, ${settings.mult}, ${settings.lb}, ${settings.ph}, ${settings.pl})`,
    accent: OSC_HUD_WIDGETS['cm-williams-vix-fix'].accent,
    times,
    traces,
    histogram: {
      values: wvf,
      colors: green.map((isGreen) => (isGreen ? WVF_COLORS.lime : WVF_COLORS.gray)),
    },
    levels: oscHudLevels([{ value: 0, color: WVF_COLORS.gray, label: '0', dashed: false }], domain),
    domain,
    activeIndex: activeIndex >= 0 && activeIndex < times.length ? activeIndex : null,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      {
        label: 'WVF',
        value: fixed(activeWvf),
        color: activeWvf === null ? undefined : activeGreen ? WVF_COLORS.lime : WVF_COLORS.gray,
      },
      { label: 'Upper', value: fixed(activeUpper), color: WVF_COLORS.aqua },
      { label: 'RangeHi', value: fixed(activeRange), color: WVF_COLORS.orange },
    ],
    verdict: williamsVixFixVerdict(
      activeWvf,
      activeUpper,
      activeRange,
      previousWvf,
      activeGreen,
      previousGreen,
    ),
    ready: wvf.some((value) => value !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/**
 * The scalper's read of the three wheels, in the order the strategy guide teaches it: a TMO 2
 * extreme cross is the trade, a plain gated TMO 2 cross is the signal, a TMO 1 cross is the
 * scalp-level hint, a wheel parked past its extreme or cutoff level names the zone, and only
 * then does the slow wheel's standing direction have the floor.
 */
export function tmoScalperVerdict(
  values: TmoScalperValues,
  settings: TmoScalperSettings,
  activeIndex: number | null,
): OscHudVerdict {
  const at = (source: (number | null)[]) =>
    activeIndex !== null && activeIndex >= 0 && activeIndex < source.length
      ? (source[activeIndex] ?? null)
      : null
  const main2 = at(values.main2)
  const main3 = at(values.main3)
  const signal3 = at(values.signal3)
  if (main2 === null && main3 === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  const wheel3 =
    main3 !== null && signal3 !== null
      ? `TMO 3 ${main3 > signal3 ? 'green' : 'red'} (${tmoResolutionLabel(settings.timeframe3)})`
      : `TMO 3 ${tmoResolutionLabel(settings.timeframe3)} warming up`
  const detail = (wheel: string, value: number | null) =>
    `${wheel} ${trim(value)} · ${wheel3}`
  if (settings.showTmo2ExtremeSignals && at(values.bullExtreme) !== null)
    return { text: '▲ TMO 2 EXTREME BUY', tone: 'bull', detail: detail('at', main2) }
  if (settings.showTmo2ExtremeSignals && at(values.bearExtreme) !== null)
    return { text: '▼ TMO 2 EXTREME SELL', tone: 'bear', detail: detail('at', main2) }
  if (settings.showTmo2Signals && at(values.bull2) !== null)
    return { text: '▲ TMO 2 BUY SIGNAL', tone: 'bull', detail: detail('cross up at', main2) }
  if (settings.showTmo2Signals && at(values.bear2) !== null)
    return { text: '▼ TMO 2 SELL SIGNAL', tone: 'bear', detail: detail('cross down at', main2) }
  if (settings.showTmo1Signals && at(values.bull1) !== null)
    return { text: '▲ TMO 1 cross up', tone: 'bull', detail: detail('TMO 2 at', main2) }
  if (settings.showTmo1Signals && at(values.bear1) !== null)
    return { text: '▼ TMO 1 cross down', tone: 'bear', detail: detail('TMO 2 at', main2) }
  if (main2 !== null && main2 >= settings.extremeOb)
    return {
      text: '🔥 EXTREME OVERBOUGHT',
      tone: 'ob',
      detail: `TMO 2 ${trim(main2)} ≥ ${trim(settings.extremeOb)} · ${wheel3}`,
    }
  if (main2 !== null && main2 <= settings.extremeOs)
    return {
      text: '⚡ EXTREME OVERSOLD',
      tone: 'os',
      detail: `TMO 2 ${trim(main2)} ≤ ${trim(settings.extremeOs)} · ${wheel3}`,
    }
  if (main2 !== null && main2 >= TMO_CUTOFF)
    return { text: '🔥 OVERBOUGHT ZONE', tone: 'ob', detail: detail('TMO 2 at', main2) }
  if (main2 !== null && main2 <= -TMO_CUTOFF)
    return { text: '⚡ OVERSOLD ZONE', tone: 'os', detail: detail('TMO 2 at', main2) }
  const up = main3 !== null && signal3 !== null && main3 > signal3
  return {
    text: up ? '▲ TMO 3 GREEN' : main3 === null ? '— NEUTRAL' : '▼ TMO 3 RED',
    tone: main3 === null ? 'flat' : up ? 'bull' : 'bear',
    detail: detail('TMO 2 at', main2),
  }
}

/**
 * The TMO Scalper window: the three wheels' Main lines with their Signal shadows, drawn from
 * the same chart-aligned values the pane plots, so the fast wheel's wiggle and the slow wheel's
 * slope read at a glance. The gated crosses print as the published circles, and the ▲/▼ markers
 * of the profile are the TMO 2 and extreme flags. Levels shown are the ±15 cutoffs and the ±9
 * extremes, and only while the window's own scale can reach them — like every other window's.
 */
export function tmoScalperHudModel(
  values: TmoScalperValues,
  settings: TmoScalperSettings,
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const main1 = finite(cut(values.main1))
  const signal1 = finite(cut(values.signal1))
  const main2 = finite(cut(values.main2))
  const signal2 = finite(cut(values.signal2))
  const main3 = finite(cut(values.main3))
  const signal3 = finite(cut(values.signal3))
  const bull1 = cut(values.bull1)
  const bear1 = cut(values.bear1)
  const bull2 = cut(values.bull2)
  const bear2 = cut(values.bear2)
  const bullExtreme = cut(values.bullExtreme)
  const bearExtreme = cut(values.bearExtreme)
  const domain = oscHudDomain([main1, signal1, main2, signal2, main3, signal3])
  const activeIndex = input.index - start
  const active = activeIndex >= 0 && activeIndex < times.length ? activeIndex : null
  const at = (source: (number | null)[]) =>
    active !== null && active < source.length ? (source[active] ?? null) : null

  const levels = oscHudLevels(
    [
      { value: TMO_CUTOFF, color: TMO_COLORS.bear, label: `${TMO_CUTOFF}`, dashed: false },
      { value: settings.extremeOb, color: TMO_COLORS.bear, label: `${settings.extremeOb}`, dashed: true },
      { value: settings.extremeOs, color: TMO_COLORS.bull, label: `${settings.extremeOs}`, dashed: true },
      { value: -TMO_CUTOFF, color: TMO_COLORS.bull, label: `${-TMO_CUTOFF}`, dashed: false },
      { value: 0, color: TMO_COLORS.zero, label: '0', dashed: false },
    ],
    domain,
  )

  const traces: OscHudTrace[] = []
  if (settings.showLines) {
    traces.push(
      // The slow wheel thicker and underneath, like the pane's dark pair.
      {
        title: 'TMO 3 Main',
        color: TMO_COLORS.tmo2Bull,
        values: main3,
        width: 2.4,
        style: 'line',
        z: 1,
      },
      {
        title: 'TMO 3 Signal',
        color: TMO_COLORS.tmo2Bear,
        values: signal3,
        width: 1.4,
        style: 'line',
        dash: '2 3',
        z: 2,
      },
      {
        title: 'TMO 2 Main',
        color: TMO_COLORS.bull,
        values: main2,
        width: 1.8,
        style: 'line',
        z: 3,
      },
      {
        title: 'TMO 2 Signal',
        color: TMO_COLORS.bear,
        values: signal2,
        width: 1.3,
        style: 'line',
        dash: '2 2',
        z: 4,
      },
      {
        title: 'TMO 1 Main',
        color: TMO_COLORS.tmo1Bull,
        values: main1,
        width: 1.5,
        style: 'line',
        z: 5,
      },
      {
        title: 'TMO 1 Signal',
        color: TMO_COLORS.bear,
        values: signal1,
        width: 1.1,
        style: 'line',
        dash: '1 3',
        z: 6,
      },
    )
  }
  if (settings.showTmo1Signals) {
    traces.push(
      {
        title: 'TMO 1 Bullish',
        color: TMO_COLORS.tmo1Bull,
        values: bull1,
        width: 3.2,
        style: 'dots',
        z: 7,
      },
      {
        title: 'TMO 1 Bearish',
        color: TMO_COLORS.bear,
        values: bear1,
        width: 3.2,
        style: 'dots',
        z: 7,
      },
    )
  }
  if (settings.showTmo2Signals) {
    traces.push(
      {
        title: 'TMO 2 Bullish',
        color: TMO_COLORS.tmo2Bull,
        values: bull2,
        width: 4.6,
        style: 'tri-up',
        z: 8,
      },
      {
        title: 'TMO 2 Bearish',
        color: TMO_COLORS.tmo2Bear,
        values: bear2,
        width: 4.6,
        style: 'tri-down',
        z: 8,
      },
    )
  }
  if (settings.showTmo2ExtremeSignals) {
    traces.push(
      {
        title: 'TMO 2 Extreme Bullish',
        color: TMO_COLORS.extremeBull,
        values: bullExtreme,
        width: 5,
        style: 'tri-up',
        z: 9,
      },
      {
        title: 'TMO 2 Extreme Bearish',
        color: TMO_COLORS.extremeBear,
        values: bearExtreme,
        width: 5,
        style: 'tri-down',
        z: 9,
      },
    )
  }

  const windowValues: TmoScalperValues = {
    main1,
    signal1,
    main2,
    signal2,
    main3,
    signal3,
    bull1,
    bear1,
    bull2,
    bear2,
    bullExtreme,
    bearExtreme,
  }
  return {
    kind: 'tmo-scalper',
    title: OSC_HUD_WIDGETS['tmo-scalper'].title,
    subtitle: `(${settings.timeframe1}, ${settings.timeframe2}, ${settings.timeframe3}, ${settings.tmoLength}, ${settings.calcLength}, ${settings.smoothLength})`,
    accent: OSC_HUD_WIDGETS['tmo-scalper'].accent,
    times,
    traces,
    levels,
    domain,
    activeIndex: active,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      {
        label: tmoResolutionLabel(settings.timeframe1),
        value: trim(at(main1)),
        color: TMO_COLORS.tmo1Bull,
      },
      {
        label: tmoResolutionLabel(settings.timeframe2),
        value: trim(at(main2)),
        color: TMO_COLORS.bull,
      },
      {
        label: tmoResolutionLabel(settings.timeframe3),
        value: trim(at(main3)),
        color: TMO_COLORS.tmo2Bull,
      },
    ],
    verdict: tmoScalperVerdict(windowValues, settings, active),
    ready:
      main1.some((value) => value !== null) ||
      main2.some((value) => value !== null) ||
      main3.some((value) => value !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/**
 * The combo's call, in the order the three parts are read: a fresh strong signal, then the
 * gray zone, then the nQQE regime, then the banker body, then whether prime itself is rising.
 * Warmup only when prime, nQQE and the fund line are all still null.
 */
export function bayesianNqqeVerdict(input: {
  prime: number | null
  previousPrime: number | null
  probUp: number | null
  probDown: number | null
  nqqe: number | null
  fund: number | null
  slow: number | null
  previousFund: number | null
  threshold: number
  longSignal: boolean
  shortSignal: boolean
}): OscHudVerdict {
  const { prime, previousPrime, probUp, probDown, nqqe, fund, slow, previousFund, threshold } = input
  if (prime === null && nqqe === null && fund === null)
    return { text: 'WARMING UP', tone: 'flat', detail: 'not enough history yet' }
  if (input.longSignal)
    return {
      text: '▲ STRONG LONG',
      tone: 'bull',
      detail: `prime ${trim(prime)} left the gray zone`,
    }
  if (input.shortSignal)
    return {
      text: '▼ STRONG SHORT',
      tone: 'bear',
      detail: `prime ${trim(prime)} · down ${trim(probDown)}`,
    }
  if (
    prime !== null &&
    probUp !== null &&
    probDown !== null &&
    bayesianSideways(prime, probUp, probDown, threshold)
  )
    return {
      text: '— SIDEWAYS',
      tone: 'flat',
      detail: `prime ${trim(prime)} · under ${trim(threshold)}`,
    }
  if (nqqe !== null) {
    if (nqqe > 10)
      return { text: '▲ nQQE UPTREND', tone: 'bull', detail: `nQQE ${trim(nqqe)} · above +10` }
    if (nqqe < -10)
      return { text: '▼ nQQE DOWNTREND', tone: 'bear', detail: `nQQE ${trim(nqqe)} · below −10` }
    return { text: '— nQQE RANGE', tone: 'flat', detail: `nQQE ${trim(nqqe)} · between ±10` }
  }
  if (fund !== null && slow !== null) {
    const color = bankerBodyColor(fund, previousFund, slow)
    const detail = `fund ${trim(fund)} · slow ${trim(slow)}`
    if (color === BAYES_COLORS.bankerWhite)
      return { text: '— BANKER DECREASE', tone: 'flat', detail }
    if (color === BAYES_COLORS.bankerRed) return { text: '▼ BANKER EXIT', tone: 'bear', detail }
    if (color === BAYES_COLORS.bankerBlue)
      return { text: '▲ BANKER REBOUND', tone: 'os', detail }
    return { text: '▲ BANKER INCREASE', tone: 'bull', detail }
  }
  if (prime !== null && previousPrime !== null) {
    const rising = prime >= previousPrime
    return {
      text: rising ? '▲ PRIME RISING' : '▼ PRIME FALLING',
      tone: rising ? 'bull' : 'bear',
      detail: `prime ${trim(prime)}`,
    }
  }
  if (prime !== null)
    return { text: '— PRIME', tone: 'flat', detail: `prime ${trim(prime)}` }
  return { text: '— NEUTRAL', tone: 'flat', detail: 'no prime reading' }
}

/**
 * The Bayesian/nQQE/BankFunds window. Values arrive full-length from
 * `calculateBayesianNqqeBankfunds` — the same call the pane plots — and are sliced here.
 * The scale spans the window's own highs and lows, including both ends of a banker column.
 * It is not mirrored about zero.
 */
export function bayesianNqqeHudModel(
  values: BayesianNqqeValues,
  settings: BayesianNqqeSettings,
  input: OscHudModelInput,
): OscHudModel {
  const start = windowStart(input.times.length, input.bars)
  const cut = <T>(source: T[]): T[] => source.slice(start, start + input.bars)
  const times = cut(input.times)
  const probDown = finite(cut(values.probDown))
  const probUp = finite(cut(values.probUp))
  const prime = finite(cut(values.prime))
  const nqqe = finite(cut(values.nqqe))
  const fund = finite(cut(values.fundtrend))
  const slow = finite(cut(values.bullbear))
  const longSignal = cut(values.longSignal)
  const shortSignal = cut(values.shortSignal)
  const columns: OscHudColumns | undefined = settings.showBankFunds
    ? {
        high: fund.map((value, index) => {
          const other = slow[index]
          if (value === null || other === null) return null
          return Math.max(value, other)
        }),
        low: fund.map((value, index) => {
          const other = slow[index]
          if (value === null || other === null) return null
          return Math.min(value, other)
        }),
        colors: cut(values.bankerColors),
      }
    : undefined
  const traces: OscHudTrace[] = []
  if (settings.showProbabilities) {
    traces.push(
      {
        title: 'Break Down',
        color: BAYES_COLORS.down,
        values: probDown,
        width: 1,
        style: 'area',
        transp: 75,
        z: 0,
      },
      {
        title: 'Break Up',
        color: BAYES_COLORS.up,
        values: probUp,
        width: 1,
        style: 'area',
        transp: 75,
        z: 0,
      },
    )
  }
  traces.push({
    title: 'Prime',
    color: BAYES_COLORS.prime,
    values: prime,
    width: 2,
    style: 'line',
    z: 3,
  })
  if (settings.showNqqe) {
    traces.push({
      title: 'nQQE',
      color: BAYES_COLORS.nqqeYellow,
      values: nqqe,
      width: 1.6,
      style: 'line',
      z: 2,
    })
  }
  const domain = oscHudDataDomain([
    ...traces.map((trace) => trace.values),
    columns?.high ?? [],
    columns?.low ?? [],
  ])
  const activeIndex = input.index - start
  const active = activeIndex >= 0 && activeIndex < times.length ? activeIndex : null
  const at = (source: (number | null)[]) =>
    active !== null && active < source.length ? (source[active] ?? null) : null
  const before = (source: (number | null)[]) => {
    const previous = input.index - 1
    if (previous < 0 || previous >= source.length) return null
    const value = source[previous]
    return value === null || value === undefined || !Number.isFinite(value) ? null : value
  }
  const activePrime = at(prime)
  const activeNqqe = at(nqqe)
  const activeFund = at(fund)
  const activeSlow = at(slow)
  const levels = oscHudLevels(
    [
      { value: 0, color: BAYES_COLORS.gray, label: '0', dashed: false },
      {
        value: settings.lowerThreshold,
        color: BAYES_COLORS.gray,
        label: `${settings.lowerThreshold}`,
        dashed: true,
      },
      { value: 10, color: BAYES_COLORS.nqqeGreen, label: '10', dashed: true },
      { value: -10, color: BAYES_COLORS.nqqeRed, label: '-10', dashed: true },
      { value: 25, color: BAYES_COLORS.bankerYellow, label: '25', dashed: true },
      { value: 100, color: BAYES_COLORS.gray, label: '100', dashed: false },
    ],
    domain,
  )
  const fundColor =
    activeFund === null || activeSlow === null
      ? undefined
      : bankerBodyColor(activeFund, before(values.fundtrend), activeSlow)
  return {
    kind: 'bayesian-nqqe-bankfunds',
    title: OSC_HUD_WIDGETS['bayesian-nqqe-bankfunds'].title,
    subtitle: `BB ${settings.bbSmaPeriod}/${settings.bbStdDev} · Bayes ${settings.bayesPeriod}/${settings.lowerThreshold} · nQQE ${settings.nqqeSource} ${settings.nqqeRsiLength}/${settings.nqqeSmooth}`,
    accent: OSC_HUD_WIDGETS['bayesian-nqqe-bankfunds'].accent,
    times,
    traces,
    columns,
    levels,
    domain,
    activeIndex: active,
    hovered: !!input.hovered,
    bars: times.length,
    spanLabel: oscHudSpan(times.length, input.timeframe),
    readouts: [
      { label: 'Prime', value: trim(activePrime), color: BAYES_COLORS.prime },
      { label: 'nQQE', value: trim(activeNqqe), color: nqqeColor(activeNqqe) },
      { label: 'Bank', value: trim(activeFund), color: fundColor },
    ],
    verdict: bayesianNqqeVerdict({
      prime: activePrime,
      previousPrime: before(values.prime),
      probUp: at(probUp),
      probDown: at(probDown),
      nqqe: activeNqqe,
      fund: activeFund,
      slow: activeSlow,
      previousFund: before(values.fundtrend),
      threshold: settings.lowerThreshold,
      longSignal: active !== null && longSignal[active] != null,
      shortSignal: active !== null && shortSignal[active] != null,
    }),
    ready:
      prime.some((value) => value !== null) ||
      nqqe.some((value) => value !== null) ||
      fund.some((value) => value !== null),
    note: input.note ?? null,
    settingsSource: input.settingsSource ?? 'defaults',
  }
}

/**
 * Extra chart resolutions a window needs that the visible indicators do not: the CM and TMO
 * windows are useful even when their indicator is switched off, and an alt-resolution MACD or
 * TMO aggregation cannot be computed from chart candles at all.
 * `requestedIndicatorTimeframes` only walks visible indicators, so the feed subscription for a
 * window-only indicator has to be asked for here.
 */
export function oscHudRequestedTimeframes(
  indicators: Indicator[],
  chart: Timeframe,
  open: Partial<Record<OscHudKind, boolean>>,
): Timeframe[] {
  const feeds: Timeframe[] = []
  if (open['cm-ult-macd']) {
    const source = indicators.find((indicator) => indicator.kind === 'cm-ult-macd')
    if (source && !source.visible) {
      const settings = cmMacdSettings(source)
      const resolution = settings.useCurrentRes ? chart : settings.resCustom
      if (resolution !== chart) feeds.push(resolution)
    }
  }
  if (open['tmo-scalper']) {
    const source = indicators.find((indicator) => indicator.kind === 'tmo-scalper')
    if (!source || !source.visible) {
      const settings = source ? tmoScalperSettings(source) : TMO_SCALPER_DEFAULTS
      feeds.push(...tmoScalperFeeds(settings).filter((resolution) => resolution !== chart))
    }
  }
  return [...new Set(feeds)]
}
