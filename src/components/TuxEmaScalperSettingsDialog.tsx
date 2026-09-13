import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  isTuxEmaScalperSettings,
  TUX_EMA_SCALPER_COLORS,
  tuxEmaScalperSettings,
} from '../lib/tux-ema-scalper'
import { TUX_EMA_SCALPER_DEFAULTS, type Indicator, type TuxEmaScalperSettings } from '../lib/types'
import { Modal, Toggle } from './ui'

type ColorKey = 'buyColor' | 'sellColor'

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

export function TuxEmaScalperSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = tuxEmaScalperSettings(indicator)
  const [numbers, setNumbers] = useState({
    factor: String(initial.factor),
    atrPeriod: String(initial.atrPeriod),
    emaLength: String(initial.emaLength),
  })
  const [colors, setColors] = useState<Record<ColorKey, string>>({
    buyColor: initial.buyColor,
    sellColor: initial.sellColor,
  })
  const [showEma, setShowEma] = useState(initial.showEma)
  const [showSuperTrend, setShowSuperTrend] = useState(initial.showSuperTrend)
  const [showLabels, setShowLabels] = useState(initial.showLabels)
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const reset = () => {
    const defaults = TUX_EMA_SCALPER_DEFAULTS
    setNumbers({
      factor: String(defaults.factor),
      atrPeriod: String(defaults.atrPeriod),
      emaLength: String(defaults.emaLength),
    })
    setColors({ buyColor: defaults.buyColor, sellColor: defaults.sellColor })
    setShowEma(defaults.showEma)
    setShowSuperTrend(defaults.showSuperTrend)
    setShowLabels(defaults.showLabels)
    setError('')
  }

  return (
    <Modal
      title="TUX EMA Scalper+SuperTrend"
      description="Green BUY and pink SELL arrows from the EMA 20 cross, with the original SuperTrend context lines."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (3, 7, 20, close) defaults
          </button>
          <button type="submit" form="tux-ema-scalper-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="tux-ema-scalper-form"
        onSubmit={(event) => {
          event.preventDefault()
          const settings: TuxEmaScalperSettings = {
            factor: Number(numbers.factor),
            atrPeriod: Number(numbers.atrPeriod),
            emaLength: Number(numbers.emaLength),
            source: 'close',
            showEma,
            showSuperTrend,
            showLabels,
            buyColor: colors.buyColor.trim().toLowerCase(),
            sellColor: colors.sellColor.trim().toLowerCase(),
          }
          if (!isTuxEmaScalperSettings(settings)) {
            setError(
              'Factor must be 0.1–100, ATR and EMA lengths must be whole numbers from 1–2000, and colors must be six-digit hex values.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'TUX EMA Scalper+SuperTrend',
            period: settings.emaLength,
            color: settings.buyColor,
            visible,
            tuxEmaScalper: settings,
          })
        }}
      >
        <section className="settings-section">
          <h3>Published profile</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              SuperTrend factor
              <input
                aria-label="SuperTrend factor"
                inputMode="decimal"
                value={numbers.factor}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, factor: event.target.value }))
                }
              />
              <small>ATR multiplier. Default 3.</small>
            </label>
            <label className="field smc-number-field">
              ATR period
              <input
                aria-label="ATR period"
                inputMode="numeric"
                value={numbers.atrPeriod}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, atrPeriod: event.target.value }))
                }
              />
              <small>SuperTrend volatility period. Default 7.</small>
            </label>
            <label className="field smc-number-field">
              EMA length
              <input
                aria-label="EMA length"
                inputMode="numeric"
                value={numbers.emaLength}
                onChange={(event) =>
                  setNumbers((current) => ({ ...current, emaLength: event.target.value }))
                }
              />
              <small>EMA scalper signal length. Default 20.</small>
            </label>
            <label className="field smc-number-field">
              Source
              <input value="close" aria-label="TUX source" readOnly />
              <small>Fixed to close, matching the requested profile.</small>
            </label>
          </div>
          <div className="smc-grid pivot-color-grid">
            <ColorField
              label="BUY arrow"
              value={colors.buyColor}
              onChange={(value) => setColors((current) => ({ ...current, buyColor: value }))}
            />
            <ColorField
              label="SELL arrow"
              value={colors.sellColor}
              onChange={(value) => setColors((current) => ({ ...current, sellColor: value }))}
            />
          </div>
        </section>

        <section className="settings-section">
          <h3>Chart display</h3>
          <div className="setting-row">
            <div>
              <strong>Show EMA</strong>
              <p>Draw the blue EMA used by the BUY and SELL cross logic.</p>
            </div>
            <Toggle checked={showEma} onChange={setShowEma} label="Show TUX EMA" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show SuperTrend</strong>
              <p>Draw the green bullish and pink bearish ATR trail as context.</p>
            </div>
            <Toggle
              checked={showSuperTrend}
              onChange={setShowSuperTrend}
              label="Show TUX SuperTrend"
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show BUY/SELL labels</strong>
              <p>
                Labels use a transparent SVG text halo; they never cover candles with a filled box.
              </p>
            </div>
            <Toggle checked={showLabels} onChange={setShowLabels} label="Show TUX labels" />
          </div>
          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Hide the arrows and lines without removing this setup.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Show TUX EMA Scalper" />
          </div>
        </section>

        <section className="settings-section">
          <h3>Signal rules</h3>
          <ul className="sr-reading-list">
            <li>
              <span className="sr-diamond" style={{ color: colors.buyColor }}>
                ▲
              </span>
              BUY when close crosses above EMA {numbers.emaLength} and the close is rising from the
              previous bar.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: colors.sellColor }}>
                ▼
              </span>
              SELL when close crosses below EMA {numbers.emaLength} and the close is falling from
              the previous bar.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: TUX_EMA_SCALPER_COLORS.upTrend }}>
                —
              </span>
              SuperTrend uses factor {numbers.factor} and ATR {numbers.atrPeriod}; it is displayed
              as context and does not silently filter EMA arrows.
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
