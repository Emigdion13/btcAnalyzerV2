import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionState, Interval, MarketCandle, MarketQuote } from '../../shared/coinbase'
import {
  isMetalInterval,
  isMetalSymbol,
  KALSHI_WINDOW_SECONDS,
  kalshiWindowBounds,
  metalFeedForSymbol,
  type MetalInterval,
} from '../../shared/kalshi'
import {
  isKalshiMetalHistory,
  secondsUntilSettlement,
  type KalshiMetalHistory,
  type MetalCoverage,
  type MetalPendingWindow,
  type SettlementPoint,
} from '../../shared/kalshi-metals'
import { METAL_ASSETS } from './market'
import type { Asset } from './types'

/** A metal chart's worth of data, in the same shape the Coinbase hook hands the app. */
export interface MetalSnapshot {
  source: 'kalshi'
  symbol: string
  interval: MetalInterval
  candles: MarketCandle[]
  asOf: number
  /** Bumped on every accepted poll, so downstream memos see a new snapshot. */
  revision: number
  /** Always false: a settlement point is final, never a forming bar's guess. */
  provisional: false
}

export interface KalshiMetalMarket {
  snapshot: MetalSnapshot | null
  candles: MarketCandle[]
  state: ConnectionState
  message: string
  quote: MarketQuote | null
  /** Quotes for every watched metal, keyed by symbol. */
  quotes: Record<string, MarketQuote>
  pending: MetalPendingWindow | null
  points: SettlementPoint[]
  coverage: MetalCoverage | null
  assets: Asset[]
  retry: () => void
}

const IDLE: KalshiMetalMarket = {
  snapshot: null,
  candles: [],
  state: 'loading',
  message: '',
  quote: null,
  quotes: {},
  pending: null,
  points: [],
  coverage: null,
  assets: METAL_ASSETS,
  retry: () => {},
}

async function requestHistory(
  symbol: string,
  interval: string,
  limit: number,
  signal: AbortSignal,
): Promise<KalshiMetalHistory> {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) })
  const response = await fetch(`/api/kalshi/metals/history?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof (data as { message?: unknown })?.message === 'string'
        ? (data as { message: string }).message
        : 'Kalshi metal data could not be loaded. Check the connection and retry.',
    )
  if (!isKalshiMetalHistory(data, symbol, interval))
    throw new Error('Kalshi returned an invalid metal history payload.')
  return data
}

/**
 * Poll cadence, matched to when a metal price can actually change.
 *
 * Kalshi publishes one settlement value per quarter hour, so there is nothing new to read
 * mid-window. Poll hard either side of a boundary — just after the cut, when the next
 * window's strike lands, and just before it, so the settlement is picked up promptly —
 * and idle in between. Exported for tests.
 */
export function metalPollDelayMs(nowMs: number): number {
  const nowSec = nowMs / 1000
  const into = nowSec - kalshiWindowBounds(nowSec).windowStart
  const left = secondsUntilSettlement(nowSec)
  if (into < 30 || left < 30) return 3_000
  return Math.max(2_000, Math.min(30_000, (left - 30) * 1_000))
}

/**
 * Silver from Kalshi's published settlement ladder.
 *
 * Every number this hook returns is a value Kalshi put on the record: a window's
 * `floor_strike` or its graded `expiration_value`. There is no trade stream to subscribe
 * to and nothing to interpolate, so it polls at the window rhythm instead of streaming,
 * and a quarter hour with no published settlement shows up as a gap rather than a flat bar.
 */
export function useKalshiMetalMarket({
  symbol,
  interval,
  enabled,
  playing,
  watched,
  limit = 300,
}: {
  symbol: string
  interval: Interval
  enabled: boolean
  playing: boolean
  watched?: string[]
  limit?: number
}): KalshiMetalMarket {
  const feed = metalFeedForSymbol(symbol)
  // Kalshi settles the metals every 15 minutes, so finer resolutions have no source at
  // all. The chart says so instead of asking for something the server must refuse.
  const supported = feed !== null && isMetalInterval(interval)
  const metalInterval = supported ? (interval as MetalInterval) : '15m'
  const [history, setHistory] = useState<KalshiMetalHistory | null>(null)
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [state, setState] = useState<ConnectionState>('loading')
  const [message, setMessage] = useState('Loading Kalshi settlement points…')
  const [retryId, setRetryId] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const revision = useRef(0)
  const retry = useCallback(() => setRetryId((id) => id + 1), [])
  // Other metals in the watchlist need quotes too, but never the charted one twice.
  // Keyed as a string so the poll effect re-runs on membership, not on a new array identity.
  const othersKey = useMemo(
    () =>
      [...new Set((watched ?? []).filter((id) => isMetalSymbol(id) && id !== symbol))].join(','),
    [watched, symbol],
  )

  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])

  // A different metal's data must never be shown under the previous one's symbol.
  useEffect(() => {
    setHistory(null)
    setState('loading')
    setMessage('Loading Kalshi settlement points…')
  }, [symbol, metalInterval, limit])

  useEffect(() => {
    if (!enabled || !supported || !visible) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const poll = async () => {
      if (controller.signal.aborted) return
      try {
        const result = await requestHistory(symbol, metalInterval, limit, controller.signal)
        if (controller.signal.aborted) return
        attempt = 0
        revision.current += 1
        setHistory(result)
        // Staleness is measured against the server's own clock, not the client's.
        const ageSec = result.coverage.to
          ? Math.max(0, result.asOf / 1000 - result.coverage.to)
          : Number.POSITIVE_INFINITY
        if (!result.candles.length) {
          setState('stale')
          setMessage(result.message || 'Kalshi has published no settled windows yet.')
        } else if (ageSec > 2 * KALSHI_WINDOW_SECONDS) {
          // Two missed windows means the ladder itself has stopped publishing.
          setState('stale')
          setMessage(
            `${result.message} Newest settlement is ${Math.round(ageSec / 60)} minutes old.`,
          )
        } else {
          setState(playing ? 'live' : 'paused')
          setMessage(result.message)
        }
        if (result.quote)
          setQuotes((previous) => ({ ...previous, [symbol]: result.quote as MarketQuote }))
      } catch (error) {
        if (controller.signal.aborted) return
        attempt += 1
        const text = error instanceof Error ? error.message : 'Kalshi is unreachable.'
        setState((previous) => (previous === 'loading' ? 'offline' : 'reconnecting'))
        setMessage(`${text}${attempt > 1 ? ` Retrying (attempt ${attempt}).` : ' Retrying…'}`)
      }
      // Quotes for the other watched metals: a two-bar ask is enough to price them.
      for (const other of othersKey ? othersKey.split(',') : []) {
        try {
          const result = await requestHistory(other, '15m', 2, controller.signal)
          if (controller.signal.aborted) return
          if (result.quote)
            setQuotes((previous) => ({ ...previous, [other]: result.quote as MarketQuote }))
        } catch {
          // A missing watchlist quote is not an error worth interrupting the chart for.
        }
      }
      if (!controller.signal.aborted && playing)
        timer = setTimeout(poll, metalPollDelayMs(Date.now()))
    }

    if (playing) void poll()
    else setState((previous) => (previous === 'loading' ? 'loading' : 'paused'))
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [enabled, supported, visible, playing, symbol, metalInterval, limit, othersKey, retryId])

  const snapshot = useMemo<MetalSnapshot | null>(() => {
    if (!history || !supported) return null
    return {
      source: 'kalshi',
      symbol: history.symbol,
      interval: history.interval,
      candles: history.candles,
      asOf: history.asOf,
      revision: revision.current,
      provisional: false,
    }
  }, [history, supported])

  if (!feed) return { ...IDLE, assets: METAL_ASSETS, retry }
  const unsupportedMessage = supported
    ? message
    : `Kalshi settles ${feed.name} every 15 minutes, so ${interval} candles do not exist. Choose 15m, 1h, 4h, 1D or 1W.`
  return {
    snapshot,
    candles: snapshot?.candles ?? [],
    state: supported ? state : 'stale',
    message: unsupportedMessage,
    quote: history?.quote ?? null,
    quotes,
    pending: history?.pending ?? null,
    points: history?.points ?? [],
    coverage: history?.coverage ?? null,
    // Every metal is listable, so the watchlist can hold both while one is charted.
    assets: METAL_ASSETS,
    retry,
  }
}
