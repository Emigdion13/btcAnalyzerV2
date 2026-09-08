import { DIVERGENCE_COLORS } from '../lib/macd-divergence'
import type { DivergenceSettings } from '../lib/types'

const TOGGLES = [
  ['showRegular', 'Regular divergence (reversal warnings)'],
  ['showHidden', 'Hidden divergence (trend continuation)'],
  ['showLines', 'Draw connecting lines'],
  ['showLabels', 'Show labels'],
] as const
const NUMBERS = [
  ['pivotLookback', 'Pivot lookback', 'Bars on each side of a histogram pivot.'],
  ['rangeLower', 'Min pivot gap', 'Fewest bars between compared pivots.'],
  ['rangeUpper', 'Max pivot gap', 'Most bars between compared pivots.'],
] as const

/**
 * Shared divergence controls for both MACD dialogs. Numeric fields are kept as
 * strings by the parent so partial edits are allowed; this component only reads
 * `settings` for booleans and mirrors the string values for the numbers.
 */
export function DivergenceSettingsSection({
  settings,
  numbers,
  onToggle,
  onNumber,
}: {
  settings: DivergenceSettings
  numbers: { pivotLookback: string; rangeLower: string; rangeUpper: string }
  onToggle: (key: 'showRegular' | 'showHidden' | 'showLines' | 'showLabels', value: boolean) => void
  onNumber: (key: 'pivotLookback' | 'rangeLower' | 'rangeUpper', value: string) => void
}) {
  return (
    <div className="settings-section">
      <h3>MACD histogram divergence</h3>
      {TOGGLES.map(([key, label]) => (
        <label className="cm-input-toggle" key={key}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(event) => onToggle(key, event.target.checked)}
          />
          {label}
        </label>
      ))}
      <div className="cm-length-fields">
        {NUMBERS.map(([key, label, hint]) => (
          <label className="field" key={key}>
            {label}
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              required
              value={numbers[key]}
              onChange={(event) => onNumber(key, event.target.value)}
            />
            <small>{hint}</small>
          </label>
        ))}
      </div>
      <div className="cm-palette" aria-label="Divergence palette">
        {[
          [DIVERGENCE_COLORS.regularBullish, 'Regular bullish'],
          [DIVERGENCE_COLORS.regularBearish, 'Regular bearish'],
          [DIVERGENCE_COLORS.hiddenBullish, 'Hidden bullish'],
          [DIVERGENCE_COLORS.hiddenBearish, 'Hidden bearish'],
        ].map(([color, label]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      <div className="info-box">
        Divergence compares confirmed histogram pivots against price. Pivots only appear after the
        lookback bars close on both sides, so the newest bars are unconfirmed and can repaint.
      </div>
    </div>
  )
}
