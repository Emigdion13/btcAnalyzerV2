import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, GripVertical, Info, Minus, Plus, RotateCcw, Timer, X } from 'lucide-react'
import type { Candle, ConnectionState, DataSource, Timeframe } from '../lib/types'
import { compactNumber, formatPrice, INTERVAL } from '../lib/market'
import { readStored, useLocalState, writeStored } from '../lib/storage'
import {
  clampPeekBars,
  formatPeekCountdown,
  layoutPeekBars,
  PEEK_AUTO,
  PEEK_BARS_MAX,
  PEEK_BARS_MIN,
  PEEK_RESOLUTIONS,
  peekBarTime,
  peekIsForming,
  peekRatioLabel,
  peekResolutionLabel,
  peekStats,
  peekTimeRemaining,
  peekWindow,
  PEEK_LAYOUT,
} from '../lib/timeframe-peek'
import type { TimeframePeekSettings } from '../lib/timeframe-peek'

const POSITION_KEY = 'timeframe-peek-pos'
type Position = { x: number; y: number }

export interface TimeframePeekFeed {
  /** Resolution the panel is showing, after `auto` has been resolved against the chart. */
  resolution: Timeframe
  candles: Candle[]
  state: ConnectionState
  message: string
  /** The resolution of the chart itself, so the panel can say when it mirrors the chart. */
  chartTimeframe: Timeframe
  /** Only Coinbase owns a retry; demo data is generated locally. */
  retry?: () => void
}

interface Props {
  ticker: string
  source: DataSource
  settings: TimeframePeekSettings
  onChange: (next: TimeframePeekSettings) => void
  onClose: () => void
  feed: TimeframePeekFeed
  upColor: string
  downColor: string
}

/**
 * A floating window onto a second timeframe: the last few bars of another resolution, with the
 * bar that is still forming included and marked. Drag it by the header, pick any resolution from
 * the dropdown (or leave it on auto), and resize the window in bars.
 *
 * It reports the same candles the MTF indicators use, so nothing here is a second opinion about
 * price. A forming bar is an unfinished range — the panel says so instead of dressing the current
 * tick up as a close, and it dims rather than pretending when the feed stops being live.
 */
export function TimeframePeekBox({
  ticker,
  source,
  settings,
  onChange,
  onClose,
  feed,
  upColor,
  downColor,
}: Props) {
  const [minimized, setMinimized] = useLocalState('timeframe-peek-min', false)
  const [showInfo, setShowInfo] = useState(false)
  const [position, setPosition] = useState<Position | null>(() =>
    readStored<Position | null>(POSITION_KEY, null),
  )
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const boxRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const positionRef = useRef<Position | null>(position)
  positionRef.current = position

  // A one-second clock is all the countdown and the forming-bar test need; the candles themselves
  // arrive over the existing market stream.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setNow(Date.now() / 1000)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const clampToStage = useCallback((next: Position): Position => {
    const box = boxRef.current
    const stage = box?.parentElement
    if (!box || !stage) return next
    const { width, height } = box.getBoundingClientRect()
    const area = stage.getBoundingClientRect()
    return {
      x: Math.min(Math.max(6, next.x), Math.max(6, area.width - width - 6)),
      y: Math.min(Math.max(6, next.y), Math.max(6, area.height - height - 6)),
    }
  }, [])

  // The chart box changes size without a window resize event whenever the editor, a side panel,
  // or focus mode moves — and a dragged panel must not end up clipped out of sight by that.
  useEffect(() => {
    const stage = boxRef.current?.parentElement
    if (!stage) return
    const reflow = () => setPosition((p) => (p ? clampToStage(p) : p))
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reflow)
      return () => window.removeEventListener('resize', reflow)
    }
    const observer = new ResizeObserver(reflow)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [clampToStage])

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, select, label, a')) return
    const box = boxRef.current
    const stage = box?.parentElement
    if (!box || !stage) return
    const rect = box.getBoundingClientRect()
    const area = stage.getBoundingClientRect()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left - area.left,
      y: rect.top - area.top,
    }
    setDragging(true)
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const next = clampToStage({
        x: drag.x + (moveEvent.clientX - drag.startX),
        y: drag.y + (moveEvent.clientY - drag.startY),
      })
      positionRef.current = next
      setPosition(next)
    }
    const stop = () => {
      dragRef.current = null
      setDragging(false)
      writeStored(POSITION_KEY, positionRef.current)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const resetPosition = () => {
    positionRef.current = null
    setPosition(null)
    writeStored(POSITION_KEY, null)
  }

  const { resolution, chartTimeframe, candles, state, message, retry } = feed
  const bars = useMemo(() => peekWindow(candles, settings.bars), [candles, settings.bars])
  const last = bars[bars.length - 1]
  const forming = peekIsForming(last, resolution, now)
  const remaining = peekTimeRemaining(last, resolution, now)
  // The meter is the share of the bar's own span that has already elapsed.
  const progress = forming ? Math.min(1, Math.max(0, 1 - remaining / INTERVAL[resolution])) : 1
  const stats = useMemo(() => peekStats(bars), [bars])
  const layout = useMemo(
    () =>
      layoutPeekBars(bars, {
        forming,
        showVolume: settings.showVolume,
      }),
    [bars, forming, settings.showVolume],
  )
  const offline = ['offline', 'stale', 'reconnecting'].includes(state)
  const markTop = Math.min(Math.max(7, layout.lastCloseY), Math.max(7, layout.height - 7))

  return (
    <section
      ref={boxRef}
      className={`peek-box${minimized ? ' is-min' : ''}${dragging ? ' is-dragging' : ''}${
        offline ? ' is-stale' : ''
      }${forming ? ' is-forming' : ''}`}
      data-testid="timeframe-peek"
      aria-label={`${resolution} timeframe peek`}
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="peek-head" onPointerDown={startDrag}>
        <GripVertical size={12} className="peek-grip" aria-hidden="true" />
        <span className="peek-label">
          {resolution}
          <small>peek</small>
        </span>
        <label className="peek-picker">
          <select
            aria-label="Timeframe to peek at"
            value={settings.resolution}
            onChange={(event) => {
              const value = event.target.value
              onChange({
                ...settings,
                resolution: value === PEEK_AUTO ? PEEK_AUTO : (value as Timeframe),
              })
            }}
          >
            {PEEK_RESOLUTIONS.map((option) => (
              <option key={option} value={option}>
                {peekResolutionLabel(option, chartTimeframe)}
              </option>
            ))}
          </select>
          <ChevronDown size={9} aria-hidden="true" />
        </label>
        <span className={`peek-state${forming ? ' is-live' : ''}`}>
          {forming ? <i aria-hidden="true" /> : null}
          {forming ? 'forming' : offline ? state : 'closed'}
        </span>
        {position ? (
          <button
            type="button"
            className="peek-button"
            aria-label="Snap the peek window back to its docked spot"
            title="Reset position"
            onClick={resetPosition}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="peek-button"
          aria-label={minimized ? 'Expand the peek window' : 'Minimize the peek window'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="peek-button"
          aria-label="Hide the timeframe peek window"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="peek-min-row">
          <span className="peek-min-price">{stats ? formatPrice(stats.last.close) : '—'}</span>
          {stats?.change !== null && stats?.change !== undefined ? (
            <span className={`peek-change ${stats.change >= 0 ? 'is-up' : 'is-down'}`}>
              {stats.change >= 0 ? '+' : ''}
              {stats.change.toFixed(2)}%
            </span>
          ) : null}
          <span className="peek-min-time mono">
            {forming
              ? `${formatPeekCountdown(remaining)} left`
              : peekBarTime(last?.time ?? 0, resolution)}
          </span>
        </div>
      ) : (
        <>
          <p className="peek-sub">
            {ticker} · {resolution} · {peekRatioLabel(resolution, chartTimeframe)}
          </p>
          {bars.length ? (
            <div className="peek-plot">
              <svg
                className="peek-svg"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${bars.length} ${resolution} candles, latest close ${
                  stats ? formatPrice(stats.last.close) : 'unavailable'
                }`}
              >
                <g className="peek-grid">
                  {layout.levels.map((level) => (
                    <line key={level.y} x1={0} x2={layout.width} y1={level.y} y2={level.y} />
                  ))}
                </g>
                <line
                  className="peek-close-line"
                  x1={0}
                  x2={layout.width}
                  y1={layout.lastCloseY}
                  y2={layout.lastCloseY}
                  stroke={stats && stats.last.close >= stats.last.open ? upColor : downColor}
                />
                {settings.showVolume && (
                  <line
                    className="peek-vol-baseline"
                    x1={0}
                    x2={layout.width}
                    y1={layout.height - PEEK_LAYOUT.padTop}
                    y2={layout.height - PEEK_LAYOUT.padTop}
                  />
                )}
                {layout.bars.map((bar) => {
                  const color = bar.up ? upColor : downColor
                  return (
                    <g key={bar.time} className={`peek-bar${bar.forming ? ' is-forming' : ''}`}>
                      <line
                        x1={bar.x}
                        x2={bar.x}
                        y1={bar.wickTop}
                        y2={bar.wickBottom}
                        stroke={color}
                        strokeWidth={1}
                      />
                      <rect
                        x={bar.x - bar.width / 2}
                        y={bar.bodyTop}
                        width={bar.width}
                        height={bar.bodyHeight}
                        fill={color}
                        fillOpacity={bar.forming ? 0.34 : bar.up ? 0.92 : 1}
                        stroke={color}
                        strokeWidth={bar.forming ? 1 : 0}
                      />
                      {settings.showVolume && bar.volumeHeight > 0 ? (
                        <rect
                          className="peek-volume"
                          x={bar.x - bar.width / 2}
                          y={bar.volumeTop}
                          width={bar.width}
                          height={bar.volumeHeight}
                          fill={color}
                          fillOpacity={bar.forming ? 0.4 : 0.55}
                        />
                      ) : null}
                      <title>{`${peekBarTime(bar.time, resolution)} · O ${formatPrice(
                        bar.open,
                      )} H ${formatPrice(bar.high)} L ${formatPrice(bar.low)} C ${formatPrice(
                        bar.close,
                      )} · ${bar.volume ? `${compactNumber(bar.volume)} vol` : 'no volume'}${
                        bar.forming ? ' · still forming' : ''
                      }`}</title>
                    </g>
                  )
                })}
              </svg>
              <div className="peek-axis">
                <span className="peek-axis-edge">
                  <small>high</small>
                  {layout.high ? formatPrice(layout.high) : '—'}
                </span>
                <span
                  className="peek-axis-mark"
                  style={{
                    top: markTop,
                    color: stats && stats.last.close >= stats.last.open ? upColor : downColor,
                  }}
                >
                  {formatPrice(layout.lastClose)}
                </span>
                <span className="peek-axis-edge">
                  <small>low</small>
                  {layout.low ? formatPrice(layout.low) : '—'}
                </span>
              </div>
            </div>
          ) : (
            <p className="peek-empty">
              <span>{message || `Loading ${resolution} candles…`}</span>
              {retry ? (
                <button type="button" onClick={retry}>
                  <RotateCcw size={10} />
                  Retry
                </button>
              ) : null}
            </p>
          )}

          {stats && (
            <div className="peek-stats">
              <span className="peek-price mono">{formatPrice(stats.last.close)}</span>
              {stats.change === null ? null : (
                <span className={`peek-change ${stats.change >= 0 ? 'is-up' : 'is-down'}`}>
                  {stats.change >= 0 ? '+' : ''}
                  {stats.change.toFixed(2)}%<small>vs prev close</small>
                </span>
              )}
              <span
                className="peek-range"
                title={`Window range ${formatPrice(stats.windowLow)} – ${formatPrice(stats.windowHigh)}`}
              >
                <span className="peek-range-track">
                  <i style={{ left: `${stats.position * 100}%` }} />
                </span>
                <small>
                  {stats.bars} bars · {compactNumber(stats.volume)} vol
                </small>
              </span>
            </div>
          )}

          <div className="peek-timer">
            <Timer size={11} aria-hidden="true" />
            <span className="peek-timer-text mono">
              {forming
                ? `${formatPeekCountdown(remaining)} to the ${resolution} close`
                : last
                  ? `${resolution} bar closed ${peekBarTime(last.time, resolution)} UTC`
                  : 'no bars yet'}
            </span>
            <span className="peek-timer-track">
              <i style={{ width: `${(forming ? progress : 1) * 100}%` }} />
            </span>
          </div>

          <footer className="peek-foot">
            <span className="peek-bars">
              <button
                type="button"
                aria-label="Fewer candles in the peek window"
                disabled={settings.bars <= PEEK_BARS_MIN}
                onClick={() => onChange({ ...settings, bars: clampPeekBars(settings.bars - 2) })}
              >
                <Minus size={10} />
              </button>
              <span title="Candles in the window, forming bar included">{settings.bars} bars</span>
              <button
                type="button"
                aria-label="More candles in the peek window"
                disabled={settings.bars >= PEEK_BARS_MAX}
                onClick={() => onChange({ ...settings, bars: clampPeekBars(settings.bars + 2) })}
              >
                <Plus size={10} />
              </button>
            </span>
            <button
              type="button"
              className={`peek-chip${settings.showVolume ? ' is-on' : ''}`}
              onClick={() => onChange({ ...settings, showVolume: !settings.showVolume })}
              title="Show or hide the volume strip"
            >
              vol
            </button>
            <button
              type="button"
              className={`peek-chip${showInfo ? ' is-on' : ''}`}
              aria-label="What this window measures"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((open) => !open)}
            >
              <Info size={10} />
            </button>
            <span className="peek-source">
              {source === 'coinbase' ? 'Coinbase' : 'demo'}
              {state !== 'live' && source === 'coinbase' ? ` · ${state}` : ''}
            </span>
          </footer>

          {showInfo ? (
            <p className="peek-note">
              The same candles the MTF indicators read, drawn at {resolution}. The outlined bar is{' '}
              <strong>still forming</strong>: its high and low are the range so far, and it can
              close anywhere inside them. {source === 'demo' ? 'Demo bars are synthetic.' : ''}
              {offline ? ` Live updates are ${state}: ${message}` : ''}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
