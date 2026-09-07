import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isCandle,
  isProductId,
  isQuote,
  mergeCandles,
  validateHistory,
} from '../../shared/coinbase'
import type {
  CoinbaseProduct,
  ConnectionState,
  HistorySnapshot,
  Interval,
  MarketQuote,
  StreamPayload,
} from '../../shared/coinbase'
import { coinbaseAsset, COINBASE_DEFAULTS } from './market'

interface View {
  key: string
  snapshot: HistorySnapshot | null
  state: ConnectionState
  message: string
  lastEventAt: number
}
const freshView = (key: string): View => ({
  key,
  snapshot: null,
  state: 'loading',
  message: 'Loading Coinbase candles…',
  lastEventAt: 0,
})
async function requestJson(path: string, signal: AbortSignal) {
  const timeout = AbortSignal.timeout(30000)
  const response = await fetch(path, {
    signal: AbortSignal.any([signal, timeout]),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof data?.message === 'string'
        ? data.message
        : 'Market data could not be loaded. Check the connection and retry.',
    )
  return data as unknown
}
function quotesFrom(value: unknown): Record<string, MarketQuote> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([id, quote]) => isProductId(id) && isQuote(quote)),
  )
}
export function useCoinbaseMarket({
  product,
  interval,
  enabled,
  playing,
  watched,
  limit = 300,
}: {
  product: string
  interval: Interval
  enabled: boolean
  playing: boolean
  watched: string[]
  limit?: number
}) {
  const key = `${product}:${interval}:${limit}`
  const [view, setView] = useState<View>(() => freshView(key))
  const [products, setProducts] = useState<CoinbaseProduct[]>([])
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [retryId, setRetryId] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const cache = useRef(new Map<string, HistorySnapshot>())
  const watchKey = [...new Set([product, ...watched].filter(isProductId))]
    .sort()
    .slice(0, 100)
    .join(',')
  const retry = useCallback(() => setRetryId((id) => id + 1), [])
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    if (!enabled || !visible) return
    const controller = new AbortController()
    let events: EventSource | null = null,
      retryTimer: ReturnType<typeof setTimeout> | undefined
    let lastEvent = Date.now(),
      attempt = 0
    const updateQuotes = (incoming: Record<string, MarketQuote>) =>
      setQuotes((previous) => {
        const changes = Object.entries(incoming).filter(
          ([id, quote]) => !previous[id] || quote.updatedAt > previous[id].updatedAt,
        )
        return changes.length ? { ...previous, ...Object.fromEntries(changes) } : previous
      })
    const update = (fn: (view: View) => View) => {
      if (!controller.signal.aborted)
        setView((previous) => fn(previous.key === key ? previous : freshView(key)))
    }
    const cached = cache.current.get(key) ?? null
    update(() => ({
      ...freshView(key),
      snapshot: cached,
      message: cached ? 'Refreshing Coinbase data…' : 'Loading Coinbase candles…',
    }))
    const connect = () => {
      if (controller.signal.aborted || !playing) return
      events?.close()
      lastEvent = Date.now()
      const params = new URLSearchParams({
        product,
        interval,
        products: watchKey,
        limit: String(limit),
      })
      events = new EventSource(`/api/coinbase/stream?${params}`)
      events.onmessage = (event) => {
        if (controller.signal.aborted) return
        try {
          const data = JSON.parse(event.data) as StreamPayload
          if (
            data.product !== product ||
            data.interval !== interval ||
            !['connecting', 'live', 'reconnecting', 'stale'].includes(data.state) ||
            !Array.isArray(data.candles) ||
            data.candles.length > 900 ||
            data.candles.some((c) => !isCandle(c)) ||
            !Number.isFinite(data.revision) ||
            !Number.isFinite(data.asOf)
          )
            throw new Error('Invalid live market message.')
          lastEvent = Date.now()
          updateQuotes(quotesFrom(data.quotes))
          update((previous) => {
            if (!previous.snapshot) return previous
            const changed =
              data.candles.length && (data.replace || data.revision !== previous.snapshot.revision)
            const snapshot = changed
              ? validateHistory(
                  {
                    ...previous.snapshot,
                    candles: data.replace
                      ? data.candles
                      : mergeCandles(previous.snapshot.candles, data.candles),
                    asOf: data.asOf,
                    revision: data.revision,
                    provisional: true,
                  },
                  product,
                  interval,
                )
              : previous.snapshot
            if (changed) cache.current.set(key, snapshot)
            return {
              ...previous,
              snapshot,
              state: data.state,
              message: data.message,
              lastEventAt: lastEvent,
            }
          })
        } catch {
          update((previous) => ({
            ...previous,
            state: 'stale',
            message: 'Invalid live update ignored. Retry to refresh authoritative candles.',
          }))
        }
      }
      events.onerror = () =>
        update((previous) => ({
          ...previous,
          state: 'reconnecting',
          message: 'Live connection interrupted. Retrying; displayed prices may be stale.',
        }))
    }
    const bootstrap = async () => {
      if (controller.signal.aborted) return
      void requestJson('/api/coinbase/products', controller.signal)
        .then((value) => {
          const data = value as { source: string; products: CoinbaseProduct[] }
          if (
            data?.source !== 'coinbase' ||
            !Array.isArray(data.products) ||
            !data.products.length ||
            data.products.some(
              (p) => !isProductId(p.id) || p.quote !== 'USD' || !Number.isFinite(p.increment),
            )
          )
            throw new Error('Invalid Coinbase catalog.')
          if (!controller.signal.aborted) setProducts(data.products)
        })
        .catch(() => {
          /* The chart request presents actionable availability errors. */
        })
      void requestJson(
        `/api/coinbase/quotes?${new URLSearchParams({ products: watchKey })}`,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted)
            updateQuotes(quotesFrom((value as { quotes?: unknown })?.quotes))
        })
        .catch(() => {
          /* No fabricated quote fallback. The stream may still supply valid quotes. */
        })
      try {
        const snapshot = validateHistory(
          await requestJson(
            `/api/coinbase/candles?${new URLSearchParams({ product, interval, limit: String(limit) })}`,
            controller.signal,
          ),
          product,
          interval,
        )
        if (controller.signal.aborted) return
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!)
        cache.current.set(key, snapshot)
        update(() => ({
          key,
          snapshot,
          state: playing ? 'connecting' : 'paused',
          message: playing
            ? 'Historical candles loaded. Connecting to live trades…'
            : 'Coinbase snapshot · live updates paused',
          lastEventAt: Date.now(),
        }))
        connect()
      } catch (error) {
        if (controller.signal.aborted) return
        update((previous) => ({
          ...previous,
          state: previous.snapshot ? 'stale' : 'offline',
          message: error instanceof Error ? error.message : 'Coinbase is unavailable.',
        }))
        if (playing)
          retryTimer = setTimeout(() => void bootstrap(), Math.min(30000, 5000 * 2 ** attempt++))
      }
    }
    void bootstrap()
    const watchdog = setInterval(() => {
      if (events && playing && Date.now() - lastEvent > 20000) {
        events.close()
        events = null
        update((previous) => ({
          ...previous,
          state: 'stale',
          message: 'No live updates received. Reconnecting to Coinbase…',
        }))
        retryTimer = setTimeout(connect, 3000)
      }
    }, 3000)
    return () => {
      controller.abort()
      events?.close()
      clearTimeout(retryTimer)
      clearInterval(watchdog)
    }
  }, [enabled, playing, visible, product, interval, limit, key, watchKey, retryId])
  const active =
    view.key === key ? view : { ...freshView(key), snapshot: cache.current.get(key) ?? null }
  const assets = useMemo(
    () =>
      (products.length ? products : COINBASE_DEFAULTS).map(coinbaseAsset).sort((a, b) => {
        const rank = (symbol: string) => {
          const i = COINBASE_DEFAULTS.indexOf(symbol)
          return i === -1 ? 100 : i
        }
        return rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol)
      }),
    [products],
  )
  return {
    ...active,
    assets,
    quotes,
    verified: products.length > 0,
    state: !visible && active.snapshot ? ('paused' as const) : active.state,
    retry,
  }
}
