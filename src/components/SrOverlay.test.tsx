import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SrOverlay } from './SrOverlay'
import { calculateSrBreaks } from '../lib/sr-breaks-retests'
import { SR_BREAKS_DEFAULTS } from '../lib/types'
import type { Candle, Indicator, SrBreaksSettings } from '../lib/types'

function bar(index: number, close: number, volume: number, open = close - 0.1): Candle {
  return {
    time: 1_700_000_000 + index * 60,
    open,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
  }
}

function settings(overrides: Partial<SrBreaksSettings> = {}): SrBreaksSettings {
  return {
    ...SR_BREAKS_DEFAULTS,
    lookbackPeriod: 2,
    volumeFilterLength: 2,
    atrLength: 2,
    boxWidth: 1,
    maxBoxes: 50,
    ...overrides,
  }
}

const indicator: Indicator = {
  id: 'sr-1',
  kind: 'sr-breaks-retests',
  name: 'SR Breaks and Retests',
  period: 2,
  color: '#008000',
  visible: true,
}

/** Ten pixels per bar, ten pixels per price unit, price growing upward. */
const point = (index: number, price: number) => ({ x: index * 10, y: 1000 - price * 10 })

/** Resistance at 12 broken at bar 6, held back at 7, broken again at 8. */
const retestCandles = [10, 11, 12, 11, 12, 12.5, 15, 13.5, 16].map((close, index) =>
  bar(index, close, 10, close + 0.1),
)
/** Support at 8, a second pivot low at 8.2, and a reclaim at bar 7. */
const supportCandles = [10, 9, 8, 9, 10, 9, 8.2, 10, 11, 12].map((close, index) =>
  bar(index, close, index === 4 ? 100 : 10),
)

const markup = (candles: Candle[], overrides: Partial<SrBreaksSettings> = {}) => {
  const sr = settings(overrides)
  return renderToStaticMarkup(
    <SrOverlay
      indicator={indicator}
      settings={sr}
      result={calculateSrBreaks(candles, sr)}
      point={point}
    />,
  )
}

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('SR Breaks and Retests overlay markup', () => {
  it('draws the broken resistance box with the original colors', () => {
    const html = markup(retestCandles)
    expect(html).toContain('data-sr-lookback="2"')
    expect(count(html, 'class="sr-box"')).toBe(1)
    // Broken resistance: green dashed border, 20% green fill, level 12 to 13.46875.
    expect(html).toContain('x="20"')
    expect(html).toContain('y="865.3125"')
    expect(html).toContain('width="70"')
    expect(html).toContain('height="14.6875"')
    expect(html).toContain('fill="#008000"')
    expect(html).toContain('fill-opacity="0.2"')
    expect(html).toContain('stroke="#008000"')
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('Vol: -10')
  })

  it('prints the Break Res label below the level, one bar before the break', () => {
    const html = markup(retestCandles)
    expect(count(html, 'class="sr-break-label"')).toBe(1)
    expect(html).toContain('Break Res')
    // label.style_label_up keeps the body below the anchor at bar 5 / price 12.
    expect(html).toContain('<rect x="21" y="885" width="58" height="15" rx="2" fill="#2b6d2d">')
  })

  it('draws the retest diamond below the plotted bar in green', () => {
    const html = markup(retestCandles)
    expect(count(html, 'class="sr-signal"')).toBe(1)
    expect(html).toContain('M 70 873.5 L 73.5 877 L 70 880.5 L 66.5 877 Z')
    expect(html).toContain('fill="#20ca26"')
    expect(html).toContain('Resistance as Support Holds')
  })

  it('draws support boxes with solid borders and a gradient fill', () => {
    const html = markup(supportCandles)
    expect(count(html, 'class="sr-box"')).toBe(2)
    expect(count(html, 'stroke="#008000"')).toBe(2)
    expect(html).not.toContain('stroke-dasharray')
    // The newest box measured 10 against a 100 maximum: 7% opacity.
    expect(html).toContain('fill-opacity="0.07"')
    expect(html).toContain('fill-opacity="0.7"')
  })

  it('draws the support hold diamond below the bar in green', () => {
    const html = markup(supportCandles)
    expect(count(html, 'class="sr-signal"')).toBe(1)
    expect(html).toContain('Support Holds')
    expect(html).toContain('fill="#20ca26"')
    expect(html).not.toContain('Break Sup')
  })

  it('honors the markup toggles', () => {
    expect(markup(retestCandles, { showBoxes: false })).not.toContain('class="sr-box"')
    expect(markup(retestCandles, { showBreakLabels: false })).not.toContain('Break Res')
    expect(markup(retestCandles, { showRetestSignals: false })).not.toContain('class="sr-signal"')
    expect(markup(supportCandles, { showHoldSignals: false })).not.toContain('class="sr-signal"')
    expect(markup(supportCandles, { showVolumeText: false })).not.toContain('Vol:')
    expect(markup(supportCandles, { showRetestSignals: false })).toContain('class="sr-signal"')
  })
})
