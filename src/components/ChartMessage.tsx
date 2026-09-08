import type { ReactNode } from 'react'
import type { SrBreakLabelKind } from '../lib/sr-breaks-retests'
import {
  chartMessageClass,
  CHART_MESSAGE_PLATE_CLASS,
  SR_BREAK_LABEL_SIZE,
} from '../lib/chart-message'

/**
 * Messages drawn inside the chart pane. They are transparent by contract — see
 * `src/lib/chart-message.ts` for the styling contract these components render.
 */

export interface ChartMessagePlateProps {
  x: number
  y: number
  width: number
  height: number
  /** Corner radius; `0` draws a square plate. */
  rx?: number
  /** Outline color. The plate is never filled. */
  color: string
  /** Outline strength, `0 – 1`. */
  strokeOpacity?: number
  testId?: string
}

/** Transparent outline plate for an in-chart message. */
export function ChartMessagePlate({
  x,
  y,
  width,
  height,
  rx = 3,
  color,
  strokeOpacity = 0.55,
  testId,
}: ChartMessagePlateProps) {
  return (
    <rect
      className={CHART_MESSAGE_PLATE_CLASS}
      x={x}
      y={y}
      width={width}
      height={height}
      rx={rx}
      fill="none"
      stroke={color}
      strokeOpacity={strokeOpacity}
      strokeWidth="1"
      data-testid={testId}
    />
  )
}

export interface ChartMessageTextProps {
  x: number
  y: number
  color: string
  size?: number
  weight?: number | string
  fontFamily?: string
  anchor?: 'start' | 'middle' | 'end'
  /** Glyph opacity, `0 – 1`; the halo keeps dimmed text readable. */
  opacity?: number
  /** Extra classes appended after `chart-message`. */
  className?: string
  testId?: string
  children: ReactNode
}

/** Halo-backed in-chart caption; readable over candles with no background. */
export function ChartMessageText({
  x,
  y,
  color,
  size = 10,
  weight,
  fontFamily = 'DM Sans, sans-serif',
  anchor,
  opacity,
  className,
  testId,
  children,
}: ChartMessageTextProps) {
  return (
    <text
      className={chartMessageClass(size, className)}
      x={x}
      y={y}
      textAnchor={anchor}
      fill={color}
      fillOpacity={opacity}
      fontSize={size}
      fontWeight={weight}
      fontFamily={fontFamily}
      data-testid={testId}
    >
      {children}
    </text>
  )
}

export interface SrBreakLabelProps {
  kind: SrBreakLabelKind
  /** Anchor in pane coordinates: the previous bar at the previous level value. */
  anchor: { x: number; y: number }
  /** Published label color, used for the outline and the pointer. */
  color: string
  /** Lightened label color for the glyphs. */
  textColor: string
}

/**
 * "Break Sup" / "Break Res" label. The plate is transparent — only its outline
 * and pointer carry the published color — so the break never hides the candles
 * it describes.
 */
export function SrBreakLabel({ kind, anchor, color, textColor }: SrBreakLabelProps) {
  const { width, height, gap, pointer } = SR_BREAK_LABEL_SIZE
  const text = kind === 'break-support' ? 'Break Sup' : 'Break Res'
  // Support breaks are called out above the level, resistance breaks below it.
  const above = kind === 'break-support'
  const x = anchor.x - width / 2
  const y = above ? anchor.y - height - gap : anchor.y + gap
  const plateBottom = y + height
  const pointerPath = above
    ? `M ${anchor.x - 4} ${plateBottom} L ${anchor.x + 4} ${plateBottom} L ${anchor.x} ${plateBottom + pointer} Z`
    : `M ${anchor.x - 4} ${y} L ${anchor.x + 4} ${y} L ${anchor.x} ${y - pointer} Z`
  return (
    <g className="sr-break-label" data-testid="sr-break-label">
      <ChartMessagePlate x={x} y={y} width={width} height={height} color={color} />
      <path d={pointerPath} fill={color} fillOpacity="0.7" />
      <ChartMessageText
        x={anchor.x}
        y={y + 12}
        color={textColor}
        size={9.5}
        weight={600}
        anchor="middle"
      >
        {text}
      </ChartMessageText>
    </g>
  )
}
