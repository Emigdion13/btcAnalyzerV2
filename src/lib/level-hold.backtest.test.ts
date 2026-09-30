/**
 * Level-hold backtest — do the agents' support/resistance levels hold more often than random prices?
 *
 * Replays real BTC-USD history through the production level pickers (`pivotLevels`,
 * `levelFromSrZone`) on a trailing 300-bar window, the chart's default load. Every time the next
 * bar trades through the nearest pivot or SR box, that test is graded by `gradeLevelTest`: held if
 * price then trades 1 ATR back away before 1 ATR through. The control is a random price 0.05–1.5
 * ATR from each close, touched and graded exactly the same way. Levels are read from closed bars
 * only, so nothing here can see the bar it is grading.
 *
 * By default it runs on the bundled tape (`macd-training-data/btc-usd-5m-15d.json`). The numbers in
 * `LEVEL_HOLD_RATES` came from longer tapes fetched from Coinbase's public candles API:
 *
 *   LEVEL_HOLD_TF=15m LEVEL_HOLD_DAYS=180 npx vitest run src/lib/level-hold.backtest.test.ts
 *
 * The printed row can be pasted into the table. Rates are printed, never asserted: they are
 * whatever the tape says they are.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import {
  gradeLevelTest,
  levelFromSrZone,
  pivotLevels,
  wilderAtr,
  LEVEL_TEST_HORIZON_BARS,
  type LevelReference,
  type LevelSide,
} from './level-strength'
import type { Candle, Timeframe } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const TAPE = join(here, 'macd-training-data', 'btc-usd-5m-15d.json')
const TIMEFRAME = (process.env.LEVEL_HOLD_TF ?? '5m') as Timeframe
const FETCH_DAYS = Number(process.env.LEVEL_HOLD_DAYS ?? 0)
const WINDOW = 300

/** Coinbase rows: [time, low, high, open, close, volume], newest first. */
type Row = [number, number, number, number, number, number]
const toCandles = (rows: Row[]): Candle[] =>
  rows
    .map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time)

/** The Coinbase granularity each chart timeframe is built from. */
const BASE: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 300,
  '1h': 3600,
  '2h': 3600,
  '4h': 3600,
  '1D': 86400,
  '1W': 86400,
}

async function fetchTape(timeframe: Timeframe, days: number): Promise<Candle[]> {
  const step = BASE[timeframe]
  const end = Math.floor(Date.now() / 1000 / step) * step
  const byTime = new Map<number, Row>()
  for (let t = end - days * 86400; t < end; t += step * 300) {
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${step}&start=${t}&end=${Math.min(t + step * 300, end)}`
    let rows: Row[] | null = null
    for (let attempt = 0; attempt < 5 && !rows; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'atlas-level-hold-backtest' },
        })
        if (response.ok) rows = (await response.json()) as Row[]
      } catch {
        // retried below
      }
      if (!rows) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
    if (!rows) throw new Error(`Coinbase candles unavailable: ${url}`)
    for (const row of rows) byTime.set(row[0], row)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return aggregate(toCandles([...byTime.values()]), INTERVAL_SECONDS[timeframe] / step)
}

function aggregate(candles: Candle[], size: number): Candle[] {
  if (size <= 1) return candles
  const out: Candle[] = []
  for (let i = 0; i + size <= candles.length; i += size) {
    const group = candles.slice(i, i + size)
    out.push({
      time: group[0].time,
      open: group[0].open,
      close: group[group.length - 1].close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return out
}

interface Tally {
  held: number
  tests: number
}

function replay(candles: Candle[], timeframe: Timeframe) {
  const tallies = {
    random: { held: 0, tests: 0 },
    pivot: { held: 0, tests: 0 },
    srZone: { held: 0, tests: 0 },
  }
  const blockedUntil = new Map<string, number>()
  const count = (tally: Tally, outcome: ReturnType<typeof gradeLevelTest>) => {
    if (outcome === null) return
    tally.tests++
    if (outcome === 'held') tally.held++
  }
  for (let t = WINDOW - 1; t < candles.length - 2; t++) {
    const window = candles.slice(t - WINDOW + 1, t + 1)
    const atrValue = wilderAtr(window, 14)[window.length - 1]!
    const price = window[window.length - 1].close
    const next = candles[t + 1]
    const touched = (level: number, side: LevelSide) =>
      side === 'support' ? next.low <= level : next.high >= level
    // Control: a price picked without looking at structure, 0.05–1.5 ATR from the close.
    const offset = 0.05 + (((t * 2654435761) % 1000) / 1000) * 1.45
    for (const side of ['support', 'resistance'] as LevelSide[]) {
      const level = side === 'support' ? price - offset * atrValue : price + offset * atrValue
      if (touched(level, side))
        count(tallies.random, gradeLevelTest(candles, t + 1, level, side, atrValue))
    }
    const pivots = pivotLevels(window, atrValue, price, timeframe)
    const levels: [LevelReference | null, LevelSide][] = [
      [levelFromSrZone(window, null, atrValue, price, 'support', timeframe), 'support'],
      [levelFromSrZone(window, null, atrValue, price, 'resistance', timeframe), 'resistance'],
      [pivots.nearestSupport, 'support'],
      [pivots.nearestResistance, 'resistance'],
    ]
    for (const [level, side] of levels) {
      if (!level) continue
      const nearSide = side === 'support' ? price > level.price : price < level.price
      if (!nearSide || !touched(level.price, side)) continue
      // One test per level until it resolves: the same level re-touched mid-test is the same test.
      const key = `${side}:${level.source}:${level.price}`
      if ((blockedUntil.get(key) ?? -1) >= t) continue
      let until = t + 1
      while (
        until < Math.min(candles.length, t + 1 + LEVEL_TEST_HORIZON_BARS) &&
        candles[until].high < level.price + atrValue &&
        candles[until].low > level.price - atrValue
      )
        until++
      blockedUntil.set(key, until)
      count(
        level.source === 'pivot' ? tallies.pivot : tallies.srZone,
        gradeLevelTest(candles, t + 1, level.price, side, atrValue),
      )
    }
  }
  return tallies
}

const rate = (tally: Tally) => (tally.tests ? tally.held / tally.tests : 0)
const row = (tally: Tally) => `{ rate: ${rate(tally).toFixed(3)}, n: ${tally.tests} }`

describe('Level-hold backtest', () => {
  it(
    'grades the nearest pivots and SR boxes against random prices on real tape',
    async () => {
      const candles = FETCH_DAYS
        ? await fetchTape(TIMEFRAME, FETCH_DAYS)
        : aggregate(
            toCandles(JSON.parse(readFileSync(TAPE, 'utf8')) as Row[]),
            INTERVAL_SECONDS[TIMEFRAME] / 300,
          )
      const tallies = replay(candles, TIMEFRAME)
      console.log(
        `\nLevel-hold backtest · BTC-USD ${TIMEFRAME} · ${candles.length} bars\n` +
          `  random ${(rate(tallies.random) * 100).toFixed(1)}% of ${tallies.random.tests}` +
          ` · pivot ${(rate(tallies.pivot) * 100).toFixed(1)}% of ${tallies.pivot.tests}` +
          ` · SR box ${(rate(tallies.srZone) * 100).toFixed(1)}% of ${tallies.srZone.tests}\n` +
          `  '${TIMEFRAME}': { random: ${row(tallies.random)}, pivot: ${row(tallies.pivot)}, srZone: ${row(tallies.srZone)} },`,
      )
      expect(tallies.random.tests).toBeGreaterThan(100)
      expect(tallies.pivot.tests).toBeGreaterThan(100)
      expect(tallies.srZone.tests).toBeGreaterThan(0)
      for (const tally of Object.values(tallies)) {
        expect(tally.held).toBeLessThanOrEqual(tally.tests)
      }
    },
    FETCH_DAYS ? 900_000 : 60_000,
  )
})
