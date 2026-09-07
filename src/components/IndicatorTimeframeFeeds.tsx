import { useEffect } from 'react'
import { useCoinbaseMarket } from '../lib/useCoinbaseMarket'
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
  const { snapshot, state, message } = feed
  useEffect(() => {
    onData(product, interval, {
      candles: snapshot?.candles ?? [],
      asOf: snapshot?.asOf ?? 0,
      state,
      message,
    })
  }, [product, interval, snapshot, state, message, onData])
  return null
}
