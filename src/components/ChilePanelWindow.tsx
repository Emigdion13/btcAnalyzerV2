import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Info, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import type { ChileReversalSettings, ConnectionState, DataSource, Timeframe } from '../lib/types'
import {
  chileMarkerNowSeconds,
  type ChileLevelState,
  type ChileReversalResult,
} from '../lib/chile-reversal'
import { chileRoundOdds, type ChileRoundOdds } from '../lib/chile-odds'
import { chilePanelSnapshot } from '../lib/chile-panel'
import {
  chileCallStats,
  chileOddsStats,
  chileScorecardKey,
  gradeChileCalls,
  gradeChileOdds,
  mergeChileCalls,
  recordChileCalls,
  sanitizeChileScorecardJournal,
} from '../lib/chile-scorecard'
import { useFloatingWindow } from '../lib/floating-window'
import { formatPrice } from '../lib/market'
import { useLocalState } from '../lib/storage'

const POSITION_KEY = 'chile-panel-pos'
const SCORECARD_KEY = 'chile-scorecard'

const percent = (value: number) => `${Math.round(value * 100)}%`

/** The odds headline: which side of the open is favoured, and how strongly. */
function oddsText(odds: ChileRoundOdds): string {
  if (odds.probabilityAbove === null) return '··'
  if (odds.state === 'closed')
    return odds.favoured === 'above'
      ? 'CLOSED ABOVE'
      : odds.favoured === 'below'
        ? 'CLOSED BELOW'
        : 'CLOSED FLAT'
  return odds.probabilityAbove >= 0.5
    ? `ABOVE ${percent(odds.probabilityAbove)}`
    : `BELOW ${percent(1 - odds.probabilityAbove)}`
}

/** English labels for the Pine `srTexto` states; the Pine string stays in the tooltip. */
const LEVEL_TEXT: Record<ChileLevelState, string> = {
  none: 'NO LEVEL NEARBY',
  'near-r1': 'NEAR R1',
  'near-r2': 'NEAR R2',
  'near-s1': 'NEAR S1',
  'near-s2': 'NEAR S2',
  bounce: 'BOUNCE OFF SUPPORT',
  reject: 'REJECTED AT RESIST.',
  'break-resistance': 'BREAKS RESIST.',
  'break-support': 'BREAKS SUPPORT',
}

const TREND_TEXT = { up: 'BULLISH', down: 'BEARISH', mixed: 'MIXED' } as const

const CALL_TEXT = { up: 'UP', down: 'DOWN', wait: 'WAIT' } as const

const VOLUME_TEXT = { normal: 'NORMAL', high: 'HIGH', 'very-high': 'VERY HIGH' } as const

export interface ChilePanelWindowProps {
  ticker: string
  source: DataSource
  /** The chart timeframe the engine ran on: it times the odds and grades the scorecard. */
  timeframe: Timeframe
  /** The profile the window scores with: the chart's Chile indicator, or the published defaults. */
  settings: ChileReversalSettings
  /** The engine's own result for these candles — the same one the overlay draws. */
  result: ChileReversalResult
  /** The round resolution's feed state; a feed that has not answered is reported, not guessed. */
  roundState: ConnectionState
  momentumState: ConnectionState
  /** False when the chart has no Chile Reversal indicator, so the window runs defaults. */
  hasIndicator: boolean
  onAddIndicator: () => void
  /** The toolbar owns visibility, so closing the window is the same choice as the button. */
  onClose: () => void
}

/**
 * The floating Chile panel: the V17 corner readout — the call for the next round, the countdown
 * to it, each side's share of the score, who closed in control of the bar, volume, the round-timeframe
 * RSI, the trend call and the S/R state — as a draggable window on the chart instead of a Pine
 * `table` pinned to a corner of the pane.
 *
 * It is a view of `lib/chile-panel.ts`, which is a port of the scoring engine: every number comes
 * from the same candles the overlay and the indicators read, and the reversal points come from the
 * overlay engine itself, so the panel can never cheer a marker that is not on the chart. The call
 * is a summary of evidence that has already printed, not a forecast, and the window says so.
 *
 * Beside the call it shows the odds that THIS round finishes above its open (`lib/chile-odds.ts`)
 * and a scorecard of how both have done on this market (`lib/chile-scorecard.ts`).
 */
export function ChilePanelWindow({
  ticker,
  source,
  timeframe,
  settings,
  result,
  roundState,
  momentumState,
  hasIndicator,
  onAddIndicator,
  onClose,
}: ChilePanelWindowProps) {
  const [minimized, setMinimized] = useLocalState('chile-panel-min', false)
  const [showInfo, setShowInfo] = useState(false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 6)
  const [now, setNow] = useState(() => Date.now() / 1000)

  // The countdown needs its own heartbeat; the candles arrive on the feed's cadence.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now() / 1000)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const snapshot = useMemo(
    () => chilePanelSnapshot({ result, settings, nowSeconds: now }),
    [result, settings, now],
  )

  // The odds run on the chart markers' clock: wall time on a live feed, the data's own edge on
  // demo history, which is pinned away from the wall clock.
  const chartSeconds = INTERVAL_SECONDS[timeframe] ?? 60
  const odds = useMemo(
    () =>
      chileRoundOdds({
        bar: result.last,
        nowSeconds: result.last ? chileMarkerNowSeconds(now, result.last.time, chartSeconds) : now,
        resolution: settings.resolution,
        chartTimeframe: timeframe,
      }),
    [result.last, now, chartSeconds, settings.resolution, timeframe],
  )

  const demo = source === 'demo'

  // The scorecard. Loaded history is graded on every update; real-market V17 grades are also
  // saved per profile so the record outlives the chart's window. Synthetic data is never saved.
  const gradedCalls = useMemo(
    () => gradeChileCalls(result, timeframe, settings.resolution),
    [result, timeframe, settings.resolution],
  )
  const oddsStats = useMemo(
    () => chileOddsStats(gradeChileOdds(result, timeframe, settings.resolution)),
    [result, timeframe, settings.resolution],
  )
  const [storedJournal, setStoredJournal] = useLocalState<unknown>(SCORECARD_KEY, null)
  const journal = useMemo(() => sanitizeChileScorecardJournal(storedJournal), [storedJournal])
  const profileKey = chileScorecardKey(source, ticker, timeframe, settings)
  useEffect(() => {
    if (demo) return
    const next = recordChileCalls(journal, profileKey, gradedCalls, Date.now())
    if (next !== journal) setStoredJournal(next)
  }, [demo, journal, profileKey, gradedCalls, setStoredJournal])
  const callStats = useMemo(
    () =>
      chileCallStats(
        demo
          ? gradedCalls
          : mergeChileCalls(journal.profiles[profileKey]?.calls ?? [], gradedCalls),
      ),
    [demo, gradedCalls, journal, profileKey],
  )
  const roundUnfed = result.missingFeed
  const degraded = !demo && (roundState !== 'live' || momentumState !== 'live')
  const dotColor =
    snapshot.call === 'up'
      ? 'var(--green)'
      : snapshot.call === 'down'
        ? 'var(--red)'
        : 'var(--muted)'
  const waiting = !snapshot.ready
    ? snapshot.waitingOn === 'round-feed'
      ? `${settings.resolution} feed loading…`
      : snapshot.waitingOn === 'warmup'
        ? `Warming the ${settings.resolution} ATR…`
        : 'Waiting for chart data…'
    : null

  const rows: { key: string; label: string; value: string; tone: string; title: string }[] = [
    {
      key: 'force-up',
      label: 'UP FORCE',
      value: `${snapshot.fuerzaArriba}%`,
      tone: 'is-up',
      title: `Pine FUERZA ARRIBA · ${snapshot.scoreUp} of ${snapshot.scoreUp + snapshot.scoreDown} points`,
    },
    {
      key: 'force-down',
      label: 'DOWN FORCE',
      value: `${snapshot.fuerzaAbajo}%`,
      tone: 'is-down',
      title: `Pine FUERZA ABAJO · ${snapshot.scoreDown} of ${snapshot.scoreUp + snapshot.scoreDown} points`,
    },
    {
      key: 'buyers',
      label: 'BUYERS',
      value: `${snapshot.buyers}%`,
      tone: 'is-up',
      title: 'Pine COMPRADORES — where in the bar the close landed, not a tape reading',
    },
    {
      key: 'sellers',
      label: 'SELLERS',
      value: `${snapshot.sellers}%`,
      tone: 'is-down',
      title: 'Pine VENDEDORES — the complement of the close position',
    },
    {
      key: 'volume',
      label: 'VOLUME',
      value: VOLUME_TEXT[snapshot.volume],
      tone: snapshot.volume === 'normal' ? '' : 'is-warn',
      title: `Pine VOLUMEN · ${snapshot.volumeRatio.toFixed(2)}× the 20-bar average`,
    },
    {
      key: 'rsi',
      label: `RSI ${settings.resolution}`,
      value: snapshot.rsiRound === null ? '··' : String(Math.round(snapshot.rsiRound)),
      tone: snapshot.rsiRound === null ? '' : snapshot.rsiRound >= 50 ? 'is-up' : 'is-down',
      title: 'Pine RSI 15M — closed bar only',
    },
    {
      key: 'trend',
      label: 'TREND',
      value: TREND_TEXT[snapshot.trend],
      tone: snapshot.trend === 'mixed' ? '' : snapshot.trend === 'up' ? 'is-up' : 'is-down',
      title: `Pine TENDENCIA: ${snapshot.trendLabel} — ROBEX trend and the ${settings.resolution} EMA cross have to agree`,
    },
    {
      key: 'level',
      label: `S/R ${settings.resolution}`,
      value: LEVEL_TEXT[snapshot.level],
      tone:
        snapshot.level === 'none'
          ? 'is-dim'
          : snapshot.level === 'reject' || snapshot.level === 'break-support'
            ? 'is-down'
            : 'is-up',
      title: `Pine S/R 15M: ${snapshot.levelLabel}`,
    },
  ]

  const topFactors = snapshot.factors.slice(0, 6)

  const oddsShown = odds.state !== 'unavailable' && odds.probabilityAbove !== null
  const oddsTitle = oddsShown
    ? `Odds this ${settings.resolution} round closes above its open (${formatPrice(odds.strike)}): the move from the open against the time left, as a random walk fitted on 120 days of Coinbase BTC-USD. The V17 score is not in it — once distance and time were known it added nothing.`
    : ''

  /** Coloured only when the 95% interval clears a coin flip; a short record reads neutral. */
  const verdictTone = (hitRate: number | null, margin: number | null) =>
    hitRate === null || margin === null
      ? ''
      : hitRate - margin > 0.5
        ? 'is-up'
        : hitRate + margin < 0.5
          ? 'is-down'
          : ''
  const oddsMargin =
    oddsStats.hitRate === null
      ? null
      : 1.96 * Math.sqrt((oddsStats.hitRate * (1 - oddsStats.hitRate)) / oddsStats.graded)

  return (
    <section
      ref={boxRef}
      className={`chile-panel${minimized ? ' is-minimized' : ''}${dragging ? ' is-dragging' : ''}${
        degraded ? ' is-degraded' : ''
      }`}
      data-testid="chile-panel-window"
      data-call={snapshot.call}
      role="region"
      aria-label="Chile panel window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="chile-panel-head" onPointerDown={startDrag}>
        <GripVertical size={11} className="chile-panel-grip" aria-hidden="true" />
        <span
          className="chile-panel-dot"
          style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
          aria-hidden="true"
        />
        <span className="chile-panel-title">CHILE PANEL</span>
        {demo ? (
          <span className="chile-panel-tag">SYNTH</span>
        ) : degraded ? (
          <span className="chile-panel-tag">DEGRADED</span>
        ) : (
          <span className="chile-panel-tag is-live">LIVE</span>
        )}
        <span className="chile-panel-head-space" />
        {!hasIndicator && (
          <button
            type="button"
            className="chile-panel-button"
            aria-label="Add the Chile Reversal overlay to the chart"
            title="Add Chile Reversal — then its settings drive this panel"
            onClick={onAddIndicator}
          >
            <Plus size={11} />
          </button>
        )}
        {position ? (
          <button
            type="button"
            className="chile-panel-button"
            aria-label="Snap the Chile panel back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="chile-panel-button"
          aria-label={minimized ? 'Expand the Chile panel' : 'Minimize the Chile panel'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="chile-panel-button is-close"
          aria-label="Hide the Chile panel"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="chile-panel-min-row">
          <span className={`chile-panel-call is-${snapshot.call}`}>
            {snapshot.call === 'up' ? (
              <ArrowUp size={11} aria-hidden="true" />
            ) : snapshot.call === 'down' ? (
              <ArrowDown size={11} aria-hidden="true" />
            ) : (
              <Minus size={11} aria-hidden="true" />
            )}
            {waiting ? 'WAIT' : CALL_TEXT[snapshot.call]}
          </span>
          <span
            className={`chile-panel-clock mono is-${snapshot.clock.urgency}`}
            title="Time to the next round close"
          >
            {snapshot.clock.text}
          </span>
          {oddsShown ? (
            <span
              className={`chile-panel-min-odds mono is-${odds.favoured ?? 'even'}`}
              title={oddsTitle}
            >
              {oddsText(odds)}
            </span>
          ) : null}
          <span className="chile-panel-min-force mono">
            {snapshot.fuerzaArriba}/{snapshot.fuerzaAbajo}
          </span>
        </div>
      ) : (
        <>
          <p className="chile-panel-sub">
            {ticker} · next {settings.resolution} round · min {settings.minScore} pts, edge{' '}
            {settings.minEdge}
          </p>

          <div className="chile-panel-verdict">
            <span className={`chile-panel-call is-${snapshot.call}`}>
              {snapshot.call === 'up' ? (
                <ArrowUp size={13} aria-hidden="true" />
              ) : snapshot.call === 'down' ? (
                <ArrowDown size={13} aria-hidden="true" />
              ) : (
                <Minus size={13} aria-hidden="true" />
              )}
              {waiting ? 'WAIT' : CALL_TEXT[snapshot.call]}
            </span>
            <span
              className={`chile-panel-clock mono is-${snapshot.clock.urgency}`}
              title="Pine TIEMPO — time to the next round close"
            >
              {snapshot.clock.text}
            </span>
            {snapshot.lateral && !waiting ? (
              <span className="chile-panel-chip is-lateral" title="Pine mercadoLateral">
                SIDEWAYS
              </span>
            ) : null}
            {snapshot.official ? (
              <span
                className="chile-panel-chip is-official"
                title="Pine fin15 and barstate.isconfirmed — the bar the original prints its signals on"
              >
                ROUND CLOSE
              </span>
            ) : null}
          </div>

          {waiting ? (
            <p className="chile-panel-waiting" role="status">
              {waiting}
            </p>
          ) : (
            <>
              {oddsShown ? (
                <div
                  className={`chile-panel-odds is-${odds.favoured ?? 'even'}${
                    odds.state === 'closed' ? ' is-closed' : ''
                  }`}
                  data-testid="chile-panel-odds"
                  title={oddsTitle}
                >
                  <span className="chile-panel-odds-label">THIS ROUND</span>
                  <span className="chile-panel-odds-value mono">{oddsText(odds)}</span>
                  <span className="chile-panel-odds-bar" aria-hidden="true">
                    <i style={{ width: percent(odds.probabilityAbove!) }} />
                  </span>
                  <span className="chile-panel-odds-strike mono">
                    open {formatPrice(odds.strike)} · {odds.deltaAtr! >= 0 ? '+' : ''}
                    {odds.deltaAtr!.toFixed(2)} ATR
                  </span>
                </div>
              ) : null}

              <div className="chile-panel-force" title="Each side's share of the total score">
                <span className="chile-panel-force-bar">
                  <i style={{ width: `${snapshot.fuerzaArriba}%` }} />
                </span>
                <span className="chile-panel-force-numbers mono">
                  {snapshot.fuerzaArriba}% / {snapshot.fuerzaAbajo}%
                </span>
              </div>

              <dl className="chile-panel-rows">
                {rows.map((row) => (
                  <div className={`chile-panel-row ${row.tone}`} key={row.key} title={row.title}>
                    <dt>{row.label}</dt>
                    <dd className="mono">{row.value}</dd>
                  </div>
                ))}
              </dl>

              {topFactors.length ? (
                <div className="chile-panel-factors" aria-label="Score contributions">
                  {topFactors.map((factor) => (
                    <span
                      className={`chile-panel-factor is-${factor.side}`}
                      key={factor.key}
                      title={`${factor.points} point${factor.points === 1 ? '' : 's'} ${
                        factor.side === 'up' ? 'up' : 'down'
                      }`}
                    >
                      {factor.label}
                      <b>{factor.points}</b>
                    </span>
                  ))}
                </div>
              ) : null}

              <dl className="chile-panel-score" aria-label="Scorecard">
                <div
                  className={`chile-panel-score-row ${verdictTone(callStats.hitRate, callStats.margin)}`}
                  data-testid="chile-panel-score-calls"
                  title={
                    callStats.hitRate === null
                      ? 'No round-close call has been graded yet: each one is graded when the round after it closes.'
                      : `Round-close calls graded against the next round's open → close: ${callStats.correct} of ${callStats.scored} right, ±${percent(callStats.margin!)} at 95%. UP ${callStats.up.correct}/${callStats.up.scored}, DOWN ${callStats.down.correct}/${callStats.down.scored}; ${callStats.waits} WAIT not scored. A coin flip is 50%.${demo ? ' Synthetic data — not saved.' : ' Saved on this device per market, chart and profile.'}`
                  }
                >
                  <dt>V17 CALLS</dt>
                  <dd className="mono">
                    {callStats.hitRate === null
                      ? '—'
                      : `${percent(callStats.hitRate)} right · ${callStats.correct}/${callStats.scored}`}
                  </dd>
                </div>
                <div
                  className={`chile-panel-score-row ${verdictTone(oddsStats.hitRate, oddsMargin)}`}
                  data-testid="chile-panel-score-odds"
                  title={
                    oddsStats.hitRate === null
                      ? 'No finished round in the loaded history to grade the odds against yet.'
                      : `Every closed ${timeframe} bar's this-round odds in the loaded history, graded against how its round finished: the favoured side won ${oddsStats.correct} of ${oddsStats.graded}. Brier ${oddsStats.brier!.toFixed(3)} — a coin flip scores 0.250, lower is better.`
                  }
                >
                  <dt>THIS-ROUND ODDS</dt>
                  <dd className="mono">
                    {oddsStats.hitRate === null
                      ? '—'
                      : `${percent(oddsStats.hitRate)} right · ${oddsStats.graded}`}
                  </dd>
                </div>
              </dl>
            </>
          )}

          <footer className="chile-panel-foot">
            <span className="chile-panel-round mono" title="Round open · move in round ATR">
              {snapshot.round.open === null
                ? '—'
                : `${snapshot.round.move! >= 0 ? '+' : ''}${snapshot.round.move!.toFixed(2)} ATR`}
            </span>
            {roundUnfed ? <span className="chile-panel-unfed">round feed unavailable</span> : null}
            <span className="chile-panel-foot-space" />
            <button
              type="button"
              className={`chile-panel-chip${showInfo ? ' is-on' : ''}`}
              aria-label="How the call is scored"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((open) => !open)}
            >
              <Info size={10} />
            </button>
          </footer>
          {showInfo ? (
            <p className="chile-panel-note">
              The call is the V17 score: ROBEX trend (supertrend), the {settings.resolution} EMA
              cross and slope, its RSI, higher highs and lows, 5m momentum, the chart's own EMA
              stack and VWAP, close position in the bar, volume, the round so far, and ±3 for a
              bounce, a rejection or a break of the pivot levels the overlay draws. Each side needs{' '}
              {settings.minScore} points and a {settings.minEdge}-point lead, and a sideways market
              scores nothing at all. It is a summary of what has already printed, not a forecast,
              and it places no orders. On 120 days of Coinbase BTC-USD it called the next round
              right 47% of the time — check the scorecard before leaning on it. THIS ROUND is
              separate: the odds the current round closes above its open, from how far price has
              moved and how much time is left.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
