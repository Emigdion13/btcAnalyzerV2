import { useMemo } from 'react'
import { GripVertical, Minus, Plus, RotateCcw, Settings2, X } from 'lucide-react'
import type { Indicator } from '../lib/types'
import {
  OSC_HUD_BAR_STEP,
  OSC_HUD_LAYOUT,
  OSC_HUD_MAX_BARS,
  OSC_HUD_MIN_BARS,
  OSC_HUD_WIDGETS,
  oscHudGeometry,
} from '../lib/osc-hud'
import type { OscHudModel, OscHudTrace } from '../lib/osc-hud'
import { useFloatingWindow } from '../lib/floating-window'
import { formatPrice } from '../lib/market'
import { oscHudScaleLabel } from '../lib/osc-hud'
import { useLocalState } from '../lib/storage'

interface Props {
  /** Everything the card shows, computed by the chart from the same values its pane plots. */
  model: OscHudModel
  /** Which corner of the chart the card rests in before you drag it. */
  dock: 'cm' | 'wave'
  /** The indicator the card reads, when the chart has one. */
  indicator: Indicator | null
  onEditIndicator: (indicator: Indicator) => void
  onAddIndicator: (kind: Indicator['kind']) => void
  /** The toolbar button owns visibility, so closing the card is the same choice as the button. */
  onClose: () => void
  bars: number
  onZoom: (delta: number) => void
}

/**
 * A floating window onto one oscillator's last twenty minutes: a zoomed mini chart of the same
 * values the pane at the bottom of the screen plots, with the numbers for whichever bar the
 * crosshair is on and the call the indicator itself is read for.
 *
 * It is deliberately a view and not a copy of the pane: the y scale is the window's own extremes
 * (symmetric about zero, so a bar's sign still reads), the bars are wide enough to see the shape
 * of a single wave, and the level lines appear only once the window's scale can show them. Drag
 * it by the header, minimize it to one line, or close it with the button that opened it.
 */
export function OscHudCard({
  model,
  dock,
  indicator,
  onEditIndicator,
  onAddIndicator,
  onClose,
  bars,
  onZoom,
}: Props) {
  const widget = OSC_HUD_WIDGETS[model.kind]
  const [minimized, setMinimized] = useLocalState(widget.minimizedKey, false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(widget.positionKey, 8)
  const geometry = useMemo(
    () =>
      oscHudGeometry(model.times.length, model.domain, OSC_HUD_LAYOUT.width, OSC_HUD_LAYOUT.height),
    [model.times.length, model.domain],
  )
  const traces = useMemo(
    () => [...model.traces].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
    [model.traces],
  )
  // The headline number is the indicator's own first series — MACD, not its signal, and wt1
  // rather than its average — which is the trace with the highest z of the line series.
  const primary = traces.filter((trace) => trace.style === 'line').at(-1) ?? traces[0]
  const activeValue =
    model.activeIndex === null || !primary ? null : (primary.values[model.activeIndex] ?? null)
  const markY =
    model.activeIndex === null || activeValue === null
      ? null
      : Math.min(geometry.height - 7, Math.max(7, geometry.y(activeValue)))

  return (
    <section
      ref={boxRef}
      className={`osc-hud-card dock-${dock}${minimized ? ' is-minimized' : ''}${
        dragging ? ' is-dragging' : ''
      } is-${model.verdict.tone}`}
      data-testid={`osc-hud-${model.kind}`}
      role="region"
      aria-label={`${model.title} window`}
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="osc-hud-head" onPointerDown={startDrag}>
        <GripVertical size={11} className="osc-hud-grip" aria-hidden="true" />
        <span
          className="osc-hud-dot"
          style={{ background: model.accent, boxShadow: `0 0 6px ${model.accent}` }}
          aria-hidden="true"
        />
        <span className="osc-hud-title">{model.title}</span>
        {model.hovered ? (
          <span className="osc-hud-tag is-bar">BAR</span>
        ) : (
          <span className="osc-hud-tag is-live">LIVE</span>
        )}
        <span className="osc-hud-head-space" />
        {indicator ? (
          <button
            type="button"
            className="osc-hud-button"
            aria-label={`Settings for ${model.title}`}
            title={`Settings for ${indicator.name}`}
            onClick={() => onEditIndicator(indicator)}
          >
            <Settings2 size={11} />
          </button>
        ) : (
          <button
            type="button"
            className="osc-hud-button"
            aria-label={`Add the ${model.title} pane to the chart`}
            title={`Add the ${model.title} pane — then its settings are editable here`}
            onClick={() => onAddIndicator(model.kind)}
          >
            <Plus size={11} />
          </button>
        )}
        {position ? (
          <button
            type="button"
            className="osc-hud-button"
            aria-label="Snap this window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="osc-hud-button"
          aria-label={minimized ? `Expand ${model.title} window` : `Minimize ${model.title} window`}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="osc-hud-button is-close"
          aria-label={`Hide ${model.title} window`}
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="osc-hud-min-row">
          <span className="osc-hud-min-value mono">{model.readouts[0]?.value ?? '—'}</span>
          <span className={`osc-hud-min-verdict tone-${model.verdict.tone}`}>
            {model.verdict.text}
          </span>
        </div>
      ) : (
        <>
          <p className="osc-hud-sub">
            {model.subtitle} · {model.bars} bars / {model.spanLabel} ·{' '}
            {model.settingsSource === 'chart' ? 'your indicator' : 'default settings'}
          </p>
          {model.ready ? (
            <div className="osc-hud-plot">
              <svg
                className="osc-hud-svg"
                width={geometry.width}
                height={geometry.height}
                viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                role="img"
                aria-label={`${model.bars} bars of ${model.title}, ${model.verdict.text}`}
              >
                <g className="osc-hud-grid">
                  {model.levels.map((level) => (
                    <line
                      key={`level-${level.value}`}
                      x1={0}
                      x2={geometry.width}
                      y1={geometry.y(level.value)}
                      y2={geometry.y(level.value)}
                      stroke={level.color}
                      strokeWidth={1}
                      strokeDasharray={level.dashed ? '3 3' : undefined}
                      opacity={level.value === 0 ? 0.5 : 0.34}
                    />
                  ))}
                </g>
                {model.histogram ? (
                  <g className="osc-hud-histogram">
                    {model.histogram.values.map((value, index) => {
                      if (value === null) return null
                      const top = Math.min(geometry.y(value), geometry.zeroY)
                      const height = Math.max(1, Math.abs(geometry.y(value) - geometry.zeroY))
                      return (
                        <rect
                          key={`hist-${index}`}
                          x={geometry.x[index]! - geometry.barWidth / 2}
                          y={top}
                          width={geometry.barWidth}
                          height={height}
                          fill={model.histogram!.colors[index]}
                          fillOpacity={model.activeIndex === index ? 1 : 0.82}
                        />
                      )
                    })}
                  </g>
                ) : null}
                {traces.map((trace) => (
                  <OscHudTraceShape
                    key={trace.title}
                    trace={trace}
                    geometry={geometry}
                    activeIndex={model.activeIndex}
                  />
                ))}
                {model.activeIndex !== null ? (
                  <g className="osc-hud-cursor">
                    <line
                      x1={geometry.x[model.activeIndex]}
                      x2={geometry.x[model.activeIndex]}
                      y1={OSC_HUD_LAYOUT.padTop - 5}
                      y2={geometry.height - OSC_HUD_LAYOUT.padBottom + 5}
                    />
                    {traces
                      .filter((trace) => trace.style !== 'dots')
                      .map((trace) => {
                        const value = trace.values[model.activeIndex!]
                        return value === null || value === undefined ? null : (
                          <circle
                            key={`mark-${trace.title}`}
                            cx={geometry.x[model.activeIndex!]}
                            cy={geometry.y(value)}
                            r={2.6}
                            fill={trace.color}
                          />
                        )
                      })}
                  </g>
                ) : null}
              </svg>
              <div className="osc-hud-axis">
                <span className="mono">{oscHudScaleLabel(model.domain.max)}</span>
                {markY === null ? null : (
                  <span className="osc-hud-axis-mark mono" style={{ top: markY }}>
                    {formatPrice(activeValue)}
                  </span>
                )}
                <span className="mono">{oscHudScaleLabel(model.domain.min)}</span>
              </div>
            </div>
          ) : (
            <p className="osc-hud-empty">
              {model.note || 'Not enough history in this window yet.'}
            </p>
          )}
          <div className="osc-hud-readouts">
            {model.readouts.map((readout) => (
              <span key={readout.label} className="osc-hud-readout" title={readout.title}>
                <small>{readout.label}</small>
                <b className="mono" style={readout.color ? { color: readout.color } : undefined}>
                  {readout.value}
                </b>
              </span>
            ))}
          </div>
          <div className="osc-hud-foot">
            <span
              className={`osc-hud-verdict tone-${model.verdict.tone}`}
              title={model.verdict.detail}
            >
              {model.verdict.text}
            </span>
            <span className="osc-hud-zoom">
              <button
                type="button"
                aria-label={`Fewer bars of ${model.title} in the window`}
                disabled={bars <= OSC_HUD_MIN_BARS}
                onClick={() => onZoom(-OSC_HUD_BAR_STEP)}
              >
                <Minus size={10} />
              </button>
              <span title="Bars in the window, and how long that is on this chart">
                {model.bars} bars
              </span>
              <button
                type="button"
                aria-label={`More bars of ${model.title} in the window`}
                disabled={bars >= OSC_HUD_MAX_BARS}
                onClick={() => onZoom(OSC_HUD_BAR_STEP)}
              >
                <Plus size={10} />
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  )
}

/** One series of the mini chart: a line, the original's dotted marker series, or an area fill. */
function OscHudTraceShape({
  trace,
  geometry,
  activeIndex,
}: {
  trace: OscHudTrace
  geometry: ReturnType<typeof oscHudGeometry>
  activeIndex: number | null
}) {
  const points = trace.values
    .map((value, index) => (value === null ? null : `${geometry.x[index]},${geometry.y(value)}`))
    .filter((point): point is string => point !== null)
  if (trace.style === 'dots') {
    return (
      <g className="osc-hud-dots">
        {trace.values.map((value, index) =>
          value === null ? null : (
            <circle
              key={`${trace.title}-${index}`}
              cx={geometry.x[index]}
              cy={geometry.y(value)}
              r={trace.width / 2}
              fill={trace.color}
              fillOpacity={activeIndex === index ? 1 : 0.9}
            />
          ),
        )}
      </g>
    )
  }
  if (!points.length) return null
  if (trace.style === 'area') {
    const first = trace.values.findIndex((value) => value !== null)
    const last = trace.values.reduce<number>(
      (acc, value, index) => (value === null ? acc : index),
      0,
    )
    const baseline = geometry.y(0)
    // An SVG path has to open with a moveto: a bare list of coordinates is a parse error, not a line.
    const path = `M ${points.join(' L ')} L ${geometry.x[last]},${baseline} L ${
      geometry.x[first]
    },${baseline} Z`
    return (
      <path
        d={path}
        fill={trace.color}
        fillOpacity={(100 - (trace.transp ?? 80)) / 100}
        stroke={trace.color}
        strokeWidth={0.6}
        strokeOpacity={0.5}
      />
    )
  }
  return (
    <polyline
      className="osc-hud-line"
      points={points.join(' ')}
      fill="none"
      stroke={trace.color}
      strokeWidth={trace.width}
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeDasharray={trace.dash}
      vectorEffect="non-scaling-stroke"
    />
  )
}
