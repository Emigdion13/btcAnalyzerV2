import { describe, expect, it } from 'vitest'
import { alarmFireToast, alarmFiredLabel, alarmStatus } from './alarm-status'
import { newIndicatorAlarm } from './indicator-alarms'
import type { AlarmReading } from './indicator-alarms'
import type { IndicatorAlarm } from './types'

const CREATED = '2026-09-17T00:00:00.000Z'
const base = (overrides: Partial<IndicatorAlarm> = {}): IndicatorAlarm => ({
  ...newIndicatorAlarm({
    id: 'a',
    symbol: 'BTC-USD',
    timeframe: '15m',
    indicator: 'rsi',
    createdAt: CREATED,
  }),
  ...overrides,
})
const reading = (overrides: Partial<AlarmReading> = {}): AlarmReading => ({
  active: false,
  previousActive: false,
  ready: true,
  barTime: 1_700_000_000,
  reading: 'RSI 41.2',
  detail: 'No cross closing yet',
  estimate: null,
  ...overrides,
})

describe('alarmStatus', () => {
  it('says why an alarm that cannot react is quiet', () => {
    expect(
      alarmStatus(base({ enabled: false }), undefined, undefined, 'coinbase', true).label,
    ).toBe('Paused')
    expect(alarmStatus(base(), undefined, undefined, 'demo', true).label).toBe(
      'Not on this data source',
    )
    expect(alarmStatus(base(), undefined, undefined, 'coinbase', false).label).toBe(
      'Waiting for the connection',
    )
    expect(
      alarmStatus(
        base(),
        undefined,
        { state: 'error', message: 'Candles could not be read for this alarm.', fetchedAt: 0 },
        'coinbase',
        true,
      ),
    ).toEqual({ label: 'Candles could not be read for this alarm.', tone: 'warning' })
  })

  it('reports its live reading, and lights up while the condition holds', () => {
    const waiting = alarmStatus(base(), undefined, undefined, 'coinbase', true)
    expect(waiting).toEqual({ label: 'Reading 15m candles…', tone: 'idle' })
    const watching = alarmStatus(
      base(),
      reading({ detail: '3.0 bars of typical movement to 70' }),
      undefined,
      'coinbase',
      true,
    )
    expect(watching).toEqual({
      label: 'Watching · 3.0 bars of typical movement to 70',
      tone: 'idle',
    })
    const holding = alarmStatus(
      base(),
      reading({ active: true, detail: 'Above 70' }),
      undefined,
      'coinbase',
      true,
    )
    expect(holding).toEqual({ label: 'Holding · Above 70', tone: 'positive' })
  })

  it('says when there is no poll slot left, rather than looking like it is loading forever', () => {
    const status = alarmStatus(
      base(),
      undefined,
      { state: 'queued', message: 'Waiting for a poll slot', fetchedAt: 0 },
      'coinbase',
      true,
    )
    expect(status).toEqual({ label: 'Waiting for a poll slot', tone: 'idle' })
  })

  it('reads a failed poll for a symbol this source does not serve as a source mismatch, not a fault', () => {
    const status = alarmStatus(
      base({ symbol: 'BTCUSDT' }),
      undefined,
      { state: 'error', message: 'demo only', fetchedAt: 0 },
      'coinbase',
      true,
    )
    expect(status.tone).toBe('idle')
    expect(status.label).toBe('Not on this data source')
  })
})

describe('alarmFireToast', () => {
  it('names the condition and the numbers for a single-condition alarm', () => {
    expect(alarmFireToast(base(), reading())).toBe(
      'BTC-USD 15m · RSI crosses above a level · RSI 41.2',
    )
  })

  it('leads with the verdict for a combined one, which is a sentence of its own', () => {
    const combo = base({
      indicator: 'cm-ult-macd',
      condition: 'macd-cross-up',
      also: [{ indicator: 'rsi', condition: 'rsi-above-level', params: { level: 70 } }],
      match: 'all',
    })
    expect(
      alarmFireToast(
        combo,
        reading({
          active: true,
          reading: 'MACD 12.43 · signal 11.98 · hist +0.45  ·  RSI 72.4',
          detail: 'All 2 conditions hold: MACD turns green, RSI above 70',
        }),
      ),
    ).toBe('BTC-USD 15m · All 2 conditions hold: MACD turns green, RSI above 70')
  })
})

describe('alarmFiredLabel', () => {
  it('counts the fires and pins them to UTC', () => {
    expect(alarmFiredLabel(base())).toBe('Never fired yet')
    expect(alarmFiredLabel(base({ lastTriggeredAt: CREATED, triggerCount: 1 }))).toBe(
      'Fired 00:00 UTC',
    )
    expect(
      alarmFiredLabel(base({ lastTriggeredAt: '2026-09-17T14:05:00.000Z', triggerCount: 4 })),
    ).toBe('Fired ×4 14:05 UTC')
  })
})
