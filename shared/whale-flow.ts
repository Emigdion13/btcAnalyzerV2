/**
 * Live whale-burst detection on the executed tape.
 *
 * ## What this reports
 *
 * Not a running total. This watches a short window (5 seconds by default) of executed fills and
 * reports whether a large directional sweep is **building**, **happening now**, or **just
 * finished**. Once the sweep is over the reading returns to `idle` and the number is dropped, so a
 * stale figure never sits on screen pretending to be current.
 *
 * A whale filling size rarely produces one print — it produces a burst of fills over a couple of
 * seconds as it walks the book. Aggregating the window (rather than thresholding individual
 * trades) is what lets the leading edge of that sweep be flagged while it is still in progress.
 *
 * ## What this cannot do
 *
 * It cannot see a trade before it executes. Nothing in the `matches` channel exposes resting
 * orders or intent, so "building" means *a sweep has started and is still going*, not *a whale
 * will arrive shortly*. True pre-trade warning needs the level2 order book (large resting size) or
 * an on-chain deposit feed — see `docs/whale-flow-sources.md`.
 *
 * It is also venue-local and executed-only: no wallets, deposits, custody moves, OTC blocks, or
 * other exchanges.
 */

/** Length of the live burst window, in seconds. */
export const BURST_WINDOW_SECONDS = 5
/** How long a finished burst stays on screen, fading, before it is dropped entirely. */
export const LINGER_SECONDS = 4
/** Share of the burst threshold that counts as "building". */
export const BUILDING_RATIO = 0.35
/** Trades sampled before the percentile threshold is trustworthy. */
export const CALIBRATION_MINIMUM = 200
/** Reservoir of recent trade notionals used to derive the threshold. */
export const SAMPLE_CAPACITY = 1500
/** Percentile of recent trade notionals that sizes a burst. */
export const DEFAULT_PERCENTILE = 0.99
/** Absolute floor so a dead-quiet market cannot mark dust as a whale. */
export const MINIMUM_THRESHOLD = 25_000
/** Prints carried for display. */
export const MAX_PRINTS = 12

/**
 * `idle`     nothing worth showing — the UI must render no figure
 * `building` a directional sweep is under way but has not yet cleared the threshold
 * `active`   the sweep has cleared the threshold; this is happening right now
 * `fading`   the sweep stopped; the final figure lingers briefly, then clears
 */
export type WhalePhase = 'idle' | 'building' | 'active' | 'fading'

export interface WhaleFlowOptions {
  windowSeconds?: number
  lingerSeconds?: number
  percentile?: number
  minimumThreshold?: number
  maxPrints?: number
  buildingRatio?: number
}

interface WindowTrade {
  id: number
  /** Exchange timestamp, for display. */
  time: number
  /**
   * Local arrival time, used for windowing.
   *
   * At a five-second window, clock skew between the venue and this process would otherwise evict
   * trades instantly or never. Display uses exchange time; eviction uses arrival time.
   */
  arrived: number
  price: number
  size: number
  /** Signed USD notional: positive when the taker bought. */
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

interface BurstMemory {
  net: number
  bought: number
  sold: number
  count: number
  prints: WindowTrade[]
  /**
   * When the sweep is projected to finish: the last contributing fill's arrival plus the window
   * length, i.e. the moment the window would drain if nothing else arrives.
   *
   * Derived from trade data rather than from when `snapshot` happened to be called, so the linger
   * behaves identically whether the caller polls at 1 Hz or not at all for an hour.
   */
  endsAt: number
}

export class WhaleFlowTracker {
  readonly product: string
  readonly windowSeconds: number
  private readonly lingerSeconds: number
  private readonly percentile: number
  private readonly minimumThreshold: number
  private readonly maxPrints: number
  private readonly buildingRatio: number
  private samples: number[] = []
  /** Every sided trade inside the live window, oldest first. */
  private window: WindowTrade[] = []
  private seen = new Set<number>()
  private cachedThreshold = 0
  private thresholdDirty = true
  private observed = 0
  /** Snapshot of the last burst that reached `active`, kept only for the linger period. */
  private lastBurst: BurstMemory | null = null
  private burstOpen = false

  constructor(product: string, options: WhaleFlowOptions = {}) {
    this.product = product
    this.windowSeconds = Math.max(1, options.windowSeconds ?? BURST_WINDOW_SECONDS)
    this.lingerSeconds = Math.max(0, options.lingerSeconds ?? LINGER_SECONDS)
    this.percentile = Math.min(0.999, Math.max(0.5, options.percentile ?? DEFAULT_PERCENTILE))
    this.minimumThreshold = Math.max(0, options.minimumThreshold ?? MINIMUM_THRESHOLD)
    this.maxPrints = Math.max(1, Math.floor(options.maxPrints ?? MAX_PRINTS))
    this.buildingRatio = Math.min(0.95, Math.max(0.05, options.buildingRatio ?? BUILDING_RATIO))
  }

  get sampled(): number {
    return this.observed
  }

  get calibrated(): boolean {
    return this.observed >= CALIBRATION_MINIMUM
  }

  /** USD notional a burst must reach inside the window to count as whale activity. */
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
   * Feed one trade. `now` is the local clock in seconds.
   *
   * Every valid trade calibrates the threshold. Only trades with a known aggressor enter the
   * directional window.
   */
  apply(trade: TrackedTrade, now: number): boolean {
    if (!Number.isFinite(trade.price) || !Number.isFinite(trade.size)) return false
    if (trade.price <= 0 || trade.size <= 0) return false
    if (!Number.isInteger(trade.id) || this.seen.has(trade.id)) return false
    this.seen.add(trade.id)
    if (this.seen.size > SAMPLE_CAPACITY * 2)
      this.seen = new Set([...this.seen].slice(-SAMPLE_CAPACITY))

    const notional = trade.price * trade.size
    if (!Number.isFinite(notional)) return false

    this.samples.push(notional)
    if (this.samples.length > SAMPLE_CAPACITY) this.samples.shift()
    this.observed++
    this.thresholdDirty = true

    if (trade.takerSide !== 'buy' && trade.takerSide !== 'sell') return false

    this.window.push({
      id: trade.id,
      time: Number.isFinite(trade.time) ? trade.time : now,
      arrived: now,
      price: trade.price,
      size: trade.size,
      notional: trade.takerSide === 'buy' ? notional : -notional,
      side: trade.takerSide,
    })
    this.evict(now)
    return true
  }

  private evict(now: number) {
    const cutoff = now - this.windowSeconds
    if (this.window.length && this.window[0].arrived < cutoff)
      this.window = this.window.filter((t) => t.arrived >= cutoff)
  }

  /**
   * Current state of the window.
   *
   * Returns `null` when there is nothing to show, so callers can omit the payload entirely rather
   * than transmitting a zeroed reading the UI would have to special-case.
   */
  snapshot(now: number) {
    this.evict(now)
    let bought = 0,
      sold = 0
    for (const trade of this.window) {
      if (trade.notional > 0) bought += trade.notional
      else sold -= trade.notional
    }
    const net = bought - sold
    const magnitude = Math.abs(net)
    const threshold = this.threshold
    const intensity = threshold > 0 ? magnitude / threshold : 0

    let phase: WhalePhase
    if (intensity >= 1) phase = 'active'
    else if (intensity >= this.buildingRatio && this.window.length >= 2) phase = 'building'
    else phase = 'idle'

    if (phase === 'active') {
      // Remember the burst at its strongest so the linger shows what actually happened.
      // `endedAt` tracks the last moment the sweep was observed live.
      const endsAt = this.window[this.window.length - 1].arrived + this.windowSeconds
      const strongest =
        !this.lastBurst || !this.burstOpen || magnitude > Math.abs(this.lastBurst.net)
      if (strongest)
        this.lastBurst = {
          net,
          bought,
          sold,
          count: this.window.length,
          prints: this.topPrints(),
          endsAt,
        }
      else if (this.lastBurst) this.lastBurst.endsAt = endsAt
      this.burstOpen = true
    } else {
      this.burstOpen = false
    }

    if (phase !== 'active' && this.lastBurst) {
      const age = now - this.lastBurst.endsAt
      if (age <= this.lingerSeconds) {
        // A fresh sweep starting during the linger takes precedence over the old figure.
        if (phase !== 'building') phase = 'fading'
      } else {
        this.lastBurst = null
      }
    }

    if (phase === 'idle') return null

    const source =
      phase === 'fading' && this.lastBurst
        ? this.lastBurst
        : { net, bought, sold, count: this.window.length, prints: this.topPrints() }

    return {
      product: this.product,
      phase,
      net: source.net,
      bought: source.bought,
      sold: source.sold,
      count: source.count,
      threshold,
      windowSeconds: this.windowSeconds,
      // Clamped so the UI can drive a meter without guarding against overflow.
      intensity: Math.min(4, Math.max(0, phase === 'fading' ? 1 : intensity)),
      prints: source.prints.map((t) => ({
        id: t.id,
        time: t.time,
        price: t.price,
        size: t.size,
        notional: t.notional,
        side: t.side,
      })),
      calibrated: this.calibrated,
      sampled: this.observed,
    }
  }

  /** Largest trades in the window by absolute notional, newest first among equals. */
  private topPrints(): WindowTrade[] {
    return [...this.window]
      .sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional) || b.arrived - a.arrived)
      .slice(0, this.maxPrints)
      .sort((a, b) => b.arrived - a.arrived)
  }
}

/**
 * Format a signed USD notional the way a trader scans it: "+$1.2M", "-$20.0M", "+$100K".
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
