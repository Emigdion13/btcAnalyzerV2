import { useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from './ui'
import {
  formatBytes,
  formatHeapShare,
  formatSignedBytes,
  heapDelta,
  heapPressure,
  heapShare,
  heapSparkline,
  readHeapMemory,
  recordHeapSample,
  type HeapSample,
} from '../lib/heap-memory'

const POLL_MS = 2000

export function HeapMemoryMeter() {
  const [sample, setSample] = useState<HeapSample | null>(() => readHeapMemory())
  const firstRef = useRef<HeapSample | null>(sample)
  const peakRef = useRef(sample?.used ?? 0)
  const [peak, setPeak] = useState(sample?.used ?? 0)
  const [history, setHistory] = useState<HeapSample[]>(() => (sample ? [sample] : []))

  useEffect(() => {
    const take = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const next = readHeapMemory()
      if (!next) return
      if (!firstRef.current) firstRef.current = next
      if (next.used > peakRef.current) {
        peakRef.current = next.used
        setPeak(next.used)
      }
      setSample(next)
      setHistory((previous) => recordHeapSample(previous, next))
    }
    take()
    const timer = window.setInterval(take, POLL_MS)
    const onVisibility = () => {
      if (!document.hidden) take()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const pressure = sample ? heapPressure(sample) : 'ok'
  const share = sample ? heapShare(sample) : 0
  const spark = useMemo(() => heapSparkline(history), [history])
  const grown = heapDelta(firstRef.current, sample)
  const label = sample
    ? `JavaScript heap ${formatBytes(sample.used)} · ${formatHeapShare(sample)} of this tab’s heap limit`
    : 'This browser does not report JavaScript heap size'

  return (
    <Dropdown
      className="heap-meter-dropdown"
      trigger={() => (
        <button className={`heap-meter ${pressure}`} aria-label={label} title={label}>
          <span>RAM</span>
          <span className="mono">{sample ? formatBytes(sample.used) : 'n/a'}</span>
          {sample && (
            <span className="heap-meter-bar" aria-hidden="true">
              <i style={{ width: `${share}%` }} />
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <div className="heap-meter-panel">
          <div className="menu-label">THIS TAB · JS HEAP</div>
          {sample ? (
            <>
              <div className="heap-meter-stats">
                <div>
                  <span>Used</span>
                  <strong className="mono">{formatBytes(sample.used)}</strong>
                </div>
                <div>
                  <span>Allocated</span>
                  <strong className="mono">{formatBytes(sample.total)}</strong>
                </div>
                <div>
                  <span>Limit</span>
                  <strong className="mono">{formatBytes(sample.limit)}</strong>
                </div>
                <div>
                  <span>Of limit</span>
                  <strong className="mono">{formatHeapShare(sample)}</strong>
                </div>
                <div>
                  <span>Peak this session</span>
                  <strong className="mono">{formatBytes(peak)}</strong>
                </div>
                <div>
                  <span>Since load</span>
                  <strong className="mono">{grown == null ? '—' : formatSignedBytes(grown)}</strong>
                </div>
              </div>
              {spark && (
                <svg
                  className="heap-meter-spark"
                  viewBox="0 0 168 36"
                  width="168"
                  height="36"
                  aria-hidden="true"
                >
                  <polyline
                    points={spark}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <p>
                Chromium reports the JavaScript heap, not the whole tab — canvas, GPU, and workers
                sit outside it. A rising line over hours is a leak; a sawtooth is the garbage
                collector doing its job.
              </p>
            </>
          ) : (
            <p>
              Firefox and Safari do not expose heap size to the page. Open Atlas in Chrome or Edge
              to watch used JS memory from this status bar.
            </p>
          )}
        </div>
      )}
    </Dropdown>
  )
}
