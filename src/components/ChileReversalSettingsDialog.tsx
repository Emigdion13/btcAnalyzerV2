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
    minScore: String(initial.minScore),
    minEdge: String(initial.minEdge),
    pivotLeft: String(initial.pivotLeft),
    pivotRight: String(initial.pivotRight),
    maxDistanceAtr: String(initial.maxDistanceAtr),
    lineLength: String(initial.lineLength),
    trendFactor: String(initial.trendFactor),
    trendAtrLength: String(initial.trendAtrLength),
    markerTtlSeconds: String(initial.markerTtlSeconds),
    markerFadeSeconds: String(initial.markerFadeSeconds),
  })
  const [colors, setColors] = useState<Record<ColorKey, string>>({
    supportColor: initial.supportColor,
    resistanceColor: initial.resistanceColor,
  })
  const [showTrend, setShowTrend] = useState(initial.showTrend)
  const [showEma, setShowEma] = useState(initial.showEma)
  const [showVwap, setShowVwap] = useState(initial.showVwap)
  const [showLevels, setShowLevels] = useState(initial.showLevels)
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const setNumber = (key: keyof typeof numbers) => (event: { target: { value: string } }) =>
    setNumbers((current) => ({ ...current, [key]: event.target.value }))

  const reset = () => {
    const d = CHILE_REVERSAL_DEFAULTS
    setResolution(d.resolution)
    setNumbers({
      minScore: String(d.minScore),
      minEdge: String(d.minEdge),
      pivotLeft: String(d.pivotLeft),
      pivotRight: String(d.pivotRight),
      maxDistanceAtr: String(d.maxDistanceAtr),
      lineLength: String(d.lineLength),
      trendFactor: String(d.trendFactor),
      trendAtrLength: String(d.trendAtrLength),
      markerTtlSeconds: String(d.markerTtlSeconds),
      markerFadeSeconds: String(d.markerFadeSeconds),
    })
    setColors({ supportColor: d.supportColor, resistanceColor: d.resistanceColor })
    setShowTrend(d.showTrend)
    setShowEma(d.showEma)
    setShowVwap(d.showVwap)
    setShowLevels(d.showLevels)
    setError('')
  }

  return (
    <Modal
      title="Chile Reversal"
      description="ROBEX IA CHILERA V17: the round-timeframe pivot levels, the score, the ARRIBA/ABAJO call on every confirmed round close, and the panel that reads it."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (15m, 2, 2, 6/2) defaults
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
            minScore: Number(numbers.minScore),
            minEdge: Number(numbers.minEdge),
            pivotLeft: Number(numbers.pivotLeft),
            pivotRight: Number(numbers.pivotRight),
            maxDistanceAtr: Number(numbers.maxDistanceAtr),
            lineLength: Number(numbers.lineLength),
            trendFactor: Number(numbers.trendFactor),
            trendAtrLength: Number(numbers.trendAtrLength),
            markerTtlSeconds: Number(numbers.markerTtlSeconds),
            markerFadeSeconds: Number(numbers.markerFadeSeconds),
            showTrend,
            showEma,
            showVwap,
            showLevels,
            supportColor: colors.supportColor.trim().toLowerCase(),
            resistanceColor: colors.resistanceColor.trim().toLowerCase(),
          }
          if (!isChileReversalSettings(settings)) {
            setError(
              'Minimum strength 3–20, minimum edge 1–8, pivot legs whole numbers from 1–5, max distance 0.5–6 ATR, line length 10–100 bars, ROBEX trend sensitivity 1–5 with an ATR length of 5–30, marker lifetime 0–3600 s, marker fade 0–600 s, and colors six-digit hex values.',
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
          <h3>Score</h3>
          <p className="settings-hint">
            The call for the next round needs both: <strong>minimum strength</strong> points on one
            side and a <strong>minimum edge</strong> over the other. A sideways market — EMA 9 and
            21 braided inside 0.025 ATR with the local RSI between 47 and 53 — calls nothing.
          </p>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Minimum strength
              <input
                aria-label="Minimum strength"
                inputMode="numeric"
                value={numbers.minScore}
                onChange={setNumber('minScore')}
              />
              <small>Pine Fuerza minima. Points one side needs to be called. Default 6.</small>
            </label>
            <label className="field smc-number-field">
              Minimum edge
              <input
                aria-label="Minimum edge"
                inputMode="numeric"
                value={numbers.minEdge}
                onChange={setNumber('minEdge')}
              />
              <small>Pine Ventaja minima. Points of lead over the other side. Default 2.</small>
            </label>
            <label className="field smc-number-field">
              ROBEX trend sensitivity
              <input
                aria-label="ROBEX trend sensitivity"
                inputMode="decimal"
                value={numbers.trendFactor}
                onChange={setNumber('trendFactor')}
              />
              <small>Pine Sensibilidad ROBEX Trend — supertrend ATR multiplier. Default 2.4.</small>
            </label>
            <label className="field smc-number-field">
              ROBEX trend ATR
              <input
                aria-label="ROBEX trend ATR length"
                inputMode="numeric"
                value={numbers.trendAtrLength}
                onChange={setNumber('trendAtrLength')}
              />
              <small>Pine ATR ROBEX Trend. Default 10.</small>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Levels</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Round timeframe
              <select
                aria-label="Round timeframe"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as Timeframe)}
              >
                {RESOLUTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <small>
                Pine hard-codes “15”. Only its closed bars are read, and it is the round the
                countdown runs to.
              </small>
            </label>
            <label className="field smc-number-field">
              Max distance (ATR)
              <input
                aria-label="Max distance in ATR"
                inputMode="decimal"
                value={numbers.maxDistanceAtr}
                onChange={setNumber('maxDistanceAtr')}
              />
              <small>Pine maxDistATR. Discard levels further than this. Default 2.5.</small>
            </label>
            <label className="field smc-number-field">
              Pivot left
              <input
                aria-label="Pivot left"
                inputMode="numeric"
                value={numbers.pivotLeft}
                onChange={setNumber('pivotLeft')}
              />
              <small>Bars left of the pivot. Default 2.</small>
            </label>
            <label className="field smc-number-field">
              Pivot right
              <input
                aria-label="Pivot right"
                inputMode="numeric"
                value={numbers.pivotRight}
                onChange={setNumber('pivotRight')}
              />
              <small>Confirmation delay. Default 2.</small>
            </label>
            <label className="field smc-number-field">
              Line length
              <input
                aria-label="Line length in bars"
                inputMode="numeric"
                value={numbers.lineLength}
                onChange={setNumber('lineLength')}
              />
              <small>Pine largoLinea. How far back each level line reaches. Default 35.</small>
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
          <h3>Draw</h3>
          <div className="setting-row">
            <div>
              <strong>ROBEX Trend</strong>
              <p>The supertrend line the score reads its first two points from.</p>
            </div>
            <Toggle checked={showTrend} onChange={setShowTrend} label="Show ROBEX Trend" />
          </div>
          <div className="setting-row">
            <div>
              <strong>EMA 9 / 21</strong>
              <p>The chart-timeframe EMA pair and the fill between them.</p>
            </div>
            <Toggle checked={showEma} onChange={setShowEma} label="Show EMA 9/21" />
          </div>
          <div className="setting-row">
            <div>
              <strong>VWAP</strong>
              <p>Session VWAP, worth one point either side of it.</p>
            </div>
            <Toggle checked={showVwap} onChange={setShowVwap} label="Show VWAP" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Nearby S/R levels</strong>
              <p>R1/R2 and S1/S2 lines with their prices, from the remembered round pivots.</p>
            </div>
            <Toggle checked={showLevels} onChange={setShowLevels} label="Show S/R levels" />
          </div>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Label lifetime (s)
              <input
                aria-label="Label lifetime in seconds"
                inputMode="numeric"
                value={numbers.markerTtlSeconds}
                onChange={setNumber('markerTtlSeconds')}
              />
              <small>
                How long an ARRIBA/ABAJO label stays after its bar closes, then it fades. 0 keeps
                labels until the 40-label cap. Default 60.
              </small>
            </label>
            <label className="field smc-number-field">
              Label fade (s)
              <input
                aria-label="Label fade in seconds"
                inputMode="decimal"
                value={numbers.markerFadeSeconds}
                onChange={setNumber('markerFadeSeconds')}
              />
              <small>How long the fade-out takes once the lifetime ends. Default 15.</small>
            </label>
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
