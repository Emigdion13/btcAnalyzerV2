import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { isNextPivotSettings, nextPivotIndicatorLabel, nextPivotSettings } from '../lib/next-pivot'
import {
  NEXT_PIVOT_DEFAULTS,
  type Indicator,
  type NextPivotSettings,
  type NextPivotSimilarity,
  type NextPivotSource,
} from '../lib/types'
import { Modal, Toggle } from './ui'

type NumericDraft = Pick<
  NextPivotSettings,
  | 'correlationLength'
  | 'forecastLength'
  | 'barsBack'
  | 'ensembleTopK'
  | 'zigZagLegs'
  | 'linRegSigma'
>
type NumericText = Record<keyof NumericDraft, string>

function numericText(s: NextPivotSettings): NumericText {
  return {
    correlationLength: String(s.correlationLength),
    forecastLength: String(s.forecastLength),
    barsBack: String(s.barsBack),
    ensembleTopK: String(s.ensembleTopK),
    zigZagLegs: String(s.zigZagLegs),
    linRegSigma: String(s.linRegSigma),
  }
}

const SIMILARITY_OPTIONS: { id: NextPivotSimilarity; label: string }[] = [
  { id: 'cosine', label: 'Cosine Similarity (default)' },
  { id: 'pearson', label: 'Pearson r' },
  { id: 'spearman', label: 'Spearman ρ (rank)' },
  { id: 'euclidean', label: 'Euclidean distance' },
  { id: 'mse', label: 'Mean Squared Error' },
  { id: 'kendall', label: 'Kendall τ-b' },
  { id: 'dtw', label: 'DTW (Atlas upgrade)' },
]

const SOURCE_OPTIONS: { id: NextPivotSource; label: string }[] = [
  { id: 'price', label: 'Price (levels)' },
  { id: 'pctChange', label: '% Change (log returns)' },
]

export function NextPivotSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = nextPivotSettings(indicator)
  const [numbers, setNumbers] = useState<NumericText>(() => numericText(initial))
  const [similarity, setSimilarity] = useState<NextPivotSimilarity>(initial.similarity)
  const [source, setSource] = useState<NextPivotSource>(initial.source)
  const [showPricePath, setShowPricePath] = useState(initial.showPricePath)
  const [showZigZag, setShowZigZag] = useState(initial.showZigZag)
  const [showLinReg, setShowLinReg] = useState(initial.showLinReg)
  const [zNormalize, setZNormalize] = useState(initial.zNormalize)
  const [showConfidenceBand, setShowConfidenceBand] = useState(initial.showConfidenceBand)
  const [showMatchBox, setShowMatchBox] = useState(initial.showMatchBox)
  const [showInfoLabel, setShowInfoLabel] = useState(initial.showInfoLabel)
  const [colors, setColors] = useState({
    forecastColor: initial.forecastColor,
    zigZagColor: initial.zigZagColor,
    linRegColor: initial.linRegColor,
  })
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const setNumber = (k: keyof NumericDraft, v: string) =>
    setNumbers((cur) => ({ ...cur, [k]: v }))

  const reset = () => {
    const d = NEXT_PIVOT_DEFAULTS
    setNumbers(numericText({ ...d }))
    setSimilarity(d.similarity)
    setSource(d.source)
    setShowPricePath(d.showPricePath)
    setShowZigZag(d.showZigZag)
    setShowLinReg(d.showLinReg)
    setZNormalize(d.zNormalize)
    setShowConfidenceBand(d.showConfidenceBand)
    setShowMatchBox(d.showMatchBox)
    setShowInfoLabel(d.showInfoLabel)
    setColors({
      forecastColor: d.forecastColor,
      zigZagColor: d.zigZagColor,
      linRegColor: d.linRegColor,
    })
    setError('')
  }

  return (
    <Modal
      title="The Next Pivot (20, 50, Cosine, Price, 5000, 1)"
      description="Pattern-matching forecast – find the closest historical analogue and project what came next. Atlas adds top-K ensemble blending, z-normalization, DTW, and confidence bands."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (20, 50, Cosine, Price, 5000, 1) defaults
          </button>
          <button type="submit" form="nextpivot-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="nextpivot-form"
        onSubmit={(e) => {
          e.preventDefault()
          const s: NextPivotSettings = {
            correlationLength: Number(numbers.correlationLength),
            forecastLength: Number(numbers.forecastLength),
            barsBack: Number(numbers.barsBack),
            ensembleTopK: Number(numbers.ensembleTopK),
            zigZagLegs: Number(numbers.zigZagLegs),
            linRegSigma: Number(numbers.linRegSigma),
            similarity,
            source,
            showPricePath,
            showZigZag,
            showLinReg,
            zNormalize,
            showConfidenceBand,
            showMatchBox,
            showInfoLabel,
            forecastColor: colors.forecastColor.trim(),
            zigZagColor: colors.zigZagColor.trim(),
            linRegColor: colors.linRegColor.trim(),
          }
          if (!isNextPivotSettings(s)) {
            setError(
              'Check the numeric ranges: correlation 5–200, forecast 5–500, barsBack ≥100, topK 1–20, zigzag legs 2–50, σ 0–5. Use #RRGGBB hex colors.',
            )
            return
          }
          onSave({
            ...indicator,
            name: nextPivotIndicatorLabel({ ...indicator, nextPivot: s }),
            period: s.correlationLength,
            color: s.zigZagColor,
            visible,
            nextPivot: s,
          })
        }}
      >
        <section className="settings-section">
          <h3>Published inputs</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Correlation Length
              <input
                inputMode="numeric"
                value={numbers.correlationLength}
                onChange={(e) => setNumber('correlationLength', e.target.value)}
              />
              <small>Bars in the look-back window (default 20).</small>
            </label>
            <label className="field smc-number-field">
              Forecast Length
              <input
                inputMode="numeric"
                value={numbers.forecastLength}
                onChange={(e) => setNumber('forecastLength', e.target.value)}
              />
              <small>Bars projected forward (default 50).</small>
            </label>
            <label className="field smc-number-field">
              Bars Back To Search
              <input
                inputMode="numeric"
                value={numbers.barsBack}
                onChange={(e) => setNumber('barsBack', e.target.value)}
              />
              <small>How much history to scan (default 5000).</small>
            </label>
            <label className="field smc-number-field">
              ZigZag Pivot Legs
              <input
                inputMode="numeric"
                value={numbers.zigZagLegs}
                onChange={(e) => setNumber('zigZagLegs', e.target.value)}
              />
              <small>Bars each side to confirm a pivot (default 5).</small>
            </label>
            <label className="field">
              Similarity Calculation
              <select
                value={similarity}
                onChange={(e) => setSimilarity(e.target.value as NextPivotSimilarity)}
              >
                {SIMILARITY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Looks For Similarities In
              <select value={source} onChange={(e) => setSource(e.target.value as NextPivotSource)}>
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Aesthetics</h3>
          <div className="smc-grid smc-grid-two">
            <Toggle
              checked={showPricePath}
              onChange={setShowPricePath}
              label="Show Projected Price Path"
            />
            <Toggle checked={showZigZag} onChange={setShowZigZag} label="Show Projected Zig Zag" />
            <Toggle checked={showLinReg} onChange={setShowLinReg} label="Show LinReg channel" />
            <label className="field smc-number-field">
              LinReg σ
              <input
                inputMode="decimal"
                value={numbers.linRegSigma}
                onChange={(e) => setNumber('linRegSigma', e.target.value)}
              />
              <small>Channel width in standard deviations (default 1).</small>
            </label>
            <label className="field">
              Forecast color
              <span className="pivot-color-inputs">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(colors.forecastColor) ? colors.forecastColor : '#ffffff'}
                  onChange={(e) => setColors((c) => ({ ...c, forecastColor: e.target.value }))}
                />
                <input
                  value={colors.forecastColor}
                  onChange={(e) => setColors((c) => ({ ...c, forecastColor: e.target.value }))}
                  spellCheck={false}
                />
              </span>
            </label>
            <label className="field">
              Projected ZigZag color
              <span className="pivot-color-inputs">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(colors.zigZagColor) ? colors.zigZagColor : '#14D990'}
                  onChange={(e) => setColors((c) => ({ ...c, zigZagColor: e.target.value }))}
                />
                <input
                  value={colors.zigZagColor}
                  onChange={(e) => setColors((c) => ({ ...c, zigZagColor: e.target.value }))}
                  spellCheck={false}
                />
              </span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Atlas accuracy upgrades</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              Ensemble Top-K
              <input
                inputMode="numeric"
                value={numbers.ensembleTopK}
                onChange={(e) => setNumber('ensembleTopK', e.target.value)}
              />
              <small>Blend the K best matches (default 5, 1 = single best match).</small>
            </label>
          </div>
          <div className="setting-row">
            <div>
              <strong>Z-normalize sequences</strong>
              <p>Remove price-level bias before comparing — almost always better than raw price cosine.</p>
            </div>
            <Toggle checked={zNormalize} onChange={setZNormalize} label="Z-normalize" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Confidence band</strong>
              <p>Shaded ±1σ band from ensemble dispersion.</p>
            </div>
            <Toggle checked={showConfidenceBand} onChange={setShowConfidenceBand} label="Confidence band" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Match highlight boxes</strong>
              <p>Draw a blue box on the matched historical window and white box on its continuation.</p>
            </div>
            <Toggle checked={showMatchBox} onChange={setShowMatchBox} label="Match boxes" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Info label</strong>
              <p>Show the on-chart badge with method, score and match count.</p>
            </div>
            <Toggle checked={showInfoLabel} onChange={setShowInfoLabel} label="Info label" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Hide to keep config without drawing.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Show The Next Pivot" />
          </div>
        </section>

        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
