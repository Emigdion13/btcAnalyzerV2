import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  isPivotPointsMissedReversalsSettings,
  PIVOT_MAX_LENGTH,
  pivotPointsMissedReversalsSettings,
} from '../lib/pivot-points-missed-reversals'
import {
  PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
  type Indicator,
  type PivotPointsMissedReversalsSettings,
} from '../lib/types'
import { Modal, Toggle } from './ui'

type ColorKey =
  'regularHighColor' | 'regularLowColor' | 'missedHighColor' | 'missedLowColor' | 'labelTextColor'

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field pivot-color-field">
      {label}
      <span className="pivot-color-inputs">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} color`}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} color hex`}
          spellCheck={false}
        />
      </span>
    </label>
  )
}

/**
 * Settings for the LuxAlgo "Pivot Points High Low & Missed Reversal Levels"
 * port. The layout mirrors the original input panel: Pivot Length, then the
 * "Regular Pivots" and "Missed Pivots" rows with their High/Low colors, then
 * the text label color.
 */
export function PivotPointsMissedReversalsSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = pivotPointsMissedReversalsSettings(indicator)
  const [lengthText, setLengthText] = useState(String(initial.pivotLength))
  const [showRegular, setShowRegular] = useState(initial.showRegular)
  const [showMissed, setShowMissed] = useState(initial.showMissed)
  const [colors, setColors] = useState<Record<ColorKey, string>>({
    regularHighColor: initial.regularHighColor,
    regularLowColor: initial.regularLowColor,
    missedHighColor: initial.missedHighColor,
    missedLowColor: initial.missedLowColor,
    labelTextColor: initial.labelTextColor,
  })
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const setColor = (key: ColorKey, value: string) =>
    setColors((current) => ({ ...current, [key]: value }))
  const reset = () => {
    const defaults = PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS
    setLengthText(String(defaults.pivotLength))
    setShowRegular(defaults.showRegular)
    setShowMissed(defaults.showMissed)
    setColors({
      regularHighColor: defaults.regularHighColor,
      regularLowColor: defaults.regularLowColor,
      missedHighColor: defaults.missedHighColor,
      missedLowColor: defaults.missedLowColor,
      labelTextColor: defaults.labelTextColor,
    })
    setError('')
  }

  return (
    <Modal
      title="Pivot Points High Low & Missed Reversal Levels"
      description="Bar-count reversals, the 👻 reversals they miss, a zig-zag through both and missed-reversal levels — LuxAlgo's published (50) calculation"
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (50) defaults
          </button>
          <button
            type="submit"
            form="pivot-points-missed-reversals-form"
            className="button button-primary"
          >
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="pivot-points-missed-reversals-form"
        onSubmit={(event) => {
          event.preventDefault()
          const pivots: PivotPointsMissedReversalsSettings = {
            pivotLength: Number(lengthText),
            showRegular,
            showMissed,
            regularHighColor: colors.regularHighColor.trim().toLowerCase(),
            regularLowColor: colors.regularLowColor.trim().toLowerCase(),
            missedHighColor: colors.missedHighColor.trim().toLowerCase(),
            missedLowColor: colors.missedLowColor.trim().toLowerCase(),
            labelTextColor: colors.labelTextColor.trim().toLowerCase(),
          }
          if (!isPivotPointsMissedReversalsSettings(pivots)) {
            setError(
              `Use a whole pivot length from 1 to ${PIVOT_MAX_LENGTH} and six-digit hex colors such as #ef5350.`,
            )
            return
          }
          onSave({
            ...indicator,
            name: 'Pivot Points High Low & Missed Reversal Levels',
            period: pivots.pivotLength,
            color: pivots.regularLowColor,
            visible,
            pivots,
          })
        }}
      >
        <section className="settings-section">
          <h3>Published inputs</h3>
          <label className="field smc-number-field">
            Pivot length
            <input
              aria-label="Pivot length"
              inputMode="numeric"
              value={lengthText}
              onChange={(event) => setLengthText(event.target.value)}
            />
            <small>
              “Bar Count Reversals” window size — bars on each side of a pivot. Higher values
              highlight more significant reversals; a pivot confirms this many bars late.
            </small>
          </label>
          {/* The original lays each toggle out inline with its High / Low swatches. */}
          <div className={`pivot-input-group ${showRegular ? '' : 'is-disabled'}`}>
            <div className="setting-row">
              <div>
                <strong>Regular pivots</strong>
                <p>▼ / ▲ labels at confirmed pivot highs and lows.</p>
              </div>
              <Toggle checked={showRegular} onChange={setShowRegular} label="Show regular pivots" />
            </div>
            <div className="smc-grid pivot-color-grid">
              <ColorField
                label="Regular high"
                value={colors.regularHighColor}
                onChange={(value) => setColor('regularHighColor', value)}
              />
              <ColorField
                label="Regular low"
                value={colors.regularLowColor}
                onChange={(value) => setColor('regularLowColor', value)}
              />
            </div>
          </div>
          <div className={`pivot-input-group ${showMissed ? '' : 'is-disabled'}`}>
            <div className="setting-row">
              <div>
                <strong>Missed pivots</strong>
                <p>👻 labels, dashed zig-zag legs and levels at reversals the method missed.</p>
              </div>
              <Toggle checked={showMissed} onChange={setShowMissed} label="Show missed pivots" />
            </div>
            <div className="smc-grid pivot-color-grid">
              <ColorField
                label="Missed high"
                value={colors.missedHighColor}
                onChange={(value) => setColor('missedHighColor', value)}
              />
              <ColorField
                label="Missed low"
                value={colors.missedLowColor}
                onChange={(value) => setColor('missedLowColor', value)}
              />
            </div>
          </div>
          <div className="smc-grid pivot-color-grid">
            <ColorField
              label="Text label"
              value={colors.labelTextColor}
              onChange={(value) => setColor('labelTextColor', value)}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Hide to keep the configuration without drawing pivots.</p>
            </div>
            <Toggle
              checked={visible}
              onChange={setVisible}
              label="Show Pivot Points High Low & Missed Reversal Levels"
            />
          </div>
        </section>
        <section className="settings-section">
          <h3>How to read it</h3>
          <ul className="sr-reading-list">
            <li>
              <span className="sr-diamond" style={{ color: colors.regularHighColor }}>
                ▼
              </span>
              A regular pivot is the highest high (or lowest low) of its window, confirmed
              <em> Pivot length</em> bars after the fact — labels appear that many bars behind the
              live edge.
            </li>
            <li>
              <span className="sr-diamond">👻</span>
              Two pivots of the same type in a row mean the method skipped a reversal. The ghost
              marks it, the zig-zag detours through it with a dashed leg, and a level starts there
              and runs until the next missed reversal.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: colors.missedLowColor }}>
                ⋯
              </span>
              The most recent ghost is an estimate of the next confirmed reversal. It readjusts on
              every new higher high or lower low, and its level extends to the latest bar.
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
