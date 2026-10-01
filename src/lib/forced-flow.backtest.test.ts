/**
 * Forced-flow backtest — do liquidation-driven moves snap back?
 *
 * The folklore: a wick that "makes no sense" is leverage being flushed, and once the forced orders
 * are done price returns. This replays real BTC-USD five-minute bars through the live rule
 * (`classifyForcedFlow`, trailing-percentile thresholds exactly as `ForcedFlowTracker` keeps them)
 * using Kraken Futures' published open-interest history, the only free OI history that reaches
 * back months from here (OKX keeps five days at five minutes; Binance and Bybit refuse this region).
 *
 * Every bar whose |close-to-close change| clears the trailing 90th percentile is a big move. Each
 * is classified by the OI change over the same bar, then graded: did price trade back half the
 * move within 15 minutes / within an hour? The control is every big move, whatever OI did, so the
 * question is whether the forced label adds anything over "price moved a lot".
 *
 * It fetches from Coinbase and Kraken, so it only runs when asked:
 *
 *   FORCED_FLOW_DAYS=180 npx vitest run src/lib/forced-flow.backtest.test.ts
 *
 * The printed rows are what `FORCED_FOLLOW_THROUGH` holds. Rates are printed, never asserted.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyForcedFlow,
  MOVE_PERCENTILE,
  OI_DROP_PERCENTILE,
  OI_RISE_PERCENTILE,
  RollingDistribution,
  DISTRIBUTION_MINIMUM,
  type ForcedState,
} from '../../shared/forced-flow'

const DAYS = Number(process.env.FORCED_FLOW_DAYS ?? 0)
const STEP = 300
const HORIZONS = [3, 12] as const

interface Bar {
  time: number
  high: number
  low: number
  close: number
  oiOpen: number
  oiClose: number
  liquidated: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'atlas-forced-flow-backtest' } })
      if (response.ok) return await response.json()
    } catch {
      // retried below
    }
    await sleep(1000 * (attempt + 1))
  }
  throw new Error(`Unavailable: ${url}`)
}

async function kraken(type: string, start: number, end: number) {
  const out = new Map<number, unknown>()
  let since = start
  for (let page = 0; page < 200; page++) {
    const { result } = (await getJson(
      `https://futures.kraken.com/api/charts/v1/analytics/PF_XBTUSD/${type}?since=${since}&to=${end}&interval=${STEP}`,
    )) as { result: { timestamp: number[]; data: unknown[]; more: boolean } }
    result.timestamp.forEach((t, i) => out.set(t, result.data[i]))
    if (!result.more || !result.timestamp.length) break
    since = result.timestamp[result.timestamp.length - 1] + STEP
  }
  return out
}

async function loadBars(days: number): Promise<Bar[]> {
  const end = Math.floor(Date.now() / 1000 / STEP) * STEP
  const start = end - days * 86400
  const [oi, liq] = await Promise.all([
    kraken('open-interest', start, end),
    kraken('liquidation-volume', start, end),
  ])
  const bars: Bar[] = []
  for (let t = start; t < end; t += STEP * 300) {
    const rows = (await getJson(
      `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${STEP}&start=${t}&end=${Math.min(t + STEP * 300, end)}`,
    )) as [number, number, number, number, number, number][]
    for (const [time, low, high, , close] of rows) {
      // Kraken's OI bar is [open, high, low, close] in BTC.
      const o = oi.get(time) as string[] | undefined
      const l = liq.get(time)
      if (!o || l === undefined) continue
      bars.push({
        time,
        high,
        low,
        close,
        oiOpen: Number(o[0]),
        oiClose: Number(o[3]),
        liquidated: Number(l),
      })
    }
    await sleep(120)
  }
  return bars
    .filter((b) => [b.close, b.oiOpen, b.oiClose].every((v) => Number.isFinite(v) && v > 0))
    .sort((a, b) => a.time - b.time)
}

type Group = 'all' | ForcedState | 'liq-heavy'
interface Graded {
  group: Group
  time: number
  back: Record<(typeof HORIZONS)[number], boolean>
}

/** Did price trade back half of bar `i`'s move within `h` bars? */
function halfBack(bars: Bar[], i: number, h: number): boolean {
  const move = bars[i].close - bars[i - 1].close
  const target = bars[i].close - move / 2
  for (let k = 1; k <= h && i + k < bars.length; k++) {
    if (move > 0 ? bars[i + k].low <= target : bars[i + k].high >= target) return true
  }
  return false
}

function replay(bars: Bar[]): Graded[] {
  const moves = new RollingDistribution()
  const oiChanges = new RollingDistribution()
  const liquidations = new RollingDistribution()
  const graded: Graded[] = []
  const horizon = Math.max(...HORIZONS)
  for (let i = 1; i < bars.length - horizon; i++) {
    if (bars[i].time - bars[i - 1].time !== STEP) continue
    const priceChange = bars[i].close / bars[i - 1].close - 1
    const oiChange = bars[i].oiClose / bars[i].oiOpen - 1
    const ready = moves.size >= DISTRIBUTION_MINIMUM
    const move = ready ? moves.percentile(MOVE_PERCENTILE) : null
    const state = classifyForcedFlow({
      priceChange,
      oiChange,
      move,
      oiDrop: ready ? oiChanges.percentile(OI_DROP_PERCENTILE) : null,
      oiRise: ready ? oiChanges.percentile(OI_RISE_PERCENTILE) : null,
      // Kraken's liquidation volume is unsigned, so the side-specific burst rule cannot be
      // replayed; heavy-liquidation bars are reported as their own group instead.
      longUsd: 0,
      shortUsd: 0,
    })
    if (move !== null && Math.abs(priceChange) >= move && priceChange !== 0) {
      const back = Object.fromEntries(
        HORIZONS.map((h) => [h, halfBack(bars, i, h)]),
      ) as Graded['back']
      graded.push({ group: 'all', time: bars[i].time, back })
      graded.push({ group: state, time: bars[i].time, back })
      const heavy = liquidations.percentile(0.9)
      if (heavy !== null && bars[i].liquidated > heavy && bars[i].liquidated > 0)
        graded.push({ group: 'liq-heavy', time: bars[i].time, back })
    }
    moves.push(Math.abs(priceChange))
    oiChanges.push(oiChange)
    liquidations.push(bars[i].liquidated)
  }
  return graded
}

/** 95% bootstrap interval for (rate in `a`) − (rate in `b`). Deterministic. */
function bootstrap(a: boolean[], b: boolean[], draws = 2000): [number, number] {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const rate = (xs: boolean[]) => {
    let hits = 0
    for (let i = 0; i < xs.length; i++) if (xs[Math.floor(random() * xs.length)]) hits++
    return hits / xs.length
  }
  const diffs = Array.from({ length: draws }, () => rate(a) - rate(b)).sort((x, y) => x - y)
  return [diffs[Math.floor(draws * 0.025)], diffs[Math.floor(draws * 0.975)]]
}

describe('forced-flow backtest', () => {
  it('replays the classifier without peeking ahead', () => {
    // Twelve calm bars then one crash with OI collapsing: graded only once thresholds exist.
    const bars: Bar[] = Array.from({ length: 400 }, (_, i) => ({
      time: i * STEP,
      high: 100.2 + (i % 3) * 0.01,
      low: 99.8,
      close: 100 + ((i * 7) % 5) * 0.01,
      oiOpen: 1000,
      oiClose: 1000 + ((i * 3) % 7) - 3,
      liquidated: 0,
    }))
    bars[300] = { ...bars[300], close: 95, low: 94.5, oiClose: 950 }
    bars[301] = { ...bars[301], low: 94 }
    const graded = replay(bars)
    const crash = graded.filter((g) => g.time === 300 * STEP)
    expect(crash.map((g) => g.group)).toEqual(['all', 'longs-liquidating'])
  })

  it.skipIf(!DAYS)(
    `measures half-retrace rates on ${DAYS} days of BTC-USD`,
    async () => {
      const bars = await loadBars(DAYS)
      const graded = replay(bars)
      const mid = bars[Math.floor(bars.length / 2)].time
      const groups: Group[] = [
        'all',
        'longs-liquidating',
        'shorts-liquidating',
        'new-shorts',
        'new-longs',
        'big-move',
        'liq-heavy',
      ]
      console.log(
        `\n${bars.length} bars, ${graded.filter((g) => g.group === 'all').length} big moves`,
      )
      for (const h of HORIZONS) {
        const all = graded.filter((g) => g.group === 'all').map((g) => g.back[h])
        console.log(`\nhalf the move back within ${h * 5}m`)
        for (const group of groups) {
          const rows = graded.filter((g) => g.group === group)
          if (!rows.length) continue
          const hits = rows.map((g) => g.back[h])
          const rate = hits.filter(Boolean).length / hits.length
          const halves = [rows.filter((g) => g.time < mid), rows.filter((g) => g.time >= mid)].map(
            (half) =>
              half.length
                ? `${((half.filter((g) => g.back[h]).length / half.length) * 100).toFixed(1)}%`
                : '—',
          )
          const ci =
            group === 'all'
              ? ''
              : bootstrap(hits, all)
                  .map((d) => (d * 100).toFixed(1))
                  .join(' … ')
          console.log(
            `${group.padEnd(19)} n=${String(rows.length).padStart(5)}  ${(rate * 100).toFixed(1)}%` +
              `  halves ${halves.join(' / ')}${ci ? `  vs all [${ci}] pp` : ''}`,
          )
        }
      }
      expect(graded.length).toBeGreaterThan(0)
    },
    600_000,
  )
})
