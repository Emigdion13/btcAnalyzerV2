import { useEffect, useState } from 'react'
import {
  isKalshiFloatResponse,
  KALSHI_FLOAT_STALE_MS,
  type KalshiFloatResponse,
} from '../../shared/kalshi-float'
import { kalshiFeedForProduct } from '../../shared/kalshi'

/**
 * One snapshot per second, the same cadence the standalone floating window
 * polls at. The answer changes every second (the book, the last trade and the
 * index all move), so there is no window-rhythm idling here — but a poll is a
 * single cheap request and failures keep the last good snapshot on screen
 * instead of retracted numbers.
 */
export const KALSHI_FLOAT_POLL_MS = 1_000

export interface KalshiFloatState {
  /** The last good snapshot, or null before the first one lands. */
  response: KalshiFloatResponse | null
  /** The server's footer line, or the transport error when the last poll failed. */
  message: string
  /** True once the last good snapshot is older than KALSHI_FLOAT_STALE_MS. */
  stale: boolean
  /** True when Kalshi runs a 15-minute market on this product. */
  supported: boolean
}

/** The live snapshot of one product's running 15-minute market, polled every second. */
export function useKalshiFloat({
  product,
  enabled,
}: {
  product: string
  enabled: boolean
}): KalshiFloatState {
  const [response, setResponse] = useState<KalshiFloatResponse | null>(null)
  const [message, setMessage] = useState('')
  /** Unix ms this client received the snapshot now on screen. */
  const [receivedAt, setReceivedAt] = useState(0)
  /** Advances on every completed poll so the staleness badge moves even while failing. */
  const [pollTick, setPollTick] = useState(0)
  const supported = kalshiFeedForProduct(product) !== null

  useEffect(() => {
    if (!enabled || !supported) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inflight: AbortController | null = null

    const tick = async () => {
      inflight = new AbortController()
      try {
        const result = await fetch(`/api/kalshi/float?${new URLSearchParams({ product })}`, {
          signal: inflight.signal,
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        const data = (await result.json().catch(() => null)) as unknown
        if (!result.ok || !isKalshiFloatResponse(data)) {
          const text =
            data && typeof data === 'object' && 'message' in data
              ? String((data as { message?: unknown }).message ?? '')
              : ''
          throw new Error(text || `Kalshi responded with HTTP ${result.status}.`)
        }
        if (cancelled) return
        // A kept snapshot keeps rendering: a dropped poll is not a retracted market.
        setResponse(data)
        setMessage(data.message)
        setReceivedAt(Date.now())
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : 'Kalshi is unreachable.')
      } finally {
        setPollTick((n) => n + 1)
        if (!cancelled) timer = setTimeout(() => void tick(), KALSHI_FLOAT_POLL_MS)
      }
    }

    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
      inflight?.abort()
    }
  }, [product, enabled, supported])

  // Staleness is measured against THIS client's receive time, never the server
  // clock: the number stops looking live when this window stopped getting fresh
  // ones, whatever the two clocks think about each other.
  const stale =
    response !== null &&
    receivedAt > 0 &&
    pollTick > 0 &&
    Date.now() - receivedAt > KALSHI_FLOAT_STALE_MS

  return { response, message, stale, supported }
}
