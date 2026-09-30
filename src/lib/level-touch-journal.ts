/**
 * Level-touch journal — does resting order-book size make a level hold?
 *
 * The level-hold backtest (`level-hold.backtest.test.ts`) found that on BTC-USD a tested pivot or
 * SR box holds no more often than a random price. It could not test the order book: Coinbase keeps
 * no level2 history, so the one question left is only answerable live. This journal answers it.
 *
 * Every bar it watches the nearest pivot and SR box on each side of price, plus a random control
 * price on each side, exactly as the backtest picks them. When the forming bar trades through one,
 * it records the resting book inside ±0.25 ATR of that price — as last seen before price got within
 * that band — and later grades the test the backtest's way (`gradeLevelTest`). Splitting the record
 * by book bucket, for levels and random prices alike, shows whether size behind a price matters and
 * whether it matters more at a level.
 */
import type { OrderBookView } from '../../shared/coinbase'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import { scoreZone, type BookStrengthBucket } from '../../shared/order-book'
import {
  gradeLevelTest,
  levelFromSrZone,
  pivotLevels,
  wilderAtr,
  LEVEL_TEST_HORIZON_BARS,
  type LevelSide,
} from './level-strength'
import type { Candle, Timeframe } from './types'

export type TouchKind = 'pivot' | 'sr-zone' | 'random'
/** The book bucket behind the price; `none` when nothing was resting inside the band. */
export type BookRead = Exclude<BookStrengthBucket, 'unloaded'> | 'none'
export type TouchOutcome = 'open' | 'held' | 'broke' | 'expired'

export interface LevelTouchEntry {
  id: string
  product: string
  timeframe: Timeframe
  kind: TouchKind
  side: LevelSide
  price: number
  atr: number
  /** Open time of the bar that traded through the price. */
  barTime: number
  book: BookRead
  /** USD resting inside the band on the defending side. */
  bookNotional: number
  outcome: TouchOutcome
}

export interface LevelTouchJournal {
  version: 1
  entries: LevelTouchEntry[]
}

/** A price being watched on the forming bar. */
export interface LevelWatch {
  key: string
  kind: TouchKind
  side: LevelSide
  price: number
  atr: number
  /** Open time of the bar the watch is for: the bar after the last closed one. */
  barTime: number
}

export interface BookPrice {
  book: BookRead
  notional: number
}

export const LEVEL_TOUCH_JOURNAL_LIMIT = 2000
/** Half-width of the band a price's resting book is read over, in ATR. */
export const TOUCH_BOOK_BAND_ATR = 0.25
const WINDOW = 300

export const emptyLevelTouchJournal = (): LevelTouchJournal => ({ version: 1, entries: [] })

/**
 * The prices to watch on the bar after `closed`: the nearest pivot and SR box on each side, and
 * a random price 0.05–1.5 ATR away on each side. All from closed bars only.
 */
export function levelWatches(closed: Candle[], timeframe: Timeframe): LevelWatch[] {
  if (closed.length < 30) return []
  const window = closed.slice(-WINDOW)
  const atrValue = wilderAtr(window, 14)[window.length - 1]
  if (!atrValue || !Number.isFinite(atrValue) || atrValue <= 0) return []
  const price = window[window.length - 1].close
  const barTime = window[window.length - 1].time + INTERVAL_SECONDS[timeframe]
  const pivots = pivotLevels(window, atrValue, price, timeframe)
  const watches: LevelWatch[] = []
  const add = (kind: TouchKind, side: LevelSide, level: number | undefined) => {
    if (level === undefined || !Number.isFinite(level)) return
    if (side === 'support' ? level >= price : level <= price) return
    watches.push({
      key: `${kind}:${side}:${level}`,
      kind,
      side,
      price: level,
      atr: atrValue,
      barTime,
    })
  }
  add('pivot', 'support', pivots.nearestSupport?.price)
  add('pivot', 'resistance', pivots.nearestResistance?.price)
  add(
    'sr-zone',
    'support',
    levelFromSrZone(window, null, atrValue, price, 'support', timeframe)?.price,
  )
  add(
    'sr-zone',
    'resistance',
    levelFromSrZone(window, null, atrValue, price, 'resistance', timeframe)?.price,
  )
  const offset = (side: LevelSide) => 0.05 + ((hash(`${barTime}:${side}`) % 1000) / 1000) * 1.45
  add('random', 'support', price - offset('support') * atrValue)
  add('random', 'resistance', price + offset('resistance') * atrValue)
  return watches
}

/** The resting book defending a watched price, over ±0.25 ATR around it. */
export function priceWatch(book: OrderBookView, watch: LevelWatch): BookPrice {
  const half = TOUCH_BOOK_BAND_ATR * watch.atr
  const score = scoreZone(
    book,
    watch.price + half,
    watch.price - half,
    watch.side === 'support' ? 'bid' : 'ask',
  )
  return { book: score.bucket === 'unloaded' ? 'none' : score.bucket, notional: score.notional }
}

/** True while price is still more than the book band away from the watched price. */
export function stillApproaching(watch: LevelWatch, price: number): boolean {
  return Math.abs(price - watch.price) > TOUCH_BOOK_BAND_ATR * watch.atr
}

/**
 * Record every watch the forming bar has traded through. `before` holds each watch's book as last
 * seen while price was still approaching; a watch price reached without one is read from `book`.
 * A price with an open test of the same kind is skipped — re-touching it mid-test is the same test.
 */
export function recordTouches(
  journal: LevelTouchJournal,
  params: {
    product: string
    timeframe: Timeframe
    watches: LevelWatch[]
    forming: Candle
    book: OrderBookView
    before: ReadonlyMap<string, BookPrice>
  },
): LevelTouchJournal {
  const { product, timeframe, watches, forming, book, before } = params
  const added: LevelTouchEntry[] = []
  for (const watch of watches) {
    if (forming.time !== watch.barTime) continue
    const touched =
      watch.side === 'support' ? forming.low <= watch.price : forming.high >= watch.price
    if (!touched) continue
    const id = `${product}:${timeframe}:${watch.barTime}:${watch.kind}:${watch.side}`
    const duplicate = journal.entries.some(
      (entry) =>
        entry.id === id ||
        (entry.outcome === 'open' &&
          entry.product === product &&
          entry.timeframe === timeframe &&
          entry.kind === watch.kind &&
          entry.side === watch.side &&
          entry.price === watch.price),
    )
    if (duplicate) continue
    const read = before.get(watch.key) ?? priceWatch(book, watch)
    added.push({
      id,
      product,
      timeframe,
      kind: watch.kind,
      side: watch.side,
      price: watch.price,
      atr: watch.atr,
      barTime: watch.barTime,
      book: read.book,
      bookNotional: read.notional,
      outcome: 'open',
    })
  }
  if (!added.length) return journal
  return { version: 1, entries: [...journal.entries, ...added].slice(-LEVEL_TOUCH_JOURNAL_LIMIT) }
}

/** Grade this chart's open tests against its closed bars. */
export function resolveTouches(
  journal: LevelTouchJournal,
  product: string,
  timeframe: Timeframe,
  closed: Candle[],
): LevelTouchJournal {
  if (!closed.length) return journal
  const index = new Map(closed.map((candle, i) => [candle.time, i]))
  let changed = false
  const entries = journal.entries.map((entry) => {
    if (entry.outcome !== 'open' || entry.product !== product || entry.timeframe !== timeframe)
      return entry
    const at = index.get(entry.barTime)
    if (at === undefined) {
      // History that no longer reaches the touch bar can never grade it.
      if (entry.barTime >= closed[0].time) return entry
      changed = true
      return { ...entry, outcome: 'expired' as const }
    }
    const outcome = gradeLevelTest(closed, at, entry.price, entry.side, entry.atr)
    if (outcome) {
      changed = true
      return { ...entry, outcome }
    }
    if (closed.length - at >= LEVEL_TEST_HORIZON_BARS) {
      changed = true
      return { ...entry, outcome: 'expired' as const }
    }
    return entry
  })
  return changed ? { version: 1, entries } : journal
}

export interface TouchTally {
  held: number
  tests: number
}

export interface LevelTouchStats {
  rows: { book: BookRead; levels: TouchTally; random: TouchTally }[]
  levels: TouchTally
  random: TouchTally
  open: number
}

export const BOOK_READS: BookRead[] = ['strong', 'medium', 'weak', 'none']

/** Held / graded tests on one chart, split by book bucket and by level versus random price. */
export function levelTouchStats(
  journal: LevelTouchJournal,
  product: string,
  timeframe: Timeframe,
): LevelTouchStats {
  const tally = (): TouchTally => ({ held: 0, tests: 0 })
  const rows = BOOK_READS.map((book) => ({ book, levels: tally(), random: tally() }))
  const levels = tally()
  const random = tally()
  let open = 0
  for (const entry of journal.entries) {
    if (entry.product !== product || entry.timeframe !== timeframe) continue
    if (entry.outcome === 'open') open++
    if (entry.outcome !== 'held' && entry.outcome !== 'broke') continue
    const row = rows.find((candidate) => candidate.book === entry.book)
    const group = entry.kind === 'random' ? 'random' : 'levels'
    for (const target of [row?.[group], group === 'random' ? random : levels]) {
      if (!target) continue
      target.tests++
      if (entry.outcome === 'held') target.held++
    }
  }
  return { rows, levels, random, open }
}

const KINDS: readonly TouchKind[] = ['pivot', 'sr-zone', 'random']
const SIDES: readonly LevelSide[] = ['support', 'resistance']
const OUTCOMES: readonly TouchOutcome[] = ['open', 'held', 'broke', 'expired']

/** Keep only well-formed entries from storage; anything else starts the journal fresh. */
export function sanitizeLevelTouchJournal(value: unknown): LevelTouchJournal {
  if (!value || typeof value !== 'object' || !Array.isArray((value as LevelTouchJournal).entries))
    return emptyLevelTouchJournal()
  const entries = (value as LevelTouchJournal).entries.filter(
    (entry): entry is LevelTouchEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.product === 'string' &&
      typeof entry.timeframe === 'string' &&
      entry.timeframe in INTERVAL_SECONDS &&
      KINDS.includes(entry.kind) &&
      SIDES.includes(entry.side) &&
      BOOK_READS.includes(entry.book) &&
      OUTCOMES.includes(entry.outcome) &&
      [entry.price, entry.atr, entry.barTime, entry.bookNotional].every(Number.isFinite),
  )
  return { version: 1, entries: entries.slice(-LEVEL_TOUCH_JOURNAL_LIMIT) }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
