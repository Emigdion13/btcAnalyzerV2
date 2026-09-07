import {
  SR_COLORS,
  SR_SIGNAL_TITLES,
  srVolumeText,
  type SrBreaksResult,
} from '../lib/sr-breaks-retests'
import type { Indicator, SrBreaksSettings } from '../lib/types'

export interface SrPoint {
  x: number
  y: number
}

/**
 * Price-pane markup for the SR Breaks and Retests overlay: volume boxes, break
 * labels, and the hold/retest diamonds. `point` maps a bar index (which may sit
 * one bar past the newest candle) and a price to pane coordinates.
 */
export function SrOverlay({
  indicator,
  settings: sr,
  result,
  point,
}: {
  indicator: Indicator
  settings: SrBreaksSettings
  result: SrBreaksResult
  point: (index: number, price: number) => SrPoint | null
}) {
  const renderBox = (box: SrBreaksResult['boxes'][number]) => {
    if (!sr.showBoxes) return null
    const level = point(box.startIndex, box.level)
    const outer = point(box.startIndex, box.outer)
    const right = point(box.endIndex, box.outer)
    if (!level || !outer || !right) return null
    const broken = box.state === 'broken'
    const support = box.kind === 'support'
    const borderColor = broken
      ? support
        ? SR_COLORS.supportBroken
        : SR_COLORS.resistanceBroken
      : support
        ? SR_COLORS.supportBorder
        : SR_COLORS.resistanceBorder
    const fillColor = broken
      ? borderColor
      : support
        ? SR_COLORS.supportFill
        : SR_COLORS.resistanceFill
    const x = Math.min(level.x, right.x)
    const width = Math.max(1, Math.abs(right.x - level.x))
    const y = Math.min(level.y, outer.y)
    const height = Math.max(1, Math.abs(outer.y - level.y))
    return (
      <g key={box.id} className="sr-box">
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fillColor}
          fillOpacity={broken ? 0.2 : box.fillOpacity}
          stroke={borderColor}
          strokeWidth="1"
          strokeDasharray={broken ? '4 3' : undefined}
        />
        {sr.showVolumeText && width > 44 && height > 11 && (
          <text
            x={x + 4}
            y={y + height / 2 + 3}
            fill={SR_COLORS.text}
            fontSize="8"
            fontFamily="DM Sans, sans-serif"
          >
            {srVolumeText(box.volume)}
          </text>
        )}
      </g>
    )
  }
  const renderSignal = (signal: SrBreaksResult['signals'][number]) => {
    const retest =
      signal.kind === 'resistance-as-support' || signal.kind === 'support-as-resistance'
    if (retest ? !sr.showRetestSignals : !sr.showHoldSignals) return null
    // `location.abovebar` / `location.belowbar`; the -1 offset is pre-applied.
    const above = signal.kind === 'resistance-holds' || signal.kind === 'support-as-resistance'
    const anchor = point(signal.plotIndex, signal.price)
    if (!anchor) return null
    const y = above ? anchor.y - 7 : anchor.y + 7
    const color =
      signal.kind === 'support-holds' || signal.kind === 'resistance-as-support'
        ? SR_COLORS.holdSupport
        : SR_COLORS.holdResistance
    return (
      <path
        key={`${signal.kind}:${signal.index}`}
        className="sr-signal"
        d={`M ${anchor.x} ${y - 3.5} L ${anchor.x + 3.5} ${y} L ${anchor.x} ${y + 3.5} L ${anchor.x - 3.5} ${y} Z`}
        fill={color}
      >
        <title>{SR_SIGNAL_TITLES[signal.kind]}</title>
      </path>
    )
  }
  const renderBreakLabel = (label: SrBreaksResult['labels'][number]) => {
    if (!sr.showBreakLabels) return null
    const anchor = point(label.index, label.price)
    if (!anchor) return null
    const color =
      label.kind === 'support' ? SR_COLORS.breakSupportLabel : SR_COLORS.breakResistanceLabel
    const width = 58
    const height = 15
    const tip = 5
    // label.style_label_down keeps the body above the anchor, style_label_up below.
    const above = label.kind === 'support'
    const top = above ? anchor.y - tip - height : anchor.y + tip
    const left = anchor.x - width / 2
    const tipPath = above
      ? `M ${anchor.x - 4} ${top + height} L ${anchor.x + 4} ${top + height} L ${anchor.x} ${anchor.y} Z`
      : `M ${anchor.x - 4} ${top} L ${anchor.x + 4} ${top} L ${anchor.x} ${anchor.y} Z`
    return (
      <g key={`${label.kind}:${label.index}`} className="sr-break-label">
        <rect x={left} y={top} width={width} height={height} rx="2" fill={color} />
        <path d={tipPath} fill={color} />
        <text
          x={anchor.x}
          y={top + height / 2 + 3}
          textAnchor="middle"
          fill={SR_COLORS.text}
          fontSize="9"
          fontWeight="600"
          fontFamily="DM Sans, sans-serif"
        >
          {label.text}
        </text>
      </g>
    )
  }
  return (
    <g data-indicator={indicator.id} data-sr-lookback={sr.lookbackPeriod}>
      {result.boxes.map(renderBox)}
      {result.labels.map(renderBreakLabel)}
      {result.signals.map(renderSignal)}
    </g>
  )
}
