import { useCallback, useEffect, useState } from 'react'
import {
  isKalshiStrikeResponse,
  KALSHI_WINDOW_SECONDS,
  kalshiFeedForProduct,
  type KalshiStrikeResponse,
} from '../../shared/kalshi'

/**
 * 'live'       — Kalshi's published strike for the window on screen.
 * 'waiting'    — Kalshi reachable, but has not published this window's strike yet.
 * 'loading'    — first request in flight.
 * 'unavailable'— Kalshi could not be reached; the chart falls back to an estimate.
 * 'unsupported'— Kalshi runs no 15-minute market on this pair.
 * 'idle'       — disabled.
 */
export type KalshiStrikeStatus =
  'idle' | 'loading' | 'live' | 'waiting' | 'unavailable' | 'unsupported'

export interface KalshiStrikeState {
  response: KalshiStrikeResponse | null
  status: KalshiStrikeStatus
  message: string
  retry: () => void
  supported: boolean
}

/** Seconds since the current 15-minute window opened. */
function secondsIntoWindow(nowMs: number): number {
  const nowSec = nowMs / 1000
  return nowSec - Math.floor(nowSec / KALSHI_WINDOW_SECONDS) * KALSHI_WINDOW_SECONDS
}

/**
 * Poll cadence, matched to when the answer can actually change.
 *
 * A strike locks once, at the window open, and is immutable for the rest of the
 * window. Hammering the API all quarter-hour would buy nothing, so we poll hard for
 * the first moments after a boundary — when Kalshi publishes it, roughly a second in
 * — and then idle until the next cut approaches.
 */
export function kalshiPollDelayMs(nowMs: number): number {
  const into = secondsIntoWindow(nowMs)
  const left = KALSHI_WINDOW_SECONDS - into
  // Poll hard either side of a boundary: just after the open, when Kalshi publishes the
  // strike, and just before the cut, so the next one is caught promptly.
  if (into < 20 || left < 20) return 2_500
  // Mid-window nothing can change, so idle — but never sleep past the pre-cut window,
  // or a boundary could go unnoticed for up to half a minute.
  return Math.max(1_000, Math.min(30_000, (left - 20) * 1_000))
}

/** Kalshi's published strike for the charted pair, polled at the window rhythm. */
export function useKalshiStrike({
  product,
  enabled,
}: {
  product: string
  enabled: boolean
}): KalshiStrikeState {
  const [response, setResponse] = useState<KalshiStrikeResponse | null>(null)
  const [status, setStatus] = useState<KalshiStrikeStatus>('idle')
  const [message, setMessage] = useState('')
  const [retryId, setRetryId] = useState(0)
  const retry = useCallback(() => setRetryId((n) => n + 1), [])
  const supported = kalshiFeedForProduct(product) !== null

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    if (!supported) {
      setResponse(null)
      setStatus('unsupported')
      setMessage('Kalshi runs no 15-minute market on this pair.')
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true

    const tick = async () => {
      if (controller.signal.aborted) return
      if (first) {
        first = false
        setStatus((previous) => (previous === 'live' ? previous : 'loading'))
      }
      try {
        const result = await fetch(`/api/kalshi/strike?${new URLSearchParams({ product })}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const data = (await result.json().catch(() => null)) as unknown
        if (!result.ok || !isKalshiStrikeResponse(data)) {
          const text =
            data && typeof data === 'object' && 'message' in data
              ? String((data as { message?: unknown }).message ?? '')
              : ''
          throw new Error(text || `Kalshi responded with HTTP ${result.status}.`)
        }
        setResponse(data)
        setStatus(data.strike ? 'live' : 'waiting')
        setMessage(data.message)
      } catch (error) {
        if (controller.signal.aborted) return
        // Keep the last good strike on screen; a dropped poll is not a retracted strike.
        setStatus('unavailable')
        setMessage(error instanceof Error ? error.message : 'Kalshi is unreachable.')
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void tick(), kalshiPollDelayMs(Date.now()))
    }

    void tick()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [product, enabled, supported, retryId])

  return { response, status, message, retry, supported }
}
