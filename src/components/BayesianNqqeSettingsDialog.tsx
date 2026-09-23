import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  BAYES_COLORS,
  BAYESIAN_NQQE_DEFAULTS,
  BAYESIAN_NQQE_SOURCES,
  NQQE_FACTOR,
  isBayesianNqqeBankfundsSettings,
  bayesianNqqeSettings,
} from '../lib/bayesian-nqqe-bankfunds'
import type { BayesianNqqeSettings, BayesianNqqeSource, Indicator } from '../lib/types'
import { Modal, Toggle } from './ui'

const LENGTHS = [
  ['bbSmaPeriod', 'BB SMA', 'Basis length'],
  ['aoFast', 'AO fast', 'SMA, not EMA'],
  ['aoSlow', 'AO slow', 'SMA, not EMA'],
  ['acFast', 'AC fast', 'SMA of hl2'],
  ['acSlow', 'AC slow', 'SMA of hl2'],
  ['acAoMa', 'AC/AO MA', 'SMA of the AC raw line'],
  ['lipsLength', 'Lips', 'Unshifted SMMA'],
  ['teethLength', 'Teeth', 'Unshifted SMMA'],
  ['jawLength', 'Jaw', 'Unshifted SMMA'],
  ['smaPeriod', 'SMA', 'Close compared with this'],
  ['bayesPeriod', 'Bayes lookback', 'Event average'],
  ['nqqeRsiLength', 'nQQE RSI', 'Wilder RSI'],
  ['nqqeSmooth', 'nQQE smooth', 'SMA-seeded EMA'],
] as const
const OFFSETS = [
  ['lipsOffset', 'Lips offset', 'Stored, not applied'],
  ['teethOffset', 'Teeth offset', 'Stored, not applied'],
  ['jawOffset', 'Jaw offset', 'Stored, not applied'],
] as const
const TOGGLES = [
  ['showProbabilities', 'Probabilities', 'Break-up and break-down areas'],
  ['showNqqe', 'nQQE', 'Fast line and the hidden trail'],
  ['showBankFunds', 'Banker fund', 'Columns between fund and the slow line'],
  ['showSignals', 'Strong signals', 'Circles on prime. Weak signals stay off'],
  ['useBwConfirmation', 'Bill Williams', 'Off by default. Uses the unshifted alligator'],
] as const

type NumberKey =
  | (typeof LENGTHS)[number][0]
  | (typeof OFFSETS)[number][0]
  | 'bbStdDev'
  | 'lowerThreshold'

const NUMBER_KEYS: NumberKey[] = [
  ...LENGTHS.map(([key]) => key),
  ...OFFSETS.map(([key]) => key),
  'bbStdDev',
  'lowerThreshold',
]

const stringsFrom = (s: BayesianNqqeSettings) =>
  Object.fromEntries(NUMBER_KEYS.map((key) => [key, String(s[key])])) as Record<NumberKey, string>

export function BayesianNqqeSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = bayesianNqqeSettings(indicator)
  const [numbers, setNumbers] = useState(() => stringsFrom(initial))
  const [source, setSource] = useState<BayesianNqqeSource>(initial.nqqeSource)
  const [toggles, setToggles] = useState(() => ({
    showProbabilities: initial.showProbabilities,
    showNqqe: initial.showNqqe,
    showBankFunds: initial.showBankFunds,
    showSignals: initial.showSignals,
    useBwConfirmation: initial.useBwConfirmation,
  }))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const reset = () => {
    setNumbers(stringsFrom(BAYESIAN_NQQE_DEFAULTS))
    setSource(BAYESIAN_NQQE_DEFAULTS.nqqeSource)
    setToggles({
      showProbabilities: BAYESIAN_NQQE_DEFAULTS.showProbabilities,
      showNqqe: BAYESIAN_NQQE_DEFAULTS.showNqqe,
      showBankFunds: BAYESIAN_NQQE_DEFAULTS.showBankFunds,
      showSignals: BAYESIAN_NQQE_DEFAULTS.showSignals,
      useBwConfirmation: BAYESIAN_NQQE_DEFAULTS.useBwConfirmation,
    })
    setError('')
  }
  return (
    <Modal
      title="Bayesian/nQQE/BankFunds"
      description="Reconstructed combo · pane and window share one calculation"
      eyebrow="INDICATOR SETTINGS"
      className="wt-settings-modal bayes-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button className="button button-primary" type="submit" form="bayesian-nqqe-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="bayesian-nqqe-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const bayesianNqqe = {
            ...Object.fromEntries(NUMBER_KEYS.map((key) => [key, Number(numbers[key])])),
            nqqeSource: source,
            ...toggles,
          } as unknown as BayesianNqqeSettings
          if (!isBayesianNqqeBankfundsSettings(bayesianNqqe)) {
            setError(
              'Lengths are whole numbers from 1 to 2000, offsets from 0 to 200, deviation from 0.01 to 100, and the threshold from 0 to 100.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'Bayesian/nQQE/BankFunds',
            period: bayesianNqqe.bbSmaPeriod,
            color: BAYES_COLORS.nqqeYellow,
            visible,
            bayesianNqqe,
          })
        }}
      >
        <div className="settings-section">
          <h3>Bayesian</h3>
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
            <label className="field">
              BB stdev
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                required
                aria-label="BB stdev"
                value={numbers.bbStdDev}
                onChange={(event) => setNumbers({ ...numbers, bbStdDev: event.target.value })}
              />
              <small>Population deviation</small>
            </label>
            <label className="field">
              Lower threshold
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                required
                aria-label="Lower threshold"
                value={numbers.lowerThreshold}
                onChange={(event) => setNumbers({ ...numbers, lowerThreshold: event.target.value })}
              />
              <small>Sideways when all three sit under this</small>
            </label>
          </div>
          <small className="wt-levels-note">
            The published expression is evaluated left to right, which is not the Bayes ratio the
            original note describes. Prime is drawn as a line so the areas stay readable; the value
            is still that score.
          </small>
        </div>
        <div className="settings-section">
          <h3>Alligator offsets</h3>
          <div className="wt-length-fields">
            {OFFSETS.map(([key, label, hint]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min="0"
                  max="200"
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
          <small className="wt-levels-note">
            Offsets are kept so the legend matches the published tuple. They do not shift the
            lines. Bill Williams confirmation, when enabled, uses the unshifted jaw, teeth and lips.
          </small>
        </div>
        <div className="settings-section">
          <h3>nQQE</h3>
          <label className="field">
            Source
            <select
              aria-label="nQQE source"
              value={source}
              onChange={(event) => setSource(event.target.value as BayesianNqqeSource)}
            >
              {BAYESIAN_NQQE_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <small>Bayesian events stay on close. The band factor {NQQE_FACTOR} is not an input.</small>
          </label>
          <div className="tmo-toggles">
            {TOGGLES.map(([key, label, hint]) => (
              <div className="setting-row" key={key}>
                <div>
                  <strong>{label}</strong>
                  <p>{hint}</p>
                </div>
                <Toggle
                  checked={toggles[key]}
                  onChange={(next) => setToggles({ ...toggles, [key]: next })}
                  label={label}
                />
              </div>
            ))}
            <div className="setting-row">
              <div>
                <strong>Visible on chart</strong>
                <p>Hide this pane without removing the indicator.</p>
              </div>
              <Toggle checked={visible} onChange={setVisible} label="Indicator visible" />
            </div>
          </div>
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
