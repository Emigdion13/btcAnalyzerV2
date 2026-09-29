import { INTERVAL_SECONDS, type DataSource } from '../../shared/coinbase'
import type { ChileKalshiMarket } from './chile-kalshi'
import { chileKalshiStrike, type ChileKalshiBoundaries } from './chile-odds'
import { wilderRsi, type ChileReversalResult } from './chile-reversal'
import { chileFinishedRounds } from './chile-scorecard'
import type { Candle, Timeframe } from './types'

/**
 * Chile RSI extremes — the one indicator reading that measured as more than noise.
 *
 * A study of every indicator Atlas ships (38 readings, 180 days of Coinbase BTC-USD 5m) found none
 * that calls the next 15-minute round better than a coin flip: the trend and momentum readings were
 * all slightly *wrong* (47–49%), because a 15-minute BTC round mildly reverts the move before it.
 * The exception was that reversion at its sharpest. When the 5m RSI(14) closes below 30 at a
 * round's open the round finished up, and above 70 it finished down:
 *
 * | Tape                                        | Rounds | Right            |
 * | ------------------------------------------- | ------ | ---------------- |
 * | Coinbase, April–mid July 2026               | 785    | 58.5%            |
 * | Coinbase, mid July–September 2026           | 541    | 58.4%            |
 * | Kalshi settlement, April–September 2026     | 1,292  | 56.6% ±2.7       |
 *
 * — between 54.6% and 61.4% in every month. On Kalshi the first-minute ask for the signal's side
 * averaged 52.3%, so the market prices a little of it. After the taker fee that left about +2.7¢
 * per contract with a 95% range of roughly 0 to +5¢: promising, not proven — and the reading was
 * picked out of 38 on those same months. Only a live record can settle it, so the panel keeps one:
 * every signal graded, with the fee-inclusive price Kalshi charged for its side in the first
 * minutes of the round, when the window was open to see it.
 *
 * It is measured on 15-minute rounds only, and read off the 5m RSI whatever the chart timeframe —
 * the same 5m series the V17 momentum read uses.
 */

export const CHILE_RSI_EXTREME_TIMEFRAME: Timeframe = '5m'
export const CHILE_RSI_EXTREME_LENGTH = 14
export const CHILE_RSI_EXTREME_LOW = 30
export const CHILE_RSI_EXTREME_HIGH = 70
/** The only round length the signal was measured on. */
export const CHILE_RSI_EXTREME_RESOLUTION: Timeframe = '15m'
/**
 * The price is taken between one and two minutes into the round: the study compared the signal with
 * Kalshi's quote at the end of the first minute, and the first seconds of a window trade thin.
 */
export const CHILE_RSI_PRICE_FROM_SECONDS = 60
export const CHILE_RSI_PRICE_UNTIL_SECONDS = 120

export type ChileRsiSide = 'up' | 'down'

/** The 5m RSI at one round's open, and the side it calls when it is extreme. */
export interface ChileRsiRound {
  roundStart: number
  rsi: number
  side: ChileRsiSide | null
}

/**
 * The RSI reading at every round open in a 5m tape: the RSI(14) of the 5m bar that closes as the
 * round opens. A bar still forming at `nowSeconds` is not read — its RSI would move. Empty for any
 * round length other than the one the signal was measured on.
 */
export function chileRsiRounds(
  candles5m: readonly Candle[],
  resolution: Timeframe,
  nowSeconds?: number,
): ReadonlyMap<number, ChileRsiRound> {
  const rounds = new Map<number, ChileRsiRound>()
  if (resolution !== CHILE_RSI_EXTREME_RESOLUTION || !candles5m.length) return rounds
  const step = INTERVAL_SECONDS[CHILE_RSI_EXTREME_TIMEFRAME]
  const roundSeconds = INTERVAL_SECONDS[resolution]
  const rsi = wilderRsi(
    candles5m.map((candle) => candle.close),
    CHILE_RSI_EXTREME_LENGTH,
  )
  candles5m.forEach((candle, i) => {
    const end = candle.time + step
    if (end % roundSeconds !== 0) return
    if (nowSeconds !== undefined && end > nowSeconds) return
    const value = rsi[i]
    if (value === null || value === undefined) return
    rounds.set(end, {
      roundStart: end,
      rsi: value,
      side: value < CHILE_RSI_EXTREME_LOW ? 'up' : value > CHILE_RSI_EXTREME_HIGH ? 'down' : null,
    })
  })
  return rounds
}

export interface ChileRsiEntry {
  roundStart: number
  side: ChileRsiSide
  rsi: number
  /** The graded round's strike and settlement. */
  open: number
  close: number
  outcome: 'up' | 'down' | 'flat'
  /** Kalshi's published strike and settlement, or the round's own Coinbase open → close. */
  settledBy: 'kalshi' | 'coinbase'
}

/**
 * Every extreme reading whose round has finished, graded. Kalshi's published result wins where it
 * exists (a tie resolves up, as Kalshi's does) — it is the one the recorded price was paid against;
 * otherwise the round's open → close from the engine's own bars.
 */
export function gradeChileRsiExtremes(
  result: ChileReversalResult,
  chartTimeframe: Timeframe,
  resolution: Timeframe,
  rounds: ReadonlyMap<number, ChileRsiRound>,
  kalshi?: ChileKalshiBoundaries | null,
): ChileRsiEntry[] {
  const finished = chileFinishedRounds(result, chartTimeframe, resolution)
  const roundSeconds = INTERVAL_SECONDS[resolution] ?? 900
  const graded: ChileRsiEntry[] = []
  for (const round of rounds.values()) {
    if (!round.side) continue
    const strike = chileKalshiStrike(kalshi, round.roundStart, roundSeconds)
    const settlement = kalshi?.get(round.roundStart + roundSeconds)
    if (strike !== null && settlement !== undefined) {
      graded.push({
        roundStart: round.roundStart,
        side: round.side,
        rsi: round.rsi,
        open: strike,
        close: settlement,
        outcome: settlement >= strike ? 'up' : 'down',
        settledBy: 'kalshi',
      })
      continue
    }
    const coinbase = finished?.(round.roundStart)
    if (!coinbase) continue
    graded.push({
      roundStart: round.roundStart,
      side: round.side,
      rsi: round.rsi,
      open: coinbase.open,
      close: coinbase.close,
      outcome:
        coinbase.close > coinbase.open ? 'up' : coinbase.close < coinbase.open ? 'down' : 'flat',
      settledBy: 'coinbase',
    })
  }
  return graded.sort((a, b) => a.roundStart - b.roundStart)
}

/**
 * The fee-inclusive price to record for the running round's signal, or null when there is nothing
 * to record: no extreme reading, no live Kalshi quote for this very round, or a moment outside the
 * one-to-two-minute window the study priced at.
 */
export function chileRsiCostToRecord(
  signal: ChileRsiRound | undefined,
  market: ChileKalshiMarket | null | undefined,
  nowSeconds: number,
): number | null {
  if (!signal?.side || !market || market.stale || market.open !== signal.roundStart) return null
  const into = nowSeconds - signal.roundStart
  if (into < CHILE_RSI_PRICE_FROM_SECONDS || into > CHILE_RSI_PRICE_UNTIL_SECONDS) return null
  const cost = signal.side === 'up' ? market.upCost : market.downCost
  return cost !== null && cost > 0 && cost < 1.1 ? cost : null
}

export interface ChileRsiStats {
  /** Graded signals on a round that did not finish flat. */
  scored: number
  correct: number
  hitRate: number | null
  margin: number | null
  up: { scored: number; correct: number }
  down: { scored: number; correct: number }
  /** Scored signals with a recorded Kalshi price. */
  priced: number
  pricedCorrect: number
  /** Mean fee-inclusive price paid per $1 of payout, over the priced signals. */
  averageCost: number | null
  /** Mean of (won − price) over the priced signals: what $1 of payout returned, fee included. */
  edge: number | null
  /** 95% half-width of `edge`. */
  edgeMargin: number | null
}

const margin95 = (p: number, n: number) => 1.96 * Math.sqrt((p * (1 - p)) / n)

export function chileRsiStats(
  entries: readonly ChileRsiEntry[],
  costs: Readonly<Record<string, number>> = {},
): ChileRsiStats {
  const up = { scored: 0, correct: 0 }
  const down = { scored: 0, correct: 0 }
  let priced = 0
  let pricedCorrect = 0
  let costSum = 0
  for (const entry of entries) {
    if (entry.outcome === 'flat') continue
    const side = entry.side === 'up' ? up : down
    const won = entry.outcome === entry.side
    side.scored++
    if (won) side.correct++
    const cost = costs[String(entry.roundStart)]
    if (cost !== undefined) {
      priced++
      costSum += cost
      if (won) pricedCorrect++
    }
  }
  const scored = up.scored + down.scored
  const correct = up.correct + down.correct
  const hitRate = scored ? correct / scored : null
  const pricedRate = priced ? pricedCorrect / priced : null
  return {
    scored,
    correct,
    hitRate,
    margin: hitRate === null ? null : margin95(hitRate, scored),
    up,
    down,
    priced,
    pricedCorrect,
    averageCost: priced ? costSum / priced : null,
    edge: pricedRate === null ? null : pricedRate - costSum / priced,
    edgeMargin: pricedRate === null ? null : margin95(pricedRate, priced),
  }
}

// --- the saved journal ------------------------------------------------------------------------

/** Graded signals kept per market: at about seven a day, a couple of months. */
export const CHILE_RSI_JOURNAL_MAX_ENTRIES = 500
/** Markets kept at once; the least recently updated is dropped first. */
export const CHILE_RSI_JOURNAL_MAX_MARKETS = 12

export interface ChileRsiJournalMarket {
  updatedAt: number
  entries: ChileRsiEntry[]
  /** Recorded prices by round open (as a string key), graded or not yet. */
  costs: Record<string, number>
}

export interface ChileRsiJournal {
  version: 1
  markets: Record<string, ChileRsiJournalMarket>
}

export const emptyChileRsiJournal = (): ChileRsiJournal => ({ version: 1, markets: {} })

/**
 * One journal per market. The signal reads the 5m RSI and the round whatever the chart timeframe
 * or V17 profile, so neither is part of the key.
 */
export const chileRsiJournalKey = (source: DataSource, product: string) => `${source}|${product}`

const SIDES = new Set<unknown>(['up', 'down'])
const OUTCOMES = new Set<unknown>(['up', 'down', 'flat'])
const SETTLED_BY = new Set<unknown>(['kalshi', 'coinbase'])

function isEntry(value: unknown): value is ChileRsiEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Number.isFinite(v.roundStart) &&
    SIDES.has(v.side) &&
    Number.isFinite(v.rsi) &&
    Number.isFinite(v.open) &&
    Number.isFinite(v.close) &&
    OUTCOMES.has(v.outcome) &&
    SETTLED_BY.has(v.settledBy)
  )
}

/** Whatever storage handed back, as a journal: malformed markets, entries and prices are dropped. */
export function sanitizeChileRsiJournal(value: unknown): ChileRsiJournal {
  const journal = emptyChileRsiJournal()
  if (!value || typeof value !== 'object') return journal
  const { version, markets } = value as { version?: unknown; markets?: unknown }
  if (version !== 1 || !markets || typeof markets !== 'object') return journal
  for (const [key, market] of Object.entries(markets as Record<string, unknown>)) {
    if (!market || typeof market !== 'object') continue
    const { updatedAt, entries, costs } = market as Record<string, unknown>
    if (!Number.isFinite(updatedAt) || !Array.isArray(entries)) continue
    const cleanCosts: Record<string, number> = {}
    if (costs && typeof costs === 'object')
      for (const [round, cost] of Object.entries(costs as Record<string, unknown>))
        if (/^\d+$/.test(round) && typeof cost === 'number' && cost > 0 && cost < 1.1)
          cleanCosts[round] = cost
    journal.markets[key] = {
      updatedAt: updatedAt as number,
      entries: entries.filter(isEntry),
      costs: cleanCosts,
    }
  }
  return journal
}

/**
 * Saved entries plus fresh ones: one per round, oldest first, capped. The fresh grade wins, except
 * that a Kalshi-settled grade is never replaced by a Coinbase one — Kalshi's record of a round
 * only drops out of the feed with age, and its result is the one the recorded price was paid on.
 */
export function mergeChileRsiEntries(
  saved: readonly ChileRsiEntry[],
  fresh: readonly ChileRsiEntry[],
): ChileRsiEntry[] {
  const byRound = new Map<number, ChileRsiEntry>()
  for (const entry of saved) byRound.set(entry.roundStart, entry)
  for (const entry of fresh) {
    const kept = byRound.get(entry.roundStart)
    if (kept?.settledBy === 'kalshi' && entry.settledBy === 'coinbase') continue
    byRound.set(entry.roundStart, entry)
  }
  return [...byRound.values()]
    .sort((a, b) => a.roundStart - b.roundStart)
    .slice(-CHILE_RSI_JOURNAL_MAX_ENTRIES)
}

const sameEntry = (a: ChileRsiEntry | undefined, b: ChileRsiEntry) =>
  a !== undefined &&
  a.roundStart === b.roundStart &&
  a.side === b.side &&
  a.rsi === b.rsi &&
  a.open === b.open &&
  a.close === b.close &&
  a.outcome === b.outcome &&
  a.settledBy === b.settledBy

function withMarket(
  journal: ChileRsiJournal,
  key: string,
  market: ChileRsiJournalMarket,
): ChileRsiJournal {
  const markets = { ...journal.markets, [key]: market }
  const keep = Object.entries(markets)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, CHILE_RSI_JOURNAL_MAX_MARKETS)
  return { version: 1, markets: Object.fromEntries(keep) }
}

/**
 * The journal with `fresh` recorded under `key`; the same object when nothing would change, so a
 * caller can skip the write — the engine re-runs on every tick.
 */
export function recordChileRsiEntries(
  journal: ChileRsiJournal,
  key: string,
  fresh: readonly ChileRsiEntry[],
  nowMs: number,
): ChileRsiJournal {
  if (!fresh.length) return journal
  const saved = journal.markets[key]
  const entries = saved?.entries ?? []
  const merged = mergeChileRsiEntries(entries, fresh)
  if (merged.length === entries.length && merged.every((entry, i) => sameEntry(entries[i], entry)))
    return journal
  // A price only matters while its round can still be graded: keep the ones the entries can reach.
  const oldest = merged[0]?.roundStart ?? 0
  const costs = Object.fromEntries(
    Object.entries(saved?.costs ?? {}).filter(([round]) => Number(round) >= oldest),
  )
  return withMarket(journal, key, { updatedAt: nowMs, entries: merged, costs })
}

/** The journal with the first price seen for `roundStart` recorded; later sightings are ignored. */
export function recordChileRsiCost(
  journal: ChileRsiJournal,
  key: string,
  roundStart: number,
  cost: number,
  nowMs: number,
): ChileRsiJournal {
  const saved = journal.markets[key]
  if (saved?.costs[String(roundStart)] !== undefined) return journal
  return withMarket(journal, key, {
    updatedAt: nowMs,
    entries: saved?.entries ?? [],
    costs: { ...saved?.costs, [String(roundStart)]: cost },
  })
}
