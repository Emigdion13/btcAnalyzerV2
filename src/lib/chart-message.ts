/**
 * Styling contract for messages drawn inside the chart pane — SR break labels,
 * drawing tags, measure badges, zone captions. Every one of them is transparent:
 *
 * - the plate behind a message is an outline only (`fill: none`), so the price
 *   action behind the message always stays visible;
 * - legibility comes from a dark halo stroked behind the glyphs
 *   (`paint-order: stroke`) instead of a solid background hiding the candles.
 *
 * The class names are styled in `src/styles.css` and applied by
 * `src/components/ChartMessage.tsx`; keep all three in sync.
 */
export const CHART_MESSAGE_TEXT_CLASS = 'chart-message'
export const CHART_MESSAGE_SMALL_CLASS = 'chart-message--small'
export const CHART_MESSAGE_PLATE_CLASS = 'chart-message-plate'
/** Glyphs at or below this size get the thinner halo. */
const SMALL_TEXT_SIZE = 8

/** Class list for an in-chart caption: the halo, the small-glyph variant, extras. */
export function chartMessageClass(size: number, extra?: string): string {
  return [
    CHART_MESSAGE_TEXT_CLASS,
    size <= SMALL_TEXT_SIZE ? CHART_MESSAGE_SMALL_CLASS : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Matches the published break-label footprint: a 60 × 17 box with a 5 px pointer. */
export const SR_BREAK_LABEL_SIZE = { width: 60, height: 17, gap: 7, pointer: 5 } as const
