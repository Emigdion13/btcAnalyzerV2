import { describe, expect, it } from 'vitest'
import {
  RSI_METER_DEFAULT_PERIOD,
  RSI_METER_DEFAULT_VISIBLE,
  RSI_METER_INDICATOR_ID,
  RSI_METER_INDICATOR_LIMIT,
  isRsiMeterIndicator,
  promotedRsiMeterIndicator,
  rsiMeterPeriod,
  rsiMeterSource,
  rsiMeterVisible,
  withRsiMeterIndicator,
  withoutRsiMeterIndicator,
} from './rsi-hud'
import type { Indicator } from './types'

function indicator(partial: Partial<Indicator> & Pick<Indicator, 'id' | 'kind'>): Indicator {
  return {
    name: partial.kind.toUpperCase(),
    period: 14,
    color: '#ffffff',
    visible: true,
    ...partial,
  }
}

const ema = indicator({ id: 'ema-20', kind: 'ema', period: 20 })
const chartRsi = indicator({ id: 'rsi-14', kind: 'rsi', period: 14 })
const hiddenChartRsi = indicator({ id: 'rsi-9', kind: 'rsi', period: 9, visible: false })
const meterRsi = indicator({
  id: RSI_METER_INDICATOR_ID,
  kind: 'rsi',
  period: RSI_METER_DEFAULT_PERIOD,
  visible: false,
})

describe('rsiMeterVisible — the button owns the window, not the indicator', () => {
  it('opens by default so the meter survives losing its pane', () => {
    expect(rsiMeterVisible(null)).toBe(RSI_METER_DEFAULT_VISIBLE)
    expect(RSI_METER_DEFAULT_VISIBLE).toBe(true)
  })

  it('lets an explicit choice win in both directions', () => {
    expect(rsiMeterVisible(true)).toBe(true)
    expect(rsiMeterVisible(false)).toBe(false)
  })
})

describe('rsiMeterPeriod — one period, shared with the pane', () => {
  it('reads the visible indicator on the chart', () => {
    expect(rsiMeterSource([ema, chartRsi])?.id).toBe('rsi-14')
    expect(rsiMeterPeriod([ema, chartRsi])).toBe(14)
  })

  it('reads a hidden indicator too, because that is the window-only case', () => {
    expect(rsiMeterPeriod([ema, hiddenChartRsi])).toBe(9)
    expect(rsiMeterPeriod([meterRsi])).toBe(RSI_METER_DEFAULT_PERIOD)
  })

  it('falls back to the conventional period while the chart has no RSI', () => {
    expect(rsiMeterSource([ema])).toBeNull()
    expect(rsiMeterPeriod([ema])).toBe(RSI_METER_DEFAULT_PERIOD)
  })
})

describe('withRsiMeterIndicator — the window without a pane', () => {
  it('adds a hidden RSI so the period stays editable from the legend chip', () => {
    const next = withRsiMeterIndicator([ema])
    expect(next).toHaveLength(2)
    const added = next[1]!
    expect(added.kind).toBe('rsi')
    expect(added.visible).toBe(false)
    expect(added.period).toBe(RSI_METER_DEFAULT_PERIOD)
    expect(isRsiMeterIndicator(added)).toBe(true)
  })

  it('keeps the chart’s own RSI instead of adding a second one', () => {
    expect(withRsiMeterIndicator([ema, chartRsi])).toEqual([ema, chartRsi])
    expect(withRsiMeterIndicator([ema, hiddenChartRsi])).toEqual([ema, hiddenChartRsi])
  })

  it('declines at the indicator cap rather than evicting something you put there', () => {
    const full = Array.from({ length: RSI_METER_INDICATOR_LIMIT }, (_, i) =>
      indicator({ id: `sma-${i}`, kind: 'sma', period: i + 1 }),
    )
    expect(withRsiMeterIndicator(full)).toEqual(full)
    expect(withRsiMeterIndicator(full.slice(0, RSI_METER_INDICATOR_LIMIT - 1))).toHaveLength(
      RSI_METER_INDICATOR_LIMIT,
    )
  })

  it('returns the same array when there is nothing to add, so no render is scheduled', () => {
    const unchanged = [ema, chartRsi]
    expect(withRsiMeterIndicator(unchanged)).toBe(unchanged)
  })
})

describe('withoutRsiMeterIndicator — closing the window cleans up after itself', () => {
  it('drops only the indicator the window added', () => {
    expect(withoutRsiMeterIndicator([ema, meterRsi])).toEqual([ema])
    expect(withoutRsiMeterIndicator([ema, chartRsi])).toEqual([ema, chartRsi])
  })

  it('returns the same array when the window’s indicator is not there', () => {
    const unchanged = [ema, hiddenChartRsi]
    expect(withoutRsiMeterIndicator(unchanged)).toBe(unchanged)
  })
})

describe('promotedRsiMeterIndicator — RSI stays a real indicator you can add', () => {
  it('promotes the hidden meter indicator instead of refusing a same-period twin', () => {
    const promoted = promotedRsiMeterIndicator([ema, meterRsi], 14, 'rsi-pane')
    expect(promoted).not.toBeNull()
    const pane = promoted!.find((i) => i.id === 'rsi-pane')!
    expect(pane.visible).toBe(true)
    expect(pane.period).toBe(14)
    // Re-identified, so closing the window no longer takes the pane off the chart with it.
    expect(promoted!.some(isRsiMeterIndicator)).toBe(false)
    expect(withoutRsiMeterIndicator(promoted!)).toBe(promoted!)
  })

  it('leaves a different period alone so the library adds it normally', () => {
    expect(promotedRsiMeterIndicator([ema, meterRsi], 21, 'rsi-pane')).toBeNull()
    expect(promotedRsiMeterIndicator([ema, chartRsi], 14, 'rsi-pane')).toBeNull()
  })

  it('does not promote an indicator the window did not add', () => {
    expect(promotedRsiMeterIndicator([hiddenChartRsi], 9, 'rsi-pane')).toBeNull()
  })
})
