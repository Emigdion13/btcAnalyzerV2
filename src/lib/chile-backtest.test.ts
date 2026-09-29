/**
 * Chile backtest harness — how the Chile panel's two numbers do on real tape.
 *
 * Replays real BTC-USD 5m history through the production code: the Chile Reversal engine on a 5m
 * chart with its 15m round feed, the this-round odds, and the scorecard graders the window runs.
 * Nothing here re-implements a rule, so the report is a report on the panel itself.
 *
 * The tape is causal by construction. The engine reads closed 15m bars only (the round feed here
 * is aggregated from the same 5m candles, so it can never hold a bar the chart has not printed),
 * round-close calls are graded against the round that opens as they print, and every bar's odds
 * are graded against how its own round finished.
 *
 * By default it runs on the bundled tape (`macd-training-data/btc-usd-5m-15d.json`, 15 days of
 * Coinbase BTC-USD, 14–28 September 2026). For a longer record, fetch one from Coinbase's public
 * candles API — no credentials needed:
 *
 *   CHILE_BACKTEST_DAYS=120 npx vitest run src/lib/chile-backtest.test.ts
 *
 * The assertions guard the machinery (every grade matches an independently aggregated 15m candle)
 * and the odds' calibration. The V17 call's hit rate is printed, never asserted: it is a port of a
 * published script, and its record is whatever the tape says it is.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bucketStart } from '../../shared/coinbase'
import { calculateChileReversal } from './chile-reversal'
import { chileRsiRounds, chileRsiStats, gradeChileRsiExtremes } from './chile-rsi-extreme'
import {
  chileCallStats,
  chileOddsStats,
  gradeChileCalls,
  gradeChileOdds,
  type ChileOddsSample,
} from './chile-scorecard'
import { CHILE_REVERSAL_DEFAULTS, type Candle } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const TAPE = join(here, 'macd-training-data', 'btc-usd-5m-15d.json')
const FETCH_DAYS = Number(process.env.CHILE_BACKTEST_DAYS ?? 0)
/** One day of warmup before anything is graded: the 15m ATR, EMAs and pivots all fill well inside it. */
const WARMUP_SECONDS = 86400

/** Coinbase rows: [time, low, high, open, close, volume], newest first. */
type Row = [number, number, number, number, number, number]
const toCandles = (rows: Row[]): Candle[] =>
  rows
    .map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time)

async function fetchTape(days: number): Promise<Candle[]> {
  const step = 300
  const end = Math.floor(Date.now() / 1000 / step) * step
  const byTime = new Map<number, Row>()
  for (let t = end - days * 86400; t < end; t += step * 300) {
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${step}&start=${t}&end=${Math.min(t + step * 300, end)}`
    let rows: Row[] | null = null
    for (let attempt = 0; attempt < 5 && !rows; attempt++) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'atlas-chile-backtest' } })
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
  return toCandles([...byTime.values()])
}

/** The 15m round feed, aggregated from the chart's own 5m candles. */
function aggregate15m(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const time = bucketStart(c.time, '15m')
    const last = out[out.length - 1]
    if (last?.time === time) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else out.push({ ...c, time })
  }
  return out
}

const pct = (value: number | null) => (value === null ? '   —  ' : `${(value * 100).toFixed(1)}%`)

describe('Chile backtest harness', () => {
  it(
    'grades the V17 call and the this-round odds on real tape',
    async () => {
      const candles = FETCH_DAYS
        ? await fetchTape(FETCH_DAYS)
        : toCandles(JSON.parse(readFileSync(TAPE, 'utf8')) as Row[])
      const rounds = aggregate15m(candles)
      const byRound = new Map(rounds.map((round) => [round.time, round]))
      const gradedFrom = candles[0]!.time + WARMUP_SECONDS

      const result = calculateChileReversal(
        candles,
        { ...CHILE_REVERSAL_DEFAULTS },
        { timeframe: '5m', timeframes: { '15m': { candles: rounds } } },
      )
      const calls = gradeChileCalls(result, '5m', '15m').filter(
        (entry) => entry.roundStart >= gradedFrom,
      )
      const samples = gradeChileOdds(result, '5m', '15m').filter(
        (sample) => sample.roundStart >= gradedFrom,
      )
      const callStats = chileCallStats(calls)
      const oddsStats = chileOddsStats(samples)
      // The RSI extremes: on a 5m chart the chart is the 5m series they read.
      const rsiEntries = gradeChileRsiExtremes(
        result,
        '5m',
        '15m',
        chileRsiRounds(candles, '15m'),
      ).filter((entry) => entry.roundStart >= gradedFrom)
      const rsiStats = chileRsiStats(rsiEntries)

      // --- the machinery: every grade is the independently aggregated 15m candle -----------------
      const completeRounds = rounds.filter(
        (round, i) => round.time >= gradedFrom && i < rounds.length - 1,
      )
      expect(calls.length).toBeGreaterThan(completeRounds.length * 0.98)
      for (const entry of calls) {
        const round = byRound.get(entry.roundStart)!
        expect(entry.open).toBe(round.open)
        expect(entry.close).toBe(round.close)
      }
      for (const sample of samples) {
        const round = byRound.get(sample.roundStart)!
        expect(sample.finishedAbove).toBe(round.close > round.open)
      }
      for (const entry of rsiEntries) {
        const round = byRound.get(entry.roundStart)!
        expect(entry.open).toBe(round.open)
        expect(entry.close).toBe(round.close)
        expect(entry.settledBy).toBe('coinbase')
      }

      // --- baselines on the same rounds ------------------------------------------------------------
      let repeat = 0
      let decided = 0
      for (const entry of calls) {
        const previous = byRound.get(entry.roundStart - 900)
        if (!previous || previous.close === previous.open || entry.outcome === 'flat') continue
        decided++
        if (previous.close > previous.open === (entry.outcome === 'up')) repeat++
      }
      const ups = calls.filter((entry) => entry.outcome === 'up').length
      const decidedCalls = calls.filter((entry) => entry.outcome !== 'flat').length

      // --- the odds, by time left and by calibration -------------------------------------------------
      const byLeft = new Map<number, ChileOddsSample[]>()
      for (const sample of samples) {
        const bucket = byLeft.get(sample.secondsLeft) ?? []
        bucket.push(sample)
        byLeft.set(sample.secondsLeft, bucket)
      }
      const deciles = Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, above: 0 }))
      for (const sample of samples) {
        const d = deciles[Math.min(9, Math.floor(sample.probabilityAbove * 10))]!
        d.n++
        d.predicted += sample.probabilityAbove
        d.above += sample.finishedAbove ? 1 : 0
      }

      const days = (candles[candles.length - 1]!.time - gradedFrom) / 86400
      const lines = [
        `Chile backtest · BTC-USD 5m chart, 15m rounds · ${days.toFixed(0)} days graded · ${
          FETCH_DAYS ? `fetched ${FETCH_DAYS} days` : 'bundled tape'
        }`,
        `  rounds graded ${calls.length} · next round finished up ${pct(ups / decidedCalls)}`,
        `  V17 call (next round)   ${pct(callStats.hitRate)} ±${pct(callStats.margin)} · ${callStats.correct}/${callStats.scored} scored, ${callStats.waits} WAIT`,
        `    UP ${callStats.up.correct}/${callStats.up.scored} (${pct(callStats.up.correct / callStats.up.scored)})  DOWN ${callStats.down.correct}/${callStats.down.scored} (${pct(callStats.down.correct / callStats.down.scored)})`,
        `  baseline: repeat the last round ${pct(repeat / decided)} · fade it ${pct(1 - repeat / decided)}`,
        `  RSI extremes (5m RSI < 30 → UP, > 70 → DOWN at the open)  ${pct(rsiStats.hitRate)} ±${pct(rsiStats.margin)} · ${rsiStats.correct}/${rsiStats.scored} · UP ${rsiStats.up.correct}/${rsiStats.up.scored}  DOWN ${rsiStats.down.correct}/${rsiStats.down.scored}`,
        `  this-round odds         ${pct(oddsStats.hitRate)} favourite won · Brier ${oddsStats.brier!.toFixed(3)} (coin flip 0.250) · n=${oddsStats.graded}`,
        ...[...byLeft.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([left, bucket]) => {
            const stats = chileOddsStats(bucket)
            return `    ${String(left / 60).padStart(2)} min left  ${pct(stats.hitRate)} · Brier ${stats.brier!.toFixed(3)} · n=${stats.graded}`
          }),
        '  calibration (predicted → finished above)',
        ...deciles
          .map((d, i) =>
            d.n
              ? `    ${String(i * 10).padStart(2)}–${String(i * 10 + 10).padStart(3)}%  n=${String(d.n).padStart(5)}  ${pct(d.predicted / d.n)} → ${pct(d.above / d.n)}`
              : '',
          )
          .filter(Boolean),
      ]
      console.log(lines.join('\n'))

      // --- the odds are worth reading: better than a coin flip, and calibrated ------------------------
      expect(oddsStats.brier!).toBeLessThan(0.2)
      expect(oddsStats.hitRate!).toBeGreaterThan(0.68)
      for (const d of deciles) {
        if (d.n < 60) continue
        expect(Math.abs(d.predicted / d.n - d.above / d.n)).toBeLessThan(0.12)
      }
    },
    FETCH_DAYS ? 600_000 : 30_000,
  )
})
