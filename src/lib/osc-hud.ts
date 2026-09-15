/**
 * Two floating windows for the oscillators you watch all day: the last twenty minutes of
 * CM_Ult_MacD_MTF and of WaveTrend [LazyBear], drawn as their own little chart instead of
 * squeezed into a full-height pane at the bottom of the screen.
 *
 * Everything here is the arithmetic the cards render from — which bars belong in the window, how
 * the y-scale is chosen, what the numbers and the call are for the bar the crosshair is on. No
 * React, so the trading-relevant part of a floating widget can be tested without a browser.
 *
 * Two rules shape the design:
 *
 * 1. The window is a _view of the indicator_, never a second opinion about it. Values come from
 *    `calculateCmMacd` / `calculateWaveTrend` over the chart's own candles, so a widget and a
 *    pane on the same chart can never disagree, and the settings the pane uses are the settings
 *    the widget uses.
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
import { formatPrice } from './market'
import type { CmMacdSettings, Indicator, Timeframe, WaveTrendSettings } from './types'

/** The two windows, keyed by the indicator kind they mirror. */
export type OscHudKind = Extract<Indicator['kind'], 'cm-ult-macd' | 'wave-trend'>

export const OSC_HUD_KINDS: OscHudKind[] = ['cm-ult-macd', 'wave-trend']

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

/** Both windows start open: they are the reason this widget set exists, and one keystroke hides them. */
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
  style: 'line' | 'dots' | 'area'
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
 * Extra chart resolutions a window needs that the visible indicators do not: the CM window is
 * useful even when its indicator is switched off, and an alt-timeframe CM MACD cannot be computed
 * from chart candles at all. `requestedIndicatorTimeframes` only walks visible indicators, so the
 * feed subscription for a window-only indicator has to be asked for here.
 */
export function oscHudRequestedTimeframes(
  indicators: Indicator[],
  chart: Timeframe,
  open: Record<OscHudKind, boolean>,
): Timeframe[] {
  if (!open['cm-ult-macd']) return []
  const source = indicators.find((indicator) => indicator.kind === 'cm-ult-macd')
  if (!source || source.visible) return []
  const settings = cmMacdSettings(source)
  const resolution = settings.useCurrentRes ? chart : settings.resCustom
  return resolution === chart ? [] : [resolution]
}
