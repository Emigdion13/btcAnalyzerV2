import type { Candle, Timeframe } from './types'

/**
 * The Kalshi-style 15-minute up/down game, as pure window math.
 *
 * Every agent in the ensemble answers one question: at the next quarter-hour cut
 * (:00/:15/:30/:45), will price be UP or DOWN from the strike — the price when the
 * window opened? This module derives that window and strike from the chart candles
 * plus a clock, so the ensemble, the journal, and the UI all read the same game.
 *
 * Quarter-hour boundaries coincide in every whole-hour timezone, so there is no
 * timezone parameter: 9:15 is 9:15 in Chicago and New York alike.
 */

/** Length of one up/down window, in seconds. */
export const KALSHI_WINDOW_SECONDS = 900
/** Chart timeframes short enough that journal entries can settle at the window cut. */
export const WINDOW_SETTLE_TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m']
/** How long after a fresh window opens a live print may stand in as provisional strike. */
export const PROVISIONAL_STRIKE_SECONDS = 120

export interface KalshiWindow {
  /** Open of the window, unix seconds. */
  windowStart: number
  /** The cut — when this window settles, unix seconds. */
  windowEnd: number
  /** Seconds from now until the cut, clamped to the window. */
  secondsLeft: number
  /** Clock label for the cut, e.g. "9:30". */
  expiryLabel: string
}

export interface StrikeContext extends KalshiWindow {
  /** Strike price: the window-open print. */
  price: number
  /**
   * True while no candle has opened inside this window yet and the strike is a live
   * print standing in. Good enough to frame the call, never good enough to settle
   * a journal entry on.
   */
  provisional: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Local clock label for a unix timestamp: "9:30". */
export function kalshiClockLabel(timeSeconds: number): string {
  const date = new Date(timeSeconds * 1000)
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getHours()}:${minutes}`
}

/** Countdown label for seconds remaining: "4:32", "0:07". */
export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = String(clamped % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/** Which 15-minute window `nowSec` falls in, and how long it has left. */
export function kalshiWindow(nowSec: number): KalshiWindow {
  const windowStart = Math.floor(nowSec / KALSHI_WINDOW_SECONDS) * KALSHI_WINDOW_SECONDS
  const windowEnd = windowStart + KALSHI_WINDOW_SECONDS
  return {
    windowStart,
    windowEnd,
    secondsLeft: clamp(windowEnd - nowSec, 0, KALSHI_WINDOW_SECONDS),
    expiryLabel: kalshiClockLabel(windowEnd),
  }
}

/** Whether this chart timeframe can settle journal entries at the window cut. */
export function canSettleAtWindow(timeframe: Timeframe): boolean {
  return WINDOW_SETTLE_TIMEFRAMES.includes(timeframe)
}

/**
 * Strike for the window containing `nowSec`.
 *
 * The strike is the open of the candle that opened exactly at the window start —
 * on 1m/3m/5m/15m charts the grid aligns, so this is the true window-open print.
 * Right after a fresh boundary, before any candle has opened inside the window, the
 * live price stands in as a provisional strike so the call stays framed; anything
 * older or any coarser timeframe returns null rather than a strike it cannot defend.
 */
export function kalshiStrike(
  candles: Candle[],
  nowSec: number,
  livePrice?: number | null,
): StrikeContext | null {
  if (!candles.length || !Number.isFinite(nowSec)) return null
  const window = kalshiWindow(nowSec)
  const exact = candles.find((candle) => candle.time === window.windowStart)
  if (exact && Number.isFinite(exact.open) && exact.open > 0)
    return { ...window, price: exact.open, provisional: false }
  const lastCandle = candles[candles.length - 1]
  const fresh = lastCandle && lastCandle.time >= window.windowStart - KALSHI_WINDOW_SECONDS
  if (
    fresh &&
    window.secondsLeft > KALSHI_WINDOW_SECONDS - PROVISIONAL_STRIKE_SECONDS &&
    livePrice != null &&
    Number.isFinite(livePrice) &&
    livePrice > 0
  )
    return { ...window, price: livePrice, provisional: true }
  return null
}

export type StrikeSide = 'above' | 'below'

export interface StrikePosition {
  side: StrikeSide
  /** Signed distance, price minus strike. */
  delta: number
  /** Signed distance in ATR units. */
  deltaAtr: number
}

/** Where price sits relative to the strike, in absolute and ATR terms. */
export function strikePosition(price: number, strike: number, atrValue: number): StrikePosition {
  const delta = price - strike
  const atr = atrValue > 0 ? atrValue : Math.max(Math.abs(strike) * 0.003, 1e-9)
  return { side: delta >= 0 ? 'above' : 'below', delta, deltaAtr: delta / atr }
}
