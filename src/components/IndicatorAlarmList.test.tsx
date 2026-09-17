import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IndicatorAlarmList } from './IndicatorAlarmList'
import { newIndicatorAlarm } from '../lib/indicator-alarms'
import type { AlarmReading } from '../lib/indicator-alarms'
import type { IndicatorAlarm } from '../lib/types'

const CREATED = '2026-09-17T00:00:00.000Z'
const noop = () => {}
const alarm = (overrides: Partial<IndicatorAlarm> = {}): IndicatorAlarm => ({
  ...newIndicatorAlarm({
    id: 'a',
    symbol: 'BTC-USD',
    timeframe: '15m',
    indicator: 'cm-ult-macd',
    createdAt: CREATED,
  }),
  ...overrides,
})
const reading: AlarmReading = {
  active: false,
  previousActive: false,
  ready: true,
  barTime: 1_700_000_000,
  reading: 'MACD 12.43 · signal 11.98 · hist +0.45',
  detail: '2.1 bars of typical movement to the bullish cross',
  estimate: 2.1,
}
const render = (props: Partial<Parameters<typeof IndicatorAlarmList>[0]> = {}) =>
  renderToStaticMarkup(
    <IndicatorAlarmList
      alarms={[alarm()]}
      readings={{ a: reading }}
      health={{}}
      source="coinbase"
      connected
      soundEnabled
      onToggleSound={noop}
      onAdd={noop}
      onRemove={noop}
      onToggle={noop}
      onToggleAlarmSound={noop}
      onSelect={noop}
      {...props}
    />,
  )

describe('IndicatorAlarmList', () => {
  it('invites a first alarm instead of showing an empty list', () => {
    const html = render({ alarms: [], readings: {} })
    expect(html).toContain('Your own triggers')
    expect(html).toContain('Build an indicator alarm')
  })

  it('shows the pair, the condition, the live numbers and the watch state', () => {
    const html = render()
    expect(html).toContain('BTC-USD')
    expect(html).toContain('15m')
    expect(html).toContain('MACD turns green — crosses above the signal line')
    expect(html).toContain('CM_Ult_MacD_MTF (12, 26, 9)')
    expect(html).toContain('MACD 12.43 · signal 11.98 · hist +0.45')
    expect(html).toContain('Watching · 2.1 bars of typical movement to the bullish cross')
    expect(html).toContain('Never fired yet')
  })

  it('reports a fire and how an alarm is watched', () => {
    const html = render({
      alarms: [
        alarm({
          lastTriggeredAt: '2026-09-17T14:05:00.000Z',
          triggerCount: 3,
          note: 'Only above the 200 EMA',
        }),
      ],
      readings: { a: { ...reading, active: true, detail: 'Green — a fresh bullish cross' } },
    })
    expect(html).toContain('Fired ×3 14:05 UTC')
    expect(html).toContain('Holding · Green — a fresh bullish cross')
    expect(html).toContain('Only above the 200 EMA')
  })

  it('explains an alarm whose symbol belongs to another data source', () => {
    const html = render({ source: 'demo' })
    expect(html).toContain('Not on this data source')
  })

  it('shows a combined alarm as a combination, legs and all', () => {
    const html = render({
      alarms: [
        alarm({
          also: [
            { indicator: 'rsi', condition: 'rsi-above-level', params: { level: 70 } },
            { indicator: 'cm-williams-vix-fix', condition: 'wvf-spike', params: {} },
          ],
          match: 'all',
        }),
      ],
    })
    expect(html).toContain('MACD turns green and RSI above 70 and Fear spike fires')
    expect(html).toContain('CM_Ult_MacD_MTF (12, 26, 9) + RSI (14) + CM_Williams_Vix_Fix')
    expect(html).toContain('All of 3 conditions')
  })

  it('says which alarms are sourced live and which are polled', () => {
    expect(render()).toContain('Alarms on the open chart react to the live stream')
  })
})
