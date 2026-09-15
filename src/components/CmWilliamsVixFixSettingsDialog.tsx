import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import {
  CM_WILLIAMS_VIX_FIX_DEFAULTS,
  isWilliamsVixFixSettings,
  WILLIAMS_VIX_FIX_SOURCE,
  williamsVixFixSettings,
  WVF_COLORS,
} from '../lib/cm-williams-vix-fix'
import type { Indicator, WilliamsVixFixSettings } from '../lib/types'
import { Modal, Toggle } from './ui'

const LENGTHS = [
  ['pd', 'LookBack Period (pd)', 'Highest close in the fear ratio'],
  ['bbl', 'Bollinger Band Length (bbl)', 'WVF average and deviation'],
  ['lb', 'Look Back Period Percentile (lb)', 'Highest/lowest WVF window'],
] as const
const DECIMALS = [
  ['mult', 'Bollinger Mult (1–5)', 'Standard-deviation multiplier'],
  ['ph', 'Highest Percentile (ph)', '0.85 means 85% of the highest WVF'],
  ['pl', 'Lowest Percentile (pl)', '1.01 means 101% of the lowest WVF'],
] as const
type NumericKey = (typeof LENGTHS)[number][0] | (typeof DECIMALS)[number][0]
const stringsFrom = (s: WilliamsVixFixSettings): Record<NumericKey, string> =>
  ({
    pd: String(s.pd),
    bbl: String(s.bbl),
    mult: String(s.mult),
    lb: String(s.lb),
    ph: String(s.ph),
    pl: String(s.pl),
  }) as Record<NumericKey, string>

export function CmWilliamsVixFixSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = williamsVixFixSettings(indicator)
  const [numbers, setNumbers] = useState(() => stringsFrom(initial))
  const [showHighRange, setShowHighRange] = useState(initial.showHighRange)
  const [showStdDevLine, setShowStdDevLine] = useState(initial.showStdDevLine)
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const reset = () => {
    setNumbers(stringsFrom(CM_WILLIAMS_VIX_FIX_DEFAULTS))
    setShowHighRange(CM_WILLIAMS_VIX_FIX_DEFAULTS.showHighRange)
    setShowStdDevLine(CM_WILLIAMS_VIX_FIX_DEFAULTS.showStdDevLine)
    setError('')
  }
  return (
    <Modal
      title="CM_Williams_Vix_Fix"
      description="ChrisMoody · Finds Market Bottoms · Price source: close and low"
      eyebrow="INDICATOR SETTINGS"
      className="wt-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button
            className="button button-primary"
            type="submit"
            form="williams-vix-fix-settings-form"
          >
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="williams-vix-fix-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const williamsVixFix = {
            pd: Number(numbers.pd),
            bbl: Number(numbers.bbl),
            mult: Number(numbers.mult),
            lb: Number(numbers.lb),
            ph: Number(numbers.ph),
            pl: Number(numbers.pl),
            showHighRange,
            showStdDevLine,
          }
          if (!isWilliamsVixFixSettings(williamsVixFix)) {
            setError(
              'Periods must be whole numbers from 1 to 2000, the multiplier from 1 to 5, and the percentiles positive numbers up to 5.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'CM_Williams_Vix_Fix',
            period: williamsVixFix.pd,
            color: WVF_COLORS.lime,
            visible,
            williamsVixFix,
          })
        }}
      >
        <div className="settings-section">
          <h3>Calculation</h3>
          <div className="wt-length-fields">
            {LENGTHS.map(([key, label, hint]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  max="2000"
                  step="1"
                  required
                  aria-label={label}
                  value={numbers[key]}
                  onChange={(event) => setNumbers({ ...numbers, [key]: event.target.value })}
                />
                <small>{hint}</small>
              </label>
            ))}
          </div>
          <div className="wt-length-fields">
            {DECIMALS.map(([key, label, hint]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min={key === 'mult' ? '1' : '0.01'}
                  max={key === 'mult' ? '5' : '5'}
                  step="any"
                  required
                  aria-label={label}
                  value={numbers[key]}
                  onChange={(event) => setNumbers({ ...numbers, [key]: event.target.value })}
                />
                <small>{hint}</small>
              </label>
            ))}
          </div>
          <div className="wt-formula">
            <span>
              wvf <b>(highest(close, pd) − low) / highest(close, pd) × 100</b>
            </span>
            <span>
              upper <b>sma(wvf, bbl) + mult × stdev(wvf, bbl)</b>
            </span>
            <span>
              range-high <b>highest(wvf, lb) × ph</b>
            </span>
            <span>
              range-low <b>lowest(wvf, lb) × pl</b>
            </span>
            <span>
              lime bar <b>wvf ≥ upper or wvf ≥ range-high</b>
            </span>
          </div>
        </div>
        <div className="settings-section">
          <h3>Original display options</h3>
          <label className="cm-input-toggle">
            <input
              type="checkbox"
              checked={showHighRange}
              onChange={(event) => setShowHighRange(event.target.checked)}
            />
            Show High Range - Based on Percentile and LookBack Period?
          </label>
          <label className="cm-input-toggle">
            <input
              type="checkbox"
              checked={showStdDevLine}
              onChange={(event) => setShowStdDevLine(event.target.checked)}
            />
            Show Standard Deviation Line?
          </label>
          <small className="wt-levels-note">
            Both toggles ship off in the published script: the histogram alone is the indicator, and
            the floating window reads the same values either way.
          </small>
        </div>
        <div className="wt-palette" aria-label="Original plot palette">
          {[
            [WVF_COLORS.lime, 'WVF · fear spike'],
            [WVF_COLORS.gray, 'WVF · quiet'],
            [WVF_COLORS.orange, 'Range high / low'],
            [WVF_COLORS.aqua, 'Upper band'],
          ].map(([color, label]) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="info-box wt-compatibility-note">
          <strong>Original behavior, including repainting.</strong>
          The open bar moves with every tick and the last values change until the candle closes.
          This is not a signal service or a backtest.
          <a href={WILLIAMS_VIX_FIX_SOURCE} target="_blank" rel="noreferrer">
            ChrisMoody’s original publication <ExternalLink size={12} />
          </a>
        </div>
        <div className="setting-row">
          <div>
            <strong>Visible on chart</strong>
            <p>Hide this pane without removing the indicator.</p>
          </div>
          <Toggle checked={visible} onChange={setVisible} label="Indicator visible" />
        </div>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
