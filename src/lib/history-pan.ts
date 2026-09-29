/**
 * Walking a floating window back through history.
 *
 * The floating windows — the timeframe peek and the oscillator cards — show the newest few bars.
 * Dragging a window's plot sideways (or its ‹ › buttons) scrolls that window through the bars the
 * chart already holds, and "live" snaps it back to the newest bar.
 *
 * A panned window is anchored to a bar _time_, not to "N bars ago": a candle closing while you
 * study an old wave must not slide the wave out from under you, and a timeframe or symbol switch
 * lands on the same moment instead of an index that means something else there. `null` is the
 * live window, which follows new candles as they arrive.
 */

export type HistoryAnchor = number | null

/** The fewest bars a window can hold: all of them when the history is shorter than the window. */
const fullWindow = (length: number, bars: number): number => Math.min(length, Math.max(1, bars))

/**
 * Exclusive end index of a `bars`-wide window over ascending `times`, anchored at `anchor`: the
 * bar at or before the anchor is the window's newest bar. The window stays full whenever the
 * history allows it, so an anchor older than the loaded history shows the oldest bars there are.
 */
export function historyEnd(times: readonly number[], anchor: HistoryAnchor, bars: number): number {
  const length = times.length
  if (anchor === null || !length) return length
  // First index whose time is past the anchor — the times are ascending, so bisect.
  let lo = 0
  let hi = length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= anchor) lo = mid + 1
    else hi = mid
  }
  return Math.min(length, Math.max(fullWindow(length, bars), lo))
}

/**
 * Move a window `delta` bars through history — negative is back in time — and return its new
 * anchor. Reaching the newest bar returns `null`, so the window follows live candles again rather
 * than freezing on whatever the last bar was when you got there.
 */
export function panHistory(
  times: readonly number[],
  anchor: HistoryAnchor,
  bars: number,
  delta: number,
): HistoryAnchor {
  const length = times.length
  if (!length) return null
  const end = Math.min(
    length,
    Math.max(fullWindow(length, bars), historyEnd(times, anchor, bars) + Math.round(delta)),
  )
  return end >= length ? null : times[end - 1]!
}

/** Bars one click of a window's ‹ › buttons moves: a quarter of the window, never less than one. */
export const historyStep = (bars: number): number => Math.max(1, Math.round(bars / 4))

/** Where a window sits in its history, for its controls and its "you are looking back" label. */
export interface WindowHistory {
  /** Bars between the window's newest bar and the live one: 0 while it follows live candles. */
  behind: number
  /** Bars older than the window that it can still scroll back to. */
  older: number
  /** When the window's newest bar opened (UTC), once it is scrolled back; null while live. */
  label: string | null
}

export function windowHistory(times: readonly number[], end: number, bars: number): WindowHistory {
  const behind = Math.max(0, times.length - end)
  const newest = times[end - 1]
  return {
    behind,
    older: Math.max(0, end - Math.max(1, bars)),
    label: behind > 0 && newest !== undefined ? historyLabel(newest, times.at(-1)!) : null,
  }
}

/**
 * A bar time as the UTC clock the windows speak — "14:32" on the live bar's own day, "28/9 14:32"
 * once the look back crosses midnight, so a scrolled window never passes yesterday off as today.
 */
export function historyLabel(seconds: number, liveSeconds: number): string {
  const date = new Date(seconds * 1000)
  const clock = date.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const sameDay = Math.floor(seconds / 86_400) === Math.floor(liveSeconds / 86_400)
  return sameDay ? clock : `${date.getUTCDate()}/${date.getUTCMonth() + 1} ${clock}`
}
