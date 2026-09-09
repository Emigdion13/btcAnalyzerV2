import { useMemo } from 'react'
import {
  Bot,
  BrainCircuit,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  horizonChoices,
  journalStats,
  learningHeadline,
  suggestedHorizonBars,
  type AgentPredictionJournal,
} from '../lib/agent-journal'
import type {
  AgentLearningState,
  AgentOpinion,
  ContextAnalysis,
  MarketAnalysis,
} from '../lib/market-agents'
import { formatPrice } from '../lib/market'
import type { DataSource, Timeframe } from '../lib/types'
import { EmptyState, IconButton, Toggle } from './ui'

const BIAS_LABEL: Record<AgentOpinion['bias'], string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'No trade',
}

const BIAS_CLASS: Record<AgentOpinion['bias'], string> = {
  bullish: 'is-bullish',
  bearish: 'is-bearish',
  neutral: 'is-neutral',
}

const AGENT_ORDER: AgentOpinion['id'][] = [
  'regime',
  'trend',
  'momentum',
  'macd',
  'level-strength',
  'structure',
  'whale',
  'context',
  'ensemble',
]

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

const formatSigned = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

function AnalysisChip({
  label,
  analysis,
  state,
}: {
  label: string
  analysis: MarketAnalysis | null
  state?: string
}) {
  if (!analysis)
    return (
      <div className="agent-context-chip is-empty">
        <strong>{label}</strong>
        <span>{state === 'loading' || state === 'connecting' ? 'Loading…' : 'Waiting for data'}</span>
      </div>
    )
  return (
    <div className={`agent-context-chip ${BIAS_CLASS[analysis.bias]}`}>
      <strong>{label}</strong>
      <span>{BIAS_LABEL[analysis.bias]}</span>
      <small>
        {analysis.regime} · {Math.round(analysis.confidence * 100)}%
      </small>
    </div>
  )
}

function AgentCard({ opinion }: { opinion: AgentOpinion }) {
  const meter = `${50 + opinion.score * 50}%`
  return (
    <article className={`agent-card ${BIAS_CLASS[opinion.bias]}`}>
      <header className="agent-card-head">
        <div>
          <strong>{opinion.label}</strong>
          <span>{BIAS_LABEL[opinion.bias]}</span>
        </div>
        <div className="agent-card-metrics">
          <span>{Math.round(opinion.confidence * 100)}%</span>
          <span>{formatSigned(opinion.score)}</span>
        </div>
      </header>
      <div className="agent-card-meter" aria-hidden="true">
        <i style={{ left: meter }} />
      </div>
      <p>{opinion.reasons[0] ?? 'No explanation recorded.'}</p>
      {opinion.warnings[0] && (
        <div className="agent-warning">
          <ShieldAlert size={12} />
          <span>{opinion.warnings[0]}</span>
        </div>
      )}
    </article>
  )
}

export function AgentPanel({
  assetLabel,
  source,
  timeframe,
  analysis,
  context,
  learning,
  journal,
  horizonBars,
  onClose,
  onToggleAutoJournal,
  onHorizonBarsChange,
  onClearJournal,
  onResetLearning,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  analysis: MarketAnalysis | null
  context: ContextAnalysis[]
  learning: AgentLearningState
  journal: AgentPredictionJournal
  horizonBars: number
  onClose: () => void
  onToggleAutoJournal: (enabled: boolean) => void
  onHorizonBarsChange: (bars: number) => void
  onClearJournal: () => void
  onResetLearning: () => void
}) {
  const stats = useMemo(() => journalStats(journal), [journal])
  const latestEntries = useMemo(
    () => [...journal.entries].reverse().slice(0, 6),
    [journal.entries],
  )
  const horizonOptions = useMemo(() => horizonChoices(timeframe), [timeframe])
  const orderedAgents = useMemo(
    () =>
      analysis
        ? [...analysis.agents].sort(
            (a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id),
          )
        : [],
    [analysis],
  )

  return (
    <aside className="side-panel agent-panel" aria-label="Market analysis agents">
      <div className="panel-heading">
        <h2>
          Agent panel <span className="count-badge">{analysis ? orderedAgents.length : 0}</span>
        </h2>
        <div className="row">
          <IconButton icon={Trash2} label="Clear agent journal" onClick={onClearJournal} />
          <IconButton icon={RefreshCw} label="Reset learned weights" onClick={onResetLearning} />
          <IconButton icon={X} label="Close agent panel" onClick={onClose} />
        </div>
      </div>

      <div className="agent-panel-scroll">
        <div className="panel-intro agent-panel-intro">
          <span className="eyebrow">SPECIALISTS, NOT A SINGLE GUESSER</span>
          <p>{assetLabel} · {timeframe}</p>
          <div className="agent-panel-subtitle">
            <span className={`demo-badge ${source === 'coinbase' ? 'coinbase-feed-badge' : ''}`}>
              {source === 'coinbase' ? 'COINBASE' : 'DEMO'}
            </span>
            <span>Adaptive ensemble · local learning only</span>
          </div>
        </div>

        {!analysis ? (
          <div className="agent-empty-wrap">
            <EmptyState
              icon={Bot}
              title="Waiting for enough candles"
              description="The agent ensemble starts speaking after at least 30 candles of history are available on this timeframe."
            />
          </div>
        ) : (
          <>
            <section className="agent-summary-card">
              <div className="agent-summary-head">
                <div>
                  <span className="agent-summary-label">Decision agent</span>
                  <strong>{BIAS_LABEL[analysis.bias]}</strong>
                </div>
                <span className={`agent-bias-badge ${BIAS_CLASS[analysis.bias]}`}>{analysis.regime}</span>
              </div>
              <div className="agent-summary-grid">
                <div>
                  <span>Confidence</span>
                  <strong>{formatPercent(analysis.confidence)}</strong>
                </div>
                <div>
                  <span>Score</span>
                  <strong>{formatSigned(analysis.score)}</strong>
                </div>
                <div>
                  <span>Price</span>
                  <strong>{formatPrice(analysis.summary.currentPrice)}</strong>
                </div>
                <div>
                  <span>ATR</span>
                  <strong>{analysis.summary.atr.toFixed(2)}</strong>
                </div>
              </div>
              <div className="agent-summary-levels">
                <div>
                  <span>Support</span>
                  <strong>
                    {analysis.summary.nearestSupport
                      ? `${formatPrice(analysis.summary.nearestSupport.price)} · ${analysis.summary.nearestSupport.distanceAtr.toFixed(2)} ATR`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Resistance</span>
                  <strong>
                    {analysis.summary.nearestResistance
                      ? `${formatPrice(analysis.summary.nearestResistance.price)} · ${analysis.summary.nearestResistance.distanceAtr.toFixed(2)} ATR`
                      : '—'}
                  </strong>
                </div>
              </div>
              <ul className="agent-reason-list">
                {analysis.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>
                    <ChevronRight size={12} />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {analysis.risks.length > 0 && (
                <div className="agent-risk-block">
                  <h3>
                    <ShieldAlert size={13} /> Risks to watch
                  </h3>
                  <ul>
                    {analysis.risks.slice(0, 3).map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="agent-section">
              <div className="agent-section-head">
                <h3>
                  <Sparkles size={13} /> Timeframe context
                </h3>
                <span>chart + higher frames</span>
              </div>
              <div className="agent-context-grid">
                <AnalysisChip label={timeframe} analysis={analysis} state="live" />
                {context.map((item) => (
                  <AnalysisChip
                    key={item.timeframe}
                    label={item.timeframe}
                    analysis={item.analysis}
                    state={item.state}
                  />
                ))}
              </div>
            </section>

            <section className="agent-section">
              <div className="agent-section-head">
                <h3>
                  <BrainCircuit size={13} /> Specialist opinions
                </h3>
                <span>score + confidence + warning</span>
              </div>
              <div className="agent-card-list">
                {orderedAgents.map((opinion) => (
                  <AgentCard key={opinion.id} opinion={opinion} />
                ))}
              </div>
            </section>
          </>
        )}

        <section className="agent-section agent-learning-section">
          <div className="agent-section-head">
            <h3>
              <Bot size={13} /> Learning & journal
            </h3>
            <span>weights adapt after outcomes settle</span>
          </div>
          <div className="agent-setting-row">
            <div>
              <strong>Prediction horizon</strong>
              <p>
                Evaluate {timeframe} forecasts after {horizonBars} bars. Recommended default:{' '}
                {suggestedHorizonBars(timeframe)} bars.
              </p>
            </div>
            <label className="agent-horizon-select">
              <span>Bars</span>
              <select
                value={String(horizonBars)}
                onChange={(event) => onHorizonBarsChange(Number(event.target.value))}
                aria-label="Prediction horizon bars"
              >
                {horizonOptions.map((option) => (
                  <option key={option} value={String(option)}>
                    {option} bars
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="agent-setting-row">
            <div>
              <strong>Auto-journal</strong>
              <p>Save one forecast per closed candle and learn after the horizon completes.</p>
            </div>
            <Toggle
              checked={journal.autoJournal}
              onChange={onToggleAutoJournal}
              label="Enable automatic agent journaling"
            />
          </div>
          <div className="agent-journal-stats">
            <div>
              <span>Pending</span>
              <strong>{stats.pending}</strong>
            </div>
            <div>
              <span>Resolved</span>
              <strong>{stats.resolved}</strong>
            </div>
            <div>
              <span>Win rate</span>
              <strong>{stats.winRate == null ? '—' : formatPercent(stats.winRate)}</strong>
            </div>
          </div>
          <div className="agent-learning-grid">
            {(
              [
                'regime',
                'trend',
                'momentum',
                'macd',
                'level-strength',
                'structure',
                'whale',
                'context',
                'ensemble',
              ] as const
            ).map((agentId) => (
              <div key={agentId} className="agent-learning-chip">
                <strong>{agentId}</strong>
                <span>{learningHeadline(learning, agentId)}</span>
              </div>
            ))}
          </div>
          <div className="agent-journal-list">
            {latestEntries.length ? (
              latestEntries.map((entry) => (
                <div key={entry.id} className={`agent-journal-entry ${entry.result ? `is-${entry.result}` : 'is-pending'}`}>
                  <div>
                    <strong>
                      {entry.symbol} · {entry.timeframe}
                    </strong>
                    <span>
                      {entry.bias} · {Math.round(entry.confidence * 100)}% · {entry.horizonBars} bars
                    </span>
                  </div>
                  <div className="agent-journal-outcome">
                    <strong>{entry.result ? entry.result.toUpperCase() : 'PENDING'}</strong>
                    <span>
                      {entry.move == null ? 'Awaiting outcome' : `${formatSigned(entry.move * 100)}%`}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="agent-journal-empty">
                No journal entries yet. Leave auto-journal on and the ensemble will record closed-candle opinions here.
              </p>
            )}
          </div>
        </section>

        <div className="panel-footnote">
          Specialists stay explainable; only their trust weights adapt. All learning is stored in
          this browser and never places trades.
        </div>
      </div>
    </aside>
  )
}
