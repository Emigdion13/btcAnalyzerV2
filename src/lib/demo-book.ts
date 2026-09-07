import { OrderBook, PERSISTENCE_SECONDS } from '../../shared/order-book'
import type { OrderBookView } from '../../shared/coinbase'
import type { Candle } from './types'

/**
 * Deterministic synthetic resting book for the app's explicit demo mode.
 *
 * This exists so the depth/strength overlay can be explored offline: demo mode has no exchange
 * connection, so no real book exists to show. The generator places ordinary background
 * liquidity around the last simulated price and plants larger "walls" at the swing extremes and
 * round numbers of the recent demo candles — the same construction the live feature performs on
 * Coinbase's real level2 feed. It is **synthetic and labeled as such everywhere it renders**;
 * it is never shown in Coinbase mode and is never mistaken for real resting orders.
 */
const hash01 = (value: number) => {
  const x = Math.abs(Math.sin(value * 127.1 + 311.7) * 43758.5453)
  return x - Math.floor(x)
}

export function demoBook(
  symbol: string,
  candles: Candle[],
  now: number,
): OrderBookView | null {
  if (candles.length < 40) return null
  const mid = candles[candles.length - 1]?.close
  if (!Number.isFinite(mid) || mid <= 0) return null

  const spreadPct = 0.04 // % of mid as the widest realistic bid/ask spread
  const bestBid = mid * (1 - spreadPct / 200)
  const bestAsk = mid * (1 + spreadPct / 200)
  const tick = Math.max(1e-6, mid * 0.0001)
  const step = mid * 0.0008
  const bids: { price: number; size: number }[] = []
  const asks: { price: number; size: number }[] = []

  // Recent swing extremes and round numbers become the "walls" (USD-denominated clusters).
  const anchors: { price: number; usd: number }[] = []
  const window = Math.min(candles.length, 240)
  const recent = candles.slice(-window)
  for (let i = 1; i < recent.length - 1; i++) {
    const high = recent[i].high,
      low = recent[i].low
    if (high > recent[i - 1].high && high >= recent[i + 1].high)
      anchors.push({ price: high, usd: 3_000_000 + hash01(high) * 9_000_000 })
    if (low < recent[i - 1].low && low <= recent[i + 1].low)
      anchors.push({ price: low, usd: 3_000_000 + hash01(low * 1.7) * 9_000_000 })
  }
  for (const fraction of [0.01, 0.02, 0.03]) {
    for (const direction of [-1, 1]) {
      const price = mid * (1 + direction * fraction)
      if (price > bestBid && price < bestAsk) continue
      anchors.push({ price, usd: 4_000_000 + hash01(price * 3.1) * 8_000_000 })
    }
  }
  // Only walls close enough to price to matter, deduplicated to their strongest twin.
  const wallGap = step * 2.5
  const clustered: { price: number; usd: number }[] = []
  for (const anchor of anchors.sort((a, b) => b.usd - a.usd)) {
    if (Math.abs(anchor.price - mid) > mid * 0.05) continue
    if (clustered.some((kept) => Math.abs(kept.price - anchor.price) <= wallGap)) continue
    clustered.push(anchor)
  }
  const wallLevels = (side: 'bid' | 'ask', price: number, usd: number) => {
    const levels = 6
    for (let i = 0; i < levels; i++) {
      const at = side === 'bid' ? price - (levels - 1 - i) * tick : price + i * tick
      if (at <= 0) continue
      const jitter = 1 + hash01(at * 9.7) * 0.25
      const size = (usd / levels) * jitter / at
      ;(side === 'bid' ? bids : asks).push({ price: at, size })
    }
  }
  for (const wall of clustered.slice(0, 8)) {
    if (wall.price < mid) wallLevels('bid', wall.price, wall.usd)
    else wallLevels('ask', wall.price, wall.usd)
  }

  // Background liquidity on a fine ladder across ~±1.6% of price.
  const ladderLevels = Math.ceil(mid * 0.016 / step)
  for (let i = 1; i <= ladderLevels; i++) {
    const bidPrice = bestBid - i * step
    const askPrice = bestAsk + i * step
    if (bidPrice > 0) {
      const noise = 1 + hash01(bidPrice * 13.1) * 3
      const usd = Math.max(2_000, mid * 0.000_015 * noise)
      bids.push({ price: bidPrice, size: usd / bidPrice })
    }
    if (askPrice > 0) {
      const noise = 1 + hash01(askPrice * 7.7) * 3
      const usd = Math.max(2_000, mid * 0.000_015 * noise)
      asks.push({ price: askPrice, size: usd / askPrice })
    }
  }

  const book = new OrderBook(symbol)
  // The synthetic ladder is "already resting" when generated: backdate the snapshot so the
  // persistence readout shows a mature book instead of a perpetually fresh one.
  book.seed(bids, asks, now, PERSISTENCE_SECONDS, now - PERSISTENCE_SECONDS)
  // The engine already bounds the profile to PROFILE_MAX_BINS (validated <= 300 on the wire).
  return book.view(now)
}
