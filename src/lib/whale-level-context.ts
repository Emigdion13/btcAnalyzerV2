/**
 * Level & book-wall context for a live whale sweep — the "where is this money going" half.
 *
 * ## Why this exists
 *
 * `shared/whale-flow.ts` measures executed money honestly: a sweep is size, direction and fills.
 * It cannot say whether that money is *working*, because it never looks at where price is. The
 * same $500K of taker buying means three different things depending on what sits in front of it:
 *
 * - pressing off a **defended level** — resting size behind the push gives it somewhere to go;
 * - **through a level** whose resting liquidity has just been eaten — absorption failed;
 * - **into a level the book is still defending** — the sweep is being faded. This is the single
 *   most common false positive a size-only detector produces.
 *
 * `whaleLevelContext()` classifies a sweep against the nearest obstacle in its path and the
 * nearest one behind it, where an obstacle is either a confirmed price-action level
 * (`LevelStrengthSummary`, i.e. SR zones and pivots) priced against the resting book inside its
 * band (`scoreZone`), or a level2 **wall** the book itself is showing (`OrderBookView.supports` /
 * `.resistances`) — whichever price sits closer to the sweep. It returns a strength multiplier, an
 * optional flip of the vote, and the plain-language lines the whale agent should say.
 *
 * It is the port of the heaviest-weighted events in the ROBEX comparison —
 * `reboteSoporte` / `rompeResistencia` / `rechazoResistencia`, each worth +3 there, see
 * [`docs/whale-flow-vs-robex.md`](../../docs/whale-flow-vs-robex.md) §4.1 and
 * [`docs/whale-level-context.md`](../../docs/whale-level-context.md) for the shipped rules — with
 * one deliberate difference: the verdict is a graded multiplier on a learnable agent, never a
 * hard-coded tally.
 *
 * ## What it cannot do
 *
 * Resting size is not a commitment: a wall can be pulled in the time it takes to read this, the
 * book is one venue (Coinbase), it is refreshed at 1 Hz against a 5 s sweep, and it shows only
 * visible size. So "absorbed" means *this book is currently resting more size in the path than
 * the sweep brought*, not *the sweep will fail*. For the same reason a vote is only ever flipped
 * **against executed money** when resting size of at least half the sweep backs the claim — a
 * price-action level on its own damps the read, it never reverses it. Nothing here is a trade
 * signal or investment advice.
 */

import { PERSISTENCE_SECONDS, scoreZone, type BookStrengthBucket } from '../../shared/order-book'
import type { OrderBookView, OrderBookWall, WhaleFlow } from '../../shared/coinbase'
import { formatNotional } from '../../shared/whale-flow'
import type { LevelReference, LevelStrengthSummary } from './market-agents'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
/** USD without the leading `+`: these are magnitudes, not signed flows. */
const usd = (value: number) => formatNotional(value).replace('+', '')

/**
 * How close an obstacle has to be, in ATR, to be part of the sweep's story. Beyond this the sweep
 * is trading in open space and the raw tape read stands untouched.
 */
export const WHALE_LEVEL_REACH_ATR = 1
/**
 * Absorption at or above this flips the whale vote against the tape — provided the resting size
 * also clears {@link WHALE_FLIP_WALL_RATIO}. Below it the same situation only damps the vote,
 * because arguing against executed money needs more than a line on a chart.
 */
export const WHALE_ABSORPTION_FLIP = 0.75
/** Resting size in the path, as a share of the sweep, required before a vote may be flipped. */
export const WHALE_FLIP_WALL_RATIO = 0.5
/** Resting size behind the sweep, as a share of it, required before the push earns a boost. */
export const WHALE_DEFENSE_WALL_RATIO = 0.25

/**
 * What the context concluded about the sweep.
 *
 * `break`    the sweep traded through the obstacle ahead and less size is left than it brought
 * `absorbed` the sweep is pressing into an obstacle ahead that is holding — damp, and flip if the
 *            resting size decisively outweighs it
 * `defended` the obstacle behind the sweep is being defended by resting size — the push has a floor
 * `clear`    nothing within {@link WHALE_LEVEL_REACH_ATR} ATR — the raw read stands
 */
export type WhaleLevelVerdict = 'break' | 'absorbed' | 'defended' | 'clear'

/** The chart-and-book frame a sweep is judged against; all of it already exists in `analyzeMarket`. */
export interface WhaleLevelFrame {
  /** Price the levels were measured against (the last candle close). */
  price: number
  /** ATR(14) in price units, so distances and bands can be spoken in ATR. */
  atr: number
  /** Nearest confirmed support/resistance, as the level-strength specialist pinned them. */
  levels: LevelStrengthSummary | null
  /** Live resting book, when the product has one. Absent means no wall evidence at all. */
  book?: OrderBookView | null
}

export interface WhaleLevelContext {
  verdict: WhaleLevelVerdict
  /**
   * Multiplier on the sweep's raw strength, in [0.2, 1.24]: above 1 boosts a push the level
   * context supports, below 1 cuts one the level is fading, 1 leaves the tape read alone.
   */
  multiplier: number
  /** True when the vote should be cast *against* the direction of the executed money. */
  flip: boolean
  /** 0..1: how decisively the obstacle ahead is absorbing the sweep. */
  absorption: number
  /** Signed adjustment to the agent's confidence, in [-0.16, +0.1]. */
  confidence: number
  /** Plain-language reason line, or null when the context has nothing to add. */
  reason: string | null
  /** Plain-language cautions, most decision-relevant first; empty when there is nothing to add. */
  warnings: string[]
  /** The numbers behind the verdict, for the agent's metrics readout. */
  metrics: Record<string, number | string | boolean | null>
}

/** Something standing in the sweep's way, or behind it: a price-action level, a book wall, or both. */
interface Obstacle {
  role: 'support' | 'resistance'
  /** What it is made of: a confirmed level, a detected resting wall, or the two at one price. */
  source: 'sr-zone' | 'pivot' | 'book-wall'
  fromLevel: boolean
  fromWall: boolean
  price: number
  top: number
  bottom: number
  /** Distance from price in ATR, never negative. */
  distanceAtr: number
  /** Price-action strength of the level, 0 when only the book sees the obstacle. */
  strength: number
  touches: number
  /** Resting USD on the defending side at this obstacle. */
  wallNotional: number
  /** Notional-weighted rest persistence of that size, 0..1. */
  wallHold: number
  /** Detected book walls counted in `wallNotional`. */
  walls: number
  bucket: BookStrengthBucket | null
  /** Share of the obstacle the sweep's own fills already traded through, 0..1. */
  penetration: number
}

const BUCKET_WEIGHT: Record<BookStrengthBucket, number> = {
  strong: 1,
  medium: 0.7,
  weak: 0.35,
  unloaded: 0,
}
const bucketWeight = (bucket: BookStrengthBucket | null) =>
  bucket === null ? 0 : (BUCKET_WEIGHT[bucket] ?? 0)
const sideWord = (role: 'support' | 'resistance') => (role === 'resistance' ? 'asks' : 'bids')
const aboveBelow = (role: 'support' | 'resistance') => (role === 'resistance' ? 'above' : 'below')
const inReach = (obstacle: Obstacle | null) =>
  obstacle !== null && obstacle.distanceAtr <= WHALE_LEVEL_REACH_ATR

/**
 * The furthest price the sweep's own fills reached in its direction.
 *
 * Only the sweep's own side counts — the counter-flow prints inside the same window are the other
 * party's business, not this push's reach. The tracker carries only the largest prints, so this is
 * a conservative bound: it can understate how far the sweep walked, never overstate it. With no
 * prints on the sweep's side it falls back to the frame price.
 */
function sweepReach(flow: WhaleFlow, direction: 1 | -1, fallback: number): number {
  const side = direction > 0 ? 'buy' : 'sell'
  const prices = flow.prints
    .filter(
      (print) =>
        print.side === side && Number.isFinite(print.price) && print.price > 0 && print.size > 0,
    )
    .map((print) => print.price)
  if (!prices.length) return fallback
  return direction > 0 ? Math.max(...prices) : Math.min(...prices)
}

/** How far into an obstacle's band the sweep traded, 0 (not reached) .. 1 (traded through). */
function penetrationOf(
  role: 'support' | 'resistance',
  top: number,
  bottom: number,
  reach: number,
  atr: number,
): number {
  // A pivot band is 0.25 ATR of tolerance either side; an SR zone can be razor thin and a book
  // wall has no band at all. Floor the band so a one-tick obstacle cannot read as penetrated.
  const band = Math.max(top - bottom, atr * 0.05, 1e-9)
  return role === 'resistance'
    ? clamp((reach - bottom) / band, 0, 1)
    : clamp((top - reach) / band, 0, 1)
}

/** A confirmed price-action level, priced against whatever the book rests inside its band. */
function levelObstacle(
  level: LevelReference,
  role: 'support' | 'resistance',
  book: OrderBookView | null,
  reach: number,
  atr: number,
): Obstacle {
  const top = Math.max(level.top, level.bottom)
  const bottom = Math.min(level.top, level.bottom)
  const zone = book ? scoreZone(book, top, bottom, role === 'resistance' ? 'ask' : 'bid') : null
  // A detected wall resting at this level is the same obstacle: fold it in rather than let the
  // nearer-of-two rule pick between a chart line and the size sitting on it.
  const pad = Math.max(atr * 0.35, (top - bottom) / 2)
  const inside = book
    ? (role === 'resistance' ? book.resistances : book.supports).filter(
        (wall) => wall.price >= bottom - pad && wall.price <= top + pad,
      )
    : []
  const wall = inside.sort((a, b) => b.notional - a.notional)[0]
  return {
    role,
    source: level.source,
    fromLevel: true,
    fromWall: inside.length > 0,
    price: level.price,
    top,
    bottom,
    distanceAtr: Number.isFinite(level.distanceAtr) ? Math.max(0, level.distanceAtr) : 0,
    strength: clamp(level.strength, 0, 1),
    touches: level.touches,
    wallNotional: Math.max(zone ? zone.notional : (level.bookNotional ?? 0), wall?.notional ?? 0),
    wallHold: Math.max(zone ? zone.hold : 0, wall?.persistence ?? 0),
    walls: zone ? Math.max(zone.wallsInside, inside.length) : inside.length,
    bucket: wall ? 'strong' : zone ? zone.bucket : (level.bookBucket ?? null),
    penetration: penetrationOf(role, top, bottom, reach, atr),
  }
}

/** A wall the book is showing, with no price-action level at that price. */
function wallObstacle(
  wall: OrderBookWall,
  role: 'support' | 'resistance',
  price: number,
  reach: number,
  atr: number,
): Obstacle {
  // The cluster's own width is not transmitted, so a wall gets a tight 0.1 ATR band: enough that
  // a fill one tick past it is not "through", small enough that walking it registers.
  const half = atr * 0.05
  const top = wall.price + half
  const bottom = wall.price - half
  return {
    role,
    source: 'book-wall',
    fromLevel: false,
    fromWall: true,
    price: wall.price,
    top,
    bottom,
    distanceAtr: Math.abs(wall.price - price) / Math.max(atr, 1e-9),
    // A detected wall already cleared the book's own notability floors, so it reads as strong
    // resting size without needing a zone bucket to say so.
    strength: 0,
    touches: 0,
    wallNotional: wall.notional,
    wallHold: wall.persistence,
    walls: 1,
    bucket: 'strong',
    penetration: penetrationOf(role, top, bottom, reach, atr),
  }
}

/** The nearest wall on one side of price, when the book shows one. */
function nearestWall(
  book: OrderBookView | null,
  role: 'support' | 'resistance',
  price: number,
): OrderBookWall | null {
  if (!book) return null
  const walls = role === 'resistance' ? book.resistances : book.supports
  const ahead = walls.filter((wall) =>
    role === 'resistance' ? wall.price > price : wall.price < price,
  )
  return ahead.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0] ?? null
}

function closerObstacle(a: Obstacle | null, b: Obstacle | null): Obstacle | null {
  if (!a) return b
  if (!b) return a
  return a.distanceAtr <= b.distanceAtr ? a : b
}

/**
 * The obstacle on one side of price: a confirmed level, a resting wall, or the two merged —
 * whichever sits closest to the sweep. `null` when neither exists at all; an obstacle further
 * than {@link WHALE_LEVEL_REACH_ATR} is still returned, so the agent can say how far off it is.
 */
function obstacleOn(
  role: 'support' | 'resistance',
  level: LevelReference | null,
  book: OrderBookView | null,
  price: number,
  reach: number,
  atr: number,
): Obstacle | null {
  const fromLevel = level ? levelObstacle(level, role, book, reach, atr) : null
  const wall = nearestWall(book, role, price)
  const fromWall = wall ? wallObstacle(wall, role, price, reach, atr) : null
  // A level and a wall at the same price are one obstacle; `levelObstacle` already folded that
  // case in, so drop the duplicate wall rather than let it win on distance alone.
  const separate =
    fromWall &&
    fromLevel &&
    Math.abs(fromWall.price - fromLevel.price) <= Math.max(atr * 0.35, 1e-9)
      ? null
      : fromWall
  return closerObstacle(fromLevel, separate)
}

/**
 * The obstacle in words: `resistance at 102.40 (0.34 ATR above, strength 0.77, 20 touches)` for a
 * chart level, `a $1.5M bid wall 0.54 ATR below price` for one only the book can see.
 */
function describeObstacle(obstacle: Obstacle): string {
  const where = `${obstacle.distanceAtr.toFixed(2)} ATR ${aboveBelow(obstacle.role)}`
  if (!obstacle.fromLevel)
    return `a ${usd(obstacle.wallNotional)} ${sideWord(obstacle.role).replace(/s$/, '')} wall ${where} price`
  const detail = [
    where,
    obstacle.strength > 0 ? `strength ${obstacle.strength.toFixed(2)}` : '',
    obstacle.touches > 0 ? `${obstacle.touches} touches` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return `${obstacle.role} at ${obstacle.price.toFixed(2)} (${detail})`
}

/** How much of the sweep's own size is resting at the obstacle, in words. */
function ratioClause(obstacle: Obstacle, absNet: number): string {
  const ratio = obstacle.wallNotional / Math.max(absNet, 1)
  if (ratio >= 1.5) return 'several times the size of the sweep'
  if (ratio >= 1) return 'more size than the sweep brought'
  if (ratio >= WHALE_FLIP_WALL_RATIO) return 'about half the size of the sweep'
  if (ratio >= WHALE_DEFENSE_WALL_RATIO) return 'a fraction of the sweep, but not a trivial one'
  return 'dust next to the sweep'
}

/** What the resting book says about the obstacle, in one clause. */
function describeWall(obstacle: Obstacle, hasBook: boolean, warmed: boolean, absNet: number) {
  if (!hasBook) return 'the resting book is unavailable, so no wall can confirm or deny it'
  if (obstacle.wallNotional <= 0)
    return `the book shows no resting ${sideWord(obstacle.role)} there`
  const held = `${obstacle.fromLevel ? 'held' : 'it has held'} ${Math.round(obstacle.wallHold * 100)}% of the ${PERSISTENCE_SECONDS}s persistence window`
  const hold = !warmed
    ? 'persistence is still warming'
    : obstacle.wallHold >= 0.4
      ? held
      : `churning (${Math.round(obstacle.wallHold * 100)}% persistence)`
  const size = obstacle.fromLevel
    ? `${usd(obstacle.wallNotional)} of resting ${sideWord(obstacle.role)} sits in the zone, ${hold}`
    : hold
  return `${size} — ${ratioClause(obstacle, absNet)}`
}

/** Resting size at the obstacle as a share of the sweep's own size. */
const wallRatioOf = (obstacle: Obstacle, absNet: number) =>
  obstacle.wallNotional / Math.max(absNet, 1)

/**
 * Whether the book is actually defending this obstacle: real resting size — a detected wall, or a
 * strong/medium zone — of at least a quarter of the sweep. Buckets are relative to the book's own
 * texture, so on their own they can call a few thousand dollars "strong"; the ratio gate is what
 * keeps that from reading as a defense.
 */
function isDefended(obstacle: Obstacle, absNet: number): boolean {
  return (
    wallRatioOf(obstacle, absNet) >= WHALE_DEFENSE_WALL_RATIO &&
    (obstacle.fromWall || obstacle.bucket === 'strong' || obstacle.bucket === 'medium')
  )
}

function metricsFor(
  verdict: WhaleLevelVerdict,
  obstacle: Obstacle | null,
  values: { multiplier: number; flip: boolean; absorption: number; hasBook: boolean },
): Record<string, number | string | boolean | null> {
  return {
    levelVerdict: verdict,
    levelRole: obstacle?.role ?? null,
    levelSource: obstacle?.source ?? null,
    levelPrice: obstacle ? Number(obstacle.price.toFixed(6)) : null,
    levelDistanceAtr: obstacle ? Number(obstacle.distanceAtr.toFixed(3)) : null,
    levelWallNotional: obstacle ? Math.round(obstacle.wallNotional) : null,
    levelBucket: obstacle?.bucket ?? null,
    levelWalls: obstacle ? obstacle.walls : null,
    levelPenetration: obstacle ? Number(obstacle.penetration.toFixed(3)) : null,
    levelAbsorption: Number(values.absorption.toFixed(3)),
    levelMultiplier: Number(values.multiplier.toFixed(3)),
    levelFlip: values.flip,
    levelBook: values.hasBook,
  }
}

/**
 * Judge a live whale sweep against what stands in its path and what sits behind it.
 *
 * Order of judgement matters: the obstacle *ahead* of the push is the one the money has to get
 * through, so it is read first (break or absorbed); only when the path ahead is open does the
 * obstacle *behind* the push — a defended floor under a buy sweep, a defended ceiling over a sell
 * one — earn its boost.
 */
export function whaleLevelContext(flow: WhaleFlow, frame: WhaleLevelFrame): WhaleLevelContext {
  const direction: 1 | -1 | 0 = flow.net > 0 ? 1 : flow.net < 0 ? -1 : 0
  const book = frame?.book ?? null
  const hasBook = book !== null
  const clear = (obstacle: Obstacle | null, reason: string | null): WhaleLevelContext => ({
    verdict: 'clear',
    multiplier: 1,
    flip: false,
    absorption: 0,
    confidence: 0,
    reason,
    warnings: [],
    metrics: metricsFor('clear', obstacle, {
      multiplier: 1,
      flip: false,
      absorption: 0,
      hasBook,
    }),
  })
  // A flat net has no direction to judge, and without a usable ATR nothing can be measured in the
  // units every rule here is written in.
  const usable =
    direction !== 0 && Number.isFinite(frame?.price) && Number.isFinite(frame?.atr) && frame.atr > 0
  if (!usable) return clear(null, null)

  const levels = frame.levels ?? null
  const absNet = Math.abs(flow.net)
  const warmed = hasBook && book.persistenceSeconds >= PERSISTENCE_SECONDS
  const reach = sweepReach(flow, direction as 1 | -1, frame.price)
  const sweepWord = direction > 0 ? 'buy sweep' : 'sell sweep'
  const aheadRole: 'support' | 'resistance' = direction > 0 ? 'resistance' : 'support'
  const behindRole: 'support' | 'resistance' = direction > 0 ? 'support' : 'resistance'

  const aheadPath = obstacleOn(
    aheadRole,
    direction > 0 ? (levels?.nearestResistance ?? null) : (levels?.nearestSupport ?? null),
    book,
    frame.price,
    reach,
    frame.atr,
  )
  const behindPath = obstacleOn(
    behindRole,
    direction > 0 ? (levels?.nearestSupport ?? null) : (levels?.nearestResistance ?? null),
    book,
    frame.price,
    reach,
    frame.atr,
  )
  const ahead = inReach(aheadPath) ? aheadPath : null
  const behind = inReach(behindPath) ? behindPath : null

  // --- The obstacle ahead: did the money get through it, or is it being eaten? ----------------
  if (ahead) {
    // The sweep traded the whole band and less size is left there than the sweep brought:
    // absorption failed, the level is breaking under the push.
    if (ahead.penetration >= 1 && ahead.wallNotional < absNet) {
      const multiplier = 1.24
      return {
        verdict: 'break',
        multiplier,
        flip: false,
        absorption: 0,
        confidence: 0.1,
        reason: `The ${sweepWord} traded through ${describeObstacle(ahead)}: ${describeWall(ahead, hasBook, warmed, absNet)}. The level is failing under the push, so continuation carries extra weight.`,
        warnings: [
          'A level one sweep trades through is not a level cleared — watch whether price holds the other side of it.',
        ],
        metrics: metricsFor('break', ahead, {
          multiplier,
          flip: false,
          absorption: 0,
          hasBook,
        }),
      }
    }

    // Otherwise the sweep is pressing into something that is still in front of it.
    const wallRatio = wallRatioOf(ahead, absNet)
    // Zone buckets and holds are scale-free: they say "this book rests more here than elsewhere",
    // not "enough here to stop this sweep". Both terms are gated on the size being material
    // against the sweep itself, so a few thousand dollars of dust can never read as a defense.
    const material = clamp(wallRatio / WHALE_FLIP_WALL_RATIO, 0, 1)
    const holdRead = !hasBook ? 0 : warmed ? clamp(ahead.wallHold, 0, 1) : 0.5
    const absorption = clamp(
      0.26 * clamp(1.25 - ahead.distanceAtr, 0, 1) +
        (0.3 * clamp(wallRatio, 0, 2)) / 2 +
        0.14 * bucketWeight(ahead.bucket) * material +
        0.14 * holdRead * material +
        // A detected wall is conviction in its own right; a chart level contributes its own.
        0.16 * clamp(Math.max(ahead.strength, ahead.fromWall ? 0.85 : 0), 0, 1) -
        0.2 * ahead.penetration,
      0,
      1,
    )
    // Flipping against executed money needs resting size behind the claim, never a chart line alone.
    const flip = absorption >= WHALE_ABSORPTION_FLIP && wallRatio >= WHALE_FLIP_WALL_RATIO
    const multiplier = flip ? 0.45 : clamp(1 - 0.8 * absorption, 0.2, 1)
    const confidence = flip ? -0.08 : -(0.03 + 0.13 * absorption)
    const pressed = `The ${sweepWord} is pressing into ${describeObstacle(ahead)}: ${describeWall(ahead, hasBook, warmed, absNet)}.`
    const warnings = flip
      ? [
          `The whale vote is cast against ${usd(absNet)} of executed ${direction > 0 ? 'buying' : 'selling'} on resting-book evidence alone — that size can be pulled in seconds.`,
        ]
      : [
          `${pressed} The push is being met, not accepted, so the vote is cut to ${Math.round(multiplier * 100)}% of its raw strength.`,
        ]
    // A defended level behind the push is worth saying out loud even when the level ahead wins:
    // it is why a damp stays a damp instead of becoming a fade.
    if (!flip && behind && isDefended(behind, absNet))
      warnings.push(
        `The level behind the push is defended too — ${behind.fromLevel ? `${describeObstacle(behind)} with ${usd(behind.wallNotional)} of resting ${sideWord(behind.role)}` : describeObstacle(behind)} — so the caution above is a cut, not a reversal.`,
      )
    return {
      verdict: 'absorbed',
      multiplier,
      flip,
      absorption,
      confidence,
      reason: flip
        ? `${pressed} That is enough resting size to fade the push, so this vote reads the level rather than the tape and turns ${direction > 0 ? 'bearish' : 'bullish'}.`
        : null,
      warnings,
      metrics: metricsFor('absorbed', ahead, { multiplier, flip, absorption, hasBook }),
    }
  }

  // --- The obstacle behind: is the push pressing off something the book is defending? ----------
  if (behind && isDefended(behind, absNet)) {
    const defense = clamp(
      0.45 * bucketWeight(behind.bucket) +
        (0.3 * clamp(wallRatioOf(behind, absNet), 0, 2)) / 2 +
        0.25 * (warmed ? clamp(behind.wallHold, 0, 1) : hasBook ? 0.5 : 0),
      0,
      1,
    )
    const multiplier = clamp(1.08 + 0.16 * defense, 1, 1.24)
    return {
      verdict: 'defended',
      multiplier,
      flip: false,
      absorption: 0,
      confidence: 0.06,
      reason: `The ${sweepWord} is pressing off ${describeObstacle(behind)}: ${describeWall(behind, hasBook, warmed, absNet)}. Size is defending the level behind the push, so it earns extra weight.`,
      warnings: [],
      metrics: metricsFor('defended', behind, {
        multiplier,
        flip: false,
        absorption: 0,
        hasBook,
      }),
    }
  }

  // --- Open space: nothing nearby to argue with the tape. --------------------------------------
  const nearest = closerObstacle(aheadPath, behindPath)
  return clear(
    nearest,
    nearest
      ? `Nothing confirmed within ${WHALE_LEVEL_REACH_ATR} ATR of the sweep — the nearest obstacle is ${describeObstacle(nearest)}, so the raw tape read stands on its own.`
      : `No confirmed level or resting wall within ${WHALE_LEVEL_REACH_ATR} ATR to judge the sweep against — the raw tape read stands on its own.`,
  )
}
