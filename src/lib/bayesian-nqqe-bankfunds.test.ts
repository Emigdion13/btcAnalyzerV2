import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OscHudCard } from '../components/OscHudCard'
import { ta } from './indicator-runtime'
import { builtInPlots } from './indicators'
import { indicatorPlotData } from './indicator-plot-series'
import {
  BAYES_AT_HUNDRED,
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

describe('published Bayes product', () => {
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
})

describe('nQQE and banker helpers', () => {
  it('is RSI smoothed by an SMA-seeded EMA, minus 50, and the trail uses 4.236', () => {
    const candles = waveCandles()
    const src = candles.map((candle) => candle.close)
    const published = nqqeLines(src, 14, 5)
    const other = nqqeLines(src, 14, 5, 1)
    expect(NQQE_FACTOR).toBe(4.236)
    expect(published.trail).not.toEqual(other.trail)
    expect(defaults).not.toHaveProperty('qqeFactor')
    const index = published.fast.findIndex(
      (value, i) => value !== null && published.trail[i] !== null && published.atr[i] !== null,
    )
    expect(index).toBeGreaterThan(0)
    expect(published.fast[index]! - published.trail[index]!).toBeCloseTo(
      published.atr[index]! * NQQE_FACTOR,
    )
    const values = calculateBayesianNqqeBankfunds(candles, defaults)
    expect(values.nqqe).toEqual(published.fast)
    expect(values.nqqe).toEqual(
      ta.ema(ta.rsi(src, 14), 5).map((value) => (value === null ? null : value - 50)),
    )
  })
  it('builds the xsa window as src[1]..src[len] at the first valid bar', () => {
    const src = [1, 2, 3, 4, 5, 6]
    const out = xsa(src, 3, 1)
    expect(out[3]).toBe(3)
    expect(out[4]).toBeCloseTo(11 / 3)
    expect(out.slice(0, 3)).toEqual([null, null, null])
  })
  it('paints banker bodies in later-wins order and requires both ends of an entry under 25', () => {
    expect(bankerBodyColor(30, 31, 20)).toBe(BAYES_COLORS.bankerGreen)
    expect(bankerBodyColor(30, 40, 20)).toBe(BAYES_COLORS.bankerWhite)
    expect(bankerBodyColor(10, 20, 15)).toBe(BAYES_COLORS.bankerRed)
    expect(bankerBodyColor(10, 10.2, 15)).toBe(BAYES_COLORS.bankerBlue)
    expect(bankerBodyColor(10, null, 15)).toBe(BAYES_COLORS.bankerBlue)
    expect(isBankerEntry(20, 10, 15, 18)).toBe(true)
    expect(isBankerEntry(30, 10, 20, 22)).toBe(false)
    expect(isBankerEntry(22, 10, 26, 28)).toBe(false)
    expect(isBankerEntry(18, 20, 15, 12)).toBe(false)
    expect(isBankerEntry(20, null, 15, 18)).toBe(false)
  })
  it('lets Bill Williams confirmation block a signal, and ignores it when the toggle is off', () => {
    const base = {
      prime: 40,
      previousPrime: 0,
      probUp: 40,
      previousProbUp: 40,
      probDown: 40,
      previousProbDown: 40,
      threshold: 15,
    }
    expect(strongBayesSignal({ ...base, useBw: false, awayUp: false, awayDown: false })).toBe('long')
    expect(strongBayesSignal({ ...base, useBw: true, awayUp: false, awayDown: false })).toBeNull()
    expect(strongBayesSignal({ ...base, useBw: true, awayUp: true, awayDown: false })).toBe('long')
    const short = {
      ...base,
      prime: 0,
      previousPrime: 40,
      probUp: 40,
      probDown: 40,
    }
    expect(strongBayesSignal({ ...short, useBw: false, awayUp: false, awayDown: false })).toBe('short')
    expect(strongBayesSignal({ ...short, useBw: true, awayUp: false, awayDown: false })).toBeNull()
    expect(strongBayesSignal({ ...short, useBw: true, awayUp: false, awayDown: true })).toBe('short')
    expect(BAYES_AT_HUNDRED).toBe(1e-4)
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

  it('returns 0 prime once a falling tape has warmed up, because the up factor is 0', () => {
    const falling = calculateBayesianNqqeBankfunds(fallingCandles(), defaults)
    const last = falling.prime.at(-1)
    expect(last).toBe(0)
    expect(falling.probUp.at(-1)).toBe(0)
  })

  it('settles a flat tape at fund 50 and paints it green', () => {
    const flat = calculateBayesianNqqeBankfunds(flatCandles(), defaults)
    expect(flat.fundtrend.at(-1)).toBe(50)
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
        awayUp: false,
        awayDown: false,
      })
      expect(values.longSignal[i] !== null).toBe(signal === 'long')
      expect(values.shortSignal[i] !== null).toBe(signal === 'short')
      const fund = values.fundtrend[i]
      const slow = values.bullbear[i]
      if (fund !== null && slow !== null) {
        expect(values.bankerColors[i]).toBe(bankerBodyColor(fund, values.fundtrend[i - 1] ?? null, slow))
        expect(values.entry[i] !== null).toBe(
          isBankerEntry(fund, values.fundtrend[i - 1] ?? null, slow, values.bullbear[i - 1] ?? null),
        )
      }
      expect(values.nqqeColors[i]).toBe(nqqeColor(values.nqqe[i] ?? null))
    }
  })

  it('drops a Bill Williams long that is not beyond the unshifted alligator', () => {
    const gated = calculateBayesianNqqeBankfunds(candles, { ...defaults, useBwConfirmation: true })
    for (let i = 0; i < candles.length; i++) {
      if (gated.longSignal[i] !== null) {
        expect(values.longSignal[i]).not.toBeNull()
        expect(candles[i]!.open > gated.jaw[i]!).toBe(true)
        expect(candles[i]!.close > gated.lips[i]!).toBe(true)
      }
      if (values.longSignal[i] !== null && gated.longSignal[i] === null) {
        const away =
          gated.jaw[i] !== null &&
          gated.teeth[i] !== null &&
          gated.lips[i] !== null &&
          candles[i]!.open > gated.jaw[i]! &&
          candles[i]!.close > gated.jaw[i]! &&
          candles[i]!.open > gated.teeth[i]! &&
          candles[i]!.close > gated.teeth[i]! &&
          candles[i]!.open > gated.lips[i]! &&
          candles[i]!.close > gated.lips[i]!
        expect(away).toBe(false)
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
    const columns = plots.find((plot) => plot.style === 'columns')
    expect(columns?.base).toEqual(values.bullbear)
    expect(columns?.colorMode).toBeUndefined()
    expect(plots.find((plot) => plot.title === 'nQQE')?.colorMode).toBe('bar')
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
        nqqe: 12,
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
      momentum: Array(length).fill(10),
      nqqe: Array(length).fill(4),
      nqqeTrail: Array(length).fill(1),
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
        onEditIndicator: () => {},
        onAddIndicator: () => {},
        onClose: () => {},
      }),
    )
    const geometry = oscHudGeometry(count, model.domain)
    const rects = markup.match(/<rect[^>]*class="|"/g) ? markup.match(/<rect[^>]*>/g) ?? [] : []
    const columns = (markup.match(/<rect[^>]*>/g) ?? []).filter((rect) => rect.includes('col-') === false)
    // Keys are not attributes. The column group is the only rect source: no histogram.
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
    expect(columns).toBeDefined()
    expect(rects).toBeDefined()
  })
})
