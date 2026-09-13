import { describe, expect, it } from 'vitest'
import { kalshiPollDelayMs } from './useKalshiStrike'
import { KALSHI_WINDOW_SECONDS } from '../../shared/kalshi'

const OPEN = Date.parse('2026-09-13T21:00:00Z')

describe('kalshiPollDelayMs', () => {
  it('polls hard just after the boundary, when Kalshi publishes the strike', () => {
    // The strike locks once, at the open, and is immutable for the rest of the window.
    expect(kalshiPollDelayMs(OPEN)).toBe(2_500)
    expect(kalshiPollDelayMs(OPEN + 1_000)).toBe(2_500)
    expect(kalshiPollDelayMs(OPEN + 19_000)).toBe(2_500)
  })

  it('idles through the middle of a window, when nothing can change', () => {
    expect(kalshiPollDelayMs(OPEN + 60_000)).toBe(30_000)
    expect(kalshiPollDelayMs(OPEN + 600_000)).toBe(30_000)
  })

  it('wakes before the cut so the next strike is caught promptly', () => {
    const cut = OPEN + KALSHI_WINDOW_SECONDS * 1000
    expect(kalshiPollDelayMs(cut - 10_000)).toBe(2_500)
    expect(kalshiPollDelayMs(cut - 1_000)).toBe(2_500)
  })

  it('rolls into the next window and starts polling hard again', () => {
    const cut = OPEN + KALSHI_WINDOW_SECONDS * 1000
    expect(kalshiPollDelayMs(cut)).toBe(2_500)
    expect(kalshiPollDelayMs(cut + 5_000)).toBe(2_500)
  })

  it('never sleeps past the moment the fast pre-cut polling should begin', () => {
    for (let offset = 0; offset < KALSHI_WINDOW_SECONDS * 1000; offset += 500) {
      const delay = kalshiPollDelayMs(OPEN + offset)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(30_000)
      const into = offset / 1000
      const left = KALSHI_WINDOW_SECONDS - into
      if (into >= 20 && left >= 20)
        // The next poll must land no later than the start of the pre-cut fast window,
        // so a fresh strike is picked up within seconds of the boundary. The 1s floor
        // on the delay is allowed to overshoot by at most that floor.
        expect(into + delay / 1000).toBeLessThanOrEqual(KALSHI_WINDOW_SECONDS - 20 + 1)
    }
  })
})
