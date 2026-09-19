/**
 * Scheduled memory maintenance.
 *
 * The market services deliberately keep their caches between requests — histories,
 * quotes, level2 books, REST pages — and every one of them is bounded, but together
 * they idle at tens of megabytes for pairs nobody is watching any more. The V8 heap
 * also grows lazily between major collections, so resident RSS ramps even while live
 * data stays flat. The maintenance sweep drops everything no active chart still needs
 * and, when Node runs with `--expose-gc`, forces a full collection so the freed pages
 * go back to the operating system instead of waiting for heap pressure.
 */

export const DEFAULT_MAINTENANCE_MINUTES = 30

/** Counts of cache entries dropped by one sweep, for the log line. */
export type PurgeReport = {
  histories: number
  quotes: number
  tradeIds: number
  failures: number
  restEntries: number
  pages: number
  sampleBuffers: number
}

export const EMPTY_PURGE_REPORT: PurgeReport = {
  histories: 0,
  quotes: 0,
  tradeIds: 0,
  failures: 0,
  restEntries: 0,
  pages: 0,
  sampleBuffers: 0,
}

/**
 * Parse `ATLAS_MAINTENANCE_MINUTES`.
 *
 * Defaults to 30 minutes; `0` disables the sweep entirely. Anything else that is not
 * an integer up to a week is a typo that would silently disable maintenance, so it
 * throws the same way an invalid `PORT` does.
 */
export function parseMaintenanceMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAINTENANCE_MINUTES
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 10_080)
    throw new Error('ATLAS_MAINTENANCE_MINUTES must be an integer from 0 (disabled) to 10080.')
  return value
}

/** Run one full garbage collection when Node was started with `--expose-gc`. */
export function collectGarbage(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc
  if (typeof gc !== 'function') return false
  gc()
  return true
}

/** Resident set size in whole megabytes, for the sweep's one-line log. */
export function rssMegabytes(): number {
  return Math.round((process.memoryUsage().rss / 1048576) * 10) / 10
}
