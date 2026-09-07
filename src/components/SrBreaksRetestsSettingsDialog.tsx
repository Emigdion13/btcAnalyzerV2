import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  isSrBreaksRetestsSettings,
  srBreaksRetestsSettings,
  SR_BREAKS_RETESTS_COLORS,
} from '../lib/sr-breaks-retests'
import {
  SR_BREAKS_RETESTS_DEFAULTS,
  type Indicator,
  type SrBreaksRetestsSettings,
} from '../lib/types'
import { Modal, Toggle } from './ui'

type NumericDraft = Pick<
  SrBreaksRetestsSettings,
  'lookbackPeriod' | 'volumeFilterLength' | 'boxWidth'
>
type NumericText = Record<keyof NumericDraft, string>

function numericText(settings: SrBreaksRetestsSettings): NumericText {
  return {
    lookbackPeriod: String(settings.lookbackPeriod),
    volumeFilterLength: String(settings.volumeFilterLength),
    boxWidth: String(settings.boxWidth),
  }
}

export function SrBreaksRetestsSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = srBreaksRetestsSettings(indicator)
  const [numbers, setNumbers] = useState<NumericText>(() => numericText(initial))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const setNumber = (key: keyof NumericDraft, value: string) =>
    setNumbers((current) => ({ ...current, [key]: value }))
  const reset = () => {
    setNumbers(numericText({ ...SR_BREAKS_RETESTS_DEFAULTS }))
    setError('')
  }

  return (
    <Modal
      title="SR Breaks and Retests"
      description="Volume-graded zones · close pivots · breaks and retests — ChartPrime's published (20, 2, 1) calculation"
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (20, 2, 1) defaults
          </button>
          <button type="submit" form="sr-breaks-retests-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="sr-breaks-retests-form"
        onSubmit={(event) => {
          event.preventDefault()
          const sr: SrBreaksRetestsSettings = {
            lookbackPeriod: Number(numbers.lookbackPeriod),
            volumeFilterLength: Number(numbers.volumeFilterLength),
            boxWidth: Number(numbers.boxWidth),
          }
          if (!isSrBreaksRetestsSettings(sr)) {
            setError(
              'Use whole numbers from 1 to 500 for the lookback and delta-volume length, and a box width from 0 to 1000.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'SR Breaks and Retests',
            period: sr.lookbackPeriod,
            color: SR_BREAKS_RETESTS_COLORS.support,
            visible,
            sr,
          })
        }}
      >
        <section className="settings-section">
          <h3>Published inputs</h3>
          <div className="smc-grid smc-grid-three">
            <label className="field smc-number-field">
              Lookback period
              <input
                aria-label="Lookback period"
                inputMode="numeric"
                value={numbers.lookbackPeriod}
                onChange={(event) => setNumber('lookbackPeriod', event.target.value)}
              />
              <small>Bars on each side of a close pivot.</small>
            </label>
            <label className="field smc-number-field">
              Delta volume filter length
              <input
                aria-label="Delta volume filter length"
                inputMode="numeric"
                value={numbers.volumeFilterLength}
                onChange={(event) => setNumber('volumeFilterLength', event.target.value)}
              />
              <small>Higher input will filter low volume boxes.</small>
            </label>
            <label className="field smc-number-field">
              Adjust box width
              <input
                aria-label="Adjust box width"
                inputMode="decimal"
                step="0.1"
                value={numbers.boxWidth}
                onChange={(event) => setNumber('boxWidth', event.target.value)}
              />
              <small>Zone depth × ATR(200). Higher input, thinner box.</small>
            </label>
          </div>
          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Hide to keep the configuration without drawing zones.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Show SR Breaks and Retests" />
          </div>
        </section>
        <section className="settings-section">
          <h3>How to read it</h3>
          <ul className="sr-reading-list">
            <li>
              <span
                className="sr-swatch"
                style={{ background: SR_BREAKS_RETESTS_COLORS.support }}
              />
              Green zones mark support at positive delta-volume pivot lows; the fill darkens with
              relative volume.
            </li>
            <li>
              <span
                className="sr-swatch"
                style={{ background: SR_BREAKS_RETESTS_COLORS.resistance }}
              />
              Red zones mark resistance at negative delta-volume pivot highs.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: SR_BREAKS_RETESTS_COLORS.holdBelow }}>
                ◆
              </span>
              A zone flips color when broken: cleared resistance becomes support, lost support
              becomes resistance. Diamonds flag holds and successful retests; labels flag breaks.
            </li>
          </ul>
          {error && (
            <p className="negative" role="alert">
              {error}
            </p>
          )}
        </section>
      </form>
    </Modal>
  )
}
