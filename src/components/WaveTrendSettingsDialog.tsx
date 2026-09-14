import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import {
  isWaveTrendSettings,
  waveTrendSettings,
  WT_AREA_TRANSPARENCY,
  WT_COLORS,
  WT_SCALE,
  WT_SIGNAL_LENGTH,
  WAVE_TREND_DEFAULTS,
  WAVE_TREND_SOURCE,
} from '../lib/wave-trend'
import type { Indicator, WaveTrendSettings } from '../lib/types'
import { Modal, Toggle } from './ui'

const LENGTHS = [
  ['channelLength', 'Channel Length', 'n1 — the ESA and deviation averages'],
  ['averageLength', 'Average Length', 'n2 — the average applied to the index'],
] as const
const LEVELS = [
  ['obLevel1', 'Over Bought Level 1'],
  ['obLevel2', 'Over Bought Level 2'],
  ['osLevel1', 'Over Sold Level 1'],
  ['osLevel2', 'Over Sold Level 2'],
] as const
const stringsFrom = (s: WaveTrendSettings) =>
  Object.fromEntries(
    [...LENGTHS.map(([key]) => key), ...LEVELS.map(([key]) => key)].map((key) => [
      key,
      String(s[key as keyof WaveTrendSettings]),
    ]),
  ) as Record<keyof WaveTrendSettings, string>

export function WaveTrendSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = waveTrendSettings(indicator)
  const [numbers, setNumbers] = useState(() => stringsFrom(initial))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const reset = () => {
    setNumbers(stringsFrom(WAVE_TREND_DEFAULTS))
    setError('')
  }
  return (
    <Modal
      title="WaveTrend [LazyBear]"
      description="LazyBear · WaveTrend Oscillator [WT] · Price source: hlc3"
      eyebrow="INDICATOR SETTINGS"
      className="wt-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button className="button button-primary" type="submit" form="wave-trend-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="wave-trend-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const waveTrend = Object.fromEntries(
            Object.entries(numbers).map(([key, value]) => [key, Number(value)]),
          ) as unknown as WaveTrendSettings
          if (!isWaveTrendSettings(waveTrend)) {
            setError(
              'Lengths must be whole numbers from 1 to 2000, and levels must be numbers within ±100000.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'WaveTrend [LazyBear]',
            period: waveTrend.channelLength,
            color: WT_COLORS.green,
            visible,
            waveTrend,
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
          <div className="wt-formula">
            <span>
              ap <b>(high + low + close) / 3</b>
            </span>
            <span>
              esa <b>ema(ap, channel length)</b>
            </span>
            <span>
              d <b>ema(|ap − esa|, channel length)</b>
            </span>
            <span>
              ci <b>(ap − esa) / ({WT_SCALE} × d)</b>
            </span>
            <span>
              WT1 <b>ema(ci, average length)</b>
            </span>
            <span>
              WT2 <b>sma(WT1, {WT_SIGNAL_LENGTH})</b>
            </span>
          </div>
        </div>
        <div className="settings-section">
          <h3>Levels</h3>
          <div className="wt-level-fields">
            {LEVELS.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min="-100000"
                  max="100000"
                  step="1"
                  required
                  aria-label={label}
                  value={numbers[key]}
                  onChange={(event) => setNumbers({ ...numbers, [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <small className="wt-levels-note">
            Levels 1 plot as solid lines, levels 2 as the original dotted crosses. The signal length
            ({WT_SIGNAL_LENGTH}) and the {WT_SCALE} scale factor are hard-coded in the published
            script, not inputs.
          </small>
        </div>
        <div className="wt-palette" aria-label="Original plot palette">
          {[
            [WT_COLORS.green, 'WT1 · wave'],
            [WT_COLORS.red, 'WT2 · signal (dotted)'],
            [WT_COLORS.blue, `WT1 − WT2 · area, transp ${WT_AREA_TRANSPARENCY}`],
            [WT_COLORS.gray, 'Zero line'],
          ].map(([color, label]) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="info-box wt-compatibility-note">
          <strong>Original behavior, including repainting.</strong>
          The oscillator is not normalized, not rescaled, and not delayed: the open bar moves with
          every tick and the last values change until the candle closes. This is not a signal
          service or a backtest.
          <a href={WAVE_TREND_SOURCE} target="_blank" rel="noreferrer">
            LazyBear’s original publication <ExternalLink size={12} />
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
