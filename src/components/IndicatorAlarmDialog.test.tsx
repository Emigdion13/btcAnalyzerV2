// @vitest-environment jsdom
/**
 * The custom-alarm builder, driven the way a trader drives it: pick an indicator, pick a
 * condition, watch the live reading, create the alarm. Rendering runs for real in jsdom, so the
 * form wiring (conditional inputs, optgroups, validation) is exercised rather than assumed.
 */
import { act } from 'react'
// React only batches test updates without a warning when the flag below is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndicatorAlarmDialog } from './IndicatorAlarmDialog'
import { ASSETS, METAL_ASSETS, generateCandles, getAsset } from '../lib/market'
import type { IndicatorAlarm } from '../lib/types'

let container: HTMLDivElement
let root: Root
const created: IndicatorAlarm[] = []
const onClose = vi.fn()

const candles = generateCandles(getAsset('BTCUSDT'), '15m', 300)

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  created.length = 0
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const render = (props: Partial<Parameters<typeof IndicatorAlarmDialog>[0]> = {}) =>
  act(() =>
    root.render(
      <IndicatorAlarmDialog
        symbol="BTCUSDT"
        timeframe="15m"
        source="demo"
        assets={ASSETS}
        candles={candles}
        connected
        onCreate={(alarm) => created.push(alarm)}
        onClose={onClose}
        {...props}
      />,
    ),
  )
// The dialog renders through a portal into document.body, so every lookup is document-wide.
const field = (label: string) =>
  [...document.querySelectorAll('label.field')].find((node) => node.textContent?.startsWith(label))
const select = (label: string) => field(label)?.querySelector('select') as HTMLSelectElement
const input = (label: string) => field(label)?.querySelector('input') as HTMLInputElement
const indicatorButton = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.alarm-indicator-picker > button')].find(
    (button) => button.textContent === name,
  )!
const query = (selector: string) => document.querySelector(selector)
const choose = (node: HTMLSelectElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(node, value)
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
const type = (node: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = () =>
  act(() => {
    const form = document.querySelector('#indicator-alarm-form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })

describe('IndicatorAlarmDialog', () => {
  it('opens on CM MACD with a live reading from the open chart', () => {
    render()
    expect(query('.alarm-indicator-picker > .active')?.textContent).toBe('CM_Ult_MacD_MTF')
    expect(query('.alarm-preview-reading')?.textContent).toContain('MACD')
    // The preview is the chart's own candles, and it says so.
    expect(query('.alarm-preview-foot')?.textContent).toContain('Live from the open chart')
  })

  it('creates a CM MACD cross alarm with the defaults a trader expects', () => {
    render()
    submit()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      indicator: 'cm-ult-macd',
      condition: 'macd-cross-up',
      sound: true,
      repeat: 'bar',
      bars: 'forming',
      enabled: true,
    })
    expect(created[0].cmMacd).toMatchObject({ fastLength: 12, slowLength: 26, signalLength: 9 })
  })

  it('offers MACD the "about to cross" conditions with their automatic proximity input', () => {
    render()
    const conditions = select('What should trigger it?')
    choose(conditions, 'macd-about-cross-up')
    const within = input('Fires within this many bars')
    expect(within.value).toBe('3')
    expect(query('.alarm-condition-copy')?.textContent).toContain('No threshold to tune')
    type(within, '5')
    submit()
    expect(created[0]).toMatchObject({ condition: 'macd-about-cross-up', params: { within: 5 } })
  })

  it('switches indicator families and carries the right settings across', () => {
    render()
    act(() => indicatorButton('RSI').click())
    expect(select('What should trigger it?')?.value).toBe('rsi-cross-up-level')
    expect(input('RSI level').value).toBe('70')
    type(input('RSI length'), '21')
    submit()
    expect(created[0]).toMatchObject({
      indicator: 'rsi',
      condition: 'rsi-cross-up-level',
      params: { level: 70 },
      rsi: { period: 21 },
    })
    // The CM MACD lengths are still carried, so switching families back loses nothing.
    expect(created[0].cmMacd).toMatchObject({ fastLength: 12 })
  })

  it('carries a level the trader already typed into the next condition', () => {
    render()
    act(() => indicatorButton('RSI').click())
    type(input('RSI level'), '82')
    choose(select('What should trigger it?'), 'rsi-cross-down-level')
    expect(input('RSI level').value).toBe('82')
  })

  it('changes the sounds and the re-arm behaviour, and records the note', () => {
    render()
    choose(select('Re-arm'), 'once')
    choose(select('Evaluate'), 'closed')
    const sound = query('.alert-delivery .toggle') as HTMLButtonElement
    expect(sound.getAttribute('aria-checked')).toBe('true')
    act(() => sound.click())
    expect(query('.alert-delivery .toggle')?.getAttribute('aria-checked')).toBe('false')
    type(input('A note to your future self'), 'Only above the 200 EMA')
    submit()
    expect(created[0]).toMatchObject({
      repeat: 'once',
      bars: 'closed',
      sound: false,
      note: 'Only above the 200 EMA',
    })
  })

  it('keeps a silver alarm on Kalshi resolutions and says why', () => {
    // Silver is a Kalshi market: it exists in live mode, never in the demo catalog.
    render({ source: 'coinbase', assets: [...ASSETS, ...METAL_ASSETS] })
    choose(select('Market'), 'XAG-USD')
    expect(query('.info-box')?.textContent).toContain(
      'Kalshi publishes silver once per quarter hour',
    )
    const timeframes = [...select('Timeframe').options].map((option) => option.value)
    expect(timeframes).toEqual(['15m', '1h', '4h', '1D', '1W'])
  })

  it('says a background alarm is polled instead of pretending it is the open chart', () => {
    render({ symbol: 'ETH-USD' })
    expect(query('.alarm-preview')?.textContent).toContain('polls ETH-USD 15m in the background')
  })

  it('refuses an impossible level instead of saving an alarm that can never fire', () => {
    render()
    act(() => indicatorButton('RSI').click())
    type(input('RSI level'), '150')
    submit()
    expect(created).toHaveLength(0)
    expect(query('[role="alert"]')?.textContent).toContain('must be between 1 and 99')
  })

  it('refuses a zero-length indicator setting', () => {
    render()
    act(() => indicatorButton('RSI').click())
    type(input('RSI length'), '0')
    submit()
    expect(created).toHaveLength(0)
    expect(query('[role="alert"]')?.textContent).toContain('whole number between 1 and 2000')
  })

  it('chains a second condition into the same alarm', () => {
    render()
    act(() => (document.querySelector('#alarm-add-leg') as HTMLButtonElement).click())
    // The new leg opens on the first indicator the alarm is not already reading.
    const legIndicator = document.querySelector('#alarm-extra-0-indicator') as HTMLSelectElement
    expect(legIndicator.value).toBe('rsi')
    const legCondition = document.querySelector('#alarm-extra-0-condition') as HTMLSelectElement
    expect(legCondition.value).toBe('rsi-cross-up-level')
    type(document.querySelector('#alarm-extra-0-param-level') as HTMLInputElement, '65')
    act(() => (document.querySelector('#alarm-match-any') as HTMLButtonElement).click())
    submit()
    expect(created[0]).toMatchObject({
      indicator: 'cm-ult-macd',
      condition: 'macd-cross-up',
      match: 'any',
      also: [{ indicator: 'rsi', condition: 'rsi-cross-up-level', params: { level: 65 } }],
    })
  })

  it('keeps one MACD flavour per alarm, in the picker and in the leg', () => {
    render()
    act(() => (document.querySelector('#alarm-add-leg') as HTMLButtonElement).click())
    const legIndicator = document.querySelector('#alarm-extra-0-indicator') as HTMLSelectElement
    expect([...legIndicator.options].map((option) => option.value)).not.toContain('macd')
    expect(indicatorButton('MACD (classic)').disabled).toBe(true)
    expect(indicatorButton('CM_Ult_MacD_MTF').disabled).toBe(false)
  })

  it('takes a combination apart again, condition by condition', () => {
    render()
    act(() => (document.querySelector('#alarm-add-leg') as HTMLButtonElement).click())
    type(document.querySelector('#alarm-extra-0-param-level') as HTMLInputElement, '65')
    act(() => (document.querySelector('#alarm-add-leg') as HTMLButtonElement).click())
    expect(document.querySelectorAll('.alarm-leg')).toHaveLength(2)
    act(() =>
      (
        document.querySelector('.alarm-leg [aria-label="Remove condition 3"]') as HTMLButtonElement
      ).click(),
    )
    expect(document.querySelectorAll('.alarm-leg')).toHaveLength(1)
    submit()
    expect(created[0].also).toHaveLength(1)
    expect(created[0].also?.[0].params).toEqual({ level: 65 })
  })

  it('validates an extra leg before saving anything', () => {
    render()
    act(() => (document.querySelector('#alarm-add-leg') as HTMLButtonElement).click())
    type(document.querySelector('#alarm-extra-0-param-level') as HTMLInputElement, '150')
    submit()
    expect(created).toHaveLength(0)
    expect(query('.negative')?.textContent).toContain(
      'Condition 2: RSI level must be between 1 and 99',
    )
  })

  it('tests the chime without a browser audio stack and says so', () => {
    render()
    const test = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Test the chime',
    )!
    act(() => test.click())
    expect(query('.alarm-sound-report')?.textContent).toContain('cannot play the alarm chime')
  })
})
