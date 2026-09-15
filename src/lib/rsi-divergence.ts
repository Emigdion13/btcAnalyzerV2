/**
 * RSI Divergence indicator and detection.
 * Computes Wilder's RSI and identifies regular and hidden divergences
 * between confirmed RSI oscillator pivots and price highs/lows.
 */
import { ta } from './indicator-runtime'
import { DIVERGENCE_COLORS, detectMacdDivergences, divergenceSettings } from './macd-divergence'
import type { Divergence } from './macd-divergence'
import type { Candle, DivergenceSettings, Indicator, Plot } from './types'
import { DIVERGENCE_DEFAULTS } from './types'

export const RSI_DIVERGENCE_DEFAULTS = {
  period: 14,
  overbought: 70,
  oversold: 30,
  midline: 50,
  color: '#ad91e5',
  divergence: { ...DIVERGENCE_DEFAULTS },
} as const

export interface RsiDivergenceValues {
  rsi: (number | null)[]
  divergences: Divergence[]
}

/**
 * Calculates Wilder RSI and detects regular and hidden divergences against price.
 */
export function calculateRsiDivergence(
  candles: Candle[],
  settings?: { period?: number; divergence?: DivergenceSettings },
): RsiDivergenceValues {
  const period = settings?.period ?? RSI_DIVERGENCE_DEFAULTS.period
  const divSettings = settings?.divergence ?? { ...DIVERGENCE_DEFAULTS }
  const close = candles.map((c) => c.close)
  const rsi = ta.rsi(close, period)
  const divergences = detectMacdDivergences(candles, rsi, divSettings)
  return { rsi, divergences }
}

/**
 * Technical plots for the RSI Divergence oscillator pane:
 * primary RSI line, overbought level (70), midline (50), and oversold level (30).
 */
export function rsiDivergencePlots(
  values: { rsi: (number | null)[] },
  indicator: Indicator,
): Plot[] {
  const period = indicator.period || RSI_DIVERGENCE_DEFAULTS.period
  const color = indicator.color || RSI_DIVERGENCE_DEFAULTS.color
  const rsi = values.rsi

  return [
    {
      title: `RSI ${period}`,
      values: rsi,
      color,
      pane: 'oscillator',
      lineWidth: 1,
    },
    {
      title: 'Overbought (70)',
      values: rsi.map(() => 70),
      color: '#ef5350',
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: 70,
      hideLegend: true,
    },
    {
      title: 'Midline (50)',
      values: rsi.map(() => 50),
      color: '#6b7280',
      pane: 'oscillator',
      lineWidth: 1,
      style: 'cross',
      horizontalLine: 50,
      hideLegend: true,
    },
    {
      title: 'Oversold (30)',
      values: rsi.map(() => 30),
      color: '#26a69a',
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: 30,
      hideLegend: true,
    },
  ]
}

export function rsiDivergenceIndicatorLabel(indicator: Indicator): string {
  const period = indicator.period || RSI_DIVERGENCE_DEFAULTS.period
  return `RSI Divergence ${period}`
}

export { DIVERGENCE_COLORS, divergenceSettings }
