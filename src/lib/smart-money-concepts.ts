import { INTERVAL_SECONDS, isInterval } from '../../shared/coinbase'
import {
  SMC_DEFAULTS,
  type Candle,
  type Indicator,
  type SMCLabelSize,
  type SMCLineStyle,
  type SmartMoneyConceptsSettings,
  type Timeframe,
} from './types'

/**
 * Atlas Smart Money Concepts is an independent OHLCV implementation. It uses
 * confirmed pivots, close-based structure breaks, opposite-candle order blocks,
 * three-candle imbalances, and ATR-scaled equal-level checks. SMC terminology is
 * descriptive rather than a promise of a particular vendor's calculation.
 */
export const SMC_COLORS = {
  internalBull: '#2962ff',
  internalBear: '#f23645',
  swingBull: '#089981',
  swingBear: '#f23645',
  bullOrderBlock: '#2962ff',
  bearOrderBlock: '#f23645',
  bullFvg: '#089981',
  bearFvg: '#f23645',
  premium: '#f23645',
  equilibrium: '#787b86',
  discount: '#2962ff',
  monochrome: '#b2b5be',
  muted: '#636363',
} as const

export type SmcSide = 'bullish' | 'bearish'
export type SmcPivotKind = 'high' | 'low'
export type SmcStructureKind = 'internal' | 'swing'
export type SmcStructureType = 'BOS' | 'CHoCH'

export interface SmcPalette {
  internalBull: string
  internalBear: string
  swingBull: string
  swingBear: string
  bullOrderBlock: string
  bearOrderBlock: string
  bullFvg: string
  bearFvg: string
  premium: string
  equilibrium: string
  discount: string
  muted: string
}

export interface SmcPivot {
  index: number
  confirmedAt: number
  kind: SmcPivotKind
  price: number
  label: 'HH' | 'LH' | 'HL' | 'LL'
}

export interface SmcStructureEvent {
  kind: SmcStructureKind
  side: SmcSide
  type: SmcStructureType
  pivotIndex: number
  breakIndex: number
  price: number
}

export interface SmcOrderBlock {
  id: string
  kind: SmcStructureKind
  side: SmcSide
  startIndex: number
  createdIndex: number
  top: number
  bottom: number
  mitigatedAt?: number
  invalidatedAt?: number
}

export interface SmcEqualLevel {
  side: 'high' | 'low'
  firstIndex: number
  secondIndex: number
  price: number
}

export interface SmcFairValueGap {
  side: SmcSide
  /** Index in the selected FVG source, retained for deterministic tests/debugging. */
  startIndex: number
  /** Source timestamps let an alternate FVG timeframe project onto the chart. */
  startTime: number
  endTime: number
  top: number
  bottom: number
  mitigatedAt?: number
  endIndex: number
}

export interface SmcPreviousHighLow {
  timeframe: 'D' | 'W' | 'M'
  startIndex: number
  endIndex: number
  high: number
  low: number
  style: SMCLineStyle
}

export interface SmcRange {
  high: number
  low: number
  startIndex: number
}

export type SmcTimeframes = Partial<Record<Timeframe, { candles: Candle[] }>>
export interface SmartMoneyConceptsContext {
  timeframe: Timeframe
  timeframes?: SmcTimeframes
  replay?: boolean
}

export interface SmartMoneyConceptsResult {
  internalEvents: SmcStructureEvent[]
  swingEvents: SmcStructureEvent[]
  internalPivots: SmcPivot[]
  swingPivots: SmcPivot[]
  internalOrderBlocks: SmcOrderBlock[]
  swingOrderBlocks: SmcOrderBlock[]
  equalLevels: SmcEqualLevel[]
  fairValueGaps: SmcFairValueGap[]
  previousHighLows: SmcPreviousHighLow[]
  range?: SmcRange
  /** -1 bearish, 0 unestablished, 1 bullish, one entry per source bar. */
  trend: number[]
  swingTrend: number
}

const STRUCTURE_FILTERS = ['All', 'BOS', 'CHoCH'] as const
const LABEL_SIZES = ['Tiny', 'Small', 'Normal'] as const
const ORDER_BLOCK_FILTERS = ['Atr', 'Cumulative Mean Range'] as const
const MITIGATION_SOURCES = ['High/Low', 'Close'] as const
const LINE_STYLES = ['⎯⎯⎯', '----', '····'] as const
const INTERNAL_PIVOT_LENGTH = 3

export function smcPalette(settings: SmartMoneyConceptsSettings): SmcPalette {
  if (settings.style === 'Monochrome')
    return {
      internalBull: SMC_COLORS.monochrome,
      internalBear: SMC_COLORS.monochrome,
      swingBull: SMC_COLORS.monochrome,
      swingBear: SMC_COLORS.monochrome,
      bullOrderBlock: SMC_COLORS.monochrome,
      bearOrderBlock: '#7d8490',
      bullFvg: SMC_COLORS.monochrome,
      bearFvg: '#7d8490',
      premium: '#8b919b',
      equilibrium: SMC_COLORS.monochrome,
      discount: '#8b919b',
      muted: SMC_COLORS.muted,
    }
  return { ...SMC_COLORS }
}

export function smcLabelSize(size: SMCLabelSize): number {
  return size === 'Tiny' ? 8 : size === 'Small' ? 10 : 12
}

export function smcSettings(indicator: Indicator): SmartMoneyConceptsSettings {
  return isSmartMoneyConceptsSettings(indicator.smc) ? indicator.smc : { ...SMC_DEFAULTS }
}

export function smcIndicatorLabel(indicator: Indicator): string {
  const settings = smcSettings(indicator)
  const tiny = (size: SmartMoneyConceptsSettings['internalLabelSize']) => size.toLowerCase()
  return (
    `LuxAlgo - Smart Money Concepts (${settings.mode}, ${settings.style}, ` +
    `${settings.internalBullish}, ${settings.internalBearish}, ${tiny(settings.internalLabelSize)}, ` +
    `${settings.swingBullish}, ${settings.swingBearish}, ${tiny(settings.swingLabelSize)}, ` +
    `${settings.swingLength}, ${settings.internalOrderBlockCount}, ${settings.swingOrderBlockCount}, ` +
    `${settings.orderBlockFilter}, ${settings.orderBlockMitigation}, ${settings.equalHighLowBars}, ` +
    `${settings.equalHighLowThreshold}, ${tiny(settings.equalHighLowLabelSize)}, ` +
    `${settings.fvgTimeframe}, ${settings.fvgExtend}, ${settings.dailyLineStyle}, ` +
    `${settings.weeklyLineStyle}, ${settings.monthlyLineStyle})`
  )
}

export function isSmartMoneyConceptsSettings(value: unknown): value is SmartMoneyConceptsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as SmartMoneyConceptsSettings
  const booleans = [
    settings.colorCandles,
    settings.showInternal,
    settings.confluenceFilter,
    settings.showSwing,
    settings.showSwingPoints,
    settings.showStrongWeakHighsLows,
    settings.showInternalOrderBlocks,
    settings.showSwingOrderBlocks,
    settings.highlightMitigatedBlocks,
    settings.showEqualHighLow,
    settings.showFairValueGaps,
    settings.fvgAutoThreshold,
    settings.showDailyHighLow,
    settings.showWeeklyHighLow,
    settings.showMonthlyHighLow,
    settings.showPremiumDiscount,
  ]
  return (
    (settings.mode === 'Historical' || settings.mode === 'Present') &&
    (settings.style === 'Colored' || settings.style === 'Monochrome') &&
    STRUCTURE_FILTERS.includes(settings.internalBullish) &&
    STRUCTURE_FILTERS.includes(settings.internalBearish) &&
    STRUCTURE_FILTERS.includes(settings.swingBullish) &&
    STRUCTURE_FILTERS.includes(settings.swingBearish) &&
    LABEL_SIZES.includes(settings.internalLabelSize) &&
    LABEL_SIZES.includes(settings.swingLabelSize) &&
    LABEL_SIZES.includes(settings.equalHighLowLabelSize) &&
    ORDER_BLOCK_FILTERS.includes(settings.orderBlockFilter) &&
    MITIGATION_SOURCES.includes(settings.orderBlockMitigation) &&
    LINE_STYLES.includes(settings.dailyLineStyle) &&
    LINE_STYLES.includes(settings.weeklyLineStyle) &&
    LINE_STYLES.includes(settings.monthlyLineStyle) &&
    (settings.fvgTimeframe === '' || isInterval(settings.fvgTimeframe)) &&
    Number.isInteger(settings.swingLength) &&
    settings.swingLength >= 2 &&
    settings.swingLength <= 500 &&
    Number.isInteger(settings.internalOrderBlockCount) &&
    settings.internalOrderBlockCount >= 1 &&
    settings.internalOrderBlockCount <= 50 &&
    Number.isInteger(settings.swingOrderBlockCount) &&
    settings.swingOrderBlockCount >= 1 &&
    settings.swingOrderBlockCount <= 50 &&
    Number.isInteger(settings.equalHighLowBars) &&
    settings.equalHighLowBars >= 1 &&
    settings.equalHighLowBars <= 100 &&
    Number.isFinite(settings.equalHighLowThreshold) &&
    settings.equalHighLowThreshold >= 0 &&
    settings.equalHighLowThreshold <= 0.5 &&
    Number.isInteger(settings.fvgExtend) &&
    settings.fvgExtend >= 1 &&
    settings.fvgExtend <= 500 &&
    booleans.every((item) => typeof item === 'boolean')
  )
}

/** Confirmed symmetric high/low pivots. A pivot is only available after `length` future bars. */
export function findSmcPivots(candles: Candle[], length: number): SmcPivot[] {
  if (!Number.isInteger(length) || length < 1 || length > 500)
    throw new Error('Pivot length must be an integer between 1 and 500.')
  const raw: Omit<SmcPivot, 'label'>[] = []
  for (let index = length; index < candles.length - length; index++) {
    const candle = candles[index]
    let isHigh = true
    let isLow = true
    for (let cursor = index - length; cursor <= index + length; cursor++) {
      if (cursor === index) continue
      if (candles[cursor].high >= candle.high) isHigh = false
      if (candles[cursor].low <= candle.low) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) raw.push({ index, confirmedAt: index + length, kind: 'high', price: candle.high })
    if (isLow) raw.push({ index, confirmedAt: index + length, kind: 'low', price: candle.low })
  }
  raw.sort((left, right) => left.index - right.index || (left.kind === 'high' ? -1 : 1))
  let priorHigh: number | undefined
  let priorLow: number | undefined
  return raw.map((pivot) => {
    let label: SmcPivot['label']
    if (pivot.kind === 'high') {
      label = priorHigh === undefined || pivot.price > priorHigh ? 'HH' : 'LH'
      priorHigh = pivot.price
    } else {
      label = priorLow === undefined || pivot.price < priorLow ? 'LL' : 'HL'
      priorLow = pivot.price
    }
    return { ...pivot, label }
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

/** Wilder-like, seeded running ATR that stays defined for a short chart. */
export function smcAtr(candles: Candle[], length = 14): number[] {
  const ranges = trueRanges(candles)
  if (!ranges.length) return []
  let sum = 0
  let prior = 0
  return ranges.map((range, index) => {
    sum += range
    if (index < length) {
      prior = sum / (index + 1)
      return prior
    }
    prior = (prior * (length - 1) + range) / length
    return prior
  })
}

function cumulativeMeanRanges(candles: Candle[]): number[] {
  let total = 0
  return candles.map((candle, index) => {
    total += candle.high - candle.low
    return total / (index + 1)
  })
}

function concordant(candle: Candle, side: SmcSide): boolean {
  const midpoint = (candle.high + candle.low) / 2
  return side === 'bullish'
    ? candle.close >= candle.open && candle.close >= midpoint
    : candle.close <= candle.open && candle.close <= midpoint
}

interface StructureCalculation {
  events: SmcStructureEvent[]
  trend: number[]
  finalTrend: number
}

function structureEvents(
  candles: Candle[],
  pivots: SmcPivot[],
  kind: SmcStructureKind,
  useConfluenceFilter: boolean,
): StructureCalculation {
  const confirmed = new Map<number, SmcPivot[]>()
  for (const pivot of pivots) {
    const available = confirmed.get(pivot.confirmedAt) ?? []
    available.push(pivot)
    confirmed.set(pivot.confirmedAt, available)
  }
  let high: SmcPivot | undefined
  let low: SmcPivot | undefined
  let highBroken = false
  let lowBroken = false
  let currentTrend = 0
  const trend: number[] = []
  const events: SmcStructureEvent[] = []
  for (let index = 0; index < candles.length; index++) {
    for (const pivot of confirmed.get(index) ?? []) {
      if (pivot.kind === 'high') {
        high = pivot
        highBroken = false
      } else {
        low = pivot
        lowBroken = false
      }
    }
    const candle = candles[index]
    if (
      high &&
      !highBroken &&
      candle.close > high.price &&
      (!useConfluenceFilter || concordant(candle, 'bullish'))
    ) {
      events.push({
        kind,
        side: 'bullish',
        type: currentTrend < 0 ? 'CHoCH' : 'BOS',
        pivotIndex: high.index,
        breakIndex: index,
        price: high.price,
      })
      highBroken = true
      currentTrend = 1
    } else if (
      low &&
      !lowBroken &&
      candle.close < low.price &&
      (!useConfluenceFilter || concordant(candle, 'bearish'))
    ) {
      events.push({
        kind,
        side: 'bearish',
        type: currentTrend > 0 ? 'CHoCH' : 'BOS',
        pivotIndex: low.index,
        breakIndex: index,
        price: low.price,
      })
      lowBroken = true
      currentTrend = -1
    }
    trend.push(currentTrend)
  }
  return { events, trend, finalTrend: currentTrend }
}

function orderBlockFromEvent(
  candles: Candle[],
  event: SmcStructureEvent,
  settings: SmartMoneyConceptsSettings,
  atr: number[],
  meanRange: number[],
): SmcOrderBlock | undefined {
  const expectedBearish = event.side === 'bullish'
  const start = Math.max(0, event.pivotIndex)
  for (let index = event.breakIndex - 1; index >= start; index--) {
    const candle = candles[index]
    const opposite = expectedBearish ? candle.close < candle.open : candle.close > candle.open
    const filter = settings.orderBlockFilter === 'Atr' ? atr[index] : meanRange[index]
    if (!opposite || candle.high - candle.low > filter * 2) continue
    return {
      id: `${event.kind}:${event.side}:${event.pivotIndex}:${event.breakIndex}:${index}`,
      kind: event.kind,
      side: event.side,
      startIndex: index,
      createdIndex: event.breakIndex,
      top: candle.high,
      bottom: candle.low,
    }
  }
  return undefined
}

function settleOrderBlock(
  block: SmcOrderBlock,
  candles: Candle[],
  settings: SmartMoneyConceptsSettings,
): SmcOrderBlock {
  let mitigatedAt: number | undefined
  let invalidatedAt: number | undefined
  for (let index = block.createdIndex + 1; index < candles.length; index++) {
    const candle = candles[index]
    const test =
      settings.orderBlockMitigation === 'Close'
        ? candle.close
        : block.side === 'bullish'
          ? candle.low
          : candle.high
    const invalidated = block.side === 'bullish' ? test < block.bottom : test > block.top
    if (invalidated) {
      invalidatedAt = index
      break
    }
    const touched = block.side === 'bullish' ? test <= block.top : test >= block.bottom
    if (touched && mitigatedAt === undefined) mitigatedAt = index
  }
  return { ...block, mitigatedAt, invalidatedAt }
}

function orderBlocks(
  candles: Candle[],
  events: SmcStructureEvent[],
  settings: SmartMoneyConceptsSettings,
  atr: number[],
  meanRange: number[],
  count: number,
): SmcOrderBlock[] {
  const unique = new Map<string, SmcOrderBlock>()
  for (const event of events) {
    const block = orderBlockFromEvent(candles, event, settings, atr, meanRange)
    if (block) unique.set(block.id, settleOrderBlock(block, candles, settings))
  }
  return [...unique.values()]
    .filter((block) => block.invalidatedAt === undefined)
    .sort((left, right) => right.createdIndex - left.createdIndex)
    .slice(0, count)
}

function equalLevels(candles: Candle[], pivots: SmcPivot[], settings: SmartMoneyConceptsSettings) {
  const atr = smcAtr(candles)
  let previousHigh: SmcPivot | undefined
  let previousLow: SmcPivot | undefined
  const levels: SmcEqualLevel[] = []
  for (const pivot of pivots) {
    const prior = pivot.kind === 'high' ? previousHigh : previousLow
    if (
      prior &&
      Math.abs(prior.price - pivot.price) <= atr[pivot.index] * settings.equalHighLowThreshold
    )
      levels.push({
        side: pivot.kind,
        firstIndex: prior.index,
        secondIndex: pivot.index,
        price: (prior.price + pivot.price) / 2,
      })
    if (pivot.kind === 'high') previousHigh = pivot
    else previousLow = pivot
  }
  return levels
}

function fairValueGaps(
  candles: Candle[],
  settings: SmartMoneyConceptsSettings,
  intervalSeconds: number,
): SmcFairValueGap[] {
  const atr = smcAtr(candles)
  const gaps: SmcFairValueGap[] = []
  for (let index = 2; index < candles.length; index++) {
    const first = candles[index - 2]
    const middle = candles[index - 1]
    const last = candles[index]
    const bullish = last.low > first.high && middle.close >= middle.open
    const bearish = last.high < first.low && middle.close <= middle.open
    if (!bullish && !bearish) continue
    const top = bullish ? last.low : first.low
    const bottom = bullish ? first.high : last.high
    if (settings.fvgAutoThreshold && top - bottom < atr[index] * 0.1) continue
    let mitigatedAt: number | undefined
    for (let future = index + 1; future < candles.length; future++) {
      const mitigated = bullish ? candles[future].low <= bottom : candles[future].high >= top
      if (mitigated) {
        mitigatedAt = future
        break
      }
    }
    const endIndex = mitigatedAt ?? Math.min(candles.length - 1, index + settings.fvgExtend)
    gaps.push({
      side: bullish ? 'bullish' : 'bearish',
      startIndex: index - 1,
      startTime: middle.time,
      endTime:
        mitigatedAt === undefined
          ? last.time + intervalSeconds * settings.fvgExtend
          : candles[mitigatedAt].time,
      top,
      bottom,
      mitigatedAt,
      endIndex,
    })
  }
  return gaps
}

function calendarBucket(time: number, timeframe: 'D' | 'W' | 'M'): string {
  const date = new Date(time * 1000)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (timeframe === 'M') return `${year}-${String(month + 1).padStart(2, '0')}`
  if (timeframe === 'D')
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  const monday = new Date(Date.UTC(year, month, date.getUTCDate()))
  const day = monday.getUTCDay() || 7
  monday.setUTCDate(monday.getUTCDate() - day + 1)
  return `W-${monday.toISOString().slice(0, 10)}`
}

function previousHighLows(
  candles: Candle[],
  timeframe: 'D' | 'W' | 'M',
  style: SMCLineStyle,
): SmcPreviousHighLow[] {
  if (!candles.length) return []
  const buckets: { startIndex: number; endIndex: number; high: number; low: number }[] = []
  let key = calendarBucket(candles[0].time, timeframe)
  let current = {
    startIndex: 0,
    endIndex: 0,
    high: candles[0].high,
    low: candles[0].low,
  }
  for (let index = 1; index < candles.length; index++) {
    const next = calendarBucket(candles[index].time, timeframe)
    if (next !== key) {
      buckets.push(current)
      key = next
      current = {
        startIndex: index,
        endIndex: index,
        high: candles[index].high,
        low: candles[index].low,
      }
    } else {
      current.endIndex = index
      current.high = Math.max(current.high, candles[index].high)
      current.low = Math.min(current.low, candles[index].low)
    }
  }
  buckets.push(current)
  return buckets.slice(1).map((bucket, index) => {
    const previous = buckets[index]
    return {
      timeframe,
      startIndex: bucket.startIndex,
      endIndex: bucket.endIndex,
      high: previous.high,
      low: previous.low,
      style,
    }
  })
}

function latestRange(pivots: SmcPivot[]): SmcRange | undefined {
  const high = [...pivots].reverse().find((pivot) => pivot.kind === 'high')
  const low = [...pivots].reverse().find((pivot) => pivot.kind === 'low')
  if (!high || !low || high.price <= low.price) return undefined
  return { high: high.price, low: low.price, startIndex: Math.min(high.index, low.index) }
}

function fvgSource(
  candles: Candle[],
  settings: SmartMoneyConceptsSettings,
  context?: SmartMoneyConceptsContext,
): { candles: Candle[]; intervalSeconds: number } {
  const chartInterval = context ? INTERVAL_SECONDS[context.timeframe] : undefined
  const inferredInterval = candles[1] ? candles[1].time - candles[0].time : 60 * 60
  if (!settings.fvgTimeframe || settings.fvgTimeframe === context?.timeframe)
    return { candles, intervalSeconds: chartInterval ?? inferredInterval }

  const intervalSeconds = INTERVAL_SECONDS[settings.fvgTimeframe]
  const source = context?.timeframes?.[settings.fvgTimeframe]?.candles ?? []
  if (!context?.replay || !candles.length) return { candles: source, intervalSeconds }

  // A replay frame must never use the eventual high/low of a higher-timeframe
  // candle that had not closed at the replay cursor yet.
  const chartEnd = candles[candles.length - 1].time + (chartInterval ?? inferredInterval)
  return {
    candles: source.filter((candle) => candle.time + intervalSeconds <= chartEnd),
    intervalSeconds,
  }
}

export function calculateSmartMoneyConcepts(
  candles: Candle[],
  settings: SmartMoneyConceptsSettings,
  context?: SmartMoneyConceptsContext,
): SmartMoneyConceptsResult {
  if (!isSmartMoneyConceptsSettings(settings))
    throw new Error('Invalid Smart Money Concepts settings.')
  const internalPivots = findSmcPivots(candles, INTERNAL_PIVOT_LENGTH)
  const swingPivots = findSmcPivots(candles, settings.swingLength)
  const internal = structureEvents(candles, internalPivots, 'internal', settings.confluenceFilter)
  const swing = structureEvents(candles, swingPivots, 'swing', false)
  const atr = smcAtr(candles)
  const meanRange = cumulativeMeanRanges(candles)
  const internalOrderBlocks = orderBlocks(
    candles,
    internal.events,
    settings,
    atr,
    meanRange,
    settings.internalOrderBlockCount,
  )
  const swingOrderBlocks = orderBlocks(
    candles,
    swing.events,
    settings,
    atr,
    meanRange,
    settings.swingOrderBlockCount,
  )
  const fvg = fvgSource(candles, settings, context)
  const previous = [
    ...(settings.showDailyHighLow ? previousHighLows(candles, 'D', settings.dailyLineStyle) : []),
    ...(settings.showWeeklyHighLow ? previousHighLows(candles, 'W', settings.weeklyLineStyle) : []),
    ...(settings.showMonthlyHighLow
      ? previousHighLows(candles, 'M', settings.monthlyLineStyle)
      : []),
  ]
  return {
    internalEvents: internal.events,
    swingEvents: swing.events,
    internalPivots,
    swingPivots,
    internalOrderBlocks,
    swingOrderBlocks,
    equalLevels: equalLevels(candles, findSmcPivots(candles, settings.equalHighLowBars), settings),
    fairValueGaps: fairValueGaps(fvg.candles, settings, fvg.intervalSeconds),
    previousHighLows: previous,
    range: latestRange(swingPivots),
    trend: internal.trend.map((value, index) => value || swing.trend[index] || 0),
    swingTrend: swing.finalTrend,
  }
}

function latestBy<T>(values: T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>()
  for (const value of values) result.set(key(value), value)
  return [...result.values()]
}

/** Caps markup in Historical mode and retains only the current set in Present mode. */
export function displayedSmcResult(
  result: SmartMoneyConceptsResult,
  settings: SmartMoneyConceptsSettings,
): SmartMoneyConceptsResult {
  if (settings.mode === 'Historical')
    return {
      ...result,
      internalEvents: result.internalEvents.slice(-100),
      swingEvents: result.swingEvents.slice(-60),
      internalPivots: result.internalPivots.slice(-80),
      swingPivots: result.swingPivots.slice(-30),
      equalLevels: result.equalLevels.slice(-30),
      fairValueGaps: result.fairValueGaps.slice(-40),
      previousHighLows: result.previousHighLows.slice(-24),
    }
  return {
    ...result,
    internalEvents: latestBy(result.internalEvents, (event) => `${event.side}:${event.type}`),
    swingEvents: latestBy(result.swingEvents, (event) => `${event.side}:${event.type}`),
    internalPivots: latestBy(result.internalPivots, (pivot) => pivot.kind),
    swingPivots: latestBy(result.swingPivots, (pivot) => pivot.kind),
    equalLevels: latestBy(result.equalLevels, (level) => level.side),
    fairValueGaps: latestBy(result.fairValueGaps, (gap) => gap.side),
    previousHighLows: latestBy(result.previousHighLows, (level) => level.timeframe),
  }
}

export function structureAllowed(
  type: SmcStructureType,
  filter: SmartMoneyConceptsSettings['internalBullish'],
): boolean {
  return filter === 'All' || filter === type
}
