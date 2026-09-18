import { useState } from 'react'
import { ExternalLink, RotateCcw } from 'lucide-react'
import {
  isTmoScalperSettings,
  tmoResolutionLabel,
  tmoScalperSettings,
  TMO_COLORS,
  TMO_CUTOFF,
  TMO_DISPLAY_SCALE,
  TMO_RESOLUTIONS,
  TMO_SCALPER_DEFAULTS,
  TMO_SCALPER_SOURCE,
} from '../lib/tmo-scalper'
import type { Indicator, TmoResolution, TmoScalperSettings } from '../lib/types'
import { Modal, Toggle } from './ui'

const TIMEFRAMES = [
  ['timeframe1', 'TMO 1', 'the fast wheel — usually the chart’s own minutes'],
  ['timeframe2', 'TMO 2', 'the wheel TMO 1 crosses are gated and traded by'],
  ['timeframe3', 'TMO 3', 'the slow wheel that gates TMO 2'],
] as const
const LENGTHS = [
  ['tmoLength', 'Length', 'bars of close-vs-open sums before smoothing'],
  ['calcLength', 'Calc Length', 'first EMA over the sums'],
  ['smoothLength', 'Smooth Length', 'Main and Signal EMAs'],
  ['signalSize', 'Signal Size', 'cross-dot radius in pixels'],
] as const
const NUMBERS = [
  ['signalOffset', 'Signal Offset', 'distance a cross dot sits off the Main line'],
  ['extremeOb', 'Extreme Overbought', 'the level TMO 2 upside extremes flag past'],
  ['extremeOs', 'Extreme Oversold', 'the level TMO 2 downside extremes flag past'],
] as const
const TOGGLES = [
  ['showTmo1Signals', 'TMO 1 signals', 'the bright circles of the published pane'],
  [
    'showTmo2Signals',
    'TMO 2 signals',
    'crosses of the middle wheel, gated by TMO 3 — the ▴/▾ pair',
  ],
  [
    'showTmo2ExtremeSignals',
    'TMO 2 extreme signals',
    'the counter-move crosses fired from an extreme zone, no trend gate — the second ▴/▾ pair',
  ],
  ['showLines', 'Main and Signal lines', 'the three wheels; their fills stay on TradingView'],
] as const

const stringsFrom = (s: TmoScalperSettings) => ({
  tmoLength: String(s.tmoLength),
  calcLength: String(s.calcLength),
  smoothLength: String(s.smoothLength),
  signalSize: String(s.signalSize),
  signalOffset: String(s.signalOffset),
  extremeOb: String(s.extremeOb),
  extremeOs: String(s.extremeOs),
})

export function TmoScalperSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = tmoScalperSettings(indicator)
  const [timeframes, setTimeframes] = useState<Record<string, TmoResolution>>({
    timeframe1: initial.timeframe1,
    timeframe2: initial.timeframe2,
    timeframe3: initial.timeframe3,
  })
  const [numbers, setNumbers] = useState(() => stringsFrom(initial))
  const [toggles, setToggles] = useState({
    showTmo1Signals: initial.showTmo1Signals,
    showTmo2Signals: initial.showTmo2Signals,
    showTmo2ExtremeSignals: initial.showTmo2ExtremeSignals,
    showLines: initial.showLines,
  })
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const reset = () => {
    setTimeframes({
      timeframe1: TMO_SCALPER_DEFAULTS.timeframe1,
      timeframe2: TMO_SCALPER_DEFAULTS.timeframe2,
      timeframe3: TMO_SCALPER_DEFAULTS.timeframe3,
    })
    setNumbers(stringsFrom(TMO_SCALPER_DEFAULTS))
    setToggles({
      showTmo1Signals: TMO_SCALPER_DEFAULTS.showTmo1Signals,
      showTmo2Signals: TMO_SCALPER_DEFAULTS.showTmo2Signals,
      showTmo2ExtremeSignals: TMO_SCALPER_DEFAULTS.showTmo2ExtremeSignals,
      showLines: TMO_SCALPER_DEFAULTS.showLines,
    })
    setError('')
  }
  return (
    <Modal
      title="TMO Scalper"
      description="L&L Capital · (T)rue (M)omentum (O)scillator MTF Scalper · (1, 5, 30, 14, 5, 3, 3, 2, 9, -9)"
      eyebrow="INDICATOR SETTINGS"
      className="tmo-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> Original defaults
          </button>
          <button className="button button-primary" type="submit" form="tmo-scalper-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="tmo-scalper-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const tmoScalper = {
            ...toggles,
            timeframe1: timeframes.timeframe1,
            timeframe2: timeframes.timeframe2,
            timeframe3: timeframes.timeframe3,
            tmoLength: Number(numbers.tmoLength),
            calcLength: Number(numbers.calcLength),
            smoothLength: Number(numbers.smoothLength),
            signalSize: Number(numbers.signalSize),
            signalOffset: Number(numbers.signalOffset),
            extremeOb: Number(numbers.extremeOb),
            extremeOs: Number(numbers.extremeOs),
          } as TmoScalperSettings
          if (!isTmoScalperSettings(tmoScalper)) {
            setError(
              'Lengths must be whole numbers from 1 to 2000, and the offset and extreme levels must be numbers within ±100000.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'TMO Scalper',
            period: tmoScalper.tmoLength,
            color: TMO_COLORS.bull,
            visible,
            tmoScalper,
          })
        }}
      >
        <div className="settings-section">
          <h3>Time frames</h3>
          <p className="settings-hint">
            Crosses print only while the next bigger wheel agrees: TMO 1 reads TMO 2, and TMO 2
            reads TMO 3 — the big wheels must be spinning for a small wheel to spin. A wheel the
            chart has no feed for (like 30m, folded 2-to-1 from the 15m stream) is aggregated
            locally from that feed.
          </p>
          <div className="tmo-tf-fields">
            {TIMEFRAMES.map(([key, label, hint]) => (
              <label className="field" key={key}>
                {label}
                <select
                  aria-label={label}
                  value={timeframes[key]}
                  onChange={(event) =>
                    setTimeframes({ ...timeframes, [key]: event.target.value as TmoResolution })
                  }
                >
                  {TMO_RESOLUTIONS.map((resolution) => (
                    <option key={resolution} value={resolution}>
                      {tmoResolutionLabel(resolution)}
                    </option>
                  ))}
                </select>
                <small>{hint}</small>
              </label>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <h3>Calculation</h3>
          <div className="tmo-length-fields">
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
              data <b>Σ sign(close − open[i]), i = 1…length−1</b>
            </span>
            <span>
              EMA <b>ema(data, calc length)</b>
            </span>
            <span>
              Main <b>ema(EMA, smooth length)</b>
            </span>
            <span>
              Signal <b>ema(Main, smooth length)</b>
            </span>
            <span>
              plotted <b>{TMO_DISPLAY_SCALE} × value ÷ length</b>
            </span>
          </div>
        </div>
        <div className="settings-section">
          <h3>Signals &amp; extremes</h3>
          <div className="tmo-number-fields">
            {NUMBERS.map(([key, label, hint]) => (
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
                <small>{hint}</small>
              </label>
            ))}
          </div>
          <small className="wt-levels-note">
            The ±{TMO_CUTOFF} OB/OS cutoff pair and the zero line are hard-coded in the published
            script, not inputs. Extreme levels only flag TMO 2 crosses; they are the {`'▴/▾'`} pairs
            the profile lists last.
          </small>
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
          </div>
        </div>
        <div className="wt-palette" aria-label="Original plot palette">
          {[
            [TMO_COLORS.bull, 'TMO 1/2 rising'],
            [TMO_COLORS.bear, 'TMO 1/2 falling'],
            [TMO_COLORS.tmo2Bull, 'TMO 3 rising'],
            [TMO_COLORS.tmo2Bear, 'TMO 3 falling'],
            [TMO_COLORS.tmo1Bull, 'TMO 1 bullish cross'],
            [TMO_COLORS.extremeBull, 'extreme ▲'],
            [TMO_COLORS.extremeBear, 'extreme ▼'],
          ].map(([color, label]) => (
            <span key={label}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="info-box wt-compatibility-note">
          <strong>Original behavior, including repainting.</strong>
          The wheels are not normalized, filtered, or delayed: the unclosed bar of each time frame
          moves with every tick, so a cross can light up and vanish until its bar closes. A cross on
          the slow wheel (TMO 3) is a state to read, not a signal to chase.
          <a href={TMO_SCALPER_SOURCE} target="_blank" rel="noreferrer">
            L&amp;L Capital’s original publication <ExternalLink size={12} />
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
