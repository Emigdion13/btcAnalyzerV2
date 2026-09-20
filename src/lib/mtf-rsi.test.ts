import { describe, expect, it } from 'vitest'
import {
  advanceMtfTendency,
  adx,
  analyzeMtfRsi,
  classifyMtfRsi,
  efficiencyRatio,
  mtfAlignment,
  MTF_RSI_MIN_BARS,
  MTF_RSI_PERIOD,
  MTF_RSI_TIMEFRAMES,
  MTF_TENDENCY_CONFIRMATIONS,
  mtfDirectionVotes,
  mtfReadingDetail,
  rawMtfTendency,
  wilderSmooth,
} from './mtf-rsi'
import type { MtfRsiReading, MtfRsiTimeframe, MtfTendency, MtfTendencyState } from './mtf-rsi'

type Verdicts = Partial<Record<MtfRsiTimeframe, MtfTendency | null>>

const bar = (time: number, open: number, high: number, low: number, close: number) => ({
  time,
  open,
  high,
  low,
  close,
})

/**
 * Deterministic candles without volume — the DMI never reads it. A linear drift up (or down)
 * with wicks around the path keeps every series finite and the direction unambiguous.
 */
const trend = (
  bars: number,
  driftPerBar: number,
  start = 100,
): { high: number; low: number; close: number }[] =>
  Array.from({ length: bars }, (_, i) => {
    const open = start + i * driftPerBar
    const close = open + driftPerBar
    return bar(
      i * 60,
      open,
      Math.max(open, close) + driftPerBar,
      Math.min(open, close) - driftPerBar,
      close,
    )
  })

/** Chop: a sawtooth that returns to its start every `period` bars — net zero, all path. */
const chop = (
  bars: number,
  amplitude = 4,
  period = 8,
): { high: number; low: number; close: number }[] =>
  Array.from({ length: bars }, (_, i) => {
    const phase = i % period
    const triangle = phase <= period / 2 ? phase : period - phase
    const close = 100 + (triangle - period / 4) * amplitude
    const open =
      i === 0
        ? close
        : 100 +
          (((i - 1) % period <= period / 2 ? (i - 1) % period : period - ((i - 1) % period)) -
            period / 4) *
            amplitude
    return bar(i * 60, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close)
  })

const emptyReading: MtfRsiReading = {
  bars: 0,
  rsi: null,
  rsiZone: null,
  adx: null,
  plusDi: null,
  minusDi: null,
  efficiency: null,
  slope: null,
  score: null,
}

describe('wilderSmooth', () => {
  it('seeds with the mean of the first period, then RMA-averages', () => {
    const smoothed = wilderSmooth([2, 4, 6, 8, 10, 12], 3)
    expect(smoothed[0]).toBeNull()
    expect(smoothed[1]).toBeNull()
    expect(smoothed[2]).toBe(4)
    // 4 + (8 − 4) / 3 = 5.333…
    expect(smoothed[3]).toBeCloseTo(4 + 4 / 3, 10)
    // 5.333… + (10 − 5.333…) / 3
    expect(smoothed[4]).toBeCloseTo(4 + 4 / 3 + (10 - (4 + 4 / 3)) / 3, 10)
  })

  it('resets its seed across a gap, like ta.ema', () => {
    const smoothed = wilderSmooth([1, 2, 3, null, 5, 6, 7], 3)
    expect(smoothed[2]).toBe(2)
    expect(smoothed[3]).toBeNull()
    expect(smoothed[4]).toBeNull()
    expect(smoothed[5]).toBeNull()
    expect(smoothed[6]).toBe(6)
  })
})

describe('efficiencyRatio', () => {
  it('is one for a straight line, zero for a closed sawtooth', () => {
    const straight = efficiencyRatio([1, 2, 3, 4, 5, 6], 5)
    expect(straight[5]).toBeCloseTo(1, 10)
    const sawtooth = efficiencyRatio([1, 2, 1, 2, 1, 2], 5)
    expect(sawtooth[5]).toBeCloseTo(Math.abs(2 - 1) / 5, 10)
  })

  it('returns null before the window fills and for a flat zero-path series', () => {
    const values = efficiencyRatio([5, 5, 5, 5, 5, 5], 5)
    expect(values[3]).toBeNull()
    expect(values[5]).toBe(0)
  })
})

describe('adx — Wilder DMI', () => {
  it('scores a strong one-directional market well above the range threshold', () => {
    const result = adx(trend(120, 1), 14)
    const last = result.adx.at(-1)!
    expect(last).toBeGreaterThan(25)
    // An uptrend's +DI leads −DI by a wide margin.
    expect(result.plusDi.at(-1)! - result.minusDi.at(-1)!).toBeGreaterThan(10)
    expect(result.atr.at(-1)!).toBeGreaterThan(0)
  })

  it('reads a downtrend through the DI sign, not the ADX level', () => {
    const result = adx(trend(120, -1), 14)
    expect(result.minusDi.at(-1)! - result.plusDi.at(-1)!).toBeGreaterThan(10)
    expect(result.adx.at(-1)!).toBeGreaterThan(25)
  })

  it('drags ADX toward low values in a sawtooth', () => {
    const up = adx(trend(80, 1), 14).adx.at(-1)!
    const side = adx(chop(80), 14).adx.at(-1)!
    expect(side).toBeLessThan(up)
    expect(side).toBeLessThan(25)
  })

  it('returns all-null components for too-few candles', () => {
    const result = adx(trend(5, 1), 14)
    expect(result.adx.every((value) => value === null)).toBe(true)
    expect(result.plusDi.every((value) => value === null)).toBe(true)
  })
})

describe('analyzeMtfRsi — one timeframe reading', () => {
  it('needs MTF_RSI_MIN_BARS closes before the score exists', () => {
    const short = analyzeMtfRsi(trend(MTF_RSI_MIN_BARS - 1, 1))
    expect(short.rsi).not.toBeNull() // RSI only needs period + 1
    expect(short.score).toBeNull()
    const enough = analyzeMtfRsi(trend(MTF_RSI_MIN_BARS, 1))
    expect(enough.score).not.toBeNull()
  })

  it('returns an all-null reading for an empty feed', () => {
    expect(analyzeMtfRsi([])).toEqual(emptyReading)
  })

  it('reads an uptrend: RSI above 55, +DI over −DI, positive slope', () => {
    const reading = analyzeMtfRsi(trend(120, 1))
    expect(reading.rsi).toBeGreaterThan(55)
    expect(reading.plusDi! - reading.minusDi!).toBeGreaterThan(2)
    expect(reading.slope).toBeGreaterThan(0.02)
    expect(reading.efficiency).toBeGreaterThan(0.5)
    expect(reading.score).toBeGreaterThanOrEqual(55)
  })

  it('reads a downtrend as the mirror image', () => {
    const reading = analyzeMtfRsi(trend(120, -1))
    expect(reading.rsi).toBeLessThan(45)
    expect(reading.minusDi! - reading.plusDi!).toBeGreaterThan(2)
    expect(reading.slope).toBeLessThan(-0.02)
    expect(reading.score).toBeGreaterThanOrEqual(55)
  })

  it('reads chop as a low score with the RSI near the middle', () => {
    const reading = analyzeMtfRsi(chop(120))
    expect(reading.score).toBeLessThan(45)
    expect(Math.abs(reading.rsi! - 50)).toBeLessThan(25)
  })

  it('stays scale-free: doubling every price leaves the components unchanged', () => {
    const base = analyzeMtfRsi(trend(120, 1))
    const doubled = analyzeMtfRsi(
      trend(120, 1).map((c) => ({
        ...c,
        open: c.close * 2,
        close: c.close * 2,
        high: c.high * 2,
        low: c.low * 2,
      })),
    )
    expect(doubled.rsi).toBe(base.rsi)
    expect(doubled.adx).toBe(base.adx)
    expect(doubled.efficiency).toBe(base.efficiency)
    expect(doubled.score).toBe(base.score)
  })
})

describe('mtfDirectionVotes — the two-of-three direction vote', () => {
  it('votes bullish when all three measures agree', () => {
    const votes = mtfDirectionVotes({
      ...emptyReading,
      rsi: 62,
      plusDi: 28,
      minusDi: 17,
      slope: 0.05,
    })
    expect(votes).toMatchObject({ di: 1, slope: 1, rsi: 1, net: 3 })
  })

  it('abstains inside the no-man zones instead of voting neutral', () => {
    const votes = mtfDirectionVotes({
      ...emptyReading,
      rsi: 50,
      plusDi: 24,
      minusDi: 23,
      slope: 0.005,
    })
    expect(votes).toMatchObject({ di: 0, slope: 0, rsi: 0, net: 0 })
  })

  it('counts a bearish majority from two bearish votes and one abstention', () => {
    const votes = mtfDirectionVotes({
      ...emptyReading,
      rsi: 38,
      plusDi: 25,
      minusDi: 26,
      slope: -0.04,
    })
    expect(votes.net).toBe(-2)
  })

  it('a missing component abstains, never votes', () => {
    const votes = mtfDirectionVotes({ ...emptyReading, rsi: 70 })
    expect(votes).toMatchObject({ di: 0, slope: 0, rsi: 1, net: 1 })
  })
})

describe('rawMtfTendency — the hysteretic regime gate', () => {
  const reading = (score: number | null, rsi = 50): MtfRsiReading => ({
    ...emptyReading,
    rsi,
    rsiZone: null,
    // Components that vote with RSI, so an above-threshold score has a direction to name.
    plusDi: rsi >= 55 ? 28 : 20,
    minusDi: rsi >= 55 ? 18 : 30,
    slope: rsi >= 55 ? 0.05 : -0.05,
    score,
  })

  it('calls a trend above the entry threshold and a range below the exit', () => {
    expect(rawMtfTendency(reading(70, 62), null)).toBe('bullish')
    expect(rawMtfTendency(reading(30, 38), null)).toBe('range')
  })

  it('holds the previous regime inside the dead-band', () => {
    const trendState: MtfTendencyState = { tendency: 'bullish', lastRaw: 'bullish', streak: 0 }
    const rangeState: MtfTendencyState = { tendency: 'range', lastRaw: 'range', streak: 0 }
    expect(rawMtfTendency(reading(50, 50), trendState)).toBe('bullish')
    expect(rawMtfTendency(reading(50, 50), rangeState)).toBe('range')
  })

  it('a trend the votes cannot agree on a direction for reads as range', () => {
    // DI bullish, slope bearish, RSI silent: net 0 — conflicted.
    const conflicted: MtfRsiReading = {
      ...emptyReading,
      score: 70,
      plusDi: 28,
      minusDi: 20,
      slope: -0.05,
      rsi: 50,
    }
    expect(rawMtfTendency(conflicted, null)).toBe('range')
  })

  it('returns null when there is no score to read', () => {
    expect(rawMtfTendency(reading(null), null)).toBeNull()
  })
})

describe('advanceMtfTendency — confirmation state machine', () => {
  it('takes the first reading as-is and holds through single-bar noise', () => {
    const first = advanceMtfTendency('bullish', null)
    expect(first.tendency).toBe('bullish')
    const noisy = advanceMtfTendency('range', first)
    expect(noisy.tendency).toBe('bullish')
    expect(noisy.streak).toBe(1)
  })

  it('flips only after two consecutive disagreements', () => {
    const bullish: MtfTendencyState = { tendency: 'bullish', lastRaw: 'bullish', streak: 0 }
    const once = advanceMtfTendency('bearish', bullish)
    expect(once.tendency).toBe('bullish')
    const twice = advanceMtfTendency('bearish', once)
    expect(twice.tendency).toBe('bearish')
    expect(MTF_TENDENCY_CONFIRMATIONS).toBe(2)
  })

  it('a break in the disagreement run resets the streak', () => {
    const bullish: MtfTendencyState = { tendency: 'bullish', lastRaw: 'bullish', streak: 0 }
    const once = advanceMtfTendency('bearish', bullish)
    const back = advanceMtfTendency('bullish', once)
    expect(back.tendency).toBe('bullish')
    const onceAgain = advanceMtfTendency('bearish', back)
    expect(onceAgain.tendency).toBe('bullish')
    expect(onceAgain.streak).toBe(1)
  })

  it('a missing raw leaves the confirmed state untouched', () => {
    const bullish: MtfTendencyState = { tendency: 'bullish', lastRaw: 'bullish', streak: 0 }
    expect(advanceMtfTendency(null, bullish)).toBe(bullish)
    expect(advanceMtfTendency(null, null).tendency).toBe('range')
  })
})

describe('classifyMtfRsi — reading + state in, verdict out', () => {
  it('calls a clean uptrend bullish with moderate-or-better strength', () => {
    const reading = analyzeMtfRsi(trend(120, 1))
    const { verdict } = classifyMtfRsi(reading, null)
    expect(verdict.tendency).toBe('bullish')
    expect(['moderate', 'strong']).toContain(verdict.strength)
  })

  it('calls a clean downtrend bearish', () => {
    const reading = analyzeMtfRsi(trend(120, -1))
    const { verdict } = classifyMtfRsi(reading, null)
    expect(verdict.tendency).toBe('bearish')
  })

  it('calls chop a range', () => {
    const reading = analyzeMtfRsi(chop(160))
    const { verdict } = classifyMtfRsi(reading, null)
    expect(verdict.tendency).toBe('range')
  })

  it('the confirmed verdict survives one contrarian reading', () => {
    let state: MtfTendencyState | null = null
    const up = trend(120, 1)
    const feed = [
      ...up,
      ...trend(2, -6)
        .slice()
        .reverse()
        .map((c) => c),
    ].map((c, i) => ({
      ...c,
      time: i * 60,
    }))
    for (const candle of feed.slice(0, 120)) {
      state = classifyMtfRsi(analyzeMtfRsi(feed.slice(0, feed.indexOf(candle) + 1)), state).state
    }
    const before = state!
    // One hard red bar must not repaint the bullish call.
    const shocked = [
      ...feed,
      bar(
        9999,
        feed.at(-1)!.close,
        feed.at(-1)!.close + 1,
        feed.at(-1)!.close - 8,
        feed.at(-1)!.close - 8,
      ),
    ]
    const { verdict } = classifyMtfRsi(analyzeMtfRsi(shocked), before)
    expect(verdict.tendency).toBe('bullish')
  })
})

describe('mtfAlignment — weighted, HTF-led summary', () => {
  it('is unavailable before any timeframe classifies', () => {
    expect(mtfAlignment({}).bias).toBe('unavailable')
    expect(mtfAlignment({ '1m': null }).bias).toBe('unavailable')
  })

  it('a clean sweep is a clean bias', () => {
    const verdicts = Object.fromEntries(MTF_RSI_TIMEFRAMES.map((tf) => [tf, 'bullish']))
    const alignment = mtfAlignment(verdicts)
    expect(alignment.bias).toBe('bullish')
    expect(alignment.trending).toBe(5)
    expect(alignment.bullShare).toBe(1)
  })

  it('higher timeframes outvote the whole lower ladder', () => {
    // 1m + 5m + 15m bullish (weight 6 of 15) against 30m + 1h bearish (9 of 15).
    const verdicts: Verdicts = {
      '1m': 'bullish',
      '5m': 'bullish',
      '15m': 'bullish',
      '30m': 'bearish',
      '1h': 'bearish',
    }
    expect(mtfAlignment(verdicts).bias).toBe('bearish')
  })

  it('ranges abstain rather than vote', () => {
    const verdicts: Verdicts = {
      '1m': 'range',
      '5m': 'range',
      '15m': 'range',
      '30m': 'bullish',
      '1h': 'bullish',
    }
    const alignment = mtfAlignment(verdicts)
    expect(alignment.bias).toBe('bullish')
    expect(alignment.trending).toBe(2)
    expect(alignment.classified).toBe(5)
    expect(alignment.bullShare).toBe(1)
  })

  it('a split without a supermajority is mixed', () => {
    // 5m + 15m bullish (5) against 1m + 30m bearish (5), the 1h abstaining — dead even.
    const verdicts: Verdicts = {
      '1m': 'bearish',
      '5m': 'bullish',
      '15m': 'bullish',
      '30m': 'bearish',
      '1h': 'range',
    }
    expect(mtfAlignment(verdicts).bias).toBe('mixed')
  })
})

describe('mtfReadingDetail', () => {
  it('narrates every component that fed the call', () => {
    const reading = analyzeMtfRsi(trend(120, 1))
    const { verdict } = classifyMtfRsi(reading, null)
    const detail = mtfReadingDetail(reading, verdict)
    expect(detail).toContain(`RSI ${reading.rsi!.toFixed(1)}`)
    expect(detail).toContain('ADX')
    expect(detail).toContain('efficiency')
    expect(detail).toContain('quality')
    expect(detail).toContain('bullish')
  })
})

describe('the RSI itself stays conventional', () => {
  it('uses the Wilder 14 the rest of the app quotes', () => {
    expect(MTF_RSI_PERIOD).toBe(14)
  })

  it('watches exactly the scalper ladder, fastest first', () => {
    expect([...MTF_RSI_TIMEFRAMES]).toEqual(['1m', '5m', '15m', '30m', '1h'])
  })
})
