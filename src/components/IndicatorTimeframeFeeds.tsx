import { useEffect } from 'react'
import { useCoinbaseMarket } from '../lib/useCoinbaseMarket'
import { useKalshiMetalMarket } from '../lib/useKalshiMetalMarket'
import type { IndicatorTimeframeData } from '../lib/cm-ult-macd'
import type { Timeframe } from '../lib/types'

const NO_WATCHLIST: string[] = []
interface Props {
  product: string
  interval: Timeframe
  playing: boolean
  onData: (product: string, interval: Timeframe, data: IndicatorTimeframeData) => void
}
/** One feed per distinct requested resolution, sharing the existing validated transport. */
export function IndicatorTimeframeFeed({ product, interval, playing, onData }: Props) {
  const feed = useCoinbaseMarket({
    product,
    interval,
    enabled: true,
    playing,
    watched: NO_WATCHLIST,
    limit: 900,
    metadata: false,
  })
  const { snapshot, state, message, tape } = feed
  useEffect(() => {
    onData(product, interval, {
      candles: snapshot?.candles ?? [],
      asOf: snapshot?.asOf ?? 0,
      state,
      message,
      tape,
    })
  }, [product, interval, snapshot, state, message, tape, onData])
  return null
}

/**
 * The same contract for silver, from Kalshi's settlement points.
 *
 * Alt-timeframe indicators need a feed per resolution whatever the venue, and the metals
 * must not be asked of Coinbase. Resolutions Kalshi publishes nothing for — anything below
 * 15 minutes — report `stale` with the reason, so an indicator says "no such data" rather
 * than drawing on a resampled guess.
 */
export function MetalTimeframeFeed({ product, interval, playing, onData }: Props) {
  const feed = useKalshiMetalMarket({
    symbol: product,
    interval,
    enabled: true,
    playing,
    limit: 900,
  })
  const { snapshot, state, message } = feed
  useEffect(() => {
    onData(product, interval, {
      candles: snapshot?.candles ?? [],
      asOf: snapshot?.asOf ?? 0,
      state,
      message,
      // Kalshi publishes settlement values, not trades, so there is no taker tape.
      tape: null,
    })
  }, [product, interval, snapshot, state, message, onData])
  return null
}
