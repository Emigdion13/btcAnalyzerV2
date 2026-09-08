import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronRight, GripVertical, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { formatPrice } from '../lib/market'
import type { MarketAnalysis } from '../lib/market-agents'
import { readStored, useLocalState, writeStored } from '../lib/storage'
import type { DataSource, Timeframe } from '../lib/types'

const POSITION_KEY = 'agent-outcome-card-pos'
type Position = { x: number; y: number }

const BIAS_LABEL: Record<NonNullable<MarketAnalysis>['bias'], string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'No trade',
}

const formatPercent = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`

const formatSigned = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`

export function AgentOutcomeCard({
  assetLabel,
  source,
  timeframe,
  analysis,
  onOpenPanel,
  onClose,
}: {
  assetLabel: string
  source: DataSource
  timeframe: Timeframe
  analysis: MarketAnalysis | null
  onOpenPanel: () => void
  onClose: () => void
}) {
  const [minimized, setMinimized] = useLocalState('agent-outcome-card-min', false)
  const [position, setPosition] = useState<Position | null>(() =>
    readStored<Position | null>(POSITION_KEY, null),
  )
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const positionRef = useRef<Position | null>(position)
  positionRef.current = position

  const clampToStage = useCallback((next: Position): Position => {
    const box = boxRef.current
    const stage = box?.parentElement
    if (!box || !stage) return next
    const { width, height } = box.getBoundingClientRect()
    const area = stage.getBoundingClientRect()
    return {
      x: Math.min(Math.max(8, next.x), Math.max(8, area.width - width - 8)),
      y: Math.min(Math.max(8, next.y), Math.max(8, area.height - height - 8)),
    }
  }, [])

  useEffect(() => {
    const stage = boxRef.current?.parentElement
    if (!stage) return
    const reflow = () => setPosition((current) => (current ? clampToStage(current) : current))
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reflow)
      return () => window.removeEventListener('resize', reflow)
    }
    const observer = new ResizeObserver(reflow)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [clampToStage])

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, a')) return
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

  const contextOpinion = useMemo(
    () => analysis?.agents.find((agent) => agent.id === 'context') ?? null,
    [analysis],
  )

  const specialists = analysis ? analysis.agents.filter((agent) => agent.id !== 'ensemble') : []
  const toneClass = analysis ? `is-${analysis.bias}` : 'is-waiting'

  return (
    <section
      ref={boxRef}
      className={`agent-outcome-card ${toneClass}${dragging ? ' is-dragging' : ''}${
        minimized ? ' is-min' : ''
      }`}
      aria-label="AI market outcome"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="agent-outcome-head" onPointerDown={startDrag}>
        <GripVertical size={12} className="agent-outcome-grip" aria-hidden="true" />
        <div className="agent-outcome-title">
          <strong>AI outcome</strong>
          <span>
            {assetLabel} · {timeframe}
          </span>
        </div>
        <span className={`agent-outcome-badge ${toneClass}`}>
          {analysis ? BIAS_LABEL[analysis.bias] : 'Waiting'}
        </span>
        {position ? (
          <button
            type="button"
            className="agent-outcome-icon"
            onClick={() => {
              positionRef.current = null
              setPosition(null)
              writeStored(POSITION_KEY, null)
            }}
            aria-label="Reset AI outcome card position"
            title="Reset position"
          >
            <RotateCcw size={11} />
          </button>
        ) : null}
        <button
          type="button"
          className="agent-outcome-icon"
          onClick={() => setMinimized((current) => !current)}
          aria-label={minimized ? 'Expand AI outcome card' : 'Minimize AI outcome card'}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          <Bot size={11} />
        </button>
        <button
          type="button"
          className="agent-outcome-icon"
          onClick={onClose}
          aria-label="Hide AI outcome card"
          title="Hide"
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="agent-outcome-min-row">
          <strong>{analysis ? BIAS_LABEL[analysis.bias] : 'Waiting for candles'}</strong>
          <span>{analysis ? formatPercent(analysis.confidence) : '30 candles needed'}</span>
        </div>
      ) : !analysis ? (
        <div className="agent-outcome-body">
          <p className="agent-outcome-waiting">
            The AI card starts speaking after at least 30 candles are loaded on this timeframe.
          </p>
          <div className="agent-outcome-footer">
            <span className="agent-outcome-source">{source === 'coinbase' ? 'Coinbase' : 'Demo'}</span>
            <button type="button" className="agent-outcome-open" onClick={onOpenPanel}>
              Open full agents
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="agent-outcome-body">
          <div className="agent-outcome-summary">
            <div>
              <span>Decision</span>
              <strong>{BIAS_LABEL[analysis.bias]}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{formatPercent(analysis.confidence)}</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{formatSigned(analysis.score)}</strong>
            </div>
            <div>
              <span>Regime</span>
              <strong>{analysis.regime}</strong>
            </div>
          </div>
          <div className="agent-outcome-strip">
            <span>
              {specialists.length} specialists · price {formatPrice(analysis.summary.currentPrice)}
            </span>
            {contextOpinion ? (
              <span>
                context {BIAS_LABEL[contextOpinion.bias].toLowerCase()} {formatPercent(
                  contextOpinion.confidence,
                )}
              </span>
            ) : (
              <span>context waiting</span>
            )}
          </div>
          <div className="agent-outcome-copy">
            <p>{analysis.reasons[0] ?? 'No primary explanation recorded yet.'}</p>
            {analysis.risks[0] ? (
              <div className="agent-outcome-risk">
                <ShieldAlert size={12} />
                <span>{analysis.risks[0]}</span>
              </div>
            ) : null}
          </div>
          <div className="agent-outcome-footer">
            <span className="agent-outcome-source">{source === 'coinbase' ? 'Coinbase' : 'Demo'}</span>
            <button type="button" className="agent-outcome-open" onClick={onOpenPanel}>
              Open full agents
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
