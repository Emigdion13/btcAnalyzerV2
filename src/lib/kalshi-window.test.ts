import { describe, expect, it } from 'vitest'
import {
  KALSHI_WINDOW_SECONDS,
  canSettleAtWindow,
  formatCountdown,
  kalshiStrike,
  kalshiWindow,
  strikePosition,
} from './kalshi-window'
import type { Candle } from './types'

function candle(time: number, open: number, close: number = open): Candle {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 10 }
}

// 2026-09-08 09:10:00 UTC — inside the 09:00→09:15 window.
const NOW = Date.UTC(2026, 8, 8, 9, 10, 0) / 1000
const WINDOW_START = Date.UTC(2026, 8, 8, 9, 0, 0) / 1000

describe('kalshi window', () => {
  it('cuts the clock into :00/:15/:30/:45 windows with seconds left', () => {
    const window = kalshiWindow(NOW)
    expect(window.windowStart).toBe(WINDOW_START)
    expect(window.windowEnd).toBe(WINDOW_START + KALSHI_WINDOW_SECONDS)
    expect(window.secondsLeft).toBe(300)
    const cut = new Date((WINDOW_START + KALSHI_WINDOW_SECONDS) * 1000)
    const expected = `${cut.getHours()}:${String(cut.getMinutes()).padStart(2, '0')}`
    expect(window.expiryLabel).toBe(expected)
  })

  it('rolls to the next window exactly at the cut', () => {
    const atCut = kalshiWindow(WINDOW_START + KALSHI_WINDOW_SECONDS)
    expect(atCut.windowStart).toBe(WINDOW_START + KALSHI_WINDOW_SECONDS)
    expect(atCut.secondsLeft).toBe(KALSHI_WINDOW_SECONDS)
  })

  it('formats countdowns the way a trader scans them', () => {
    expect(formatCountdown(272)).toBe('4:32')
    expect(formatCountdown(7)).toBe('0:07')
    expect(formatCountdown(-3)).toBe('0:00')
  })

  it('takes the strike from the candle that opened the window', () => {
    const candles = [
      candle(WINDOW_START - 60, 99_990),
      candle(WINDOW_START, 100_000),
      candle(WINDOW_START + 60, 100_010),
    ]
    const strike = kalshiStrike(candles, NOW, 100_050)
    expect(strike?.price).toBe(100_000)
    expect(strike?.provisional).toBe(false)
    expect(strike?.windowStart).toBe(WINDOW_START)
  })

  it('stands a live print in as provisional strike right after the boundary', () => {
    const candles = [candle(WINDOW_START - 60, 99_990)]
    const justOpened = kalshiStrike(candles, WINDOW_START + 20, 100_050)
    expect(justOpened?.price).toBe(100_050)
    expect(justOpened?.provisional).toBe(true)
    // Two minutes in with still no window candle, the print is no longer window-open.
    expect(kalshiStrike(candles, WINDOW_START + 300, 100_050)).toBeNull()
  })

  it('refuses a strike on stale candles or coarse grids', () => {
    // Hourly candle opened at 9:00 says nothing about the 9:15 window open once the
    // provisional grace has passed.
    const hourly = [candle(WINDOW_START, 100_000, 100_020)]
    expect(kalshiStrike(hourly, WINDOW_START + 900 + 300, 100_020)).toBeNull()
    // Dead feed: last candle is older than a full window.
    const stale = [candle(WINDOW_START - 3600, 100_000)]
    expect(kalshiStrike(stale, NOW, 100_050)).toBeNull()
    expect(kalshiStrike([], NOW, 100_050)).toBeNull()
  })

  it('measures price against the strike in dollars and ATR', () => {
    expect(strikePosition(100_050, 100_000, 25)).toEqual({
      side: 'above',
      delta: 50,
      deltaAtr: 2,
    })
    expect(strikePosition(99_975, 100_000, 25).side).toBe('below')
  })

  it('settles journal entries at the cut only on short timeframes', () => {
    for (const timeframe of ['1m', '3m', '5m', '15m'] as const)
      expect(canSettleAtWindow(timeframe)).toBe(true)
    for (const timeframe of ['1h', '4h', '1D', '1W'] as const)
      expect(canSettleAtWindow(timeframe)).toBe(false)
  })
})
