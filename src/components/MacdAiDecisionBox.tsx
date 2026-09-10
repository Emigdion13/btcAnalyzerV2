import { useState } from 'react'
import { ChevronRight, GripVertical, Info, Minus, Plus, RotateCcw, X, Zap } from 'lucide-react'
import type { ConnectionState } from '../../shared/coinbase'
import type { MacdBias, MacdForecast } from '../lib/macd-forecast'
import { useLocalState } from '../lib/storage'
import { agentDecisionDefaultMinimized, useFloatingWindow } from '../lib/floating-window'
import type { DataSource, Timeframe } from '../lib/types'

const POSITION_KEY = 'macd-ai-pos'

const BIAS_CLASS: Record<MacdBias, string> = {
  bullish: 'is-bullish',
  bearish: 'is-bearish',
  neutral: 'is-neutral',
}

/** Feeds that are not current: the forecast stays on screen but is flagged as last known. */
const STALE_STATES = ['offline', 'stale', 'reconnecting', 'paused']

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

function shortCall(forecast: MacdForecast): string {
  if (forecast.regime === 'fresh-cross' && forecast.snapshot.lastCrossDir)
    return `${forecast.snapshot.lastCrossDir === 'bullish' ? 'Bullish' : 'Bearish'} cross ✓`
  if (forecast.crossDir && forecast.crossBars !== null)
    return `${forecast.crossDir === 'bullish' ? 'Bullish' : 'Bearish'} cross ~${forecast.crossBars}`
  if (forecast.touch === 'bounce') return 'Touch & bounce'
  if (forecast.regime === 'coil') return 'Coiling'
  return 'No cross'
}

function badgeText(forecast: MacdForecast | null, cmActive: boolean): string {
  if (!cmActive) return 'No CM'
  if (!forecast) return 'Waiting'
  if (forecast.regime === 'fresh-cross')
    return forecast.snapshot.lastCrossDir === 'bearish' ? 'CROSSED ↓' : 'CROSSED ↑'
  if (forecast.crossDir && forecast.crossBars !== null)
    return `${forecast.crossDir === 'bullish' ? '↑' : '↓'} ~${forecast.crossBars}`
  if (forecast.touch === 'bounce') return 'BOUNCE'
  if (forecast.regime === 'coil') return 'COIL'
  return 'NO CROSS'
}

function signalCell(forecast: MacdForecast): string {
  if (forecast.regime === 'fresh-cross') return 'just crossed'
  if (forecast.crossDir && forecast.crossBars !== null)
    return `${forecast.crossDir === 'bullish' ? '↑' : '↓'} ~${forecast.crossBars} bars`
  if (forecast.touch === 'bounce') return 'touch holds'
  return '—'
}

function midLineCell(forecast: MacdForecast): string {
  if (forecast.zeroDir && forecast.zeroBars !== null)
    return `${forecast.zeroDir === 'up' ? '↑' : '↓'} ~${forecast.zeroBars} bars`
  return `holds ${forecast.snapshot.zeroSide}`
}

/**
 * The MACD AI forecast as a picture-in-picture window over the chart.
 *
 * It mirrors the AI decision window on purpose — same drag, minimize, dock and
 * stale behaviour — but it never describes the present. Every line is what the
 * CM_Ult_MacD_MTF does AFTER now: the touch, the cross, the mid-line flip and
 * the thrust to the other side, in order. The full specialist breakdown lives
 * in the MACD AI side panel, which this opens on request.
 */
export function MacdAiDecisionBox({
  assetLabel,
  source,
  timeframe,
  forecast,
  cmActive,
  feedState,
  onOpenPanel,
  onClose,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  forecast: MacdForecast | null
  cmActive: boolean
  feedState: ConnectionState | 'paused'
  onOpenPanel: () => void
  onClose: () => void
}) {
  // null means "never chosen": the window defers to the viewport, then remembers a real choice.
  const [minPreference, setMinPreference] = useLocalState<boolean | null>('macd-ai-min', null)
  const minimized =
    minPreference ??
    agentDecisionDefaultMinimized(
      typeof window !== 'undefined' ? window.innerWidth : 1200,
      typeof window !== 'undefined' ? window.innerHeight : 800,
    )
  const [showInfo, setShowInfo] = useState(false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 8)

  const tone = forecast ? BIAS_CLASS[forecast.bias] : 'is-waiting'
  const stale = STALE_STATES.includes(feedState)
  const badge = badgeText(forecast, cmActive)
  const zero = forecast
    ? forecast.zeroDir
      ? {
          text: `MID LINE ${forecast.snapshot.zeroSide} → ${forecast.zeroDir === 'up' ? 'above' : 'below'} ~${forecast.zeroBars}`,
          side: forecast.zeroDir === 'up' ? 'is-up' : 'is-down',
        }
      : { text: `MID LINE holds ${forecast.snapshot.zeroSide}`, side: '' }
    : null

  return (
    <section
      ref={boxRef}
      className={`ai-decision-box macd-ai-box ${tone}${dragging ? ' is-dragging' : ''}${
        minimized ? ' is-min' : ''
      }${stale ? ' is-stale' : ''}`}
      data-testid="macd-ai-decision"
      aria-label="MACD AI forecast window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="ai-decision-head" onPointerDown={startDrag}>
        <GripVertical size={12} className="ai-decision-grip" aria-hidden="true" />
        <span className="ai-decision-label">
          MACD AI
          <small>forecast</small>
        </span>
        <span className={`ai-decision-badge ${tone}`}>{badge}</span>
        {position ? (
          <button
            type="button"
            className="ai-decision-button"
            aria-label="Snap the MACD AI window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="ai-decision-button"
          aria-label={minimized ? 'Expand the MACD AI window' : 'Minimize the MACD AI window'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinPreference(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="ai-decision-button"
          aria-label="Hide the MACD AI window"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div
          className="ai-decision-min-row"
          onClick={onOpenPanel}
          role="button"
          tabIndex={0}
          title={forecast ? forecast.headline : 'Open MACD AI panel'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenPanel()
            }
          }}
        >
          <strong>{forecast ? shortCall(forecast) : cmActive ? 'Waiting for candles' : 'No CM pane'}</strong>
          <span className="mono">{forecast ? formatPercent(forecast.confidence) : '30 bars'}</span>
          <button
            type="button"
            className="ai-decision-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpenPanel()
            }}
            title="Open MACD AI panel"
            aria-label="Open MACD AI panel"
          >
            <Zap size={11} />
            MACD agents
            <ChevronRight size={12} />
          </button>
        </div>
      ) : !forecast ? (
        <div className="ai-decision-body">
          <p className="ai-decision-empty">
            {!cmActive
              ? 'Add CM_Ult_MacD_MTF to the chart — MACD AI reads that pane.'
              : 'MACD AI speaks once at least 30 candles and warmed-up CM values are loaded.'}
          </p>
          <div className="ai-decision-foot">
            <span className="ai-decision-source">{source === 'coinbase' ? 'Coinbase' : 'Demo'}</span>
            <button
              type="button"
              className="ai-decision-open"
              onClick={onOpenPanel}
              title="Open MACD AI panel"
              aria-label="Open MACD AI panel"
            >
              <Zap size={11} />
              MACD agents
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-decision-body" title={`${assetLabel} · ${timeframe}`}>
          <div className={`ai-decision-verdict ${tone}`}>
            <span className="ai-decision-call macd-ai-call">{shortCall(forecast)}</span>
            <span className="ai-decision-meter">
              <span className="ai-decision-track">
                <i style={{ width: `${Math.min(100, forecast.confidence * 100)}%` }} />
              </span>
              <span className="mono">{formatPercent(forecast.confidence)}</span>
            </span>
          </div>

          <p
            className="ai-decision-reason"
            title={forecast.timeline.map((step) => step.title).join(' → ')}
          >
            Next: {forecast.timeline[0]?.title ?? 'stand by'}
          </p>
          {forecast.timeline[1] ? (
            <p className="ai-decision-reason macd-ai-then" title={forecast.timeline[1].detail}>
              Then: {forecast.timeline[1].title}
            </p>
          ) : null}

          {zero ? (
            <div
              className="ai-decision-strike macd-ai-zero"
              title={
                forecast.zeroDir
                  ? `MACD crosses the mid line ${forecast.snapshot.zeroSide} → ${forecast.zeroDir === 'up' ? 'above' : 'below'} in ~${forecast.zeroBars} bars.`
                  : `MACD holds ${forecast.snapshot.zeroSide} the mid line — no flip forming.`
              }
            >
              <span className={`ai-decision-strike-side ${zero.side}`}>{zero.text}</span>
              <span className="mono ai-decision-strike-clock">{forecast.regime}</span>
            </div>
          ) : null}

          <div className="ai-decision-grid macd-ai-grid">
            <div title={forecast.reasons[1] ?? 'Signal-cross timing'}>
              <span>Signal</span>
              <strong>{signalCell(forecast)}</strong>
            </div>
            <div title={forecast.zeroDir ? 'Mid-line flip timing' : 'Mid line holds its side'}>
              <span>Mid line</span>
              <strong>{midLineCell(forecast)}</strong>
            </div>
            <div title="Post-cross follow-through">
              <span>Thrust</span>
              <strong>{forecast.thrust}</strong>
            </div>
            <div title={`MACD ${forecast.snapshot.zeroSide} zero · gap ${(forecast.snapshot.gapSwing * 100).toFixed(0)}% of swing`}>
              <span>Touch</span>
              <strong>
                {forecast.touch === 'none'
                  ? '—'
                  : `${forecast.touch}${forecast.touchBars ? ` ~${forecast.touchBars}` : ''}`}
              </strong>
            </div>
          </div>

          <div className="ai-decision-foot">
            <button
              type="button"
              className={`ai-decision-chip${showInfo ? ' is-on' : ''}`}
              aria-label="How this forecast is reached"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((open) => !open)}
            >
              <Info size={10} />
            </button>
            <span className="ai-decision-source">
              {source === 'coinbase' ? 'Coinbase' : 'demo'}
              {stale ? ` · ${feedState}` : ''}
            </span>
            <button
              type="button"
              className="ai-decision-open"
              onClick={onOpenPanel}
              title="Open MACD AI panel"
              aria-label="Open MACD AI panel"
            >
              <Zap size={11} />
              MACD agents
              <ChevronRight size={12} />
            </button>
          </div>

          {showInfo ? (
            <p className="ai-decision-note">
              Five specialists — cross timer, zero-line scout, touch judge, thrust reader and
              pattern memory — forecast the CM MACD after this bar, and the director weights them
              with what this browser has learned from settled forecasts. Only the trust weights and
              the timing calibration adapt; the reasons stay visible.{' '}
              {stale
                ? `The feed is ${feedState}, so this is the last forecast the data supported rather than a live one. `
                : ''}
              Nothing here places trades.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
