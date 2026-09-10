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
import type { AgentForecast, PriceForecast } from '../lib/price-forecast'
import type {
  AgentLearningState,
  AgentOpinion,
  ContextAnalysis,
  MarketAnalysis,
} from '../lib/market-agents'
import { canSettleAtWindow, formatCountdown, kalshiClockLabel } from '../lib/kalshi-window'
import { formatPrice } from '../lib/market'
import type { DataSource, Timeframe } from '../lib/types'
import { EmptyState, IconButton, Toggle } from './ui'

const BIAS_LABEL: Record<AgentOpinion['bias'], string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'No trade',
}

/** The horizon call in one phrase: the strike side when there is a strike line, else the lean. */
function forecastCall(forecast: PriceForecast): string {
  if (forecast.strikeCall === 'above') return 'Above strike'
  if (forecast.strikeCall === 'below') return 'Below strike'
  if (forecast.finishAboveProbability !== null) return 'Coin flip'
  return forecast.bias === 'bullish' ? 'Higher' : forecast.bias === 'bearish' ? 'Lower' : 'Sideways'
}

const formatAtr = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : '\u2212'}${Math.abs(value).toFixed(digits)}`

/** When a live strike frames the analysis, every vote reads as the window call. */
const CALL_LABEL: Record<AgentOpinion['bias'], string> = {
  bullish: 'UP',
  bearish: 'DOWN',
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
        <span>
          {state === 'loading' || state === 'connecting' ? 'Loading…' : 'Waiting for data'}
        </span>
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

function AgentCard({
  opinion,
  windowCall,
  forecast,
}: {
  opinion: AgentOpinion
  windowCall: boolean
  forecast?: AgentForecast
}) {
  const meter = `${50 + opinion.score * 50}%`
  return (
    <article className={`agent-card ${BIAS_CLASS[opinion.bias]}`}>
      <header className="agent-card-head">
        <div>
          <strong>{opinion.label}</strong>
          <span>{windowCall ? CALL_LABEL[opinion.bias] : BIAS_LABEL[opinion.bias]}</span>
        </div>
        <div className="agent-card-metrics">
          <span>{Math.round(opinion.confidence * 100)}%</span>
          <span>{formatSigned(opinion.score)}</span>
        </div>
      </header>
      <div className="agent-card-meter" aria-hidden="true">
        <i style={{ left: meter }} />
      </div>
      {forecast ? (
        <div
          className="agent-card-forecast"
          title={`This agent's horizon projection: ${formatAtr(forecast.driftAtr)} ATR of drift, ${Math.round(forecast.confidence * 100)}% confident.`}
        >
          <span>horizon {formatAtr(forecast.driftAtr)} ATR</span>
          {forecast.finishAboveProbability !== null ? (
            <span>{Math.round(forecast.finishAboveProbability * 100)}% above</span>
          ) : null}
          {forecast.strikeTouchProbability !== null ? (
            <span>
              touch {Math.round(forecast.strikeTouchProbability * 100)}%
              {forecast.strikeBars !== null ? ` ~${forecast.strikeBars}` : ''}
            </span>
          ) : null}
          <span>{forecast.path}</span>
        </div>
      ) : null}
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
  settleMode,
  onClose,
  onToggleAutoJournal,
  onHorizonBarsChange,
  onSettleModeChange,
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
  settleMode: 'bars' | 'cut'
  onClose: () => void
  onToggleAutoJournal: (enabled: boolean) => void
  onHorizonBarsChange: (bars: number) => void
  onSettleModeChange: (mode: 'bars' | 'cut') => void
  onClearJournal: () => void
  onResetLearning: () => void
}) {
  const stats = useMemo(() => journalStats(journal), [journal])
  const latestEntries = useMemo(() => [...journal.entries].reverse().slice(0, 6), [journal.entries])
  const horizonOptions = useMemo(() => horizonChoices(timeframe), [timeframe])
  const strike = analysis?.summary.strike ?? null
  const model = analysis?.forecast ?? null
  const windowCall = strike !== null
  const windowSettles = windowCall && canSettleAtWindow(timeframe)
  const strikeDelta =
    strike == null
      ? null
      : `${strike.delta >= 0 ? '+' : '\u2212'}${formatPrice(Math.abs(strike.delta), false, 2)}`
  const orderedAgents = useMemo(() => {
    if (!analysis) return []
    const specialists = analysis.agents.filter((agent) => agent.id !== 'ensemble')
    const projections = new Map(
      specialists.map((agent, index) => [agent.id, analysis.forecast.agents[index]]),
    )
    return [...analysis.agents]
      .sort((a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id))
      .map((opinion) => ({ opinion, forecast: projections.get(opinion.id) }))
  }, [analysis])

  return (
    <aside className="side-panel agent-panel" aria-label="Market analysis agents">
      <div className="panel-heading">
        <h2>
          Price AI <span className="count-badge">{analysis ? orderedAgents.length : 0}</span>
        </h2>
        <div className="row">
          <IconButton icon={Trash2} label="Clear agent journal" onClick={onClearJournal} />
          <IconButton icon={RefreshCw} label="Reset learned weights" onClick={onResetLearning} />
          <IconButton icon={X} label="Close agent panel" onClick={onClose} />
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
            <span>Adaptive ensemble · local learning only</span>
          </div>
          {strike ? (
            <div
              className="agent-strike-strip"
              title={
                strike.provisional
                  ? 'Strike is still setting — provisional print from the live tape.'
                  : `Price is ${strike.side} the strike by ${Math.abs(strike.deltaAtr).toFixed(2)} ATR · settles UP/DOWN at the ${kalshiClockLabel(strike.windowEnd)} cut.`
              }
            >
              <span>
                STRIKE {strike.provisional ? '~' : ''}
                {formatPrice(strike.price, true)}
              </span>
              <span className={strike.delta >= 0 ? 'is-up' : 'is-down'}>
                {strike.delta >= 0 ? '\u25B2' : '\u25BC'} {strikeDelta} {strike.side}
              </span>
              <span className="mono">
                {formatCountdown(strike.secondsLeft)} → {kalshiClockLabel(strike.windowEnd)}
              </span>
            </div>
          ) : null}
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
                  <span className="agent-summary-label">
                    Horizon call · {analysis.forecast.horizonBars} bars
                  </span>
                  <strong>{model ? forecastCall(model) : BIAS_LABEL[analysis.bias]}</strong>
                </div>
                <span
                  className={`agent-bias-badge ${model ? BIAS_CLASS[model.bias] : BIAS_CLASS[analysis.bias]}`}
                >
                  {analysis.regime}
                </span>
              </div>
              <p className="agent-forecast-headline">{analysis.forecast.headline}</p>
              <div className="agent-summary-grid">
                <div>
                  <span>
                    {model && model.finishAboveProbability !== null ? 'Finish above' : 'Confidence'}
                  </span>
                  <strong>
                    {model && model.finishAboveProbability !== null
                      ? formatPercent(model.finishAboveProbability)
                      : formatPercent(analysis.forecast.confidence)}
                  </strong>
                </div>
                <div>
                  <span>Expected close</span>
                  <strong>{formatPrice(analysis.forecast.expectedPrice)}</strong>
                </div>
                <div>
                  <span>Drift</span>
                  <strong>{formatAtr(analysis.forecast.expectedMoveAtr)} ATR</strong>
                </div>
                <div>
                  <span>Path</span>
                  <strong>{analysis.forecast.path}</strong>
                </div>
              </div>
              <div className="agent-summary-levels">
                <div>
                  <span>Finish band</span>
                  <strong>
                    {formatPrice(analysis.forecast.targetLow)} –{' '}
                    {formatPrice(analysis.forecast.targetHigh)}
                  </strong>
                </div>
                <div>
                  <span>Strike touch</span>
                  <strong>
                    {analysis.forecast.strikeTouchProbability === null
                      ? '—'
                      : `${formatPercent(analysis.forecast.strikeTouchProbability)}${analysis.forecast.strikeTouch ? ` · ${analysis.forecast.touchVerdict}${analysis.forecast.strikeBars ? ` ~${analysis.forecast.strikeBars} ${analysis.forecast.strikeBars === 1 ? 'bar' : 'bars'}` : ''}` : ' · not expected'}`}
                  </strong>
                </div>
              </div>
              <div className="agent-summary-levels">
                <div>
                  <span>Now</span>
                  <strong>
                    {windowCall ? CALL_LABEL[analysis.bias] : BIAS_LABEL[analysis.bias]} ·{' '}
                    {formatSigned(analysis.score)} @ {formatPercent(analysis.confidence)}
                  </strong>
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
                {analysis.forecast.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>
                    <ChevronRight size={12} />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {analysis.forecast.risks.length > 0 && (
                <div className="agent-risk-block">
                  <h3>
                    <ShieldAlert size={13} /> What breaks this forecast
                  </h3>
                  <ul>
                    {analysis.forecast.risks.slice(0, 3).map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="agent-section">
              <div className="agent-section-head">
                <h3>
                  <Sparkles size={13} /> What happens next
                </h3>
                <span>in order, after this bar</span>
              </div>
              <ol className="macd-timeline">
                {analysis.forecast.timeline.map((step, index) => (
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
                {orderedAgents.map(({ opinion, forecast }) => (
                  <AgentCard
                    key={opinion.id}
                    opinion={opinion}
                    windowCall={windowCall}
                    forecast={forecast}
                  />
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
              <strong>Settlement</strong>
              <p>
                {settleMode === 'cut'
                  ? `Forecasts settle UP/DOWN from the strike at the ${strike ? kalshiClockLabel(strike.windowEnd) : 'window'} cut.`
                  : `Forecasts settle ${horizonBars} bars later — where the AI said they would land.`}
              </p>
            </div>
            <label className="agent-horizon-select">
              <span>Mode</span>
              <select
                value={settleMode}
                onChange={(event) => onSettleModeChange(event.target.value as 'bars' | 'cut')}
                aria-label="Forecast settlement mode"
              >
                <option value="bars">After {horizonBars} bars</option>
                <option value="cut" disabled={!windowSettles}>
                  At the strike cut
                </option>
              </select>
            </label>
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
            <div title="Entries whose forecast chose a side of the strike line">
              <span>Strike calls</span>
              <strong>
                {stats.strikeAccuracy == null
                  ? '—'
                  : `${formatPercent(stats.strikeAccuracy)} (${stats.strikeResolved})`}
              </strong>
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
                <div
                  key={entry.id}
                  className={`agent-journal-entry ${entry.strikeResult ? `is-${entry.strikeResult}` : entry.result ? `is-${entry.result}` : 'is-pending'}`}
                >
                  <div>
                    <strong>
                      {entry.symbol} · {entry.timeframe}
                    </strong>
                    <span>
                      {entry.forecast?.strikeSide
                        ? `${entry.forecast.strikeSide.toUpperCase()} ${Math.round((entry.forecast.strikeProbability ?? 0) * 100)}%`
                        : entry.bias}{' '}
                      · {Math.round((entry.forecast?.confidence ?? entry.confidence) * 100)}% ·{' '}
                      {entry.mode === 'window'
                        ? `window \u2192${kalshiClockLabel(entry.targetTime)}`
                        : `${entry.horizonBars} bars`}
                    </span>
                  </div>
                  <div className="agent-journal-outcome">
                    <strong>
                      {entry.strikeResult
                        ? `${entry.actualStrikeSide ? entry.actualStrikeSide.toUpperCase() : 'FLAT'} ${entry.strikeResult === 'correct' ? '\u2713' : '\u2717'}`
                        : entry.result
                          ? entry.result.toUpperCase()
                          : 'PENDING'}
                    </strong>
                    <span>
                      {entry.move == null
                        ? 'Awaiting outcome'
                        : `${formatSigned(entry.move * 100)}%${entry.touchedStrike === true ? ' · touched' : ''}`}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="agent-journal-empty">
                No journal entries yet. Leave auto-journal on and every closed candle gets a
                forecast here, graded once its horizon prints.
              </p>
            )}
          </div>
        </section>

        <div className="panel-footnote">
          Each specialist projects its own read across the horizon; the director weights them by
          what settled forecasts taught it. {analysis?.forecast.modelNote ?? ''} All learning stays
          in this browser and nothing here places trades.
        </div>
      </div>
    </aside>
  )
}
