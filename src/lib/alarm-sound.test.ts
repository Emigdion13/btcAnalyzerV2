import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  alarmAudioAvailable,
  alarmChimeForAlarm,
  alarmChimeForCondition,
  playAlarmChime,
  primeAlarmAudio,
  resetAlarmAudio,
} from './alarm-sound'

afterEach(() => {
  vi.unstubAllGlobals()
  resetAlarmAudio()
})

describe('alarm chime mapping', () => {
  it('sounds a cross up differently from a cross down', () => {
    expect(alarmChimeForCondition('macd-cross-up')).toBe('bull')
    expect(alarmChimeForCondition('macd-cross-down')).toBe('bear')
    expect(alarmChimeForCondition('rsi-about-cross-up')).toBe('bull')
    expect(alarmChimeForCondition('rsi-about-cross-down')).toBe('bear')
    expect(alarmChimeForCondition('macd-hist-rising')).toBe('bull')
    expect(alarmChimeForCondition('macd-hist-falling')).toBe('bear')
    expect(alarmChimeForCondition('macd-hist-aqua')).toBe('bull')
    expect(alarmChimeForCondition('macd-hist-blue')).toBe('bear')
    // At or below zero: maroon is the sell-off easing, red is it deepening.
    expect(alarmChimeForCondition('macd-hist-maroon')).toBe('bull')
    expect(alarmChimeForCondition('macd-hist-red')).toBe('bear')
    expect(alarmChimeForCondition('wvf-spike')).toBe('bull')
    expect(alarmChimeForCondition('wvf-spike-ends')).toBe('neutral')
    expect(alarmChimeForCondition('rsi-cross-up-level')).toBe('bull')
    expect(alarmChimeForCondition('rsi-cross-down-level')).toBe('bear')
    expect(alarmChimeForCondition('rsi-turns-down')).toBe('bear')
  })

  it('sounds a combined alarm like its legs when they agree, flat when they do not', () => {
    expect(alarmChimeForAlarm({ condition: 'macd-cross-up', also: [] })).toBe('bull')
    expect(alarmChimeForAlarm({ condition: 'rsi-cross-down-level', also: [] })).toBe('bear')
    // A bullish gate on RSI is still bullish news when the MACD turns green with it.
    expect(
      alarmChimeForAlarm({
        condition: 'macd-cross-up',
        also: [{ indicator: 'rsi', condition: 'rsi-above-level', params: { level: 70 } }],
      }),
    ).toBe('bull')
    // Two-sided: the chime does not pick a side the trader did not pick.
    expect(
      alarmChimeForAlarm({
        condition: 'macd-cross-up',
        also: [{ indicator: 'rsi', condition: 'rsi-cross-down-level', params: { level: 30 } }],
      }),
    ).toBe('neutral')
  })
})

describe('alarm audio without a browser audio stack', () => {
  it('reports that it cannot play and never throws', () => {
    expect(alarmAudioAvailable()).toBe(false)
    expect(primeAlarmAudio()).toBe(false)
    expect(playAlarmChime('bull')).toBe(false)
  })
})

describe('alarm audio with an AudioContext', () => {
  const started: number[] = []
  class FakeGain {
    gain = {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    }
    connect = vi.fn()
  }
  class FakeOscillator {
    type = 'sine'
    frequency = { setValueAtTime: (value: number) => started.push(value) }
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
  }
  class FakeAudioContext {
    state = 'suspended'
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => {})
    createGain = () => new FakeGain()
    createOscillator = () => new FakeOscillator()
  }
  it('schedules the two notes and resumes a suspended context', () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    expect(alarmAudioAvailable()).toBe(true)
    expect(primeAlarmAudio()).toBe(true)
    expect(playAlarmChime('bull')).toBe(true)
    expect(started).toContain(523.25)
    expect(started).toContain(783.99)
    started.length = 0
    expect(playAlarmChime('bear')).toBe(true)
    expect(started).toEqual([587.33, 392])
  })

  it('survives an audio context that refuses to be built', () => {
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          throw new Error('blocked by policy')
        }
      },
    })
    expect(primeAlarmAudio()).toBe(false)
    expect(playAlarmChime()).toBe(false)
  })
})
