/**
 * Runs the level-touch journal on the chart's live Coinbase feed: new watches on every closed bar,
 * the resting book read on every book update while price approaches, a test recorded the moment
 * the forming bar trades through a watched price, and open tests graded as bars close.
 *
 * Only a live, non-replay Coinbase chart with a live book feeds it — a frozen or synthetic book
 * would record a defence nobody was offering. The journal persists locally across sessions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { INTERVAL_SECONDS, type OrderBookView } from '../../shared/coinbase'
import { closedCandles } from './indicator-alarms'
import {
  emptyLevelTouchJournal,
  levelTouchStats,
  levelWatches,
  priceWatch,
  recordTouches,
  resolveTouches,
  sanitizeLevelTouchJournal,
  stillApproaching,
  type BookPrice,
  type LevelWatch,
} from './level-touch-journal'
import { readStored, writeStored } from './storage'
import type { Candle, Timeframe } from './types'

const STORAGE_KEY = 'levelTouchJournal'

export function useLevelTouchJournal({
  product,
  timeframe,
  candles,
  book,
  enabled,
}: {
  product: string
  timeframe: Timeframe
  candles: Candle[]
  book: OrderBookView | null
  enabled: boolean
}) {
  const [journal, setJournal] = useState(() =>
    sanitizeLevelTouchJournal(readStored<unknown>(STORAGE_KEY, null)),
  )
  const watched = useRef<{ key: string; watches: LevelWatch[] }>({ key: '', watches: [] })
  const before = useRef(new Map<string, BookPrice>())

  useEffect(() => {
    writeStored(STORAGE_KEY, journal)
  }, [journal])

  useEffect(() => {
    if (!enabled || !candles.length) return
    const now = Date.now() / 1000
    const closed = closedCandles(candles, timeframe, now)
    const last = candles[candles.length - 1]
    const forming = last.time + INTERVAL_SECONDS[timeframe] > now ? last : null
    const key = `${product}:${timeframe}:${closed[closed.length - 1]?.time ?? 'none'}`
    if (watched.current.key !== key) {
      watched.current = { key, watches: levelWatches(closed, timeframe) }
      before.current = new Map()
      setJournal((current) => resolveTouches(current, product, timeframe, closed))
    }
    if (!forming || !book) return
    const { watches } = watched.current
    const reads = before.current
    for (const watch of watches) {
      const touched =
        watch.side === 'support' ? forming.low <= watch.price : forming.high >= watch.price
      if (!touched && stillApproaching(watch, forming.close))
        before.current.set(watch.key, priceWatch(book, watch))
    }
    setJournal((current) =>
      recordTouches(current, {
        product,
        timeframe,
        watches,
        forming,
        book,
        before: reads,
      }),
    )
  }, [enabled, product, timeframe, candles, book])

  const stats = useMemo(
    () => levelTouchStats(journal, product, timeframe),
    [journal, product, timeframe],
  )
  const reset = useCallback(() => setJournal(emptyLevelTouchJournal()), [])
  return { journal, stats, reset }
}
