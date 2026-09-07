/**
 * Live resting-liquidity analysis on the venue's level2 order book.
 *
 * ## What this produces
 *
 * From Coinbase's `level2` channel (a full-book `snapshot` followed by `l2update` deltas) this
 * builds a price-ordered book and derives, at the 1 Hz SSE cadence:
 *
 * - a **depth profile** of thin price slices (`bins`) across the whole transmitted span, with
 *   the USD resting on each side in every slice. Slicing the book lets any client sum arbitrary
 *   price ranges — an SMC order block, a fair value gap, an SR box — into "how much resting
 *   money is actually stacked inside this zone right now".
 * - **walls**: clusters of adjacent levels whose combined notional stands out from the rest of
 *   the book (`supports` below mid, `resistances` above). These are the S/R levels the book
 *   itself constructs, and their size is the direct answer to "is there a big resting order
 *   defending this price".
 * - a per-slice **rest persistence** (`hold`): how long the liquidity at a price has rested
 *   unchanged. Size that keeps sitting there while price trades around it is the closest the
 *   book gets to a measured *defense*; size that churns every few seconds is more likely
 *   fleeting/aggressive liquidity.
 *
 * ## What this is not
 *
 * Resting size is not a commitment: every level can be pulled or walked within seconds, the
 * book sees only this venue (Coinbase), and it cannot see hidden/iceberg intent or resting
 * liquidity on other exchanges. None of these levels is a trade signal or advice.
 */

import type { OrderBookBin, OrderBookView, OrderBookWall } from './coinbase'

/** Window over which level rest-age is measured for the `hold` persistence metric. */
export const PERSISTENCE_SECONDS = 60
/** A wall must rest at least this much USD to be reported (quiet books cannot fake walls). */
export const WALL_MIN_NOTIONAL = 200_000
/** A wall's single largest level must exceed this USD to be notable. */
export const WALL_MIN_LEVEL_PEAK = 250_000
/** Max walls reported per side. */
export const WALL_MAX_PER_SIDE = 3
/** Upper bound on transmitted profile bins. */
export const PROFILE_MAX_BINS = 280
/** Smallest profile slice, as a ratio of the mid price. */
export const MIN_BIN_WIDTH_RATIO = 0.00005

export interface RawLevel {
  /** Price of the level, in quote currency. */
  price: number
  /** Resting size at the level, in base currency. */
  size: number
}
export interface BookChange {
  side: 'bid' | 'ask'
  price: number
  /** New resting size at the price; 0 removes the level. */
  size: number
}

/** Parse an Exchange-feed `level2` snapshot message. Returns null when malformed. */
export function parseLevel2Snapshot(value: unknown): { bids: RawLevel[]; asks: RawLevel[] } | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const side = (rows: unknown): RawLevel[] | null => {
    if (!Array.isArray(rows)) return null
    const levels: RawLevel[] = []
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) return null
      const price = Number(row[0]),
        size = Number(row[1])
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0)
        return null
      levels.push({ price, size })
    }
    return levels
  }
  const bids = side(raw.bids),
    asks = side(raw.asks)
  return raw.type === 'snapshot' && bids && asks ? { bids, asks } : null
}

/** Parse an Exchange-feed `l2update` message. Returns null when malformed. */
export function parseLevel2Update(value: unknown): BookChange[] | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'l2update' || !Array.isArray(raw.changes)) return null
  const changes: BookChange[] = []
  for (const entry of raw.changes) {
    if (!Array.isArray(entry) || entry.length < 3) return null
    const side = entry[0] === 'buy' ? 'bid' : entry[0] === 'sell' ? 'ask' : null
    const price = Number(entry[1]),
      size = Number(entry[2])
    if (
      !side ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(size) ||
      size < 0 ||
      size > 1e12
    )
      return null
    changes.push({ side, price, size })
  }
  return changes
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface InternalWall {
  levels: RawLevel[]
  price: number
  notional: number
  peak: number
  depth: number
  persistence: number
}

/**
 * Price-ordered resting book for one product, fed by Exchange-feed `level2` messages.
 *
 * Snapshot semantics follow the venue's channel contract: a `snapshot` replaces the book, each
 * later `l2update` entry is the *new* size at a price (0 removes the level). No sequence numbers
 * are required on the level2 channel. The class never invents levels; it only stores what the
 * venue sends.
 */
export class OrderBook {
  readonly product: string
  /** price → resting base size, bids (below mid) and asks (above mid). */
  private readonly bids = new Map<number, number>()
  private readonly asks = new Map<number, number>()
  /** Last change time per price, unix seconds; drives the rest-persistence metric. */
  private readonly changedAt = new Map<number, number>()
  private snapshotAt = 0

  constructor(product: string) {
    this.product = product
  }

  /** Level count currently held. */
  get size(): number {
    return this.bids.size + this.asks.size
  }

  /**
   * Replace the whole book with a snapshot received at `now` (unix seconds).
   * `restSeconds` backdates each level's rest age (all levels were already resting when the
   * snapshot arrived); `since` overrides the persistence-clock start (used by synthetic demo
   * books, which have no real arrival time).
   */
  seed(bids: RawLevel[], asks: RawLevel[], now: number, restSeconds = 0, since?: number) {
    const age = Math.max(0, restSeconds)
    this.bids.clear()
    this.asks.clear()
    this.changedAt.clear()
    for (const level of bids) {
      this.bids.set(level.price, level.size)
      if (level.size > 0) this.changedAt.set(level.price, now - age)
    }
    for (const level of asks) {
      this.asks.set(level.price, level.size)
      if (level.size > 0) this.changedAt.set(level.price, now - age)
    }
    this.snapshotAt = since ?? now
  }

  /** Apply one level2 delta entry. */
  apply(change: BookChange, now: number): boolean {
    if (!Number.isFinite(change.price) || change.price <= 0) return false
    if (!Number.isFinite(change.size) || change.size < 0 || change.size > 1e12) return false
    const side = change.side === 'bid' ? this.bids : this.asks
    if (change.size === 0) {
      side.delete(change.price)
      this.changedAt.delete(change.price)
      return true
    }
    side.set(change.price, change.size)
    this.changedAt.set(change.price, now)
    return true
  }

  /** Base size resting at a price on one side of the book, or 0 when no level is there. */
  sizeAt(side: 'bid' | 'ask', price: number): number {
    return (side === 'bid' ? this.bids.get(price) : this.asks.get(price)) ?? 0
  }

  /** Dispatch a raw level2 message; returns true when it touched the book. */
  applyMessage(raw: unknown, now: number): boolean {
    const snapshot = parseLevel2Snapshot(raw)
    if (snapshot) {
      this.seed(snapshot.bids, snapshot.asks, now)
      return true
    }
    const changes = parseLevel2Update(raw)
    if (!changes) return false
    let touched = false
    for (const change of changes) touched = this.apply(change, now) || touched
    return touched
  }

  /** Mid price of the book, or null before a valid snapshot exists. */
  get mid(): number | null {
    let bestBid = -Infinity
    for (const price of this.bids.keys())
      if (price > bestBid && (this.bids.get(price) ?? 0) > 0) bestBid = price
    let bestAsk = Infinity
    for (const price of this.asks.keys())
      if (price < bestAsk && (this.asks.get(price) ?? 0) > 0) bestAsk = price
    return bestBid > 0 && bestAsk < Infinity && bestBid < bestAsk
      ? (bestBid + bestAsk) / 2
      : null
  }

  /** Best ask minus best bid, or 0 before a valid book exists. */
  get spread(): number {
    const mid = this.mid
    if (mid === null) return 0
    let bestBid = -Infinity
    for (const price of this.bids.keys())
      if (price > bestBid && (this.bids.get(price) ?? 0) > 0) bestBid = price
    let bestAsk = Infinity
    for (const price of this.asks.keys())
      if (price < bestAsk && (this.asks.get(price) ?? 0) > 0) bestAsk = price
    return bestAsk - bestBid
  }

  /** Notional-weighted rest persistence of a set of levels at `now`, 0..1. */
  private persistence(levels: RawLevel[], now: number): number {
    let total = 0,
      weighted = 0
    for (const level of levels) {
      const notional = level.price * level.size
      const age = this.changedAt.has(level.price) ? now - (this.changedAt.get(level.price) ?? 0) : 0
      total += notional
      weighted += notional * clamp(age / PERSISTENCE_SECONDS, 0, 1)
    }
    return total > 0 ? weighted / total : 0
  }

  /**
   * Full analysis view, or null while the book has no valid mid.
   *
   * Bins tile the whole transmitted span at an adaptive width (at most PROFILE_MAX_BINS), so any
   * client price range can be priced by summing the slices it overlaps. Walls are computed from
   * the full book, not the binned profile.
   */
  view(now: number) {
    const mid = this.mid
    if (mid === null || this.bids.size === 0 || this.asks.size === 0) return null
    const bidLevels = [...this.bids]
      .filter(([, size]) => size > 0)
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price)
    const askLevels = [...this.asks]
      .filter(([, size]) => size > 0)
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => a.price - b.price)
    const low = bidLevels[0].price
    const high = askLevels[askLevels.length - 1].price
    const span = Math.max(0.01, high - low)
    // Adaptive slice width: never thinner than the book's own finest level spacing (so a wall's
    // levels land in one slice), never wider than needed to stay inside PROFILE_MAX_BINS.
    const distinct = [...bidLevels, ...askLevels]
      .map((l) => l.price)
      .sort((a, b) => a - b)
    let finest = Infinity
    for (let i = 1; i < distinct.length; i++) {
      const gap = distinct[i] - distinct[i - 1]
      if (gap > 0 && gap < finest) finest = gap
    }
    const tick = Number.isFinite(finest) ? finest : 0.01
    const natural = mid * MIN_BIN_WIDTH_RATIO
    const fitted =
      Math.ceil(span / (PROFILE_MAX_BINS - 1) / natural) * natural
    const step = Math.max(tick, fitted)
    const b0 = Math.floor(low / step) * step
    const binCount = Math.min(PROFILE_MAX_BINS, Math.max(1, Math.ceil((high - b0) / step)))
    const binBid = new Float64Array(binCount)
    const binAsk = new Float64Array(binCount)
    const binHoldNumerator = new Float64Array(binCount)
    const binHoldDenominator = new Float64Array(binCount)
    const binIndex = (price: number) =>
      Math.round((price - b0) / step) // grid-aligned, monotone for dense books
    const add = (
      level: RawLevel,
      bins: Float64Array,
      holdNumerator: Float64Array,
      holdDenominator: Float64Array,
    ) => {
      const index = binIndex(level.price)
      if (index < 0 || index >= binCount) return
      const notional = level.price * level.size
      bins[index] += notional
      const age = this.changedAt.has(level.price) ? now - (this.changedAt.get(level.price) ?? 0) : 0
      const persistence = clamp(age / PERSISTENCE_SECONDS, 0, 1)
      holdNumerator[index] += notional * persistence
      holdDenominator[index] += notional
    }
    for (const level of bidLevels) add(level, binBid, binHoldNumerator, binHoldDenominator)
    for (const level of askLevels) add(level, binAsk, binHoldNumerator, binHoldDenominator)

    const bins: OrderBookBin[] = []
    let bidsTotal = 0,
      asksTotal = 0
    for (let index = 0; index < binCount; index++) {
      const price = b0 + index * step
      const bid = binBid[index],
        ask = binAsk[index]
      bidsTotal += bid
      asksTotal += ask
      bins.push({
        price,
        bid,
        ask,
        hold: binHoldDenominator[index] > 0 ? binHoldNumerator[index] / binHoldDenominator[index] : 0,
      })
    }

    // Near-mid imbalance over the innermost slices either side of the mid price.
    const nearBand = Math.max(step * 5, this.spread * 3)
    let bidNear = 0,
      askNear = 0
    for (const bin of bins) {
      if (Math.abs(bin.price - mid) <= nearBand) {
        bidNear += bin.bid
        askNear += bin.ask
      }
    }
    const imbalance = bidNear + askNear > 0 ? (bidNear - askNear) / (bidNear + askNear) : 0

    const walls = (levels: RawLevel[]): InternalWall[] => {
      if (!levels.length) return []
      // Cluster adjacent levels whose price gap stays inside `gap`. A wall is a *tight* stack:
      // real resting interest concentrates within a few ticks, not across $100s of price.
      const gap = Math.max(this.spread * 2, mid * 0.00005)
      const clusters: RawLevel[][] = []
      let current: RawLevel[] = [levels[0]]
      for (let i = 1; i < levels.length; i++) {
        if (levels[i].price - levels[i - 1].price <= gap) current.push(levels[i])
        else {
          clusters.push(current)
          current = [levels[i]]
        }
      }
      clusters.push(current)
      // "Background texture": the lower-quartile level notional of the side. Quartile (not
      // median) so a handful of giant wall levels cannot raise the floor and hide themselves.
      const typicalLevel = (() => {
        const notionals = levels.map((l) => l.price * l.size).sort((a, b) => a - b)
        return notionals[Math.floor(notionals.length / 4)] ?? 0
      })()
      const candidates = clusters
        .filter((cluster) => {
          const notional = cluster.reduce((sum, l) => sum + l.price * l.size, 0)
          if (notional < WALL_MIN_NOTIONAL) return false
          const peak = Math.max(...cluster.map((l) => l.price * l.size))
          // A wall stands out from the side's own texture: its strongest level must exceed what
          // the book typically rests at each price, and the cluster must hold more than an
          // ordinary background strip of the same width would.
          const peakFloor = Math.max(WALL_MIN_LEVEL_PEAK, 4 * typicalLevel)
          const expectedBackground = 4 * typicalLevel * cluster.length
          return peak >= peakFloor && notional >= expectedBackground
        })
        .map((cluster) => {
          const notional = cluster.reduce((sum, l) => sum + l.price * l.size, 0)
          const weightedPrice = cluster.reduce((sum, l) => sum + l.price * l.price * l.size, 0) /
            (notional || 1)
          return {
            levels: cluster,
            price: weightedPrice,
            notional,
            peak: Math.max(...cluster.map((l) => l.price * l.size)),
            depth: 0,
            persistence: 0,
          }
        })
        .sort((a, b) => b.notional - a.notional)
      const kept: InternalWall[] = []
      for (const candidate of candidates) {
        if (kept.length >= WALL_MAX_PER_SIDE) break
        if (kept.some((wall) => Math.abs(wall.price - candidate.price) <= gap)) continue
        candidate.persistence = this.persistence(candidate.levels, now)
        kept.push(candidate)
      }
      // Depth in front of the wall: liquidity between mid and the cluster's near edge.
      for (const wall of kept) {
        const support = wall.levels[0].price < mid
        const inFront = support
          ? bidLevels.filter((l) => l.price > wall.levels[wall.levels.length - 1].price && l.price < mid)
          : askLevels.filter((l) => l.price < wall.levels[0].price && l.price > mid)
        wall.depth = inFront.reduce((sum, l) => sum + l.price * l.size, 0)
      }
      return kept
    }

    const supports = walls(bidLevels).sort((a, b) => b.notional - a.notional)
    const resistances = walls(askLevels).sort((a, b) => b.notional - a.notional)
    const project = (wall: InternalWall): OrderBookWall => ({
      side: wall.levels[0].price < mid ? 'bid' : 'ask',
      price: wall.price,
      notional: wall.notional,
      depth: wall.depth,
      peak: wall.peak,
      persistence: wall.persistence,
    })

    let bestAsk = Infinity
    for (const level of askLevels) if (level.price < bestAsk) bestAsk = level.price
    const bestBid = bidLevels[bidLevels.length - 1].price

    return {
      product: this.product,
      asOf: Math.floor(now),
      mid,
      spread: bestAsk - bestBid,
      step,
      bottom: b0,
      top: b0 + binCount * step,
      imbalance,
      bidsTotal,
      asksTotal,
      bins,
      supports: supports.map(project),
      resistances: resistances.map(project),
      persistenceSeconds: clamp(now - this.snapshotAt, 0, PERSISTENCE_SECONDS),
    }
  }
}

/** Price range side a zone defends with: bids (support) or asks (resistance). */
export type BookSide = 'bid' | 'ask' | 'both'
export type BookStrengthBucket = 'strong' | 'medium' | 'weak' | 'unloaded'

export interface ZoneBookScore {
  bucket: BookStrengthBucket
  /** USD resting on the relevant side(s) inside the zone's price range. */
  notional: number
  /** Notional-weighted rest persistence of the overlapping liquidity, 0..1. */
  hold: number
  /** Transmitted slices the zone overlaps. */
  bins: number
  /** Detected walls (same side) currently priced inside the range. */
  wallsInside: number
  /** Benchmark used for the bucket: the strongest same-side wall (or largest slice ×1.5). */
  strongRef: number
}

/**
 * Score a price-action zone — SMC order block, fair value gap, or SR box — against the resting
 * book. `top`/`bottom` are the zone's price range (top > bottom).
 *
 * Buckets are explicit and reproducible:
 * - `strong`: as much USD is resting in the zone as at the book's current strongest wall on that
 *   side, and (once persistence has warmed) that size has been resting rather than churning.
 * - `medium`: a meaningful share of the strongest-wall benchmark (or a big fresh stack while the
 *   persistence window is still calibrating).
 * - `weak`: some liquidity is there but well below what the book itself treats as a wall.
 * - `unloaded`: no resting size currently sits inside the zone — it is a price-action level the
 *   book is not defending at this moment.
 */
export function scoreZone(
  book: OrderBookView,
  top: number,
  bottom: number,
  side: BookSide,
): ZoneBookScore {
  const empty: ZoneBookScore = {
    bucket: 'unloaded',
    notional: 0,
    hold: 0,
    bins: 0,
    wallsInside: 0,
    strongRef: 0,
  }
  if (!book || !Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) return empty
  let notional = 0,
    holdNumerator = 0,
    holdDenominator = 0,
    bins = 0
  const half = book.step / 2
  for (const bin of book.bins) {
    // Prorate partial slices so thin zones are not over-credited by a wide bin edge.
    const binTop = bin.price + half,
      binBottom = bin.price - half
    const overlap = Math.min(top, binTop) - Math.max(bottom, binBottom)
    if (overlap <= 0) continue
    const share = Math.min(1, overlap / book.step)
    const value =
      share * (side === 'bid' ? bin.bid : side === 'ask' ? bin.ask : bin.bid + bin.ask)
    if (value > 0) {
      bins++
      notional += value
      holdNumerator += value * bin.hold
      holdDenominator += value
    }
  }
  const walls =
    side === 'ask'
      ? book.resistances
      : side === 'bid'
        ? book.supports
        : [...book.supports, ...book.resistances]
  const wallsInside = walls.filter((wall) => wall.price >= bottom && wall.price <= top)
  const sideWalls = side === 'ask' ? book.resistances : side === 'bid' ? book.supports : walls
  const benchmarkWall = sideWalls.reduce((max, wall) => Math.max(max, wall.notional), 0)
  const maxBin = side === 'bid' ? book.bidsTotal / Math.max(1, book.bins.length) * 2
    : side === 'ask' ? book.asksTotal / Math.max(1, book.bins.length) * 2
    : (book.bidsTotal + book.asksTotal) / Math.max(1, book.bins.length) * 2
  const strongRef = Math.max(benchmarkWall, maxBin)
  if (bins === 0 && wallsInside.length === 0) return { ...empty, strongRef }
  const hold = holdDenominator > 0 ? holdNumerator / holdDenominator : 0
  const warmed = book.persistenceSeconds >= PERSISTENCE_SECONDS
  const rests = !warmed || hold >= 0.4
  let bucket: BookStrengthBucket
  if (strongRef > 0 && notional >= 0.6 * strongRef && rests) bucket = 'strong'
  else if (strongRef > 0 && (notional >= 0.6 * strongRef || (notional >= 0.15 * strongRef && rests)))
    bucket = 'medium'
  else bucket = 'weak'
  return { bucket, notional, hold, bins: bins + wallsInside.length, wallsInside: wallsInside.length, strongRef }
}
