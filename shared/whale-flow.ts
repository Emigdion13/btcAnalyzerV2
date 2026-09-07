/**
 * Executed large-print ("whale") flow tracking.
 *
 * ## What this measures
 *
 * Every trade Coinbase reports on the `matches` channel is an EXECUTED fill on the venue's order
 * book. This module keeps a rolling window of the unusually large ones and reports the signed USD
 * notional: positive when takers were lifting offers (money in), negative when takers were hitting
 * bids (money out).
 *
 * ## What this is NOT
 *
 * This is not on-chain data. It cannot see wallets, exchange deposits, custody transfers, OTC
 * blocks, or any activity on other venues. A "whale" here means one large order filled on this
 * Coinbase product — nothing more. See `docs/whale-flow-sources.md` for the layers this does not
 * cover and why on-chain intent signals need a paid labeled feed.
 *
 * ## Threshold calibration
 *
 * A fixed USD threshold cannot work across a catalog where BTC-USD and a thin altcoin trade in the
 * same UI. The threshold is therefore a high percentile of recently observed trade notionals, so it
 * adapts per product and per liquidity regime. Until enough trades have been sampled the tracker
 * reports `calibrated: false` and the UI labels it accordingly rather than showing a fabricated
 * number.
 */

/** Trades sampled before the percentile threshold is trustworthy. */
export const CALIBRATION_MINIMUM = 200
/** Reservoir of recent trade notionals used to derive the threshold. */
export const SAMPLE_CAPACITY = 1500
/** Percentile of recent trade notionals that qualifies as a whale print. */
export const DEFAULT_PERCENTILE = 0.99
/** Absolute floor so a dead-quiet market cannot mark dust as a whale. */
export const MINIMUM_THRESHOLD = 25_000
/** Prints retained for transport/UI. */
export const MAX_PRINTS = 50

export interface WhaleFlowOptions {
  windowSeconds?: number
  percentile?: number
  minimumThreshold?: number
  maxPrints?: number
}

interface TrackedPrint {
  id: number
  time: number
  price: number
  size: number
  notional: number
  side: 'buy' | 'sell'
}

interface TrackedTrade {
  id: number
  time: number
  price: number
  size: number
  takerSide?: 'buy' | 'sell' | null
}

/**
 * Rolling whale-print tracker for a single product.
 *
 * Time is supplied by the caller (trade timestamps and an explicit `now`) so the class is
 * deterministic and testable without faking clocks.
 */
export class WhaleFlowTracker {
  readonly product: string
  readonly windowSeconds: number
  private readonly percentile: number
  private readonly minimumThreshold: number
  private readonly maxPrints: number
  /** Recent trade notionals, oldest first, capped at SAMPLE_CAPACITY. */
  private samples: number[] = []
  /** Whale prints inside the window, oldest first. */
  private prints: TrackedPrint[] = []
  private seen = new Set<number>()
  private cachedThreshold = 0
  private thresholdDirty = true
  private observed = 0

  constructor(product: string, options: WhaleFlowOptions = {}) {
    this.product = product
    this.windowSeconds = Math.max(60, Math.floor(options.windowSeconds ?? 3600))
    this.percentile = Math.min(0.999, Math.max(0.5, options.percentile ?? DEFAULT_PERCENTILE))
    this.minimumThreshold = Math.max(0, options.minimumThreshold ?? MINIMUM_THRESHOLD)
    this.maxPrints = Math.max(1, Math.floor(options.maxPrints ?? MAX_PRINTS))
  }

  /** Total trades accepted into the calibration sample. */
  get sampled(): number {
    return this.observed
  }

  get calibrated(): boolean {
    return this.observed >= CALIBRATION_MINIMUM
  }

  /**
   * Current USD notional a trade must clear to register as a whale print.
   *
   * Before calibration this still returns a usable number (the floor) so the tracker never divides
   * by an undefined threshold, but `calibrated` stays false so the UI can say so.
   */
  get threshold(): number {
    if (this.thresholdDirty) {
      this.cachedThreshold = this.computeThreshold()
      this.thresholdDirty = false
    }
    return this.cachedThreshold
  }

  private computeThreshold(): number {
    if (!this.samples.length) return this.minimumThreshold
    const sorted = [...this.samples].sort((a, b) => a - b)
    const rank = Math.min(sorted.length - 1, Math.floor(sorted.length * this.percentile))
    return Math.max(this.minimumThreshold, sorted[rank])
  }

  /**
   * Feed one trade.
   *
   * Returns the print if the trade qualified as a whale print, otherwise null. Duplicate trade IDs
   * (Coinbase replays these across reconnects) are ignored, matching how CandleTracker dedupes.
   */
  apply(trade: TrackedTrade, now: number): TrackedPrint | null {
    if (!Number.isFinite(trade.price) || !Number.isFinite(trade.size)) return null
    if (trade.price <= 0 || trade.size <= 0) return null
    if (!Number.isInteger(trade.id) || this.seen.has(trade.id)) return null
    this.seen.add(trade.id)
    // Bound the dedupe set; trade IDs increase monotonically so old ones cannot recur in practice.
    if (this.seen.size > SAMPLE_CAPACITY * 2) {
      const keep = [...this.seen].slice(-SAMPLE_CAPACITY)
      this.seen = new Set(keep)
    }

    const notional = trade.price * trade.size
    if (!Number.isFinite(notional)) return null

    // Every trade calibrates the threshold, including ones with an unknown side.
    this.samples.push(notional)
    if (this.samples.length > SAMPLE_CAPACITY) this.samples.shift()
    this.observed++
    this.thresholdDirty = true

    // Directional flow requires a known aggressor.
    if (trade.takerSide !== 'buy' && trade.takerSide !== 'sell') return null
    if (notional < this.threshold) return null

    const print: TrackedPrint = {
      id: trade.id,
      time: trade.time,
      price: trade.price,
      size: trade.size,
      notional: trade.takerSide === 'buy' ? notional : -notional,
      side: trade.takerSide,
    }
    this.prints.push(print)
    this.evict(now)
    return print
  }

  /** Drop prints that have aged out of the window. */
  private evict(now: number) {
    const cutoff = now - this.windowSeconds
    if (this.prints.length && this.prints[0].time < cutoff)
      this.prints = this.prints.filter((p) => p.time >= cutoff)
    // Retaining more than the transport cap wastes memory without adding information.
    const overflow = this.prints.length - this.maxPrints * 4
    if (overflow > 0) this.prints.splice(0, overflow)
  }

  /** Immutable snapshot of the current window. */
  snapshot(now: number) {
    this.evict(now)
    let bought = 0,
      sold = 0
    for (const print of this.prints) {
      if (print.notional > 0) bought += print.notional
      else sold -= print.notional
    }
    return {
      product: this.product,
      net: bought - sold,
      bought,
      sold,
      count: this.prints.length,
      threshold: this.threshold,
      windowSeconds: this.windowSeconds,
      // Newest first for display.
      prints: this.prints.slice(-this.maxPrints).reverse(),
      calibrated: this.calibrated,
      sampled: this.observed,
    }
  }
}

/**
 * Format a signed USD notional the way a trader scans it: "+$1.2M", "-$20.0M", "+$100K".
 *
 * Uses two significant decimals below 10 units of a magnitude and one above, so the width stays
 * stable in a fixed-position readout.
 */
export function formatNotional(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < 1000) return `${sign}$${Math.round(abs)}`
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      const scaled = abs / scale
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
      return `${sign}$${scaled.toFixed(digits)}${suffix}`
    }
  }
  return `${sign}$${Math.round(abs)}`
}
