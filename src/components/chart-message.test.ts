import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartMessagePlate, ChartMessageText, SrBreakLabel } from './ChartMessage'
import { SR_BREAK_LABEL_SIZE } from '../lib/chart-message'
import { SR_BREAKS_RETESTS_COLORS } from '../lib/sr-breaks-retests'

const anchor = { x: 200, y: 100 }
const rectTags = (markup: string) => markup.match(/<rect[^>]*>/g) ?? []
const textTags = (markup: string) => markup.match(/<text[^>]*>/g) ?? []
/** The plate's `y`; `\s` keeps `stroke-opacity="…"` from matching. */
const plateY = (markup: string) => Number(/\sy="(-?[\d.]+)"/.exec(rectTags(markup)[0]!)![1])

describe('in-chart messages', () => {
  it('never fills the plate behind a message', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartMessagePlate, { x: 10, y: 20, width: 60, height: 17, color: '#2b6d2d' }),
    )
    expect(markup).toContain('class="chart-message-plate"')
    expect(markup).toContain('fill="none"')
    // The published color is an outline only.
    expect(markup).toContain('stroke="#2b6d2d"')
    expect(markup).not.toContain('fill="#2b6d2d"')
  })

  it('halos the glyphs instead of backing them with a background', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartMessageText, {
        x: 4,
        y: 9,
        color: '#d1d4dc',
        size: 7,
        children: 'Vol: 12',
      }),
    )
    expect(markup).toContain('class="chart-message chart-message--small"')
    expect(markup).toContain('>Vol: 12</text>')
  })

  it('draws the Break Res label as a transparent outline with colored glyphs', () => {
    const markup = renderToStaticMarkup(
      createElement(SrBreakLabel, {
        kind: 'break-resistance',
        anchor,
        color: SR_BREAKS_RETESTS_COLORS.breakResistance,
        textColor: SR_BREAKS_RETESTS_COLORS.breakResistanceText,
      }),
    )

    // No filled plate: every rect in the label is transparent.
    for (const rect of rectTags(markup)) expect(rect).toContain('fill="none"')
    expect(rectTags(markup)).toHaveLength(1)
    expect(markup).toContain('data-testid="sr-break-label"')
    expect(markup).toContain('>Break Res</text>')

    const text = textTags(markup)[0]
    expect(text).toContain(`fill="${SR_BREAKS_RETESTS_COLORS.breakResistanceText}"`)
    expect(text).toContain('class="chart-message"')

    // Resistance breaks sit below the anchor, support breaks above it.
    expect(plateY(markup)).toBeCloseTo(anchor.y + SR_BREAK_LABEL_SIZE.gap)
  })

  it('draws the Break Sup label above the anchor', () => {
    const markup = renderToStaticMarkup(
      createElement(SrBreakLabel, {
        kind: 'break-support',
        anchor,
        color: SR_BREAKS_RETESTS_COLORS.breakSupport,
        textColor: SR_BREAKS_RETESTS_COLORS.breakSupportText,
      }),
    )
    expect(markup).toContain('>Break Sup</text>')
    for (const rect of rectTags(markup)) expect(rect).toContain('fill="none"')
    expect(plateY(markup)).toBeCloseTo(
      anchor.y - SR_BREAK_LABEL_SIZE.height - SR_BREAK_LABEL_SIZE.gap,
    )
  })
})
