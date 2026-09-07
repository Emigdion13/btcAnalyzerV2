import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import {
  CM_COLORS,
  CM_MACD_DEFAULTS,
  CM_MACD_SOURCE,
  CM_RESOLUTIONS,
  cmMacdSettings,
  isCmMacdSettings,
} from '../lib/cm-ult-macd'
import { TIMEFRAMES } from '../lib/market'
import type { CmMacdSettings, Indicator, Timeframe } from '../lib/types'
import { Modal, Toggle } from './ui'

const OPTIONS = [
  ['showLines', 'Show MacD & Signal Line? Also Turn Off Dots Below'],
  ['showDots', 'Show Dots When MacD Crosses Signal Line?'],
  ['showHistogram', 'Show Histogram?'],
  ['macdColorChange', 'Change MacD Line Color-Signal Line Cross?'],
  ['histogramColorChange', 'MacD Histogram 4 Colors?'],
] as const
const LENGTHS = [
  ['fastLength', 'Fast Length'],
  ['slowLength', 'Slow Length'],
  ['signalLength', 'Signal Length'],
] as const
const lengthsFrom = (s: CmMacdSettings) => ({
  fastLength: String(s.fastLength),
  slowLength: String(s.slowLength),
  signalLength: String(s.signalLength),
})

export function CmMacdSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = cmMacdSettings(indicator)
  const [settings, setSettings] = useState(initial)
  const [lengths, setLengths] = useState(() => lengthsFrom(initial))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const reset = () => {
    setSettings({ ...CM_MACD_DEFAULTS })
    setLengths(lengthsFrom(CM_MACD_DEFAULTS))
    setError('')
  }
  return (
    <Modal
      title="CM_Ult_MacD_MTF"
      description="ChrisMoody · Original 2014 edition · Price source: close"
      eyebrow="INDICATOR SETTINGS"
      className="cm-macd-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button className="button button-primary" type="submit" form="cm-macd-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="cm-macd-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const cmMacd = {
            ...settings,
            fastLength: Number(lengths.fastLength),
            slowLength: Number(lengths.slowLength),
            signalLength: Number(lengths.signalLength),
          }
          if (!isCmMacdSettings(cmMacd)) {
            setError('Lengths must be whole numbers from 1 to 2000. Choose a supported timeframe.')
            return
          }
          onSave({
            ...indicator,
            name: 'CM_Ult_MacD_MTF',
            period: cmMacd.fastLength,
            color: CM_COLORS.lime,
            visible,
            cmMacd,
          })
        }}
      >
        <div className="settings-section">
          <h3>Resolution</h3>
          <label className="cm-input-toggle">
            <input
              type="checkbox"
              checked={settings.useCurrentRes}
              onChange={(event) =>
                setSettings({ ...settings, useCurrentRes: event.target.checked })
              }
            />
            Use Current Chart Resolution?
          </label>
          <label className="field cm-resolution-field">
            Use Different Timeframe? Uncheck Box Above
            <select
              value={settings.resCustom}
              disabled={settings.useCurrentRes}
              onChange={(event) =>
                setSettings({ ...settings, resCustom: event.target.value as Timeframe })
              }
            >
              {TIMEFRAMES.map((res) => (
                <option key={res} value={res}>
                  {CM_RESOLUTIONS[res]} · {res === '1h' ? '1 hour' : res === '4h' ? '4 hours' : res}
                </option>
              ))}
            </select>
            <small>
              60 means one hour. With the box checked, the indicator follows your chart instead.
            </small>
          </label>
        </div>
        <div className="settings-section">
          <h3>Original display options</h3>
          {OPTIONS.map(([key, label]) => (
            <label className="cm-input-toggle" key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="settings-section">
          <h3>Calculation</h3>
          <div className="cm-length-fields">
            {LENGTHS.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  max="2000"
                  step="1"
                  required
                  value={lengths[key]}
                  onChange={(event) => setLengths({ ...lengths, [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="cm-formula">
            <span>
              MACD <b>EMA(close, fast) − EMA(close, slow)</b>
            </span>
            <span>
              Signal <b>SMA(MACD, signal length)</b>
            </span>
            <span>
              Histogram <b>MACD − Signal</b>
            </span>
          </div>
        </div>
        <div className="cm-palette" aria-label="Original histogram palette">
          {[
            [CM_COLORS.aqua, 'Above 0 · rising'],
            [CM_COLORS.blue, 'Above 0 · falling'],
            [CM_COLORS.red, 'At/below 0 · falling'],
            [CM_COLORS.maroon, 'At/below 0 · rising'],
            [CM_COLORS.yellow, 'Unchanged / first value'],
            [CM_COLORS.gray, 'Four colors off'],
          ].map(([color, label]) => (
            <span key={color}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="info-box cm-compatibility-note">
          <strong>Original behavior, including repainting.</strong>
          Historical higher-timeframe values use legacy Pine lookahead. Open-bar values and dots can
          change; reloading can repaint history. This is not a non-repainting signal or a backtest.
          <a href={CM_MACD_SOURCE} target="_blank" rel="noreferrer">
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
