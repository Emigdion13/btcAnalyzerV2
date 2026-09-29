import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  GripVertical,
  Info,
  Minus,
  Plus,
  RotateCcw,
  Timer,
  X,
} from 'lucide-react'
import type { Candle, ConnectionState, DataSource, Timeframe } from '../lib/types'
import { compactNumber, formatPrice, INTERVAL } from '../lib/market'
import { useFloatingWindow, useHistoryDrag } from '../lib/floating-window'
import { historyEnd, historyStep, panHistory, windowHistory } from '../lib/history-pan'
import type { HistoryAnchor } from '../lib/history-pan'
import { useLocalState } from '../lib/storage'
import {
  clampPeekBars,
  formatPeekCountdown,
  layoutPeekBars,
  PEEK_AUTO,
  PEEK_BARS_MAX,
  PEEK_BARS_MIN,
  PEEK_RESOLUTIONS,
  PEEK_RSI_PERIOD,
  peekBarTime,
  peekIsForming,
  peekRatioLabel,
  peekResolutionLabel,
  peekRsi,
  peekRsiZone,
  peekStats,
  peekTimeRemaining,
  peekWindow,
  PEEK_LAYOUT,
} from '../lib/timeframe-peek'
import type { TimeframePeekSettings } from '../lib/timeframe-peek'

const POSITION_KEY = 'timeframe-peek-pos'
const SIZE_KEY = 'timeframe-peek-size'

const PEEK_PANEL_DEFAULT_WIDTH = 268
const PEEK_PANEL_MIN_WIDTH = 200
const PEEK_PANEL_MAX_WIDTH = 560
const PEEK_PRICE_MIN_HEIGHT = 56
const PEEK_PRICE_MAX_HEIGHT = 320

interface PeekSize {
  panelWidth: number
  priceHeight: number
}

const PEEK_SIZE_DEFAULT: PeekSize = {
  panelWidth: PEEK_PANEL_DEFAULT_WIDTH,
  priceHeight: PEEK_LAYOUT.priceHeight,
}

function clampPeekSize(value: unknown): PeekSize {
  if (!value || typeof value !== 'object') return PEEK_SIZE_DEFAULT
  const raw = value as Partial<PeekSize>
  const w = Number(raw.panelWidth)
  const h = Number(raw.priceHeight)
  return {
    panelWidth: Number.isFinite(w)
      ? Math.min(PEEK_PANEL_MAX_WIDTH, Math.max(PEEK_PANEL_MIN_WIDTH, Math.round(w)))
      : PEEK_SIZE_DEFAULT.panelWidth,
    priceHeight: Number.isFinite(h)
      ? Math.min(PEEK_PRICE_MAX_HEIGHT, Math.max(PEEK_PRICE_MIN_HEIGHT, Math.round(h)))
      : PEEK_SIZE_DEFAULT.priceHeight,
  }
}

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
 * the dropdown (or leave it on auto), and resize the window in bars and in pixels.
 *
 * It reports the same candles the MTF indicators use, so nothing here is a second opinion about
 * price. A forming bar is an unfinished range — the panel says so instead of dressing the current
 * tick up as a close, and it dims rather than pretending when the feed stops being live.
 *
 * Now supports 30m and 2h (and every other timeframe in TIMEFRAMES) and is resizable by dragging
 * the corner handle: width controls how much horizontal room the candles have, height controls
 * the price pane. Both dimensions persist across reloads.
 *
 * Dragging the candles sideways (or ‹ ›) scrolls back through that resolution's history; the
 * window then says so in its state chip and timer, and ⏭ returns it to the forming bar.
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
  const [now, setNow] = useState(() => Date.now() / 1000)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 6)
  const [storedSize, setStoredSize] = useLocalState<PeekSize>(SIZE_KEY, PEEK_SIZE_DEFAULT)
  const size = useMemo(() => clampPeekSize(storedSize), [storedSize])
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startY: number; w: number; h: number } | null>(null)

  // A one-second clock is all the countdown and the forming-bar test need; the candles themselves
  // arrive over the existing market stream.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setNow(Date.now() / 1000)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const { resolution, chartTimeframe, candles, state, message, retry } = feed
  // Looking back is a moment in time, not a preference: a reload opens on the live bars again.
  const [anchor, setAnchor] = useState<HistoryAnchor>(null)
  const windowBars = clampPeekBars(settings.bars)
  const times = useMemo(() => candles.map((candle) => candle.time), [candles])
  const end = historyEnd(times, anchor, windowBars)
  const history = windowHistory(times, end, windowBars)
  const lookingBack = history.behind > 0
  const pan = useCallback(
    (delta: number | 'live') =>
      setAnchor((current) =>
        delta === 'live' ? null : panHistory(times, current, windowBars, delta),
      ),
    [times, windowBars],
  )
  const bars = useMemo(() => peekWindow(candles, windowBars, end), [candles, windowBars, end])
  const { panning, startPan } = useHistoryDrag(pan, bars.length)
  const last = bars[bars.length - 1]
  const forming = peekIsForming(last, resolution, now)
  const remaining = peekTimeRemaining(last, resolution, now)
  // The meter is the share of the bar's own span that has already elapsed.
  const progress = forming ? Math.min(1, Math.max(0, 1 - remaining / INTERVAL[resolution])) : 1
  const stats = useMemo(() => peekStats(bars), [bars])
  const plotWidth = useMemo(() => Math.max(60, size.panelWidth - 80), [size.panelWidth])
  const layoutSizes = useMemo(
    () => ({
      ...PEEK_LAYOUT,
      priceHeight: size.priceHeight,
      plotWidth,
    }),
    [size.priceHeight, plotWidth],
  )
  const layout = useMemo(
    () =>
      layoutPeekBars(bars, {
        forming,
        showVolume: settings.showVolume,
        width: plotWidth,
        sizes: layoutSizes,
      }),
    [bars, forming, settings.showVolume, plotWidth, layoutSizes],
  )
  const offline = ['offline', 'stale', 'reconnecting'].includes(state)
  const markTop = Math.min(Math.max(7, layout.lastCloseY), Math.max(7, layout.height - 7))
  // Momentum of the watched resolution: the full candle history of that timeframe, the
  // forming bar's live close included — the same honesty rule as every other readout here.
  // Scrolled back, it is the momentum as of the newest bar in view — never a later close.
  const rsiValue = useMemo(
    () => peekRsi(end < candles.length ? candles.slice(0, end) : candles),
    [candles, end],
  )
  const rsiZone = peekRsiZone(rsiValue)

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      const startW = size.panelWidth
      const startH = size.priceHeight
      resizeRef.current = { startX, startY, w: startW, h: startH }
      setResizing(true)
      const move = (moveEvent: PointerEvent) => {
        const ref = resizeRef.current
        if (!ref) return
        const dx = moveEvent.clientX - ref.startX
        const dy = moveEvent.clientY - ref.startY
        const nextW = Math.min(
          PEEK_PANEL_MAX_WIDTH,
          Math.max(PEEK_PANEL_MIN_WIDTH, Math.round(ref.w + dx)),
        )
        const nextH = Math.min(
          PEEK_PRICE_MAX_HEIGHT,
          Math.max(PEEK_PRICE_MIN_HEIGHT, Math.round(ref.h + dy)),
        )
        setStoredSize({ panelWidth: nextW, priceHeight: nextH })
      }
      const stop = () => {
        resizeRef.current = null
        setResizing(false)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    },
    [size.panelWidth, size.priceHeight, setStoredSize],
  )

  const resetSize = useCallback(() => {
    setStoredSize(PEEK_SIZE_DEFAULT)
  }, [setStoredSize])

  return (
    <section
      ref={boxRef}
      className={`peek-box${minimized ? ' is-min' : ''}${dragging ? ' is-dragging' : ''}${
        resizing ? ' is-resizing' : ''
      }${offline ? ' is-stale' : ''}${forming ? ' is-forming' : ''}`}
      data-testid="timeframe-peek"
      aria-label={`${resolution} timeframe peek`}
      style={{
        width: minimized ? undefined : size.panelWidth,
        ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {}),
      }}
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
        <span
          className={`peek-state${forming ? ' is-live' : ''}${lookingBack ? ' is-history' : ''}`}
        >
          {forming ? <i aria-hidden="true" /> : null}
          {lookingBack ? 'history' : forming ? 'forming' : offline ? state : 'closed'}
        </span>
        {position ? (
          <button
            type="button"
            className="peek-button"
            aria-label="Snap the peek window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        {!minimized &&
        (size.panelWidth !== PEEK_SIZE_DEFAULT.panelWidth ||
          size.priceHeight !== PEEK_SIZE_DEFAULT.priceHeight) ? (
          <button
            type="button"
            className="peek-button"
            aria-label="Reset peek window size"
            title="Reset size"
            onClick={resetSize}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="peek-button"
          aria-label={minimized ? 'Expand the peek window' : 'Minimize the peek window'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => {
            // The one-line view has no room to say it is looking back, so it always reads live.
            if (!minimized) pan('live')
            setMinimized(!minimized)
          }}
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
          {rsiValue !== null ? (
            <span
              className={`peek-min-rsi mono is-${rsiZone}`}
              title={`RSI ${PEEK_RSI_PERIOD} · ${rsiZone}`}
            >
              {Math.round(rsiValue)}
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
                className={`peek-svg is-pannable${panning ? ' is-panning' : ''}`}
                onPointerDown={startPan}
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${bars.length} ${resolution} candles, latest close $${
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

          <div
            className={`peek-rsi${rsiZone ? ` is-${rsiZone}` : ''}${
              rsiValue === null ? ' is-warming' : ''
            }`}
            data-testid="peek-rsi"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rsiValue ?? undefined}
            aria-label={`RSI ${PEEK_RSI_PERIOD} of the ${resolution} candles${
              rsiValue !== null ? `, currently ${rsiValue.toFixed(1)} — ${rsiZone}` : ', warming up'
            }`}
          >
            <span className="peek-rsi-meta">
              <small>rsi · {PEEK_RSI_PERIOD}</small>
              <em>{rsiZone ?? 'warming up'}</em>
            </span>
            <span className="peek-rsi-value mono">
              {rsiValue !== null ? rsiValue.toFixed(1) : '—'}
            </span>
            <span className="peek-rsi-gauge" aria-hidden="true">
              <span className="peek-rsi-band is-low" />
              <span className="peek-rsi-band is-high" />
              <span className="peek-rsi-track">
                <i
                  style={{
                    left: `${rsiValue === null ? 50 : Math.min(100, Math.max(0, rsiValue))}%`,
                  }}
                />
              </span>
            </span>
          </div>

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
              {lookingBack
                ? `history to ${history.label} UTC · ${history.behind} bars back`
                : forming
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
            <span className="peek-pan">
              <button
                type="button"
                aria-label="Scroll the peek window back through history"
                title="Older candles — or drag the candles to the right"
                disabled={history.older <= 0}
                onClick={() => pan(-historyStep(windowBars))}
              >
                <ChevronLeft size={10} />
              </button>
              <button
                type="button"
                aria-label="Scroll the peek window toward the live bar"
                title="Newer candles — or drag the candles to the left"
                disabled={!lookingBack}
                onClick={() => pan(historyStep(windowBars))}
              >
                <ChevronRight size={10} />
              </button>
              {lookingBack ? (
                <button
                  type="button"
                  className="is-live"
                  aria-label="Back to the live bar in the peek window"
                  title="Back to live"
                  onClick={() => pan('live')}
                >
                  <ChevronsRight size={10} />
                </button>
              ) : null}
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
              close anywhere inside them. The RSI readout is {PEEK_RSI_PERIOD}-period momentum over
              these {resolution} closes, forming bar included.{' '}
              {source === 'demo' ? 'Demo bars are synthetic.' : ''}
              {offline ? ` Live updates are ${state}: ${message}` : ''}
            </p>
          ) : null}

          <div
            className="peek-resize-handle"
            onPointerDown={startResize}
            title="Drag to resize — width and height. Double-click to reset."
            onDoubleClick={resetSize}
            role="separator"
            aria-label="Resize peek window"
            aria-orientation="vertical"
          />
        </>
      )}
    </section>
  )
}
