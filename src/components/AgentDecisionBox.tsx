import { useMemo, useState } from 'react'
import { Bot, ChevronRight, GripVertical, Info, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { ConnectionState } from '../../shared/coinbase'
import { formatPrice } from '../lib/market'
import type { ContextAnalysis, MarketAnalysis } from '../lib/market-agents'
import { useLocalState } from '../lib/storage'
import { agentDecisionDefaultMinimized, useFloatingWindow } from '../lib/floating-window'
import type { DataSource, Timeframe } from '../lib/types'

const POSITION_KEY = 'agent-decision-pos'

type Bias = NonNullable<MarketAnalysis>['bias']

const BIAS_LABEL: Record<Bias, string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'No trade',
}

/** Short form for the footer chips, where every character of width counts. */
const BIAS_SHORT: Record<Bias, string> = {
  bullish: 'bull',
  bearish: 'bear',
  neutral: 'flat',
}

const BIAS_CLASS: Record<Bias, string> = {
  bullish: 'is-bullish',
  bearish: 'is-bearish',
  neutral: 'is-neutral',
}

/** Feeds that are not current: the call stays on screen but is flagged as last known. */
const STALE_STATES = ['offline', 'stale', 'reconnecting', 'paused']

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

const formatSigned = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

const formatLevel = (level: MarketAnalysis['summary']['nearestSupport']) =>
  level ? `${formatPrice(level.price)} · ${level.distanceAtr.toFixed(1)} ATR` : '—'

/**
 * The AI's general decision as a picture-in-picture window over the chart.
 *
 * It carries the same ensemble verdict the agent panel leads with — bias, confidence, score,
 * regime, the levels the call leans on and the reason behind it — so the decision can be read
 * without opening a side panel. Like the timeframe peek window it is draggable, minimizable, and
 * remembers where it was left; the deep specialist breakdown stays in the agent panel, which it
 * opens on request.
 *
 * A decision is only as fresh as the candles behind it, so a feed that is not live dims the
 * window instead of presenting a stale call as current, and bar replay steps aside entirely.
 */
export function AgentDecisionBox({
  assetLabel,
  source,
  timeframe,
  analysis,
  context,
  feedState,
  onOpenPanel,
  onClose,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  analysis: MarketAnalysis | null
  context: ContextAnalysis[]
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

  const specialists = useMemo(
    () => (analysis ? analysis.agents.filter((agent) => agent.id !== 'ensemble') : []),
    [analysis],
  )
  const tally = useMemo(() => {
    const count: Record<Bias, number> = { bullish: 0, bearish: 0, neutral: 0 }
    for (const agent of specialists) count[agent.bias] += 1
    return count
  }, [specialists])
  const tone = analysis ? BIAS_CLASS[analysis.bias] : 'is-waiting'
  const stale = STALE_STATES.includes(feedState)
  const counted = specialists.length || 1
  // Disagreement is the useful part of the headline: it says how much of the ensemble agrees.
  const leadCount = Math.max(tally.bullish, tally.bearish, tally.neutral)
  const agreement = analysis
    ? `${leadCount} of ${specialists.length} specialists ${BIAS_SHORT[analysis.bias]}`
    : ''

  return (
    <section
      ref={boxRef}
      className={`ai-decision-box ${tone}${dragging ? ' is-dragging' : ''}${
        minimized ? ' is-min' : ''
      }${stale ? ' is-stale' : ''}`}
      data-testid="agent-decision"
      aria-label="AI decision window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="ai-decision-head" onPointerDown={startDrag}>
        <GripVertical size={12} className="ai-decision-grip" aria-hidden="true" />
        <span className="ai-decision-label">
          AI decision
          <small>ensemble</small>
        </span>
        <span className={`ai-decision-badge ${tone}`}>
          {analysis ? BIAS_LABEL[analysis.bias] : 'Waiting'}
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
          title="Open full agent panel"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenPanel()
            }
          }}
        >
          <strong>{analysis ? BIAS_LABEL[analysis.bias] : 'Waiting for candles'}</strong>
          <span className="mono">{analysis ? formatPercent(analysis.confidence) : '30 bars'}</span>
          {analysis ? <span className="mono">{formatSigned(analysis.score)} score</span> : null}
          <button
            type="button"
            className="ai-decision-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpenPanel()
            }}
            title="Open full agent panel"
            aria-label="Open full agent panel"
          >
            <Bot size={11} />
            Open full agents
            <ChevronRight size={12} />
          </button>
        </div>
      ) : !analysis ? (
        <div className="ai-decision-body">
          <p className="ai-decision-empty">
            The ensemble speaks once at least 30 candles are loaded on this timeframe.
          </p>
          <div className="ai-decision-foot">
            <span className="ai-decision-source">
              {source === 'coinbase' ? 'Coinbase' : 'Demo'}
            </span>
            <button
              type="button"
              className="ai-decision-open"
              onClick={onOpenPanel}
              title="Open full agent panel"
              aria-label="Open full agent panel"
            >
              <Bot size={11} />
              Open full agents
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-decision-body" title={`${assetLabel} · ${timeframe}`}>
          <div className={`ai-decision-verdict ${tone}`}>
            <span className="ai-decision-call">{BIAS_LABEL[analysis.bias]}</span>
            <span className="ai-decision-meter">
              <span className="ai-decision-track">
                <i style={{ width: `${Math.min(100, analysis.confidence * 100)}%` }} />
              </span>
              <span className="mono">{formatPercent(analysis.confidence)}</span>
            </span>
          </div>

          <p
            className="ai-decision-reason"
            title={[analysis.reasons[0], analysis.risks[0]].filter(Boolean).join(' · ')}
          >
            {analysis.reasons[0] ?? 'No primary explanation recorded.'}
          </p>

          <div className="ai-decision-grid">
            <div>
              <span>Score</span>
              <strong>{formatSigned(analysis.score)}</strong>
            </div>
            <div>
              <span>Regime</span>
              <strong>{analysis.regime}</strong>
            </div>
            <div title={`ATR ${analysis.summary.atr.toFixed(2)}`}>
              <span>Price</span>
              <strong>{formatPrice(analysis.summary.currentPrice)}</strong>
            </div>
          </div>

          <div className="ai-decision-levels">
            <span>
              <small>support</small>
              {formatLevel(analysis.summary.nearestSupport)}
            </span>
            <span>
              <small>resistance</small>
              {formatLevel(analysis.summary.nearestResistance)}
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
              aria-label="How this decision is reached"
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
                    ? `${item.timeframe} · ${BIAS_LABEL[item.analysis.bias]} · ${formatPercent(
                        item.analysis.confidence,
                      )} confidence`
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
              title="Open full agent panel"
              aria-label="Open full agent panel"
            >
              <Bot size={11} />
              Open full agents
              <ChevronRight size={12} />
            </button>
          </div>

          {showInfo ? (
            <p className="ai-decision-note">
              Up to eight specialists — regime, trend, momentum, MACD, levels, structure, whale flow
              and higher-timeframe context — vote, and the ensemble weights them with what this
              browser has learned from past outcomes. {agreement ? `${agreement}. ` : ''}Only their
              trust weights adapt; the reasons stay visible.{' '}
              {stale
                ? `The feed is ${feedState}, so this is the last decision the data supported rather than a live one. `
                : ''}
              Nothing here places trades.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
