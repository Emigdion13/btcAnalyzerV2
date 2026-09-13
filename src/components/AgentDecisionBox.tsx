import { useMemo, useState } from 'react'
import { Bot, ChevronRight, GripVertical, Info, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { ConnectionState } from '../../shared/coinbase'
import { formatCountdown } from '../lib/kalshi-window'
import { formatPrice } from '../lib/market'
import type { ContextAnalysis, MarketAnalysis } from '../lib/market-agents'
import { peekBarTime } from '../lib/timeframe-peek'
import type { PeekSynchronizedHorizon } from '../lib/timeframe-peek'
import { useLocalState } from '../lib/storage'
import { agentDecisionDefaultMinimized, useFloatingWindow } from '../lib/floating-window'
import type { DataSource, Timeframe } from '../lib/types'

const POSITION_KEY = 'agent-decision-pos'

type Bias = NonNullable<MarketAnalysis>['bias']
type Forecast = NonNullable<MarketAnalysis>['forecast']

const BIAS_CLASS: Record<Bias, string> = {
  bullish: 'is-bullish',
  bearish: 'is-bearish',
  neutral: 'is-neutral',
}

/** Short form for the footer chips, where every character of width counts. */
const BIAS_SHORT: Record<Bias, string> = {
  bullish: 'bull',
  bearish: 'bear',
  neutral: 'flat',
}

/** Feeds that are not current: the forecast stays on screen but is flagged as last known. */
const STALE_STATES = ['offline', 'stale', 'reconnecting', 'paused']

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

const formatAtr = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`

/**
 * What the horizon call says in one phrase: the strike side when the chart has a
 * strike line, the drift lean when it does not.
 */
function callLabel(forecast: Forecast): string {
  if (forecast.strikeCall === 'above') return 'Above strike'
  if (forecast.strikeCall === 'below') return 'Below strike'
  if (forecast.finishAboveProbability !== null) return 'Coin flip'
  return forecast.bias === 'bullish' ? 'Higher' : forecast.bias === 'bearish' ? 'Lower' : 'Sideways'
}

/** The badge: the number that goes with the call, not a mood. */
function badgeText(forecast: Forecast): string {
  if (forecast.strikeCall === 'above')
    return `↑ ${Math.round((forecast.strikeCallProbability ?? 0) * 100)}%`
  if (forecast.strikeCall === 'below')
    return `↓ ${Math.round((forecast.strikeCallProbability ?? 0) * 100)}%`
  if (forecast.finishAboveProbability !== null)
    return `↔ ${Math.round(forecast.finishAboveProbability * 100)}% above`
  return `${formatAtr(forecast.expectedMoveAtr)} ATR`
}

function pathLabel(forecast: Forecast): string {
  return forecast.path === 'continuation'
    ? `continuation · ${forecast.thrust}`
    : forecast.path === 'squeeze'
      ? 'squeeze'
      : forecast.path
}

/**
 * The main-chart AI as a picture-in-picture window over the chart.
 *
 * It carries what MACD AI carries — a forward call, the numbers behind it, the
 * order things are expected to happen in — for the chart itself rather than for an
 * indicator pane: where price is expected to finish over the horizon, and whether
 * that finish sits above or below the strike line. The "now" verdict the specialists
 * describe stays one click away in the agent panel, which this opens on request.
 *
 * A forecast is only as fresh as the candles behind it, so a feed that is not live
 * dims the window instead of presenting a stale call as current, and bar replay
 * steps aside entirely.
 */
export function AgentDecisionBox({
  assetLabel,
  source,
  timeframe,
  analysis,
  context,
  horizonSync,
  feedState,
  onOpenPanel,
  onClose,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  analysis: MarketAnalysis | null
  context: ContextAnalysis[]
  horizonSync?: PeekSynchronizedHorizon | null
  feedState: ConnectionState | 'paused'
  onOpenPanel: () => void
  onClose: () => void
}) {
  // null means "never chosen": the window defers to the viewport, then remembers a real choice.
  const [minPreference, setMinPreference] = useLocalState<boolean | null>(
    'agent-decision-min',
    null,
  )
  const minimized =
    minPreference ??
    agentDecisionDefaultMinimized(
      typeof window !== 'undefined' ? window.innerWidth : 1200,
      typeof window !== 'undefined' ? window.innerHeight : 800,
    )
  const [showInfo, setShowInfo] = useState(false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 8)

  const forecast = analysis?.forecast ?? null
  // The split bar reads the horizon votes, not the present-tense ones: each specialist's
  // projected drift is what it is voting for over the next N bars.
  const tally = useMemo(() => {
    const count: Record<Bias, number> = { bullish: 0, bearish: 0, neutral: 0 }
    for (const agent of forecast?.agents ?? []) {
      count[agent.driftAtr >= 0.22 ? 'bullish' : agent.driftAtr <= -0.22 ? 'bearish' : 'neutral'] +=
        1
    }
    return count
  }, [forecast])
  const counted = forecast?.agents.length || 1
  const lead = Math.max(tally.bullish, tally.bearish, tally.neutral)
  const agreement = forecast ? `${lead} of ${forecast.agents.length} agents lean that way` : ''
  const strike = forecast?.snapshot.strike ?? null
  const strikeDelta =
    strike === null || forecast === null ? null : formatAtr(forecast.snapshot.strikeDeltaAtr)
  const tone = forecast ? BIAS_CLASS[forecast.bias] : 'is-waiting'
  const stale = STALE_STATES.includes(feedState)
  const finishSide = forecast?.snapshot.strikeSide ?? null
  const band =
    forecast === null
      ? null
      : `${formatPrice(forecast.targetLow)} – ${formatPrice(forecast.targetHigh)}`
  const targetClock = forecast ? peekBarTime(forecast.targetTime, timeframe) : null
  const horizonTitle = forecast
    ? horizonSync
      ? `Forecast finishes on the chart bar at ${targetClock} UTC, synced to the ${horizonSync.resolution} peek close${horizonSync.spilloverSeconds ? ` plus ${horizonSync.spilloverSeconds}s of chart-grid spillover` : ''}.`
      : `Forecast finishes ${forecast.horizonBars} bars ahead at ${targetClock} UTC.`
    : 'Forecast horizon'
  const horizonLabel = forecast
    ? horizonSync
      ? `${forecast.horizonBars} bars → ${horizonSync.resolution} close`
      : `${forecast.horizonBars} bars`
    : '—'

  return (
    <section
      ref={boxRef}
      className={`ai-decision-box ${tone}${dragging ? ' is-dragging' : ''}${
        minimized ? ' is-min' : ''
      }${stale ? ' is-stale' : ''}`}
      data-testid="agent-decision"
      aria-label="AI forecast window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="ai-decision-head" onPointerDown={startDrag}>
        <GripVertical size={12} className="ai-decision-grip" aria-hidden="true" />
        <span className="ai-decision-label">
          AI forecast
          <small>price action</small>
        </span>
        <span className={`ai-decision-badge ${tone}`}>
          {forecast ? badgeText(forecast) : 'Waiting'}
        </span>
        {position ? (
          <button
            type="button"
            className="ai-decision-button"
            aria-label="Snap the AI decision window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="ai-decision-button"
          aria-label={
            minimized ? 'Expand the AI decision window' : 'Minimize the AI decision window'
          }
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinPreference(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="ai-decision-button"
          aria-label="Hide the AI decision window"
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
          title={forecast ? forecast.headline : 'Open the agent panel'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenPanel()
            }
          }}
        >
          <strong>{forecast ? callLabel(forecast) : 'Waiting for candles'}</strong>
          <span className="mono">
            {forecast
              ? forecast.strikeCallProbability !== null
                ? formatPercent(forecast.strikeCallProbability)
                : `${formatAtr(forecast.expectedMoveAtr)} ATR`
              : `30 bars`}
          </span>
          {forecast ? <span className="mono">{formatPercent(forecast.confidence)}</span> : null}
          {forecast?.snapshot.secondsLeft !== null &&
          forecast?.snapshot.secondsLeft !== undefined &&
          forecast.snapshot.strikeExpiryLabel ? (
            <span
              className="mono"
              title={`Strike window closes at ${forecast.snapshot.strikeExpiryLabel}`}
            >
              {formatCountdown(forecast.snapshot.secondsLeft)} →{' '}
              {forecast.snapshot.strikeExpiryLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="ai-decision-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpenPanel()
            }}
            title="Open the agent panel"
            aria-label="Open the agent panel"
          >
            <Bot size={11} />
            Agents
            <ChevronRight size={12} />
          </button>
        </div>
      ) : !forecast ? (
        <div className="ai-decision-body">
          <p className="ai-decision-empty">
            The AI speaks once at least 30 candles are loaded on this timeframe — then it forecasts
            the horizon instead of describing the present.
          </p>
          <div className="ai-decision-foot">
            <span className="ai-decision-source">
              {source === 'coinbase' ? 'Coinbase' : 'Demo'}
            </span>
            <button
              type="button"
              className="ai-decision-open"
              onClick={onOpenPanel}
              title="Open the agent panel"
              aria-label="Open the agent panel"
            >
              <Bot size={11} />
              Agents
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-decision-body" title={`${assetLabel} · ${timeframe}`}>
          <div className={`ai-decision-verdict ${tone}`}>
            <span className="ai-decision-call">{callLabel(forecast)}</span>
            <span className="ai-decision-meter">
              <span className="ai-decision-track">
                <i
                  style={{
                    width: `${
                      forecast.strikeCallProbability !== null
                        ? Math.min(100, forecast.strikeCallProbability * 100)
                        : Math.min(100, forecast.confidence * 100)
                    }%`,
                  }}
                />
              </span>
              <span className="mono">
                {forecast.strikeCallProbability !== null
                  ? formatPercent(forecast.strikeCallProbability)
                  : `${formatAtr(forecast.expectedMoveAtr)} ATR`}
              </span>
            </span>
          </div>

          <p className="ai-decision-reason" title={forecast.headline}>
            {forecast.headline}
          </p>

          {strike !== null && forecast.snapshot.strikeDeltaAtr !== null ? (
            <div
              className="ai-decision-strike"
              title={`${forecast.reasons[0] ?? forecast.headline}`}
            >
              <span className="ai-decision-strike-price">
                STRIKE {forecast.snapshot.strikeProvisional ? '~' : ''}
                {formatPrice(strike, true)}
              </span>
              <span
                className={
                  forecast.snapshot.strikeSide === 'above'
                    ? 'ai-decision-strike-side is-up'
                    : 'ai-decision-strike-side is-down'
                }
              >
                {forecast.snapshot.strikeSide === 'above' ? '\u25B2' : '\u25BC'} {strikeDelta}{' '}
                {forecast.snapshot.strikeSide}
              </span>
              <span className="mono ai-decision-strike-clock">
                {forecast.strikeTouchProbability === null
                  ? ''
                  : `touch ${formatPercent(forecast.strikeTouchProbability)}`}
                {forecast.snapshot.secondsLeft !== null
                  ? ` · ${formatCountdown(forecast.snapshot.secondsLeft)}`
                  : ''}
              </span>
            </div>
          ) : null}

          <p className="ai-decision-reason agent-then-line">
            Next: {forecast.timeline[0]?.title ?? 'stand by'}
            {forecast.timeline[1] ? ` → ${forecast.timeline[1].title}` : ''}
          </p>

          <div className="ai-decision-grid">
            <div title={`Expected close over ${forecast.horizonBars} bars`}>
              <span>Finish</span>
              <strong>{formatPrice(forecast.expectedPrice)}</strong>
            </div>
            <div title={band ? `One-scale band: ${band}` : 'Expected finish'}>
              <span>Band</span>
              <strong>{band}</strong>
            </div>
            <div title={`Expected drift over ${forecast.horizonBars} bars`}>
              <span>Drift</span>
              <strong>{formatAtr(forecast.expectedMoveAtr)} ATR</strong>
            </div>
            <div title={horizonTitle}>
              <span>Horizon</span>
              <strong>{horizonLabel}</strong>
            </div>
          </div>

          <div className="ai-decision-levels">
            <span>
              <small>touch</small>
              {forecast.strikeTouch
                ? `${forecast.touchVerdict === 'break' ? 'break' : 'hold'}${forecast.strikeBars ? ` ~${forecast.strikeBars} ${forecast.strikeBars === 1 ? 'bar' : 'bars'}` : ''}`
                : forecast.strikeTouchProbability !== null
                  ? `no touch · ${formatPercent(1 - forecast.strikeTouchProbability)}`
                  : 'no strike'}
            </span>
            <span>
              <small>path</small>
              {pathLabel(forecast)}
            </span>
          </div>

          <div className="ai-decision-levels">
            <span>
              <small>support reach</small>
              {formatPercent(forecast.supportReachProbability)}
            </span>
            <span>
              <small>resistance reach</small>
              {formatPercent(forecast.resistanceReachProbability)}
            </span>
            <span>
              <small>{finishSide ? 'finish above' : 'confidence'}</small>
              {finishSide
                ? formatPercent(forecast.finishAboveProbability)
                : formatPercent(forecast.confidence)}
            </span>
          </div>

          <div className="ai-decision-split" title={agreement} aria-hidden="true">
            <i className="is-bullish" style={{ width: `${(tally.bullish / counted) * 100}%` }} />
            <i className="is-bearish" style={{ width: `${(tally.bearish / counted) * 100}%` }} />
            <i className="is-neutral" style={{ width: `${(tally.neutral / counted) * 100}%` }} />
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
            {context.map((item) => (
              <span
                key={item.timeframe}
                className={`ai-decision-context-chip ${
                  item.analysis ? BIAS_CLASS[item.analysis.bias] : 'is-waiting'
                }`}
                title={
                  item.analysis
                    ? `${item.timeframe} context · ${item.analysis.bias} · ${formatPercent(
                        item.analysis.forecast.confidence,
                      )} on its own horizon`
                    : `${item.timeframe} · waiting for candles`
                }
              >
                {item.timeframe}
                <small>{item.analysis ? BIAS_SHORT[item.analysis.bias] : 'wait'}</small>
              </span>
            ))}
            <button
              type="button"
              className="ai-decision-open"
              onClick={onOpenPanel}
              title="Open the agent panel"
              aria-label="Open the agent panel"
            >
              <Bot size={11} />
              Agents
              <ChevronRight size={12} />
            </button>
          </div>

          {showInfo ? (
            <p className="ai-decision-note">
              Eight specialists — regime, trend, momentum, MACD, levels, structure, whale flow and
              higher-timeframe context — each project their read across the next{' '}
              {forecast.horizonBars} bars, and the director weighs those projections with what has
              been learned from settled forecasts. {agreement ? `${agreement}. ` : ''}
              {horizonSync
                ? `This horizon is synced to the ${horizonSync.resolution} peek window close. `
                : ''}
              {forecast.modelNote}{' '}
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
