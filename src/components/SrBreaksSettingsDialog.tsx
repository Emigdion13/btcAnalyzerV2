import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import {
  SR_BREAKS_SOURCE,
  SR_COLORS,
  isSrBreaksSettings,
  srBreaksSettings,
} from '../lib/sr-breaks-retests'
import { SR_BREAKS_DEFAULTS } from '../lib/types'
import type { Indicator, SrBreaksSettings } from '../lib/types'
import { Modal, Toggle } from './ui'

type NumberKey = 'lookbackPeriod' | 'volumeFilterLength' | 'boxWidth' | 'atrLength' | 'maxBoxes'
type NumberText = Record<NumberKey, string>

function numberText(settings: SrBreaksSettings): NumberText {
  return {
    lookbackPeriod: String(settings.lookbackPeriod),
    volumeFilterLength: String(settings.volumeFilterLength),
    boxWidth: String(settings.boxWidth),
    atrLength: String(settings.atrLength),
    maxBoxes: String(settings.maxBoxes),
  }
}

export function SrBreaksSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = srBreaksSettings(indicator)
  const [settings, setSettings] = useState<SrBreaksSettings>(initial)
  const [numbers, setNumbers] = useState<NumberText>(() => numberText(initial))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const update = <K extends keyof SrBreaksSettings>(key: K, value: SrBreaksSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }))
  const setNumber = (key: NumberKey, value: string) =>
    setNumbers((current) => ({ ...current, [key]: value }))
  const reset = () => {
    setSettings({ ...SR_BREAKS_DEFAULTS })
    setNumbers(numberText(SR_BREAKS_DEFAULTS))
    setError('')
  }
  return (
    <Modal
      title="SR Breaks and Retests"
      description="ChartPrime · volume-filtered support and resistance boxes · Price source: close"
      eyebrow="INDICATOR SETTINGS"
      className="sr-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button className="button button-primary" type="submit" form="sr-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="sr-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const sr: SrBreaksSettings = {
            ...settings,
            lookbackPeriod: Number(numbers.lookbackPeriod),
            volumeFilterLength: Number(numbers.volumeFilterLength),
            boxWidth: Number(numbers.boxWidth),
            atrLength: Number(numbers.atrLength),
            maxBoxes: Number(numbers.maxBoxes),
          }
          if (!isSrBreaksSettings(sr)) {
            setError(
              'Lookback, filter length, ATR length and box count must be whole numbers in range. Box width must be from 0 to 1000.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'SR Breaks and Retests',
            period: sr.lookbackPeriod,
            color: SR_COLORS.supportBorder,
            visible,
            sr,
          })
        }}
      >
        <section className="settings-section">
          <h3>Settings</h3>
          <div className="sr-grid">
            <label className="field">
              Lookback Period
              <input
                aria-label="Lookback period"
                data-autofocus
                type="number"
                min="1"
                max="2000"
                step="1"
                required
                value={numbers.lookbackPeriod}
                onChange={(event) => setNumber('lookbackPeriod', event.target.value)}
              />
              <small>Bars on each side required to confirm a pivot high or low.</small>
            </label>
            <label className="field">
              Delta Volume Filter Length
              <input
                aria-label="Delta volume filter length"
                type="number"
                min="1"
                max="2000"
                step="1"
                required
                value={numbers.volumeFilterLength}
                onChange={(event) => setNumber('volumeFilterLength', event.target.value)}
              />
              <small>Higher values filter out lower-volume boxes.</small>
            </label>
            <label className="field">
              Adjust Box Width
              <input
                aria-label="Adjust box width"
                type="number"
                min="0"
                max="1000"
                step="0.1"
                required
                value={numbers.boxWidth}
                onChange={(event) => setNumber('boxWidth', event.target.value)}
              />
              <small>Box height as a multiple of ATR. Higher values give a taller box.</small>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Advanced</h3>
          <div className="sr-grid">
            <label className="field">
              ATR length for box width
              <input
                aria-label="ATR length"
                type="number"
                min="1"
                max="2000"
                step="1"
                required
                value={numbers.atrLength}
                onChange={(event) => setNumber('atrLength', event.target.value)}
              />
              <small>Fixed at 200 in the original. Boxes start once this many bars exist.</small>
            </label>
            <label className="field">
              Maximum boxes
              <input
                aria-label="Maximum boxes"
                type="number"
                min="1"
                max="500"
                step="1"
                required
                value={numbers.maxBoxes}
                onChange={(event) => setNumber('maxBoxes', event.target.value)}
              />
              <small>Newest boxes kept on the chart. The original keeps 50.</small>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Markup</h3>
          <div className="setting-row">
            <div>
              <strong>Support and resistance boxes</strong>
              <p>Volume-filtered pivot zones that extend until a newer level replaces them.</p>
            </div>
            <Toggle
              checked={settings.showBoxes}
              onChange={(value) => update('showBoxes', value)}
              label="Show support and resistance boxes"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Volume text</strong>
              <p>Print the delta volume measured when the box formed.</p>
            </div>
            <Toggle
              checked={settings.showVolumeText}
              onChange={(value) => update('showVolumeText', value)}
              label="Show box volume text"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Hold diamonds</strong>
              <p>
                <i className="sr-swatch" style={{ background: SR_COLORS.holdSupport }} />
                support holds and{' '}
                <i className="sr-swatch" style={{ background: SR_COLORS.holdResistance }} />
                resistance holds.
              </p>
            </div>
            <Toggle
              checked={settings.showHoldSignals}
              onChange={(value) => update('showHoldSignals', value)}
              label="Show hold signals"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Retest diamonds</strong>
              <p>Broken resistance acting as support, and broken support acting as resistance.</p>
            </div>
            <Toggle
              checked={settings.showRetestSignals}
              onChange={(value) => update('showRetestSignals', value)}
              label="Show retest signals"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Break labels</strong>
              <p>“Break Sup” and “Break Res” on the first break of a level.</p>
            </div>
            <Toggle
              checked={settings.showBreakLabels}
              onChange={(value) => update('showBreakLabels', value)}
              label="Show break labels"
            />
          </div>
        </section>

        <div className="info-box sr-compatibility-note">
          <strong>Behavioral port of a published indicator.</strong>
          Atlas reimplements the calculations and drawing rules of ChartPrime’s “Support and
          Resistance (High Volume Boxes)”, published on TradingView as “SR Breaks and Retests
          [ChartPrime]” under MPL-2.0. Levels come from confirmed pivots, so the newest boxes and
          signals can repaint as bars close. This is an analysis aid, not a signal service.
          <a href={SR_BREAKS_SOURCE} target="_blank" rel="noreferrer">
            ChartPrime’s original publication <ExternalLink size={12} />
          </a>
        </div>
        <div className="setting-row">
          <div>
            <strong>Visible on chart</strong>
            <p>Hide this overlay without removing the indicator.</p>
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
