/**
 * Custom indicator alarms — the catalog and the arithmetic behind an alarm on MACD, RSI or
 * CM_Williams_Vix_Fix.
 *
 * One idea holds the whole feature together: every condition is a **state predicate** on the
 * newest bar of a series. "MACD is green", "RSI is above 70", "the VIX Fix bar is lime". The
 * alarm fires on the bar that state first becomes true, so a cross is simply the bar the state
 * changes, and "about to cross" is a state too — the gap is closing and it is within a few bars
 * of typical movement of the line. That keeps the catalog declarative and every condition
 * testable in isolation; nothing here touches the DOM, React or the network.
 *
 * The math is deliberately the app's own: CM alarms run ChrisMoody's CM_Ult_MacD_MTF, classic
 * MACD alarms run the same EMA/EMA lengths the pane plots, RSI is Wilder's, and the VIX Fix is
 * the published (22, 20, 2, 50, 0.85, 1.01) recurrence. An alarm can never disagree with the
 * pane, because it evaluates the same code on the same candles.
 */
import { CM_MACD_DEFAULTS, calculateCmMacd, isCmMacdSettings } from './cm-ult-macd'
import {
  CM_WILLIAMS_VIX_FIX_DEFAULTS,
  calculateWilliamsVixFix,
  isWilliamsVixFixSettings,
} from './cm-williams-vix-fix'
import { ta } from './indicator-runtime'
import { INTERVAL_SECONDS, isProductId } from '../../shared/coinbase'
import { isMetalSymbol } from '../../shared/kalshi'
import type { DataSource } from '../../shared/coinbase'
import type {
  AlarmConditionEntry,
  AlarmConditionId,
  AlarmIndicatorKind,
  AlarmMatch,
  Candle,
  CmMacdSettings,
  IndicatorAlarm,
  Timeframe,
  WilliamsVixFixSettings,
} from './types'

type Values = (number | null)[]

/** Alarms are cheap to store but each distinct pair costs one poll: keep both bounded. */
export const ALARM_LIMIT = 25
export const ALARM_FEED_LIMIT = 12
/** Background poll cadence. The chart's own pair is read from the live stream between polls. */
export const ALARM_POLL_MS = 45_000
/** Deltas used to estimate "typical bars of movement" for the about-to-cross conditions. */
export const PROXIMITY_LOOKBACK = 20
export const PROXIMITY_MIN_SAMPLES = 4
export const PROXIMITY_DEFAULT_WITHIN = 3
export const MACD_ALARM_DEFAULTS = { fast: 12, slow: 26, signal: 9 } as const

export interface AlarmParamSpec {
  id: string
  label: string
  min: number
  max: number
  /** `any` mirrors the number inputs the rest of the app uses for unconstrained values. */
  step: number | 'any'
  default: number
  /** Short suffix shown after the input, e.g. `bars`. */
  unit?: string
}
export interface AlarmConditionSpec {
  id: AlarmConditionId
  /** Grouping in the builder's select, e.g. `Crosses`. */
  group: string
  label: string
  /** One-line form used by headlines, toasts and the legs list. */
  short: string
  description: string
  indicators: AlarmIndicatorKind[]
  params: AlarmParamSpec[]
}
const withinParam = (min = 1, max = 20): AlarmParamSpec => ({
  id: 'within',
  label: 'Fires within this many bars of typical movement',
  min,
  max,
  step: 1,
  default: PROXIMITY_DEFAULT_WITHIN,
  unit: 'bars',
})
const levelParam = (def: number, label: string, min = -1e9, max = 1e9): AlarmParamSpec => ({
  id: 'level',
  label,
  min,
  max,
  step: 'any',
  default: def,
})

/**
 * The whole condition vocabulary. `indicators` is what the builder offers for each entry, so an
 * impossible pairing (the conventional MACD has no aqua histogram) cannot be created.
 */
export const ALARM_CONDITIONS: AlarmConditionSpec[] = [
  {
    id: 'macd-cross-up',
    group: 'Crosses & turns',
    label: 'MACD turns green — crosses above the signal line',
    short: 'MACD turns green',
    description:
      'Fires on the bar the MACD line moves from at-or-below its signal to above it: the bullish cross that paints the line lime in CM_Ult_MacD_MTF.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-cross-down',
    group: 'Crosses & turns',
    label: 'MACD turns red — crosses below the signal line',
    short: 'MACD turns red',
    description:
      'Fires on the bar the MACD line moves from at-or-above its signal to below it: the bearish cross that paints the line red.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-about-cross-up',
    group: 'Crosses & turns',
    label: 'MACD is about to cross above the signal line (still red)',
    short: 'MACD about to cross above',
    description:
      'No threshold to tune: the alarm measures the gap against how much the line typically moves per bar and fires while the gap is still closing. Nothing fires once the cross has happened.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [withinParam(1, 20)],
  },
  {
    id: 'macd-about-cross-down',
    group: 'Crosses & turns',
    label: 'MACD is about to cross below the signal line (still green)',
    short: 'MACD about to cross below',
    description:
      'The same automatic proximity read, on the way down: the gap must still be open, narrowing, and within a few bars of typical movement.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [withinParam(1, 20)],
  },
  {
    id: 'macd-zero-cross-up',
    group: 'Crosses & turns',
    label: 'MACD crosses above zero',
    short: 'MACD crosses above zero',
    description: 'Fires on the bar the MACD line moves above the zero line.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-zero-cross-down',
    group: 'Crosses & turns',
    label: 'MACD crosses below zero',
    short: 'MACD crosses below zero',
    description: 'Fires on the bar the MACD line moves below the zero line.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-above-level',
    group: 'Levels',
    label: 'MACD line is above a level',
    short: 'MACD above',
    description:
      'Fires when the MACD line becomes greater than the level you type. MACD is in price units, so the level belongs to one instrument.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [levelParam(0, 'MACD level')],
  },
  {
    id: 'macd-below-level',
    group: 'Levels',
    label: 'MACD line is below a level',
    short: 'MACD below',
    description: 'Fires when the MACD line becomes less than the level you type.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [levelParam(0, 'MACD level')],
  },
  {
    id: 'macd-hist-rising',
    group: 'Histogram',
    label: 'Histogram is rising — momentum building',
    short: 'Histogram rising',
    description:
      'Fires on the bar the histogram (MACD minus signal) is higher than the bar before it.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-hist-falling',
    group: 'Histogram',
    label: 'Histogram is falling — momentum fading',
    short: 'Histogram falling',
    description:
      'Fires on the bar the histogram (MACD minus signal) is lower than the bar before it.',
    indicators: ['cm-ult-macd', 'macd'],
    params: [],
  },
  {
    id: 'macd-hist-aqua',
    group: 'Histogram',
    label: 'Histogram turns aqua — rally momentum building',
    short: 'Histogram aqua',
    description:
      "ChrisMoody's aqua bar: above zero and taller than the previous bar. CM_Ult_MacD_MTF only — the conventional MACD has no color change.",
    indicators: ['cm-ult-macd'],
    params: [],
  },
  {
    id: 'macd-hist-blue',
    group: 'Histogram',
    label: 'Histogram turns blue — rally momentum fading',
    short: 'Histogram blue',
    description:
      "ChrisMoody's blue bar: still above zero but shorter than the previous bar. CM_Ult_MacD_MTF only.",
    indicators: ['cm-ult-macd'],
    params: [],
  },
  {
    id: 'macd-hist-maroon',
    group: 'Histogram',
    label: 'Histogram turns maroon — sell-off momentum fading',
    short: 'Histogram maroon',
    description:
      "ChrisMoody's maroon bar: at or below zero but taller than the previous bar, so the sell-off is losing momentum. CM_Ult_MacD_MTF only.",
    indicators: ['cm-ult-macd'],
    params: [],
  },
  {
    id: 'macd-hist-red',
    group: 'Histogram',
    label: 'Histogram turns red — sell-off momentum building',
    short: 'Histogram red',
    description:
      "ChrisMoody's red bar: at or below zero and shorter than the previous bar, so the sell-off is deepening. CM_Ult_MacD_MTF only.",
    indicators: ['cm-ult-macd'],
    params: [],
  },
  {
    id: 'rsi-cross-up-level',
    group: 'Levels',
    label: 'RSI crosses above a level',
    short: 'RSI crosses above',
    description: 'The classic overbought alarm. Fires on the bar RSI moves above the level.',
    indicators: ['rsi'],
    params: [levelParam(70, 'RSI level', 1, 99)],
  },
  {
    id: 'rsi-cross-down-level',
    group: 'Levels',
    label: 'RSI crosses below a level',
    short: 'RSI crosses below',
    description: 'The classic oversold alarm. Fires on the bar RSI moves below the level.',
    indicators: ['rsi'],
    params: [levelParam(30, 'RSI level', 1, 99)],
  },
  {
    id: 'rsi-about-cross-up',
    group: 'Levels',
    label: 'RSI is about to cross above a level',
    short: 'RSI about to cross above',
    description:
      'Automatic proximity: the alarm measures the distance to the level against how much RSI typically moves per bar, and fires while RSI is still below it and closing.',
    indicators: ['rsi'],
    params: [levelParam(70, 'RSI level', 1, 99), withinParam()],
  },
  {
    id: 'rsi-about-cross-down',
    group: 'Levels',
    label: 'RSI is about to cross below a level',
    short: 'RSI about to cross below',
    description:
      'The same automatic proximity read downward: RSI must still be above the level and falling toward it.',
    indicators: ['rsi'],
    params: [levelParam(30, 'RSI level', 1, 99), withinParam()],
  },
  {
    id: 'rsi-above-level',
    group: 'State',
    label: 'RSI is above a level',
    short: 'RSI above',
    description: 'Fires when RSI becomes greater than the level, and re-arms once it drops back.',
    indicators: ['rsi'],
    params: [levelParam(70, 'RSI level', 1, 99)],
  },
  {
    id: 'rsi-below-level',
    group: 'State',
    label: 'RSI is below a level',
    short: 'RSI below',
    description: 'Fires when RSI becomes less than the level, and re-arms once it climbs back.',
    indicators: ['rsi'],
    params: [levelParam(30, 'RSI level', 1, 99)],
  },
  {
    id: 'rsi-turns-up',
    group: 'State',
    label: 'RSI turns up out of a dip',
    short: 'RSI turns up',
    description: 'Fires on the bar RSI stops falling and closes higher than the bar before it.',
    indicators: ['rsi'],
    params: [],
  },
  {
    id: 'rsi-turns-down',
    group: 'State',
    label: 'RSI turns down from a peak',
    short: 'RSI turns down',
    description: 'Fires on the bar RSI stops rising and closes lower than the bar before it.',
    indicators: ['rsi'],
    params: [],
  },
  {
    id: 'wvf-spike',
    group: 'Fear spikes',
    label: 'A fear spike fires (lime bar)',
    short: 'Fear spike fires',
    description:
      'The published trigger: WVF at or above the Bollinger upper band, or at or above the 50-bar percentile range high (times 0.85). The bar paints lime.',
    indicators: ['cm-williams-vix-fix'],
    params: [],
  },
  {
    id: 'wvf-spike-ends',
    group: 'Fear spikes',
    label: 'The fear spike ends (bar goes gray)',
    short: 'Fear spike ends',
    description:
      'Fires on the first bar that fails the trigger after a lime bar — the spike is finished printing.',
    indicators: ['cm-williams-vix-fix'],
    params: [],
  },
  {
    id: 'wvf-about-spike',
    group: 'Fear spikes',
    label: 'WVF is about to trigger a spike',
    short: 'WVF about to spike',
    description:
      'Automatic proximity to whichever trigger is nearer — the upper band, the range high or neither — measured in bars of typical WVF movement.',
    indicators: ['cm-williams-vix-fix'],
    params: [withinParam()],
  },
  {
    id: 'wvf-cross-above-band',
    group: 'Fear spikes',
    label: 'WVF crosses above the Bollinger upper band',
    short: 'WVF crosses above the upper band',
    description:
      'Fires when the histogram moves above the aqua upper band. The band only exists once bbl WVF values have been computed.',
    indicators: ['cm-williams-vix-fix'],
    params: [],
  },
  {
    id: 'wvf-cross-above-range',
    group: 'Fear spikes',
    label: 'WVF crosses above the range high',
    short: 'WVF crosses above the range high',
    description:
      'Fires when the histogram moves above highest(WVF, lb) × ph. Needs lb bars of history before the range high exists.',
    indicators: ['cm-williams-vix-fix'],
    params: [],
  },
  {
    id: 'wvf-above-level',
    group: 'Levels',
    label: 'WVF is above a level',
    short: 'WVF above',
    description:
      'WVF is a percentage of the distance from the highest close, so the level is comparable across assets.',
    indicators: ['cm-williams-vix-fix'],
    params: [levelParam(10, 'WVF level', 0, 100)],
  },
  {
    id: 'wvf-below-level',
    group: 'Levels',
    label: 'WVF is below a level',
    short: 'WVF below',
    description: 'Fires when the fear ratio drops below the level you type.',
    indicators: ['cm-williams-vix-fix'],
    params: [levelParam(10, 'WVF level', 0, 100)],
  },
]
const CONDITION_MAP = new Map(ALARM_CONDITIONS.map((spec) => [spec.id, spec]))
export const ALARM_INDICATOR_LABELS: Record<AlarmIndicatorKind, string> = {
  'cm-ult-macd': 'CM_Ult_MacD_MTF',
  macd: 'MACD (classic)',
  rsi: 'RSI',
  'cm-williams-vix-fix': 'CM_Williams_Vix_Fix',
}
export const ALARM_INDICATORS: AlarmIndicatorKind[] = [
  'cm-ult-macd',
  'macd',
  'rsi',
  'cm-williams-vix-fix',
]
/** Order shown in the builder: the indicator then the catalog's own grouping. */
export function conditionsFor(indicator: AlarmIndicatorKind): AlarmConditionSpec[] {
  return ALARM_CONDITIONS.filter((spec) => spec.indicators.includes(indicator))
}
export function conditionSpec(id: AlarmConditionId): AlarmConditionSpec {
  const spec = CONDITION_MAP.get(id)
  if (!spec) throw new Error(`Unknown alarm condition: ${id}`)
  return spec
}
export function conditionExists(id: unknown): id is AlarmConditionId {
  return typeof id === 'string' && CONDITION_MAP.has(id as AlarmConditionId)
}
/** The default condition the builder opens with for each indicator. */
export function defaultCondition(indicator: AlarmIndicatorKind): AlarmConditionId {
  if (indicator === 'rsi') return 'rsi-cross-up-level'
  if (indicator === 'cm-williams-vix-fix') return 'wvf-spike'
  return 'macd-cross-up'
}
export function defaultParams(id: AlarmConditionId): Record<string, number> {
  return Object.fromEntries(conditionSpec(id).params.map((param) => [param.id, param.default]))
}
/** Level params, clamped to the spec so a stored alarm can never evaluate nonsense. */
export function conditionParams(
  condition: AlarmConditionId,
  stored?: Record<string, number>,
): Record<string, number> {
  const spec = conditionSpec(condition)
  return Object.fromEntries(
    spec.params.map((param) => {
      const raw = stored?.[param.id]
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : param.default
      return [param.id, Math.min(param.max, Math.max(param.min, value))]
    }),
  )
}
export function alarmParams(alarm: IndicatorAlarm): Record<string, number> {
  return conditionParams(alarm.condition, alarm.params)
}
/**
 * Up to four legs per alarm — one primary plus three `also` entries — and the only rule that
 * binds them: a single alarm reads **one MACD flavour**, because both flavours would want the
 * same series slot and "MACD turns green" would stop meaning one thing.
 */
export const ALARM_ENTRY_LIMIT = 4
export const ALARM_ENTRY_LIMIT_MESSAGE = 'An alarm can watch up to 4 conditions.'
const MACD_KINDS: AlarmIndicatorKind[] = ['cm-ult-macd', 'macd']
export function isMacdKind(kind: AlarmIndicatorKind): boolean {
  return MACD_KINDS.includes(kind)
}
export const ALARM_MATCHES: AlarmMatch[] = ['all', 'any']
/** `all` unless the alarm explicitly asked for `any`. */
export function alarmMatch(alarm: IndicatorAlarm): AlarmMatch {
  return alarm.match === 'any' ? 'any' : 'all'
}
/** Every leg, primary first, with each leg's params defaulted and clamped. */
export function alarmEntries(alarm: IndicatorAlarm): AlarmConditionEntry[] {
  const primary: AlarmConditionEntry = {
    indicator: alarm.indicator,
    condition: alarm.condition,
    params: alarmParams(alarm),
  }
  const also = (alarm.also ?? []).slice(0, ALARM_ENTRY_LIMIT - 1).map((entry) => ({
    indicator: entry.indicator,
    condition: entry.condition,
    params: conditionParams(entry.condition, entry.params),
  }))
  return [primary, ...also]
}
/** Indicator families an alarm reads, primary first, each mentioned once. */
export function alarmFamilies(alarm: IndicatorAlarm): AlarmIndicatorKind[] {
  return [...new Set(alarmEntries(alarm).map((entry) => entry.indicator))]
}
/** Can this leg be added to that alarm? One MACD flavour, and no duplicate legs. */
export function canAddEntry(
  alarm: Pick<IndicatorAlarm, 'indicator' | 'condition' | 'also'>,
  entry: Pick<AlarmConditionEntry, 'indicator' | 'condition'>,
): boolean {
  const entries = [
    { indicator: alarm.indicator, condition: alarm.condition },
    ...(alarm.also ?? []).map((item) => ({ indicator: item.indicator, condition: item.condition })),
  ]
  if (entries.length >= ALARM_ENTRY_LIMIT) return false
  if (
    entries.some((item) => item.indicator === entry.indicator && item.condition === entry.condition)
  )
    return false
  if (isMacdKind(entry.indicator) && entries.some((item) => isMacdKind(item.indicator)))
    return false
  return true
}
export function alarmRsiPeriod(alarm: IndicatorAlarm): number {
  const period = alarm.rsi?.period
  return typeof period === 'number' && Number.isInteger(period) && period >= 1 && period <= 2000
    ? period
    : 14
}
export function alarmMacdLengths(alarm: IndicatorAlarm): {
  fast: number
  slow: number
  signal: number
} {
  const lengths = alarm.macd
  const length = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2000
      ? value
      : fallback
  return {
    fast: length(lengths?.fast, MACD_ALARM_DEFAULTS.fast),
    slow: length(lengths?.slow, MACD_ALARM_DEFAULTS.slow),
    signal: length(lengths?.signal, MACD_ALARM_DEFAULTS.signal),
  }
}
/**
 * CM_Ult_MacD_MTF settings for an alarm. An alarm always evaluates its OWN timeframe — a 4h
 * MACD alarm stays a 4h MACD alarm whatever the chart is showing — so `useCurrentRes` is forced
 * on and the multi-timeframe projection is never needed.
 */
export function alarmCmMacdSettings(alarm: IndicatorAlarm): CmMacdSettings {
  const stored = isCmMacdSettings(alarm.cmMacd) ? alarm.cmMacd : CM_MACD_DEFAULTS
  return { ...stored, useCurrentRes: true }
}
export function alarmVixFixSettings(alarm: IndicatorAlarm): WilliamsVixFixSettings {
  return isWilliamsVixFixSettings(alarm.williamsVixFix)
    ? alarm.williamsVixFix
    : { ...CM_WILLIAMS_VIX_FIX_DEFAULTS }
}
/** One pollable pair. Alarms sharing a pair share a single request. */
export function alarmFeedKey(alarm: Pick<IndicatorAlarm, 'symbol' | 'timeframe'>): string {
  return `${alarm.symbol}|${alarm.timeframe}`
}
/**
 * Is this symbol's venue the one the workspace is currently reading? A Coinbase alarm cannot
 * fire on demo candles, and a demo alarm cannot fire on Coinbase ones — the same rule the price
 * alerts follow, so an alarm can never be triggered by a number from somewhere else.
 */
export function alarmVenueActive(symbol: string, source: DataSource): boolean {
  if (isMetalSymbol(symbol)) return source !== 'demo'
  if (isProductId(symbol)) return source === 'coinbase'
  return source === 'demo'
}
/** One family's settings in one label, e.g. `RSI (7)` or `CM_Ult_MacD_MTF (12, 26, 9)`. */
function familyLabel(kind: AlarmIndicatorKind, alarm: IndicatorAlarm): string {
  if (kind === 'rsi') return `RSI (${alarmRsiPeriod(alarm)})`
  if (kind === 'cm-williams-vix-fix') {
    const s = alarmVixFixSettings(alarm)
    return `CM_Williams_Vix_Fix (${s.pd}, ${s.bbl}, ${s.mult}, ${s.lb}, ${s.ph}, ${s.pl})`
  }
  const { fast, slow, signal } = alarmMacdLengths(alarm)
  return kind === 'cm-ult-macd'
    ? `CM_Ult_MacD_MTF (${fast}, ${slow}, ${signal})`
    : `MACD (${fast}, ${slow}, ${signal})`
}
/** Every family the alarm reads: `CM_Ult_MacD_MTF (12, 26, 9) + RSI (14)` for a combined one. */
export function alarmIndicatorLabel(alarm: IndicatorAlarm): string {
  return alarmFamilies(alarm)
    .map((kind) => familyLabel(kind, alarm))
    .join(' + ')
}
/** Whole levels keep no decimals: `RSI crosses above 70`, not `70.00`. */
const formatLevel = (value: number) =>
  Number.isInteger(value) ? String(value) : formatAlarmNumber(value)
/** One leg in a line, with the level it watches: `RSI crosses above 70`. */
export function entryHeadline(entry: AlarmConditionEntry): string {
  const spec = conditionSpec(entry.condition)
  const level = conditionParams(entry.condition, entry.params).level
  return typeof level === 'number' ? `${spec.short} ${formatLevel(level)}` : spec.short
}
/**
 * What the alarm watches, in one line. A single-condition alarm reads exactly as it always did;
 * a combined one joins its legs with the word the match implies — `and`, or `or`.
 */
export function alarmHeadline(alarm: IndicatorAlarm): string {
  const entries = alarmEntries(alarm)
  if (entries.length === 1) return conditionSpec(entries[0].condition).label
  const joiner = alarmMatch(alarm) === 'any' ? ' or ' : ' and '
  return entries.map((entry) => entryHeadline(entry)).join(joiner)
}
/** The legs of a combined alarm, spelled out for the card: `MACD turns green · RSI above 70`. */
export function alarmLegList(alarm: IndicatorAlarm): string {
  return alarmEntries(alarm)
    .map((entry) => entryHeadline(entry))
    .join(' · ')
}
export function alarmSummary(alarm: IndicatorAlarm): string {
  return `${alarmIndicatorLabel(alarm)} · ${alarmHeadline(alarm)}`
}
/** A brand-new alarm, fully defaulted for its indicator. */
export function newIndicatorAlarm({
  id,
  symbol,
  timeframe,
  indicator,
  createdAt,
}: {
  id: string
  symbol: string
  timeframe: Timeframe
  indicator: AlarmIndicatorKind
  createdAt: string
}): IndicatorAlarm {
  const condition = defaultCondition(indicator)
  return {
    id,
    symbol,
    timeframe,
    indicator,
    condition,
    params: defaultParams(condition),
    rsi: { period: 14 },
    macd: { ...MACD_ALARM_DEFAULTS },
    cmMacd: { ...CM_MACD_DEFAULTS },
    williamsVixFix: { ...CM_WILLIAMS_VIX_FIX_DEFAULTS },
    sound: true,
    repeat: 'bar',
    bars: 'forming',
    note: '',
    enabled: true,
    createdAt,
    triggerCount: 0,
  }
}

/* ------------------------------------------------------------------ *
 * Series
 * ------------------------------------------------------------------ */

export interface AlarmSeries {
  times: number[]
  /** MACD line, either kind. */
  macd?: Values
  signal?: Values
  /** MACD − signal, never suppressed at exact zeros. */
  histogram?: Values
  rsi?: Values
  wvf?: Values
  upperBand?: Values
  rangeHigh?: Values
  isGreen?: boolean[]
}
export type AlarmHistogramColor = 'aqua' | 'blue' | 'red' | 'maroon' | 'yellow'
/** ChrisMoody's histogram rule, read as a value rather than a fill colour. */
export function histogramColor(histogram: Values, index: number): AlarmHistogramColor | 'none' {
  const value = histogram[index]
  const previous = index > 0 ? histogram[index - 1] : null
  if (value === null || value === undefined || previous === null || previous === undefined)
    return 'none'
  if (value > previous) return value > 0 ? 'aqua' : 'maroon'
  if (value < previous) return value > 0 ? 'blue' : 'red'
  return 'yellow'
}
/**
 * The series every leg of the alarm reads. Only the families the alarm actually uses are
 * computed, so a combined MACD + RSI alarm pays for two indicators, not four.
 */
export function alarmSeries(candles: Candle[], alarm: IndicatorAlarm): AlarmSeries {
  const series: AlarmSeries = { times: candles.map((candle) => candle.time) }
  const families = alarmFamilies(alarm)
  if (families.includes('rsi')) {
    series.rsi = ta.rsi(
      candles.map((candle) => candle.close),
      alarmRsiPeriod(alarm),
    )
  }
  if (families.includes('cm-williams-vix-fix')) {
    const values = calculateWilliamsVixFix(candles, alarmVixFixSettings(alarm))
    series.wvf = values.wvf
    series.upperBand = values.upperBand
    series.rangeHigh = values.rangeHigh
    series.isGreen = values.isGreen
  }
  const macdKind = families.find(isMacdKind)
  if (macdKind) {
    const close = candles.map((candle) => candle.close)
    const { fast, slow, signal } = alarmMacdLengths(alarm)
    let line: Values
    let signalLine: Values
    if (macdKind === 'cm-ult-macd') {
      const values = calculateCmMacd(candles, alarmCmMacdSettings(alarm), {
        timeframe: alarm.timeframe,
      })
      line = values.macd
      signalLine = values.signal
    } else {
      const fastEma = ta.ema(close, fast)
      const slowEma = ta.ema(close, slow)
      line = fastEma.map((value, index) =>
        value === null || slowEma[index] === null ? null : value - slowEma[index]!,
      )
      signalLine = ta.ema(line, signal)
    }
    series.macd = line
    series.signal = signalLine
    // hist = macd − signal, which is also the gap the cross conditions measure.
    series.histogram = line.map((value, index) =>
      value === null || signalLine[index] === null ? null : value - signalLine[index]!,
    )
  }
  return series
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export interface AlarmReading {
  /** True while the condition holds on the newest bar. */
  active: boolean
  /** True while it held on the bar before — a false → true edge is what fires an alarm. */
  previousActive: boolean
  /** False while the indicator still lacks the history the condition needs. */
  ready: boolean
  /** Bucket time of the newest bar evaluated, so one bar can never fire twice. */
  barTime: number | null
  /** The numbers behind the verdict, e.g. `MACD 12.43 · signal 11.98 · hist +0.45`. */
  reading: string
  /** A short plain-language verdict, e.g. `Green — MACD above its signal`. */
  detail: string
  /** Estimated bars of typical movement to the cross, for the about-to-cross conditions. */
  estimate: number | null
}
const EMPTY_READING: AlarmReading = {
  active: false,
  previousActive: false,
  ready: false,
  barTime: null,
  reading: 'No candles loaded yet',
  detail: 'Waiting for candles',
  estimate: null,
}
const valueAt = (values: Values | undefined, index: number): number | null => {
  if (!values || index < 0 || index >= values.length) return null
  const value = values[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
const boolAt = (values: boolean[] | undefined, index: number): boolean =>
  !!values && index >= 0 && index < values.length && values[index] === true
/**
 * Typical per-bar movement over the last `PROXIMITY_LOOKBACK` deltas. This is the yardstick the
 * "about to cross" conditions use instead of a number the trader has to tune: a gap of 0.4 MACD
 * points means something very different on 1m BTC than on a 1D chart.
 */
export function typicalStep(values: Values, index: number, lookback = PROXIMITY_LOOKBACK) {
  let total = 0
  let samples = 0
  for (let i = Math.max(1, index - lookback + 1); i <= index; i++) {
    const current = valueAt(values, i)
    const previous = valueAt(values, i - 1)
    if (current === null || previous === null) continue
    total += Math.abs(current - previous)
    samples++
  }
  if (samples < PROXIMITY_MIN_SAMPLES) return null
  const step = total / samples
  return step > 0 ? step : null
}
/**
 * Is `values` closing on `target` without having reached it? `direction` is +1 for "crosses
 * above" and −1 for "crosses below". Returns the estimate in bars, or null when the reading is
 * not applicable (already crossed, moving the wrong way, or not enough history).
 */
export function barsToTarget(
  values: Values,
  index: number,
  target: number,
  direction: 1 | -1,
  within: number,
): number | null {
  const current = valueAt(values, index)
  const previous = valueAt(values, index - 1)
  if (current === null || previous === null) return null
  const gap = direction === 1 ? target - current : current - target
  if (gap <= 0) return null
  const moving = direction === 1 ? current > previous : current < previous
  if (!moving) return null
  const step = typicalStep(values, index)
  if (step === null) return null
  const bars = gap / step
  return bars <= within ? bars : null
}
/** The proximity target for a VIX Fix spike: whichever published trigger is nearer. */
function spikeTarget(series: AlarmSeries, index: number): number | null {
  const band = valueAt(series.upperBand, index)
  const range = valueAt(series.rangeHigh, index)
  if (band === null) return range
  if (range === null) return band
  return Math.min(band, range)
}
/**
 * Every condition, as a per-bar predicate. Nulls are "not applicable", which is false — Pine's
 * own `na` comparisons are false too, so warm-up bars never fire an alarm.
 */
function stateAt(entry: AlarmConditionEntry, series: AlarmSeries, index: number): boolean {
  const params = entry.params
  const level = params.level ?? 0
  const within = params.within ?? PROXIMITY_DEFAULT_WITHIN
  const { macd, histogram, rsi, wvf } = series
  const line = valueAt(macd, index)
  const previousLine = valueAt(macd, index - 1)
  const hist = valueAt(histogram, index)
  const previousHist = valueAt(histogram, index - 1)
  const momentum = valueAt(rsi, index)
  const previousMomentum = valueAt(rsi, index - 1)
  switch (entry.condition) {
    case 'macd-cross-up':
      return hist !== null && previousHist !== null && hist > 0 && previousHist <= 0
    case 'macd-cross-down':
      return hist !== null && previousHist !== null && hist < 0 && previousHist >= 0
    case 'macd-about-cross-up':
      return histogram !== undefined && barsToTarget(histogram, index, 0, 1, within) !== null
    case 'macd-about-cross-down':
      return histogram !== undefined && barsToTarget(histogram, index, 0, -1, within) !== null
    case 'macd-zero-cross-up':
      return line !== null && previousLine !== null && line > 0 && previousLine <= 0
    case 'macd-zero-cross-down':
      return line !== null && previousLine !== null && line < 0 && previousLine >= 0
    case 'macd-above-level':
      return line !== null && line > level
    case 'macd-below-level':
      return line !== null && line < level
    case 'macd-hist-rising':
      return hist !== null && previousHist !== null && hist > previousHist
    case 'macd-hist-falling':
      return hist !== null && previousHist !== null && hist < previousHist
    case 'macd-hist-aqua':
      return histogramColor(histogram ?? [], index) === 'aqua'
    case 'macd-hist-blue':
      return histogramColor(histogram ?? [], index) === 'blue'
    case 'macd-hist-maroon':
      return histogramColor(histogram ?? [], index) === 'maroon'
    case 'macd-hist-red':
      return histogramColor(histogram ?? [], index) === 'red'
    case 'rsi-cross-up-level':
      return (
        momentum !== null &&
        previousMomentum !== null &&
        momentum > level &&
        previousMomentum <= level
      )
    case 'rsi-cross-down-level':
      return (
        momentum !== null &&
        previousMomentum !== null &&
        momentum < level &&
        previousMomentum >= level
      )
    case 'rsi-about-cross-up':
      return rsi !== undefined && barsToTarget(rsi, index, level, 1, within) !== null
    case 'rsi-about-cross-down':
      return rsi !== undefined && barsToTarget(rsi, index, level, -1, within) !== null
    case 'rsi-above-level':
      return momentum !== null && momentum > level
    case 'rsi-below-level':
      return momentum !== null && momentum < level
    case 'rsi-turns-up': {
      const earlier = valueAt(rsi, index - 2)
      return (
        momentum !== null &&
        previousMomentum !== null &&
        earlier !== null &&
        momentum > previousMomentum &&
        previousMomentum <= earlier
      )
    }
    case 'rsi-turns-down': {
      const earlier = valueAt(rsi, index - 2)
      return (
        momentum !== null &&
        previousMomentum !== null &&
        earlier !== null &&
        momentum < previousMomentum &&
        previousMomentum >= earlier
      )
    }
    case 'wvf-spike':
      return boolAt(series.isGreen, index)
    case 'wvf-spike-ends':
      return !boolAt(series.isGreen, index) && boolAt(series.isGreen, index - 1)
    case 'wvf-about-spike': {
      if (wvf === undefined) return false
      const target = spikeTarget(series, index)
      return target !== null && barsToTarget(wvf, index, target, 1, within) !== null
    }
    case 'wvf-cross-above-band': {
      const band = valueAt(series.upperBand, index)
      const value = valueAt(wvf, index)
      return value !== null && band !== null && value > band
    }
    case 'wvf-cross-above-range': {
      const range = valueAt(series.rangeHigh, index)
      const value = valueAt(wvf, index)
      return value !== null && range !== null && value > range
    }
    case 'wvf-above-level':
      return valueAt(wvf, index) !== null && valueAt(wvf, index)! > level
    case 'wvf-below-level':
      return valueAt(wvf, index) !== null && valueAt(wvf, index)! < level
    default:
      return false
  }
}
/** `12.43`, `+0.45`, `68.2` — enough digits to be useful without pretending to more precision. */
export function formatAlarmNumber(value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude >= 1000) return value.toFixed(0)
  if (magnitude >= 100) return value.toFixed(1)
  if (magnitude >= 1) return value.toFixed(2)
  if (magnitude >= 0.01) return value.toFixed(4)
  if (magnitude === 0) return '0'
  return value.toExponential(2)
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${formatAlarmNumber(value)}`
const plural = (value: number, unit: string) => `${value.toFixed(1)} ${unit}`
interface Verdict {
  reading: string
  detail: string
  estimate: number | null
}
/** The numbers and the sentence the card shows for the newest bar. */
function legVerdict(entry: AlarmConditionEntry, series: AlarmSeries, index: number): Verdict {
  const params = entry.params
  const level = params.level ?? 0
  const within = params.within ?? PROXIMITY_DEFAULT_WITHIN
  const histogram = series.histogram ?? []
  const macd = valueAt(series.macd, index)
  const signal = valueAt(series.signal, index)
  const hist = valueAt(series.histogram, index)
  const rsi = valueAt(series.rsi, index)
  const wvf = valueAt(series.wvf, index)
  const band = valueAt(series.upperBand, index)
  const range = valueAt(series.rangeHigh, index)
  const macdReading =
    macd === null || signal === null
      ? 'MACD is still warming up'
      : `MACD ${formatAlarmNumber(macd)} · signal ${formatAlarmNumber(signal)} · hist ${hist === null ? '—' : signed(hist)}`
  switch (entry.condition) {
    case 'macd-cross-up':
      return { reading: macdReading, detail: 'Green — a fresh bullish cross', estimate: null }
    case 'macd-cross-down':
      return { reading: macdReading, detail: 'Red — a fresh bearish cross', estimate: null }
    case 'macd-about-cross-up':
    case 'macd-about-cross-down': {
      const direction = entry.condition === 'macd-about-cross-up' ? 1 : -1
      const bars = barsToTarget(histogram, index, 0, direction, within)
      return {
        reading: macdReading,
        detail:
          bars === null
            ? 'No cross closing yet'
            : `${plural(bars, 'bars')} of typical movement to the ${direction === 1 ? 'bullish' : 'bearish'} cross`,
        estimate: bars,
      }
    }
    case 'macd-zero-cross-up':
      return { reading: macdReading, detail: 'MACD crossed above zero', estimate: null }
    case 'macd-zero-cross-down':
      return { reading: macdReading, detail: 'MACD crossed below zero', estimate: null }
    case 'macd-above-level':
      return {
        reading: macdReading,
        detail: `MACD above ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    case 'macd-below-level':
      return {
        reading: macdReading,
        detail: `MACD below ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    case 'macd-hist-rising':
      return {
        reading: macdReading,
        detail: 'Momentum building — the histogram is rising',
        estimate: null,
      }
    case 'macd-hist-falling':
      return {
        reading: macdReading,
        detail: 'Momentum fading — the histogram is falling',
        estimate: null,
      }
    case 'macd-hist-aqua':
    case 'macd-hist-blue':
    case 'macd-hist-maroon':
    case 'macd-hist-red': {
      const color = histogramColor(histogram, index)
      const words: Record<string, string> = {
        aqua: 'aqua — rally momentum building',
        blue: 'blue — rally momentum fading',
        maroon: 'maroon — sell-off momentum fading',
        red: 'red — sell-off momentum building',
      }
      return {
        reading: macdReading,
        detail: color === 'none' ? 'Waiting for enough history' : `Histogram ${words[color]}`,
        estimate: null,
      }
    }
    case 'rsi-cross-up-level':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: `Above ${formatAlarmNumber(level)} — overbought`,
        estimate: null,
      }
    case 'rsi-cross-down-level':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: `Below ${formatAlarmNumber(level)} — oversold`,
        estimate: null,
      }
    case 'rsi-about-cross-up':
    case 'rsi-about-cross-down': {
      const direction = entry.condition === 'rsi-about-cross-up' ? 1 : -1
      const bars = series.rsi ? barsToTarget(series.rsi, index, level, direction, within) : null
      return {
        reading:
          rsi === null
            ? 'RSI is still warming up'
            : `RSI ${formatAlarmNumber(rsi)} · level ${formatAlarmNumber(level)}`,
        detail:
          bars === null
            ? 'No cross closing yet'
            : `${plural(bars, 'bars')} of typical movement to ${formatAlarmNumber(level)}`,
        estimate: bars,
      }
    }
    case 'rsi-above-level':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: `Above ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    case 'rsi-below-level':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: `Below ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    case 'rsi-turns-up':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: 'Turning up out of a dip',
        estimate: null,
      }
    case 'rsi-turns-down':
      return {
        reading: rsi === null ? 'RSI is still warming up' : `RSI ${formatAlarmNumber(rsi)}`,
        detail: 'Turning down from a peak',
        estimate: null,
      }
    case 'wvf-spike':
      return {
        reading: wvfReading(wvf, band, range),
        detail: 'Lime bar — a fear spike, the published market-bottom signal',
        estimate: null,
      }
    case 'wvf-spike-ends':
      return {
        reading: wvfReading(wvf, band, range),
        detail: 'The fear spike ended — the bar is gray again',
        estimate: null,
      }
    case 'wvf-about-spike': {
      const target = spikeTarget(series, index)
      const bars =
        series.wvf && target !== null ? barsToTarget(series.wvf, index, target, 1, within) : null
      return {
        reading: wvfReading(wvf, band, range),
        detail:
          target === null || bars === null
            ? 'No spike closing yet'
            : `${plural(bars, 'bars')} of typical movement to the nearest trigger`,
        estimate: bars,
      }
    }
    case 'wvf-cross-above-band':
      return {
        reading: wvfReading(wvf, band, range),
        detail: 'WVF crossed above the Bollinger upper band',
        estimate: null,
      }
    case 'wvf-cross-above-range':
      return {
        reading: wvfReading(wvf, band, range),
        detail: 'WVF crossed above the percentile range high',
        estimate: null,
      }
    case 'wvf-above-level':
      return {
        reading: wvfReading(wvf, band, range),
        detail: `Above ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    case 'wvf-below-level':
      return {
        reading: wvfReading(wvf, band, range),
        detail: `Below ${formatAlarmNumber(level)}`,
        estimate: null,
      }
    default:
      return { reading: '—', detail: 'Unknown condition', estimate: null }
  }
}
function wvfReading(wvf: number | null, band: number | null, range: number | null): string {
  if (wvf === null) return 'WVF is still warming up'
  const parts = [`WVF ${formatAlarmNumber(wvf)}`]
  if (band !== null) parts.push(`upper band ${formatAlarmNumber(band)}`)
  if (range !== null) parts.push(`range high ${formatAlarmNumber(range)}`)
  return parts.join(' · ')
}
const joinList = (items: string[]) => items.join(', ')
/**
 * The verdict for a whole alarm. One leg reads exactly as it always did; a combined alarm adds
 * up its legs in words — which ones are holding, and which ones the bar is still waiting on.
 */
function verdictAt(
  entries: AlarmConditionEntry[],
  match: AlarmMatch,
  series: AlarmSeries,
  index: number,
): Verdict {
  const verdicts = entries.map((entry) => legVerdict(entry, series, index))
  if (entries.length === 1) return verdicts[0]
  const holding = entries.filter((entry) => stateAt(entry, series, index))
  const waiting = entries.filter((entry) => !stateAt(entry, series, index))
  const headlines = entries.map((entry) => entryHeadline(entry))
  const estimate = verdicts
    .map((verdict) => verdict.estimate)
    .filter((value): value is number => value !== null)
  const nearest = estimate.length ? Math.min(...estimate) : null
  return {
    reading: verdicts.map((verdict) => verdict.reading).join('  ·  '),
    detail:
      match === 'all'
        ? waiting.length === 0
          ? `All ${entries.length} conditions hold: ${joinList(headlines)}`
          : holding.length === 0
            ? `None of ${entries.length} yet: ${joinList(headlines)}`
            : `Waiting on ${joinList(waiting.map((entry) => entryHeadline(entry)))}`
        : holding.length > 0
          ? `Triggered by ${joinList(holding.map((entry) => entryHeadline(entry)))}`
          : `None of ${entries.length} yet: ${joinList(headlines)}`,
    estimate: nearest,
  }
}
/**
 * Evaluate one alarm against a series aligned to its own candles. The newest bar decides
 * `active`; the bar before it decides whether this is a fresh occurrence worth firing.
 */
export function evaluateIndicatorAlarm(alarm: IndicatorAlarm, series: AlarmSeries): AlarmReading {
  const last = series.times.length - 1
  if (last < 0) return EMPTY_READING
  const entries = alarmEntries(alarm)
  const match = alarmMatch(alarm)
  /**
   * A bar is *judgeable* only when every leg's inputs exist — an alarm must not say "waiting"
   * forever because a leg it never needed is still warming up. `all` needs every leg true,
   * `any` needs one; either way the previous bar's answer makes this a fresh occurrence.
   */
  const at = (index: number) => {
    const ready = index >= 0 && entries.every((entry) => conditionReady(entry, series, index))
    if (!ready) return { ready: false, active: false }
    const states = entries.map((entry) => stateAt(entry, series, index))
    return { ready: true, active: match === 'any' ? states.some(Boolean) : states.every(Boolean) }
  }
  const newest = at(last)
  const previous = at(last - 1)
  const verdict = verdictAt(entries, match, series, last)
  return {
    active: newest.active,
    previousActive: previous.active,
    ready: newest.ready,
    barTime: series.times[last],
    reading: newest.ready ? verdict.reading : 'Waiting for enough history',
    detail: newest.ready
      ? verdict.detail
      : `Needs more ${alarm.timeframe} bars before it can judge`,
    estimate: newest.ready ? verdict.estimate : null,
  }
}
/** A condition is judgeable only once that bar's own inputs exist. */
function conditionReady(entry: AlarmConditionEntry, series: AlarmSeries, index: number): boolean {
  switch (entry.condition) {
    case 'rsi-cross-up-level':
    case 'rsi-cross-down-level':
    case 'rsi-about-cross-up':
    case 'rsi-about-cross-down':
    case 'rsi-above-level':
    case 'rsi-below-level':
    case 'rsi-turns-up':
    case 'rsi-turns-down':
      return valueAt(series.rsi, index) !== null
    case 'wvf-spike':
    case 'wvf-spike-ends':
    case 'wvf-about-spike':
    case 'wvf-cross-above-band':
    case 'wvf-cross-above-range':
    case 'wvf-above-level':
    case 'wvf-below-level':
      return valueAt(series.wvf, index) !== null
    default:
      return valueAt(series.macd, index) !== null && valueAt(series.signal, index) !== null
  }
}
/** The `false → true` edge that fires an alarm. */
export function alarmFires(reading: AlarmReading): boolean {
  return reading.ready && reading.active && !reading.previousActive
}
/**
 * Drop the bar that is still forming, so `closed` alarms only ever judge a bar the venue has
 * finished publishing. Bars whose bucket is still open are removed; a venue that timestamps the
 * newest bar in the past (demo mode) is left alone.
 */
export function closedCandles(
  candles: Candle[],
  timeframe: Timeframe,
  nowSeconds = Date.now() / 1000,
): Candle[] {
  const step = INTERVAL_SECONDS[timeframe]
  return candles.filter((candle) => candle.time + step <= nowSeconds)
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const isKind = (value: unknown): value is AlarmIndicatorKind =>
  typeof value === 'string' && (ALARM_INDICATORS as string[]).includes(value)
/**
 * Strict shape check, used by the workspace importer and by anything that stored an alarm by
 * hand. A condition that does not belong to its indicator is invalid, not coerced.
 */
function isConditionEntry(value: unknown): value is AlarmConditionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!isKind(entry.indicator)) return false
  if (!conditionExists(entry.condition)) return false
  if (!conditionSpec(entry.condition).indicators.includes(entry.indicator)) return false
  if (typeof entry.params !== 'object' || entry.params === null || Array.isArray(entry.params))
    return false
  return Object.values(entry.params as Record<string, unknown>).every(
    (param) => typeof param === 'number' && Number.isFinite(param),
  )
}
export function isIndicatorAlarm(value: unknown): value is IndicatorAlarm {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  if (typeof a.id !== 'string' || !a.id || a.id.length > 100) return false
  if (typeof a.symbol !== 'string' || !a.symbol || a.symbol.length > 40) return false
  if (typeof a.timeframe !== 'string' || !(a.timeframe in INTERVAL_SECONDS)) return false
  if (!isKind(a.indicator)) return false
  if (!conditionExists(a.condition)) return false
  if (!conditionSpec(a.condition).indicators.includes(a.indicator)) return false
  if (typeof a.params !== 'object' || a.params === null || Array.isArray(a.params)) return false
  if (!Object.values(a.params).every((p) => typeof p === 'number' && Number.isFinite(p)))
    return false
  if (typeof a.sound !== 'boolean' || typeof a.enabled !== 'boolean') return false
  if (a.repeat !== 'bar' && a.repeat !== 'once') return false
  if (a.bars !== 'forming' && a.bars !== 'closed') return false
  if (typeof a.note !== 'string' || a.note.length > 160) return false
  if (typeof a.createdAt !== 'string' || !a.createdAt) return false
  if (typeof a.triggerCount !== 'number' || !Number.isFinite(a.triggerCount)) return false
  if (a.lastTriggeredAt !== undefined && typeof a.lastTriggeredAt !== 'string') return false
  if (a.lastTriggeredBar !== undefined && typeof a.lastTriggeredBar !== 'number') return false
  if (a.also !== undefined) {
    if (!Array.isArray(a.also) || a.also.length > ALARM_ENTRY_LIMIT - 1) return false
    if (!a.also.every(isConditionEntry)) return false
    const legs = [
      { indicator: a.indicator, condition: a.condition },
      ...(a.also as AlarmConditionEntry[]).map((entry) => ({
        indicator: entry.indicator,
        condition: entry.condition,
      })),
    ]
    const seen = new Set(legs.map((leg) => `${leg.indicator}|${leg.condition}`))
    if (seen.size !== legs.length) return false
    if (legs.filter((leg) => isMacdKind(leg.indicator)).length > 1) return false
  }
  if (a.match !== undefined && a.match !== 'all' && a.match !== 'any') return false
  if (a.rsi !== undefined && !isLengthSettings(a.rsi, ['period'])) return false
  if (a.macd !== undefined && !isLengthSettings(a.macd, ['fast', 'slow', 'signal'])) return false
  if (a.cmMacd !== undefined && !isCmMacdSettings(a.cmMacd)) return false
  if (a.williamsVixFix !== undefined && !isWilliamsVixFixSettings(a.williamsVixFix)) return false
  return true
}
function isLengthSettings(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return keys.every((key) => {
    const raw = record[key]
    return Number.isInteger(raw) && (raw as number) >= 1 && (raw as number) <= 2000
  })
}
/** Stored alarms are read straight out of localStorage: keep the valid ones, drop the rest. */
export function sanitizeIndicatorAlarms(value: unknown): IndicatorAlarm[] {
  if (!Array.isArray(value)) return []
  return value.filter(isIndicatorAlarm).slice(0, ALARM_LIMIT)
}
