/**
 * The floating RSI meter and the indicator behind it.
 *
 * The meter is a window, not a pane: the toolbar button owns whether it is on screen. It still
 * reads its period from an RSI indicator, so one is kept on the chart while the window is open —
 * added hidden, so no oscillator pane is drawn — which keeps the period editable from the legend
 * chip and shared with the pane you get by adding RSI as a real indicator.
 */
import type { Indicator } from './types'

/** Stable id, so the window only ever adds and removes its own indicator. */
export const RSI_METER_INDICATOR_ID = 'rsi-meter'

/** The cap the indicator library already enforces; the window never pushes past it. */
export const RSI_METER_INDICATOR_LIMIT = 16

export const RSI_METER_DEFAULT_PERIOD = 14
export const RSI_METER_COLOR = '#ad91e5'

/**
 * Whether the meter is open. A stored `null` means "never chosen", which defers to this default;
 * an explicit choice — from the toolbar button, the workspace menu, or removing the meter's own
 * indicator — wins over it either way.
 */
export const RSI_METER_DEFAULT_VISIBLE = true

export function rsiMeterVisible(preference: boolean | null): boolean {
  return preference ?? RSI_METER_DEFAULT_VISIBLE
}

/** The indicator the meter reads its period from: the chart's own RSI, hidden one included. */
export function rsiMeterSource(indicators: Indicator[]): Indicator | null {
  return indicators.find((indicator) => indicator.kind === 'rsi') ?? null
}

/** The period the meter shows, falling back to the conventional 14 while the chart has no RSI. */
export function rsiMeterPeriod(indicators: Indicator[]): number {
  return rsiMeterSource(indicators)?.period ?? RSI_METER_DEFAULT_PERIOD
}

/** True only for the hidden indicator the window itself added — never for one you added. */
export function isRsiMeterIndicator(indicator: Indicator): boolean {
  return indicator.id === RSI_METER_INDICATOR_ID && indicator.kind === 'rsi'
}

/**
 * Opening the window: give it an indicator to read from when the chart has none. It is added
 * hidden so no pane is drawn. At the indicator cap it declines rather than evicting something
 * the trader put there, and the meter simply reads the conventional period.
 */
export function withRsiMeterIndicator(indicators: Indicator[]): Indicator[] {
  if (indicators.some((indicator) => indicator.kind === 'rsi')) return indicators
  if (indicators.length >= RSI_METER_INDICATOR_LIMIT) return indicators
  return [
    ...indicators,
    {
      id: RSI_METER_INDICATOR_ID,
      kind: 'rsi',
      name: 'RSI',
      period: RSI_METER_DEFAULT_PERIOD,
      color: RSI_METER_COLOR,
      visible: false,
    },
  ]
}

/** Closing the window: drop only the indicator the window added, and only if it is there. */
export function withoutRsiMeterIndicator(indicators: Indicator[]): Indicator[] {
  return indicators.some(isRsiMeterIndicator)
    ? indicators.filter((indicator) => !isRsiMeterIndicator(indicator))
    : indicators
}

/**
 * Adding RSI from the library while the window's hidden one is on the chart: promote that
 * indicator to a visible pane instead of silently refusing to add a second RSI of the same
 * period. It is re-identified on the way, so it is now the trader's own chart indicator and
 * closing the window no longer removes it. Returns null when there is nothing to promote, so
 * the caller adds normally.
 */
export function promotedRsiMeterIndicator(
  indicators: Indicator[],
  period: number,
  id: string,
): Indicator[] | null {
  const meter = indicators.find(
    (indicator) =>
      isRsiMeterIndicator(indicator) && !indicator.visible && indicator.period === period,
  )
  if (!meter) return null
  return indicators.map((indicator) =>
    indicator.id === meter.id ? { ...indicator, id, visible: true } : indicator,
  )
}
