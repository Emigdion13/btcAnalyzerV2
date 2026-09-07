import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  coinbaseStrikeSettings,
  isCoinbaseStrikeSettings,
  COINBASE_STRIKE_DEFAULTS,
} from '../lib/coinbase-strike'
import type { CoinbaseStrikeSettings, Indicator } from '../lib/types'
import { Modal, Toggle } from './ui'

export function CoinbaseStrikeSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = coinbaseStrikeSettings(indicator)
  const [intervalMinutes, setIntervalMinutes] = useState(String(initial.intervalMinutes))
  const [buffer, setBuffer] = useState(String(initial.buffer))
  const [showTargets, setShowTargets] = useState(initial.showTargets)
  const [showStatusBadge, setShowStatusBadge] = useState(initial.showStatusBadge)
  const [customStrike, setCustomStrike] = useState(
    initial.customStrike > 0 ? String(initial.customStrike) : '',
  )
  const [strikeColor, setStrikeColor] = useState(initial.strikeColor)
  const [upColor, setUpColor] = useState(initial.upColor)
  const [downColor, setDownColor] = useState(initial.downColor)
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const reset = () => {
    setIntervalMinutes(String(COINBASE_STRIKE_DEFAULTS.intervalMinutes))
    setBuffer(String(COINBASE_STRIKE_DEFAULTS.buffer))
    setShowTargets(COINBASE_STRIKE_DEFAULTS.showTargets)
    setShowStatusBadge(COINBASE_STRIKE_DEFAULTS.showStatusBadge)
    setCustomStrike('')
    setStrikeColor(COINBASE_STRIKE_DEFAULTS.strikeColor)
    setUpColor(COINBASE_STRIKE_DEFAULTS.upColor)
    setDownColor(COINBASE_STRIKE_DEFAULTS.downColor)
    setError('')
  }

  const presets = [
    { label: '5m', value: 5 },
    { label: '15m (Standard)', value: 15 },
    { label: '30m', value: 30 },
    { label: '1h', value: 60 },
    { label: '4h', value: 240 },
    { label: '1D', value: 1440 },
  ]

  return (
    <Modal
      title="Coinbase BTC Up/Down Strike"
      description="Intraday contract strike lines · live UP/DOWN prediction status · target buffer levels"
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> 15m defaults
          </button>
          <button type="submit" form="coinbase-strike-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="coinbase-strike-form"
        onSubmit={(event) => {
          event.preventDefault()
          const intMin = Number(intervalMinutes)
          const buf = Number(buffer)
          const custom = customStrike.trim() ? Number(customStrike) : 0

          const settings: CoinbaseStrikeSettings = {
            intervalMinutes: intMin,
            buffer: buf,
            showTargets,
            showStatusBadge,
            customStrike: custom,
            strikeColor,
            upColor,
            downColor,
          }

          if (!isCoinbaseStrikeSettings(settings)) {
            setError(
              'Please enter a valid interval (1–10,080 minutes) and a positive buffer amount.',
            )
            return
          }

          onSave({
            ...indicator,
            name: 'Coinbase BTC Up/Down Strike',
            period: settings.intervalMinutes,
            color: strikeColor,
            visible,
            strike: settings,
          })
        }}
      >
        <section className="settings-section">
          <h3>Contract Interval</h3>
          <div className="strike-preset-row">
            {presets.map((p) => (
              <button
                type="button"
                key={p.value}
                className={`button button-small ${Number(intervalMinutes) === p.value ? 'button-active' : 'button-quiet'}`}
                onClick={() => setIntervalMinutes(String(p.value))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="smc-grid smc-grid-three" style={{ marginTop: '12px' }}>
            <label className="field smc-number-field">
              Interval (Minutes)
              <input
                aria-label="Contract interval in minutes"
                inputMode="numeric"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
              />
              <small>Contract duration (e.g. 15 for 15-minute guess).</small>
            </label>

            <label className="field smc-number-field">
              Target Buffer ($)
              <input
                aria-label="Target buffer dollar amount"
                inputMode="decimal"
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
              />
              <small>Target band offset above/below strike.</small>
            </label>

            <label className="field smc-number-field">
              Custom Strike ($)
              <input
                aria-label="Custom strike price override"
                placeholder="Auto (open price)"
                inputMode="decimal"
                value={customStrike}
                onChange={(e) => setCustomStrike(e.target.value)}
              />
              <small>Leave blank for dynamic interval open.</small>
            </label>
          </div>

          <div className="setting-row">
            <div>
              <strong>Show target bands</strong>
              <p>Plot Strike + Buffer and Strike − Buffer target lines on the chart.</p>
            </div>
            <Toggle
              checked={showTargets}
              onChange={setShowTargets}
              label="Show target buffer lines"
            />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show live UP / DOWN badge</strong>
              <p>Display real-time winning status, price delta, and expiry countdown.</p>
            </div>
            <Toggle
              checked={showStatusBadge}
              onChange={setShowStatusBadge}
              label="Show live UP/DOWN status badge"
            />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Toggle strike line and level overlay visibility.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Show indicator on chart" />
          </div>
        </section>

        <section className="settings-section">
          <h3>Colors</h3>
          <div className="smc-grid smc-grid-three">
            <label className="field">
              Strike line
              <div className="color-field">
                <input
                  type="color"
                  value={strikeColor}
                  onChange={(e) => setStrikeColor(e.target.value)}
                  aria-label="Strike line color"
                />
                <input
                  value={strikeColor}
                  onChange={(e) => setStrikeColor(e.target.value)}
                  aria-label="Strike line color hex"
                />
              </div>
            </label>

            <label className="field">
              UP (Bullish)
              <div className="color-field">
                <input
                  type="color"
                  value={upColor}
                  onChange={(e) => setUpColor(e.target.value)}
                  aria-label="UP winning color"
                />
                <input
                  value={upColor}
                  onChange={(e) => setUpColor(e.target.value)}
                  aria-label="UP winning color hex"
                />
              </div>
            </label>

            <label className="field">
              DOWN (Bearish)
              <div className="color-field">
                <input
                  type="color"
                  value={downColor}
                  onChange={(e) => setDownColor(e.target.value)}
                  aria-label="DOWN winning color"
                />
                <input
                  value={downColor}
                  onChange={(e) => setDownColor(e.target.value)}
                  aria-label="DOWN winning color hex"
                />
              </div>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>How Coinbase Up / Down Guess Works</h3>
          <ul className="sr-reading-list">
            <li>
              <span className="sr-swatch" style={{ background: strikeColor }} />
              <strong>Strike Price:</strong> The spot price of BTC at the exact start of the
              contract window (e.g. at <code>:00</code>, <code>:15</code>, <code>:30</code>,{' '}
              <code>:45</code> UTC).
            </li>
            <li>
              <span className="sr-swatch" style={{ background: upColor }} />
              <strong>UP (Winning):</strong> Price is currently higher than the strike line. If
              price settles above the line at interval expiry, UP contracts win.
            </li>
            <li>
              <span className="sr-swatch" style={{ background: downColor }} />
              <strong>DOWN (Winning):</strong> Price is currently lower than the strike line. If
              price settles below the line at interval expiry, DOWN contracts win.
            </li>
          </ul>
          {error && (
            <p className="negative" role="alert" style={{ marginTop: '10px' }}>
              {error}
            </p>
          )}
        </section>
      </form>
    </Modal>
  )
}
