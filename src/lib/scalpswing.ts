import { ta } from './indicator-runtime'
import type { Candle, Indicator, Plot, ScalpSwingSettings } from './types'
import { SCALPSWING_DEFAULTS } from './types'

export const SCALPSWING_COLORS = {
  buy: '#26a69a',
  sell: '#ef5350',
  pac: '#7a8592',
  pacClose: '#b0bec5',
  emaFilter: '#42a5f5',
  bigBuy: '#00e5ff',
  bigSell: '#ff4081',
} as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isScalpSwingSettings(value: unknown): value is ScalpSwingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.pacLength === 'number' &&
    Number.isInteger(s.pacLength) &&
    s.pacLength >= 2 &&
    s.pacLength <= 200 &&
    typeof s.filterWithEma === 'boolean' &&
    typeof s.emaFilterLength === 'number' &&
    Number.isInteger(s.emaFilterLength) &&
    s.emaFilterLength >= 1 &&
    s.emaFilterLength <= 2000 &&
    typeof s.showPacChannel === 'boolean' &&
    typeof s.showEmaFilter === 'boolean' &&
    typeof s.useBigArrows === 'boolean' &&
    typeof s.showLabels === 'boolean' &&
    typeof s.signalOnNextBar === 'boolean' &&
    typeof s.buyColor === 'string' &&
    HEX_COLOR.test(s.buyColor as string) &&
    typeof s.sellColor === 'string' &&
    HEX_COLOR.test(s.sellColor as string)
  )
}

export function scalpSwingSettings(indicator: Indicator): ScalpSwingSettings {
  const custom = indicator.scalpswing
  if (custom && isScalpSwingSettings(custom)) return custom
  // Fallback: derive pacLength from period if plausible, otherwise defaults
  const period = typeof indicator.period === 'number' ? indicator.period : SCALPSWING_DEFAULTS.pacLength
  return {
    ...SCALPSWING_DEFAULTS,
    pacLength: Number.isInteger(period) && period >= 2 && period <= 200 ? period : SCALPSWING_DEFAULTS.pacLength,
    buyColor: indicator.color && HEX_COLOR.test(indicator.color) ? indicator.color : SCALPSWING_DEFAULTS.buyColor,
  }
}

export function scalpSwingIndicatorLabel(indicator: Indicator): string {
  const s = scalpSwingSettings(indicator)
  return `SCALPSWING R1-6 (${s.pacLength})`
}

export type ScalpSwingSignalSide = 'buy' | 'sell'

export interface ScalpSwingSignal {
  index: number
  side: ScalpSwingSignalSide
  /** Candle time for positioning */
  time: number
  /** Price where arrow anchors (low for buy, high for sell) */
  price: number
  /** Close price at signal bar */
  close: number
  /** PAC values at signal bar for tooltip/debug */
  pacU: number | null
  pacL: number | null
  pacC: number | null
  emaFilter: number | null
}

export interface ScalpSwingResult {
  pacU: (number | null)[]
  pacL: (number | null)[]
  pacC: (number | null)[]
  emaFilter: (number | null)[]
  signals: ScalpSwingSignal[]
  warmupBars: number
}

/**
 * Core PAC logic extracted from JustUncleL's Scalping Swing Trading Tool R1-6
 * published open-source on TradingView. See docs/scalpswing.md for full
 * provenance and behavioral contract.
 *
 * Original Pine v3 snippet (simplified):
 *   pacC = ema(close_, HiLoLen)
 *   pacL = ema(low_, HiLoLen)
 *   pacU = ema(high_, HiLoLen)
 *   EMA200 = ema(close_, 200)
 *   isup = exitClose>exitOpen and exitClose>pacU and exitClose[1]<pacU[1] and (not filterEMA200 or pacC>emaMedium)
 *   isdown = exitClose<exitOpen and exitClose<pacL and exitClose[1]>pacL[1] and (not filterEMA200 or pacC<emaMedium)
 *   up_alert := isup ? na(up_alert[1]) ? 1 : up_alert[1]+1 : 0
 *   dn_alert := isdown ? na(dn_alert[1]) ? 1 : dn_alert[1]+1 : 0
 *   plotshape(up_alert[1]==1 ? true : na, ... arrowup belowbar ...)
 *   plotshape(dn_alert[1]==1 ? true : na, ... arrowdown abovebar ...)
 *
 * The small arrows at bottom/top of candles are those plotshape arrows.
 * Atlas replicates the same EMA and breakout conditions bar-by-bar.
 *
 * Two display modes are supported:
 * - signalOnNextBar = false (default for Atlas): arrow on the breakout candle itself,
 *   more intuitive for users wanting arrows at candle bottom/top.
 * - signalOnNextBar = true: arrow one bar later, matching original Pine's [1] offset.
 */
export function calculateScalpSwing(candles: Candle[], settings: ScalpSwingSettings): ScalpSwingResult {
  if (!isScalpSwingSettings(settings)) throw new Error('Invalid ScalpSwing settings')
  const n = candles.length
  if (n === 0) {
    return { pacU: [], pacL: [], pacC: [], emaFilter: [], signals: [], warmupBars: settings.pacLength }
  }

  const close = candles.map((c) => c.close)
  const high = candles.map((c) => c.high)
  const low = candles.map((c) => c.low)

  const pacC = ta.ema(close, settings.pacLength)
  const pacU = ta.ema(high, settings.pacLength)
  const pacL = ta.ema(low, settings.pacLength)
  const emaFilter = ta.ema(close, settings.emaFilterLength)

  const signals: ScalpSwingSignal[] = []

  // For next-bar mode we need to track pending alerts like Pine's up_alert/dn_alert
  let pendingUp = false
  let pendingDown = false

  for (let i = 1; i < n; i++) {
    const c = candles[i]
    const prev = candles[i - 1]

    const curPacU = pacU[i]
    const prevPacU = pacU[i - 1]
    const curPacL = pacL[i]
    const prevPacL = pacL[i - 1]
    const curPacC = pacC[i]
    const curEma = emaFilter[i]

    // Warmup check: PAC values must be present
    if (curPacU === null || prevPacU === null || curPacL === null || prevPacL === null || curPacC === null) {
      // Still need to clear pending if in next-bar mode and warmup fails?
      pendingUp = false
      pendingDown = false
      continue
    }

    const filterOkUp = !settings.filterWithEma || (curEma !== null && curPacC > curEma)
    const filterOkDown = !settings.filterWithEma || (curEma !== null && curPacC < curEma)

    const isUp = c.close > c.open && c.close > curPacU && prev.close < prevPacU && filterOkUp
    const isDown = c.close < c.open && c.close < curPacL && prev.close > prevPacL && filterOkDown

    if (settings.signalOnNextBar) {
      // Original behavior: signal appears on bar after breakout
      if (pendingUp) {
        signals.push({
          index: i,
          side: 'buy',
          time: c.time,
          price: c.low,
          close: c.close,
          pacU: curPacU,
          pacL: curPacL,
          pacC: curPacC,
          emaFilter: curEma,
        })
      }
      if (pendingDown) {
        signals.push({
          index: i,
          side: 'sell',
          time: c.time,
          price: c.high,
          close: c.close,
          pacU: curPacU,
          pacL: curPacL,
          pacC: curPacC,
          emaFilter: curEma,
        })
      }
      pendingUp = isUp
      pendingDown = isDown
    } else {
      if (isUp) {
        signals.push({
          index: i,
          side: 'buy',
          time: c.time,
          price: c.low,
          close: c.close,
          pacU: curPacU,
          pacL: curPacL,
          pacC: curPacC,
          emaFilter: curEma,
        })
      }
      if (isDown) {
        signals.push({
          index: i,
          side: 'sell',
          time: c.time,
          price: c.high,
          close: c.close,
          pacU: curPacU,
          pacL: curPacL,
          pacC: curPacC,
          emaFilter: curEma,
        })
      }
    }
  }

  return {
    pacU,
    pacL,
    pacC,
    emaFilter,
    signals,
    warmupBars: Math.max(settings.pacLength, settings.emaFilterLength),
  }
}

export function scalpSwingPlots(candles: Candle[], indicator: Indicator): Plot[] {
  const settings = scalpSwingSettings(indicator)
  const result = calculateScalpSwing(candles, settings)
  const plots: Plot[] = []

  if (settings.showPacChannel) {
    plots.push({
      title: `PAC High ${settings.pacLength}`,
      color: SCALPSWING_COLORS.pac,
      values: result.pacU,
      pane: 'price',
      lineWidth: 1,
    })
    plots.push({
      title: `PAC Low ${settings.pacLength}`,
      color: SCALPSWING_COLORS.pac,
      values: result.pacL,
      pane: 'price',
      lineWidth: 1,
    })
    plots.push({
      title: `PAC Close ${settings.pacLength}`,
      color: SCALPSWING_COLORS.pacClose,
      values: result.pacC,
      pane: 'price',
      lineWidth: 1,
    })
  }

  if (settings.showEmaFilter) {
    plots.push({
      title: `EMA ${settings.emaFilterLength}`,
      color: SCALPSWING_COLORS.emaFilter,
      values: result.emaFilter,
      pane: 'price',
      lineWidth: 2,
    })
  }

  return plots
}
