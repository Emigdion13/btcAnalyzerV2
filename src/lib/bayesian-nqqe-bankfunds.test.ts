import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OscHudCard } from '../components/OscHudCard'
import { ta } from './indicator-runtime'
import { builtInPlots } from './indicators'
import { indicatorPlotData } from './indicator-plot-series'
import {
  BAYES_COLORS,
  BAYESIAN_NQQE_DEFAULTS,
  NQQE_FACTOR,
  bankerBodyColor,
  bayesianNqqeIndicatorLabel,
  bayesianNqqePlots,
  bayesianNqqeSettings,
  calculateBayesianNqqeBankfunds,
  isBankerEntry,
  nqqeColor,
  nqqeLines,
  publishedBayesPrime,
  publishedBayesProduct,
  strongBayesSignal,
  xsa,
} from './bayesian-nqqe-bankfunds'
import {
  bayesianNqqeHudModel,
  bayesianNqqeVerdict,
  oscHudDataDomain,
  oscHudGeometry,
  oscHudRequestedTimeframes,
} from './osc-hud'
import type { BayesianNqqeValues } from './bayesian-nqqe-bankfunds'
import type { Candle, Indicator } from './types'

const defaults = BAYESIAN_NQQE_DEFAULTS

function waveCandles(count = 120): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 1000 + i * 0.8 + Math.sin(i / 6) * 40
    const open = close - Math.sin(i / 3) * 8
    const high = Math.max(open, close) + 6 + (i % 5)
    const low = Math.min(open, close) - 5 - (i % 4)
    return { time: 1_700_000_000 + i * 60, open, high, low, close, volume: 10 + (i % 7) }
  })
}

function fallingCandles(count = 120): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 1000 - i
    return {
      time: 1_700_000_000 + i * 60,
      open: close + 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1,
    }
  })
}

function flatCandles(count = 80): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * 60,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }))
}

const indicator = {
  id: 'bayes',
  kind: 'bayesian-nqqe-bankfunds',
  name: 'Bayesian/nQQE/BankFunds',
  period: 20,
  color: '#ffff00',
  visible: true,
} as Indicator

describe('published Bayes products', () => {
  it('is the left-associative gap, not the ratio the note describes', () => {
    const a = 0.5
    const b = 0.4
    const c = 0.25
    const left = ((((a * b) * c) / a) * b) * c + (1 - a) * (1 - b) * (1 - c)
    const described = (a * b * c) / (a * b * c + (1 - a) * (1 - b) * (1 - c))
    expect(publishedBayesProduct(a, b, c)).toBe(left)
    expect(publishedBayesProduct(a, b, c)).toBeCloseTo((b * c) ** 2 + (1 - a) * (1 - b) * (1 - c))
    expect(publishedBayesProduct(a, b, c)).not.toBeCloseTo(described)
  })
  it('returns 0 when a is 0 or any input is not finite', () => {
    expect(publishedBayesProduct(0, 0.4, 0.25)).toBe(0)
    expect(publishedBayesProduct(Number.NaN, 0.4, 0.25)).toBe(0)
    expect(publishedBayesProduct(0.5, Number.POSITIVE_INFINITY, 0.25)).toBe(0)
  })
  it('prime is the two-factor expression: su squared plus the complement product', () => {
    const down = 0.5
    const up = 0.4
    expect(publishedBayesPrime(down, up)).toBe(((down * up) / down) * up + (1 - down) * (1 - up))
    expect(publishedBayesPrime(down, up)).toBeCloseTo(up ** 2 + (1 - down) * (1 - up))
    // Pine: sigmaProbsDown == 0 divides by zero, nz makes the whole thing 0.
    expect(publishedBayesPrime(0, up)).toBe(0)
    expect(publishedBayesPrime(Number.NaN, up)).toBe(0)
    expect(publishedBayesPrime(down, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('nQQE and banker helpers', () => {
  it('is the raw smoothed RSI on the 0-100 scale, and the trail uses 4.236', () => {
    const candles = waveCandles()
    const src = candles.map((candle) => candle.close)
    const published = nqqeLines(src, 14, 5)
    const other = nqqeLines(src, 14, 5, 1)
    expect(NQQE_FACTOR).toBe(4.236)
    expect(published.trail).not.toEqual(other.trail)
    expect(defaults).not.toHaveProperty('qqeFactor')
    const index = published.fast.findIndex((value) => value !== null)
    expect(index).toBeGreaterThan(0)
    expect(published.fast[index]).toBeCloseTo(ta.ema(ta.rsi(src, 14), 5)[index]!)
    // No -50 shift: the fast line lives where the RSI smoothed lives.
    expect(published.fast[published.fast.length - 1]).toBeGreaterThan(0)
    const values = calculateBayesianNqqeBankfunds(candles, defaults)
    expect(values.nqqe).toEqual(published.fast)
    expect(values.nqqe).toEqual(ta.ema(ta.rsi(src, 14), 5))
  })
  it('colors the published regimes: lime above 60, red below 40, yellow between', () => {
    expect(nqqeColor(61)).toBe(BAYES_COLORS.nqqeGreen)
    expect(nqqeColor(60)).toBe(BAYES_COLORS.nqqeYellow)
    expect(nqqeColor(50)).toBe(BAYES_COLORS.nqqeYellow)
    expect(nqqeColor(40)).toBe(BAYES_COLORS.nqqeYellow)
    expect(nqqeColor(39)).toBe(BAYES_COLORS.nqqeRed)
    expect(nqqeColor(null)).toBe(BAYES_COLORS.nqqeYellow)
  })
  it('builds the xsa window as src[1]..src[len] at the first valid bar', () => {
    const src = [1, 2, 3, 4, 5, 6]
    const out = xsa(src, 3, 1)
    expect(out[3]).toBe(3)
    expect(out[4]).toBeCloseTo(11 / 3)
    expect(out.slice(0, 3)).toEqual([null, null, null])
  })
  it('paints banker bodies in later-wins order against the pre-multiplied drop line', () => {
    expect(bankerBodyColor(30, 28.5, 20)).toBe(BAYES_COLORS.bankerGreen)
    expect(bankerBodyColor(30, 38, 20)).toBe(BAYES_COLORS.bankerWhite)
    expect(bankerBodyColor(10, 19, 15)).toBe(BAYES_COLORS.bankerRed)
    expect(bankerBodyColor(10, 9.69, 15)).toBe(BAYES_COLORS.bankerBlue)
    expect(bankerBodyColor(10, null, 15)).toBe(BAYES_COLORS.bankerBlue)
  })
  it('fires the yellow entry on any cross above a slow line under 25', () => {
    expect(isBankerEntry(20, 10, 15, 18)).toBe(true)
    // The fund side is unconstrained: a cross far above 25 is still an entry.
    expect(isBankerEntry(90, 10, 20, 22)).toBe(true)
    expect(isBankerEntry(22, 10, 26, 28)).toBe(false)
    expect(isBankerEntry(18, 20, 15, 12)).toBe(false)
    expect(isBankerEntry(20, null, 15, 18)).toBe(false)
  })
  it('uses the published transitions with exact 0/100 comparisons, no sideways filter', () => {
    // Long: prime leaves exact 0 through the threshold.
    expect(
      strongBayesSignal({
        prime: 40,
        previousPrime: 0,
        probUp: 40,
        previousProbUp: 40,
        probDown: 40,
        previousProbDown: 40,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBe('long')
    // Long: the up score falls off exact 100.
    expect(
      strongBayesSignal({
        prime: 40,
        previousPrime: 40,
        probUp: 40,
        previousProbUp: 100,
        probDown: 40,
        previousProbDown: 40,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBe('long')
    // Short: prime falls to exact 0 from above the threshold — even inside the
    // gray zone, because the script never gates on sideways.
    expect(
      strongBayesSignal({
        prime: 0,
        previousPrime: 40,
        probUp: 5,
        previousProbUp: 5,
        probDown: 5,
        previousProbDown: 5,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBe('short')
    // Short: the down score falls off exact 100.
    expect(
      strongBayesSignal({
        prime: 40,
        previousPrime: 40,
        probUp: 40,
        previousProbUp: 40,
        probDown: 40,
        previousProbDown: 100,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBe('short')
    // Near-misses do not fire: 1e-4 off is not "at 0" and 99.9999 is "below 100".
    expect(
      strongBayesSignal({
        prime: 40,
        previousPrime: 0.0001,
        probUp: 40,
        previousProbUp: 40,
        probDown: 40,
        previousProbDown: 40,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBeNull()
    expect(
      strongBayesSignal({
        prime: 40,
        previousPrime: 40,
        probUp: 99.9999,
        previousProbUp: 100,
        probDown: 40,
        previousProbDown: 40,
        threshold: 15,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      }),
    ).toBe('long')
  })
  it('lets Bill Williams gate on the AC/AO pair plus the jaw alone', () => {
    const base = {
      prime: 40,
      previousPrime: 0,
      probUp: 40,
      previousProbUp: 40,
      probDown: 40,
      previousProbDown: 40,
      threshold: 15,
    }
    expect(strongBayesSignal({ ...base, useBw: false, bull: false, bear: false, awayUp: false, awayDown: false })).toBe(
      'long',
    )
    expect(strongBayesSignal({ ...base, useBw: true, bull: true, bear: false, awayUp: false, awayDown: false })).toBeNull()
    expect(strongBayesSignal({ ...base, useBw: true, bull: true, bear: false, awayUp: true, awayDown: false })).toBe('long')
    expect(strongBayesSignal({ ...base, useBw: true, bull: false, bear: true, awayUp: true, awayDown: false })).toBeNull()
    const short = {
      ...base,
      prime: 0,
      previousPrime: 40,
      probUp: 40,
      probDown: 40,
    }
    expect(strongBayesSignal({ ...short, useBw: false, bull: false, bear: false, awayUp: false, awayDown: false })).toBe(
      'short',
    )
    expect(strongBayesSignal({ ...short, useBw: true, bull: false, bear: true, awayUp: false, awayDown: false })).toBeNull()
    expect(strongBayesSignal({ ...short, useBw: true, bull: false, bear: true, awayUp: false, awayDown: true })).toBe(
      'short',
    )
    // The source's `acIsRed and acIsRed`: shorts need only AC falling.
    expect(strongBayesSignal({ ...short, useBw: true, bull: false, bear: true, awayUp: true, awayDown: true })).toBe(
      'short',
    )
  })
})

describe('calculateBayesianNqqeBankfunds', () => {
  const candles = waveCandles()
  const values = calculateBayesianNqqeBankfunds(candles, defaults)

  it('uses an SMA awesome oscillator, not an EMA', () => {
    const hl2 = candles.map((candle) => (candle.high + candle.low) / 2)
    const smaAo = ta.sma(hl2, 5).map((value, i) => {
      const slow = ta.sma(hl2, 34)[i]
      return value === null || slow === null ? null : value - slow
    })
    const emaAo = ta.ema(hl2, 5).map((value, i) => {
      const slow = ta.ema(hl2, 34)[i]
      return value === null || slow === null ? null : value - slow
    })
    expect(values.ao[80]).toBeCloseTo(smaAo[80]!)
    expect(values.ao[80]).not.toBeCloseTo(emaAo[80]!)
  })

  it('does not let stored alligator offsets change the scores', () => {
    const shifted = calculateBayesianNqqeBankfunds(candles, {
      ...defaults,
      lipsOffset: 0,
      teethOffset: 0,
      jawOffset: 0,
    })
    expect(shifted.prime).toEqual(values.prime)
    expect(shifted.probUp).toEqual(values.probUp)
    expect(shifted.probDown).toEqual(values.probDown)
    expect(shifted.jaw).toEqual(values.jaw)
    expect(shifted.nqqe).toEqual(values.nqqe)
    expect(shifted.fundtrend).toEqual(values.fundtrend)
  })

  it('keeps the nQQE source off the Bayesian half', () => {
    const opened = calculateBayesianNqqeBankfunds(candles, { ...defaults, nqqeSource: 'open' })
    expect(opened.prime).toEqual(values.prime)
    expect(opened.nqqe).not.toEqual(values.nqqe)
  })

  it('sends a falling tape to prime 0 and break-up 100 through the up/down swap', () => {
    const falling = calculateBayesianNqqeBankfunds(fallingCandles(), defaults)
    // No close above the upper band in the window → the up-side P is 0 → the
    // red score and prime are nz(0/0) = 0, and the green score (the DOWN
    // probabilities) sits at exactly 1.
    expect(falling.prime.at(-1)).toBe(0)
    expect(falling.probDown.at(-1)).toBe(0)
    expect(falling.probUp.at(-1)).toBe(100)
  })

  it('leaves a flat tape unfunded, because 0/0 is na in Pine', () => {
    const flat = calculateBayesianNqqeBankfunds(flatCandles(), defaults)
    expect(flat.fundtrend.at(-1)).toBeNull()
    expect(flat.bullbear.at(-1)).toBeNull()
    expect(flat.bankerColors.at(-1)).toBe(BAYES_COLORS.bankerGreen)
  })

  it('feeds the same signal, colour and entry helpers the pane plots', () => {
    for (let i = 1; i < candles.length; i++) {
      const signal = strongBayesSignal({
        prime: values.prime[i] ?? null,
        previousPrime: values.prime[i - 1] ?? null,
        probUp: values.probUp[i] ?? null,
        previousProbUp: values.probUp[i - 1] ?? null,
        probDown: values.probDown[i] ?? null,
        previousProbDown: values.probDown[i - 1] ?? null,
        threshold: defaults.lowerThreshold,
        useBw: false,
        bull: false,
        bear: false,
        awayUp: false,
        awayDown: false,
      })
      expect(values.longSignal[i] !== null).toBe(signal === 'long')
      expect(values.shortSignal[i] !== null).toBe(signal === 'short')
      const fund = values.fundtrend[i]
      const slow = values.bullbear[i]
      if (fund !== null && slow !== null) {
        // xrf(fund*0.95, 1): the previous drop reference, falling back to the
        // current one when the bar before is null.
        const dropReference = values.fundtrend[i - 1] ?? fund
        expect(values.bankerColors[i]).toBe(bankerBodyColor(fund, dropReference * 0.95, slow))
        expect(values.entry[i] !== null).toBe(
          isBankerEntry(fund, values.fundtrend[i - 1] ?? null, slow, values.bullbear[i - 1] ?? null),
        )
      }
      expect(values.nqqeColors[i]).toBe(nqqeColor(values.nqqe[i] ?? null))
    }
  })

  it('gates Bill Williams signals on the jaw only, plus the AC/AO pair', () => {
    const gated = calculateBayesianNqqeBankfunds(candles, { ...defaults, useBwConfirmation: true })
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!
      if (gated.longSignal[i] !== null) {
        expect(values.longSignal[i]).not.toBeNull()
        // Away up = open and close beyond the jaw. No lips, no teeth.
        expect(candle.open > gated.jaw[i]! && candle.close > gated.jaw[i]!).toBe(true)
        // Green side: AC rising and AO rising.
        expect(gated.ac[i]! > gated.ac[i - 1]!).toBe(true)
        expect(gated.ao[i]! > gated.ao[i - 1]!).toBe(true)
      }
      if (gated.shortSignal[i] !== null) {
        expect(candle.open < gated.jaw[i]! && candle.close < gated.jaw[i]!).toBe(true)
        expect(gated.ac[i]! > gated.ac[i - 1]!).toBe(false)
      }
    }
  })

  it('aligns every plot to the candles, with finite or null values', () => {
    const plots = bayesianNqqePlots(values, defaults)
    for (const plot of plots) {
      expect(plot.values).toHaveLength(candles.length)
      expect(plot.values.every((value) => value === null || Number.isFinite(value))).toBe(true)
    }
    expect(plots.filter((plot) => !plot.hideLegend).map((plot) => plot.title)).toEqual([
      'Break Down',
      'Break Up',
      'Prime',
      'nQQE',
    ])
    const columns = plots.find((plot) => plot.style === 'columns' && plot.title === 'Banker Fund')
    expect(columns?.base).toEqual(values.bullbear)
    expect(columns?.colorMode).toBeUndefined()
    const nqqe = plots.find((plot) => plot.title === 'nQQE')
    expect(nqqe?.colorMode).toBe('bar')
    expect(nqqe?.style).toBe('area')
    expect(nqqe?.histbase).toBe(50)
    expect(nqqe?.transp).toBe(30)
    expect(plots.find((plot) => plot.title === 'Break Down')?.transp).toBe(60)
    expect(plots.find((plot) => plot.title === 'Prime')?.style).toBe('area')
    // The published 0→50 yellow entry block, and the dashed 40/60 levels.
    const entry = plots.find((plot) => plot.title === 'Banker entry')
    expect(entry?.style).toBe('columns')
    expect(entry?.base?.every((base) => base === 0)).toBe(true)
    expect(entry?.values.every((value) => value === null || value === 50)).toBe(true)
    expect(plots.find((plot) => plot.horizontalLine === 40)?.dashed).toBe(true)
    expect(plots.find((plot) => plot.horizontalLine === 60)?.dashed).toBe(true)
    const point = indicatorPlotData(candles, columns!).find((item) => 'base' in item)
    expect(point && 'base' in point && Number.isFinite(point.base)).toBe(true)
    expect(builtInPlots(candles, indicator).map((plot) => plot.title)).toEqual(
      plots.map((plot) => plot.title),
    )
  })

  it('defaults a missing settings field and rejects a bad one', () => {
    expect(bayesianNqqeSettings({})).toEqual(defaults)
    expect(bayesianNqqeIndicatorLabel(indicator)).toBe(
      'Bayesian/nQQE/BankFunds (20, 2.5, 5, 34, 5, 34, 13, 5, 8, 13, 3, 5, 8, 20, 20, 15, close, 14, 5)',
    )
    expect(bayesianNqqeIndicatorLabel({ ...indicator, bayesianNqqe: undefined })).toBe(
      'Bayesian/nQQE/BankFunds (20, 2.5, 5, 34, 5, 34, 13, 5, 8, 13, 3, 5, 8, 20, 20, 15, close, 14, 5)',
    )
    expect(() => calculateBayesianNqqeBankfunds(candles, { ...defaults, bbSmaPeriod: 0 })).toThrow(
      /Bayesian/,
    )
  })
})

describe('bayesian floating window', () => {
  const candles = waveCandles()
  const values = calculateBayesianNqqeBankfunds(candles, defaults)

  it('slices the same calculate output and spans actual highs and lows', () => {
    const bars = 20
    const model = bayesianNqqeHudModel(values, defaults, {
      times: candles.map((candle) => candle.time),
      timeframe: '1m',
      bars,
      index: candles.length - 1,
    })
    const start = candles.length - bars
    expect(model.traces.find((trace) => trace.title === 'Prime')?.values).toEqual(
      values.prime.slice(start),
    )
    expect(model.traces.find((trace) => trace.title === 'nQQE')?.values).toEqual(
      values.nqqe.slice(start),
    )
    expect(model.columns).toBeDefined()
    for (let i = 0; i < bars; i++) {
      const fund = values.fundtrend[start + i]
      const slow = values.bullbear[start + i]
      if (fund === null || slow === null) {
        expect(model.columns!.high[i]).toBeNull()
        expect(model.columns!.low[i]).toBeNull()
      } else {
        expect(model.columns!.high[i]).toBe(Math.max(fund, slow))
        expect(model.columns!.low[i]).toBe(Math.min(fund, slow))
      }
    }
    expect(model.domain.min).not.toBe(-model.domain.max)
    for (const level of model.levels)
      expect(level.value).toBeGreaterThanOrEqual(model.domain.min)
    expect(model.readouts.map((item) => item.label)).toEqual(['Prime', 'nQQE', 'Bank'])
    expect(model.histogram).toBeUndefined()
    expect(oscHudRequestedTimeframes([], '1m', { 'bayesian-nqqe-bankfunds': true })).toEqual([])
  })

  it('does not mirror a one-sided range about zero', () => {
    const domain = oscHudDataDomain([[10, 20, 30]])
    expect(domain.min).toBeGreaterThan(0)
    expect(domain.min).toBeLessThan(10)
    expect(domain.max).toBeGreaterThan(30)
    expect(domain.min).not.toBe(-domain.max)
  })

  it('names warmup, a fresh signal, sideways, then nQQE, then the banker, then prime', () => {
    expect(
      bayesianNqqeVerdict({
        prime: null,
        previousPrime: null,
        probUp: null,
        probDown: null,
        nqqe: null,
        fund: null,
        slow: null,
        previousFund: null,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('WARMING UP')
    expect(
      bayesianNqqeVerdict({
        prime: 40,
        previousPrime: 0,
        probUp: 40,
        probDown: 40,
        nqqe: 20,
        fund: 60,
        slow: 40,
        previousFund: 55,
        threshold: 15,
        longSignal: true,
        shortSignal: false,
      }).text,
    ).toBe('▲ STRONG LONG')
    expect(
      bayesianNqqeVerdict({
        prime: 5,
        previousPrime: 4,
        probUp: 5,
        probDown: 5,
        nqqe: 20,
        fund: 60,
        slow: 40,
        previousFund: 55,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('— SIDEWAYS')
    expect(
      bayesianNqqeVerdict({
        prime: 40,
        previousPrime: 30,
        probUp: 40,
        probDown: 40,
        nqqe: 62,
        fund: 60,
        slow: 40,
        previousFund: 55,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('▲ nQQE UPTREND')
    expect(
      bayesianNqqeVerdict({
        prime: 40,
        previousPrime: 30,
        probUp: 40,
        probDown: 40,
        nqqe: 62,
        fund: 10,
        slow: 20,
        previousFund: 10.2,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('▲ nQQE UPTREND')
    expect(
      bayesianNqqeVerdict({
        prime: 40,
        previousPrime: 30,
        probUp: 40,
        probDown: 40,
        nqqe: null,
        fund: 10,
        slow: 20,
        previousFund: 10.2,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('▲ BANKER REBOUND')
    expect(
      bayesianNqqeVerdict({
        prime: 40,
        previousPrime: 30,
        probUp: 40,
        probDown: 40,
        nqqe: null,
        fund: null,
        slow: null,
        previousFund: null,
        threshold: 15,
        longSignal: false,
        shortSignal: false,
      }).text,
    ).toBe('▲ PRIME RISING')
  })

  it('draws banker columns between the two prices, not from zero', () => {
    const blank = (length: number): BayesianNqqeValues => ({
      probDown: Array(length).fill(20),
      probUp: Array(length).fill(30),
      prime: Array(length).fill(40),
      nqqe: Array(length).fill(70),
      nqqeTrail: Array(length).fill(60),
      nqqeAtr: Array(length).fill(1),
      fundtrend: Array(length).fill(80),
      bullbear: Array(length).fill(40),
      longSignal: Array(length).fill(null),
      shortSignal: Array(length).fill(null),
      entry: Array(length).fill(null),
      ao: Array(length).fill(1),
      ac: Array(length).fill(1),
      lips: Array(length).fill(1),
      teeth: Array(length).fill(1),
      jaw: Array(length).fill(1),
      nqqeColors: Array(length).fill(BAYES_COLORS.nqqeYellow),
      bankerColors: Array(length).fill(BAYES_COLORS.bankerGreen),
    })
    const count = 8
    const model = bayesianNqqeHudModel(blank(count), defaults, {
      times: Array.from({ length: count }, (_, i) => i * 60),
      timeframe: '1m',
      bars: count,
      index: count - 1,
    })
    const markup = renderToStaticMarkup(
      createElement(OscHudCard, {
        model,
        dock: 'bayes',
        indicator: null,
        bars: count,
        onZoom: () => {},
        history: { behind: 0, older: 0, label: null },
        onPan: () => {},
        onEditIndicator: () => {},
        onAddIndicator: () => {},
        onClose: () => {},
      }),
    )
    const geometry = oscHudGeometry(count, model.domain)
    const drawn = markup.match(/<rect[^>]*>/g) ?? []
    expect(drawn.length).toBe(count)
    expect(markup).toContain('osc-hud-columns')
    expect(markup).not.toContain('osc-hud-histogram')
    const yHigh = geometry.y(80)
    const yLow = geometry.y(40)
    const top = Math.min(yHigh, yLow)
    const height = Math.max(1, Math.abs(yHigh - yLow))
    expect(drawn[0]).toContain(`y="${top}"`)
    expect(drawn[0]).toContain(`height="${height}"`)
    expect(Math.abs(top + height - geometry.zeroY) > 0.51 && Math.abs(top - geometry.zeroY) > 0.51).toBe(
      true,
    )
  })
})
