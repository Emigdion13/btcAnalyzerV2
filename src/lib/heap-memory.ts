/** Chromium's non-standard JS heap snapshot. Other browsers typically omit it. */
export type HeapMemorySource = {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
    jsHeapSizeLimit?: number
  }
}

export type HeapSample = {
  at: number
  used: number
  total: number
  limit: number
}

export type HeapPressure = 'ok' | 'watch' | 'high' | 'critical'

/** About three minutes at a 2s poll, enough to see a leak vs. GC sawtooth. */
export const HEAP_HISTORY_LIMIT = 90

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function readHeapMemory(
  source: HeapMemorySource | undefined = typeof performance === 'undefined'
    ? undefined
    : (performance as HeapMemorySource),
  now = Date.now(),
): HeapSample | null {
  const memory = source?.memory
  if (!memory) return null
  const used = memory.usedJSHeapSize
  const total = memory.totalJSHeapSize
  const limit = memory.jsHeapSizeLimit
  if (
    !finiteNonNegative(used) ||
    !finiteNonNegative(total) ||
    !finiteNonNegative(limit) ||
    limit <= 0
  )
    return null
  return { at: now, used, total, limit }
}

export function heapShare(sample: HeapSample): number {
  return Math.min(100, Math.max(0, (sample.used / sample.limit) * 100))
}

export function heapPressure(sample: HeapSample): HeapPressure {
  const share = heapShare(sample)
  if (share >= 90) return 'critical'
  if (share >= 75) return 'high'
  if (share >= 50) return 'watch'
  return 'ok'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`
}

export function formatHeapShare(sample: HeapSample): string {
  const share = heapShare(sample)
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`
}

export function recordHeapSample(
  history: HeapSample[],
  sample: HeapSample,
  limit = HEAP_HISTORY_LIMIT,
): HeapSample[] {
  if (limit <= 0) return []
  if (history.length === 0) return [sample]
  const last = history[history.length - 1]
  // Drop no-op ticks so the sparkline is the real shape, not a flat line of duplicates.
  if (last.used === sample.used && last.total === sample.total && last.limit === sample.limit)
    return history
  if (history.length < limit) return [...history, sample]
  return [...history.slice(history.length - limit + 1), sample]
}

export function heapSparkline(history: HeapSample[], width = 168, height = 36): string {
  if (history.length < 2) return ''
  const values = history.map((sample) => sample.used)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * (height - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function heapDelta(from: HeapSample | null, to: HeapSample | null): number | null {
  if (!from || !to) return null
  return to.used - from.used
}

export function formatSignedBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const sign = bytes > 0 ? '+' : '−'
  return `${sign}${formatBytes(Math.abs(bytes))}`
}
