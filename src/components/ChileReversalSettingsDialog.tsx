import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { isChileReversalSettings, chileReversalSettings } from '../lib/chile-reversal'
import {
  CHILE_REVERSAL_DEFAULTS,
  type ChileReversalSettings,
  type Indicator,
  type Timeframe,
} from '../lib/types'
import { Modal, Toggle } from './ui'

const RESOLUTIONS: Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W']

type ColorKey = 'supportColor' | 'resistanceColor'

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

export function ChileReversalSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = chileReversalSettings(indicator)
  const [resolution, setResolution] = useState<Timeframe>(initial.resolution)
  const [numbers, setNumbers] = useState({
    pivotLeft: String(initial.pivotLeft),
    pivotRight: String(initial.pivotRight),
    maxDistanceAtr: String(initial.maxDistanceAtr),
    zoneThicknessAtr: String(initial.zoneThicknessAtr),
    impulseBodyRatio: String(initial.impulseBodyRatio),
    markerTtlSeconds: String(initial.markerTtlSeconds),
    markerFadeSeconds: String(initial.markerFadeSeconds),
  })
  const [colors, setColors] = useState<Record<ColorKey, string>>({
    supportColor: initial.supportColor,
    resistanceColor: initial.resistanceColor,
  })
  const [showZones, setShowZones] = useState(initial.showZones)
  const [showBreaks, setShowBreaks] = useState(initial.showBreaks)
  const [requireConfirmation, setRequireConfirmation] = useState(initial.requireConfirmation)
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const reset = () => {
    const d = CHILE_REVERSAL_DEFAULTS
    setResolution(d.resolution)
    setNumbers({
      pivotLeft: String(d.pivotLeft),
      pivotRight: String(d.pivotRight),
      maxDistanceAtr: String(d.maxDistanceAtr),
      zoneThicknessAtr: String(d.zoneThicknessAtr),
      impulseBodyRatio: String(d.impulseBodyRatio),
      markerTtlSeconds: String(d.markerTtlSeconds),
      markerFadeSeconds: String(d.markerFadeSeconds),
    })
    setColors({ supportColor: d.supportColor, resistanceColor: d.resistanceColor })
    setShowZones(d.showZones)
    setShowBreaks(d.showBreaks)
    setRequireConfirmation(d.requireConfirmation)
    setError('')
  }

  return (
    <Modal
      title="Chile Reversal"
      description="The reversal core of ROBEX IA CHILERA V18: pivot support and resistance zones sized in ATR, with bounce, rejection and break markers."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (15m, 2, 2, 0.10) defaults
          </button>
          <button type="submit" form="chile-reversal-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="chile-reversal-form"
        onSubmit={(event) => {
          event.preventDefault()
          const settings: ChileReversalSettings = {
            resolution,
            pivotLeft: Number(numbers.pivotLeft),
            pivotRight: Number(numbers.pivotRight),
            maxDistanceAtr: Number(numbers.maxDistanceAtr),
            zoneThicknessAtr: Number(numbers.zoneThicknessAtr),
            markerTtlSeconds: Number(numbers.markerTtlSeconds),
            markerFadeSeconds: Number(numbers.markerFadeSeconds),
            showZones,
            showBreaks,
            requireConfirmation,
            impulseBodyRatio: Number(numbers.impulseBodyRatio),
            supportColor: colors.supportColor.trim().toLowerCase(),
            resistanceColor: colors.resistanceColor.trim().toLowerCase(),
          }
          if (!isChileReversalSettings(settings)) {
            setError(
              'Pivot legs must be whole numbers from 1–5, max distance 0.5–6 ATR, zone thickness 0.03–0.50 ATR, impulse ratio 0–1, marker lifetime 0–3600 s, marker fade 0–600 s, and colors six-digit hex values.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'Chile Reversal',
            period: settings.pivotLeft,
            color: settings.supportColor,
            visible,
            chileReversal: settings,
          })
        }}
      >
        <section className="settings-section">
          <h3>Levels</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Pivot timeframe
              <select
                aria-label="Pivot timeframe"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as Timeframe)}
              >
                {RESOLUTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <small>Pine hard-codes “15”. Only closed bars of it are read.</small>
            </label>
            <label className="field smc-number-field">
              Zone thickness (ATR)
              <input
                aria-label="Zone thickness in ATR"
                inputMode="decimal"
                value={numbers.zoneThicknessAtr}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, zoneThicknessAtr: event.target.value }))
                }
              />
              <small>Pine grosorZonaATR. Default 0.10.</small>
            </label>
            <label className="field smc-number-field">
              Pivot left
              <input
                aria-label="Pivot left"
                inputMode="numeric"
                value={numbers.pivotLeft}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, pivotLeft: event.target.value }))
                }
              />
              <small>Bars left of the pivot. Default 2.</small>
            </label>
            <label className="field smc-number-field">
              Pivot right
              <input
                aria-label="Pivot right"
                inputMode="numeric"
                value={numbers.pivotRight}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, pivotRight: event.target.value }))
                }
              />
              <small>Confirmation delay. Default 2.</small>
            </label>
            <label className="field smc-number-field">
              Max distance (ATR)
              <input
                aria-label="Max distance in ATR"
                inputMode="decimal"
                value={numbers.maxDistanceAtr}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, maxDistanceAtr: event.target.value }))
                }
              />
              <small>Discard levels further than this. Default 2.5.</small>
            </label>
            <label className="field smc-number-field">
              Impulse body ratio
              <input
                aria-label="Impulse body ratio"
                inputMode="decimal"
                value={numbers.impulseBodyRatio}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, impulseBodyRatio: event.target.value }))
                }
              />
              <small>Pine velaImpulso. Used only with confirmation on.</small>
            </label>
          </div>
          <div className="smc-grid pivot-color-grid">
            <ColorField
              label="Support"
              value={colors.supportColor}
              onChange={(value) => setColors((current) => ({ ...current, supportColor: value }))}
            />
            <ColorField
              label="Resistance"
              value={colors.resistanceColor}
              onChange={(value) => setColors((current) => ({ ...current, resistanceColor: value }))}
            />
          </div>
        </section>

        <section className="settings-section">
          <h3>Signals</h3>
          <div className="setting-row">
            <div>
              <strong>Show S/R zones</strong>
              <p>Draw the R1/R2 and S1/S2 rectangles the reversals are measured against.</p>
            </div>
            <Toggle checked={showZones} onChange={setShowZones} label="Show S/R zones" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show breaks</strong>
              <p>Include rompeResistencia and rompeSoporte markers alongside the reversals.</p>
            </div>
            <Toggle checked={showBreaks} onChange={setShowBreaks} label="Show breaks" />
          </div>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Marker lifetime (s)
              <input
                aria-label="Marker lifetime in seconds"
                inputMode="numeric"
                value={numbers.markerTtlSeconds}
                onChange={(event) =>
                  setNumbers((current) => ({
                    ...current,
                    markerTtlSeconds: event.target.value,
                  }))
                }
              />
              <small>
                How long a marker stays after its bar closes, then it fades. 0 keeps markers until
                the 40-marker cap. Default 60.
              </small>
            </label>
            <label className="field smc-number-field">
              Marker fade (s)
              <input
                aria-label="Marker fade in seconds"
                inputMode="decimal"
                value={numbers.markerFadeSeconds}
                onChange={(event) =>
                  setNumbers((current) => ({
                    ...current,
                    markerFadeSeconds: event.target.value,
                  }))
                }
              />
              <small>How long the fade-out takes once the lifetime ends. Default 15.</small>
            </label>
          </div>
          <div className="setting-row">
            <div>
              <strong>Require Pine confirmation</strong>
              <p>
                Apply the original scalping gates — close beyond EMA 9 and VWAP, RSI past 50, and an
                impulse body. Fewer marks, and each one prints only after price has already turned.
              </p>
            </div>
            <Toggle
              checked={requireConfirmation}
              onChange={setRequireConfirmation}
              label="Require confirmation"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Visible</strong>
              <p>Hide the indicator without removing it from the chart.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Visible" />
          </div>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
