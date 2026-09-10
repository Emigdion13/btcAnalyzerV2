import { useMemo } from 'react'
import {
  Bot,
  BrainCircuit,
  ChevronRight,
  ListOrdered,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import {
  MACD_AI_AGENT_ORDER,
  formatMacdValue,
  macdJournalStats,
  macdLearningHeadline,
  type MacdAgentOpinion,
  type MacdBias,
  type MacdForecast,
  type MacdForecastEntry,
  type MacdAiLearningState,
  type MacdForecastJournal,
} from '../lib/macd-forecast'
import type { DataSource, Timeframe } from '../lib/types'
import { EmptyState, IconButton, Toggle } from './ui'

const BIAS_LABEL: Record<MacdBias, string> = {
  bullish: 'Up',
  bearish: 'Down',
  neutral: 'Wait',
}

const BIAS_CLASS: Record<MacdBias, string> = {
  bullish: 'is-bullish',
  bearish: 'is-bearish',
  neutral: 'is-neutral',
}

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

const formatSigned = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

const formatBars = (bars: number | null) =>
  bars === null ? '—' : `~${bars} bar${bars === 1 ? '' : 's'}`

function AgentCard({ opinion }: { opinion: MacdAgentOpinion }) {
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

function JournalRow({ entry }: { entry: MacdForecastEntry }) {
  const tone =
    entry.result === 'hit'
      ? 'is-correct'
      : entry.result === 'miss'
        ? 'is-wrong'
        : entry.result === 'partial' || entry.result === 'stale'
          ? 'is-flat'
          : 'is-pending'
  const outcome = entry.result ? entry.result.toUpperCase() : 'PENDING'
  const actual = entry.actual
  const detail = !actual
    ? entry.result === 'stale'
      ? 'History rotated past it'
      : 'Awaiting outcome'
    : [
        actual.crossDir
          ? `cross ${actual.crossDir === 'bullish' ? '↑' : '↓'}${actual.crossBars}`
          : 'no cross',
        actual.zeroDir ? `mid ${actual.zeroDir === 'up' ? '↑' : '↓'}${actual.zeroBars}` : null,
        actual.touchResult === 'none' ? null : actual.touchResult,
        actual.thrust ?? null,
      ]
        .filter(Boolean)
        .join(' · ')
  return (
    <div className={`agent-journal-entry ${tone}`} title={entry.headline}>
      <div>
        <strong>
          {entry.symbol} · {entry.timeframe}
        </strong>
        <span>{entry.headline}</span>
      </div>
      <div className="agent-journal-outcome">
        <strong>{outcome}</strong>
        <span>{detail}</span>
      </div>
    </div>
  )
}

export function MacdAiPanel({
  assetLabel,
  source,
  timeframe,
  forecast,
  cmActive,
  settingsLabel,
  learning,
  journal,
  onClose,
  onToggleAutoJournal,
  onClearJournal,
  onResetLearning,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  forecast: MacdForecast | null
  cmActive: boolean
  settingsLabel: string
  learning: MacdAiLearningState
  journal: MacdForecastJournal
  onClose: () => void
  onToggleAutoJournal: (enabled: boolean) => void
  onClearJournal: () => void
  onResetLearning: () => void
}) {
  const stats = useMemo(() => macdJournalStats(journal), [journal])
  const latestEntries = useMemo(
    () => [...journal.entries].reverse().slice(0, 6),
    [journal.entries],
  )
  const orderedAgents = useMemo(
    () =>
      forecast
        ? [...forecast.agents].sort(
            (a, b) => MACD_AI_AGENT_ORDER.indexOf(a.id) - MACD_AI_AGENT_ORDER.indexOf(b.id),
          )
        : [],
    [forecast],
  )
  const snapshot = forecast?.snapshot ?? null
  const calibration = learning.calibration
  const crossBias = `${calibration.crossBarsBias >= 0 ? '+' : ''}${calibration.crossBarsBias.toFixed(1)}`
  const zeroBias = `${calibration.zeroBarsBias >= 0 ? '+' : ''}${calibration.zeroBarsBias.toFixed(1)}`

  return (
    <aside
      className="side-panel agent-panel"
      aria-label="MACD AI forecast panel"
      data-testid="macd-ai-panel"
    >
      <div className="panel-heading">
        <h2>
          MACD AI <span className="count-badge">{forecast ? orderedAgents.length : 0}</span>
        </h2>
        <div className="row">
          <IconButton icon={Trash2} label="Clear MACD forecast journal" onClick={onClearJournal} />
          <IconButton icon={RefreshCw} label="Reset MACD learned weights" onClick={onResetLearning} />
          <IconButton icon={X} label="Close MACD AI panel" onClick={onClose} />
        </div>
      </div>

      <div className="agent-panel-scroll">
        <div className="panel-intro agent-panel-intro">
          <span className="eyebrow">FORWARD FORECAST — AFTER NOW, NOT NOW</span>
          <p>
            {assetLabel} · {timeframe}
          </p>
          <div className="agent-panel-subtitle">
            <span className={`demo-badge ${source === 'coinbase' ? 'coinbase-feed-badge' : ''}`}>
              {source === 'coinbase' ? 'COINBASE' : 'DEMO'}
            </span>
            <span>{settingsLabel}</span>
          </div>
          {snapshot ? (
            <div
              className="agent-strike-strip macd-ai-reading-strip"
              title="The live CM reading this forecast is projected from."
            >
              <span>MACD {formatMacdValue(snapshot.macd)}</span>
              <span>SIG {formatMacdValue(snapshot.signal)}</span>
              <span className="mono">
                {snapshot.resolution}
                {snapshot.resolution !== timeframe ? ' projection' : ''}
              </span>
            </div>
          ) : null}
        </div>

        {!cmActive ? (
          <div className="agent-empty-wrap">
            <EmptyState
              icon={Zap}
              title="Add CM_Ult_MacD_MTF"
              description="MACD AI reads the CM_Ult_MacD_MTF pane. Open Indicators, search CM_Ult_MacD_MTF, and add it — the forecast group starts speaking from its lines."
            />
          </div>
        ) : !forecast ? (
          <div className="agent-empty-wrap">
            <EmptyState
              icon={Zap}
              title="Waiting for enough candles"
              description="The MACD forecast group starts speaking after at least 30 candles with warmed-up CM values are available on this timeframe."
            />
          </div>
        ) : (
          <>
            <section className="agent-summary-card">
              <div className="agent-summary-head">
                <div>
                  <span className="agent-summary-label">MACD director · coming up</span>
                  <strong className="macd-ai-headline">{forecast.headline}</strong>
                </div>
                <span className={`agent-bias-badge ${BIAS_CLASS[forecast.bias]}`}>
                  {forecast.regime}
                </span>
              </div>
              <div className="agent-summary-grid">
                <div>
                  <span>Confidence</span>
                  <strong>{formatPercent(forecast.confidence)}</strong>
                </div>
                <div>
                  <span>Score</span>
                  <strong>{formatSigned(forecast.score)}</strong>
                </div>
                <div>
                  <span>Signal cross</span>
                  <strong>
                    {forecast.crossDir
                      ? `${forecast.crossDir === 'bullish' ? '↑' : '↓'} ${formatBars(forecast.crossBars)}`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Mid-line flip</span>
                  <strong>
                    {forecast.zeroDir
                      ? `${forecast.zeroDir === 'up' ? '↑' : '↓'} ${formatBars(forecast.zeroBars)}`
                      : `holds ${snapshot?.zeroSide ?? ''}`}
                  </strong>
                </div>
              </div>
              <div className="agent-summary-levels">
                <div>
                  <span>Histogram</span>
                  <strong>
                    {snapshot
                      ? `${snapshot.histogram >= 0 ? '+' : ''}${formatMacdValue(snapshot.histogram)} · ${(snapshot.gapSwing * 100).toFixed(0)}% of swing`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Touch → thrust</span>
                  <strong>
                    {forecast.touch === 'none' ? 'no touch' : forecast.touch} → {forecast.thrust}
                  </strong>
                </div>
              </div>
              <ul className="agent-reason-list">
                {forecast.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>
                    <ChevronRight size={12} />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {forecast.risks.length > 0 && (
                <div className="agent-risk-block">
                  <h3>
                    <ShieldAlert size={13} /> What breaks this forecast
                  </h3>
                  <ul>
                    {forecast.risks.slice(0, 3).map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="agent-section">
              <div className="agent-section-head">
                <h3>
                  <ListOrdered size={13} /> What happens next
                </h3>
                <span>in order, after this bar</span>
              </div>
              <ol className="macd-timeline">
                {forecast.timeline.map((step, index) => (
                  <li key={`${step.title}-${index}`}>
                    <span className="macd-timeline-step">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="agent-section">
              <div className="agent-section-head">
                <h3>
                  <BrainCircuit size={13} /> Specialist opinions
                </h3>
                <span>each times its own event</span>
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
            <span>forecasts settle against later bars</span>
          </div>
          <div className="agent-setting-row">
            <div>
              <strong>Auto-journal</strong>
              <p>Save one forecast per closed candle, settle it 10 bars later, and learn.</p>
            </div>
            <Toggle
              checked={journal.autoJournal}
              onChange={onToggleAutoJournal}
              label="Enable automatic MACD forecast journaling"
            />
          </div>
          <div className="agent-setting-row">
            <div>
              <strong>Timing calibration</strong>
              <p>
                Crosses {crossBias} bars · mid-line {zeroBias} bars · {calibration.samples}{' '}
                timed {calibration.samples === 1 ? 'sample' : 'samples'}
              </p>
            </div>
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
              <span>Hit rate</span>
              <strong>{stats.hitRate == null ? '—' : formatPercent(stats.hitRate)}</strong>
            </div>
            <div>
              <span>Stale</span>
              <strong>{stats.stale}</strong>
            </div>
          </div>
          <div className="agent-learning-grid">
            {MACD_AI_AGENT_ORDER.map((agentId) => (
              <div key={agentId} className="agent-learning-chip">
                <strong>{agentId}</strong>
                <span>{macdLearningHeadline(learning, agentId)}</span>
              </div>
            ))}
          </div>
          <div className="agent-journal-list">
            {latestEntries.length ? (
              latestEntries.map((entry) => <JournalRow key={entry.id} entry={entry} />)
            ) : (
              <p className="agent-journal-empty">
                No journal entries yet. Leave auto-journal on and the group will record closed-candle
                forecasts here, then grade itself once the later bars print.
              </p>
            )}
          </div>
        </section>

        <div className="panel-footnote">
          Specialists stay explainable; only their trust weights and the timing calibration adapt.
          All learning is stored in this browser and never places trades.
        </div>
      </div>
    </aside>
  )
}
