import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Indicator, TrendPressureSettings } from '../lib/types'
import {
  isTrendPressureSettings,
  trendPressureSettings,
  TREND_PRESSURE_DEFAULTS,
} from '../lib/zeiierman-trend-pressure'
import { Modal, Toggle } from './ui'

type NumericKey = {
  [K in keyof TrendPressureSettings]: TrendPressureSettings[K] extends number ? K : never
}[keyof TrendPressureSettings]
const groups: { title: string; fields: [NumericKey, string, number, number, number][] }[] = [
  {
    title: 'Z-Pulse',
    fields: [
      ['pulseRange', 'Pulse Range', 3, 2000, 1],
      ['pulseStochastic', 'Pulse Stochastic', 3, 2000, 1],
      ['pulseSmoothing', 'Pulse Smoothing', 1, 50, 1],
    ],
  },
  {
    title: 'Z-Trend',
    fields: [
      ['trendRange', 'Trend Range', 5, 2000, 1],
      ['macroTrend', 'Macro Trend', 10, 2000, 1],
      ['trendSmoothing', 'Trend Smoothing', 1, 30, 1],
      ['trendPersistence', 'Trend Persistence', 0, 20, 0.5],
    ],
  },
  {
    title: 'Pressure Exhaustion',
    fields: [
      ['exhaustionZone', 'Exhaustion Zone', 5, 40, 1],
      ['sensitivity', 'Sensitivity', 1, 10, 1],
    ],
  },
  {
    title: 'Pressure Core',
    fields: [
      ['reactiveSmoothing', 'Reactive Smoothing', 1, 30, 1],
      ['regimeWeight', 'Regime Weight', 0, 1, 0.05],
    ],
  },
  {
    title: 'Colors & Style',
    fields: [
      ['levelTransparency', 'Level Transparency', 0, 100, 1],
      ['coreWidth', 'Core Width', 1, 4, 1],
      ['maxBoxes', 'Max Price Boxes', 1, 300, 1],
    ],
  },
]
const colors: [keyof TrendPressureSettings, string][] = [
  ['cold', 'Cold'],
  ['hot', 'Hot'],
  ['upperLevel', 'Upper Level'],
  ['lowerLevel', 'Lower Level'],
  ['pulseColor', 'Z-Pulse'],
  ['trendColor', 'Z-Trend'],
  ['coreBull', 'Core Bull'],
  ['coreBear', 'Core Bear'],
  ['coreNeutral', 'Core Neutral'],
]
const booleans: [keyof TrendPressureSettings, string][] = [
  ['showCrosses', 'Pulse / Trend Crosses'],
  ['gradientFill', 'Gradient Fill'],
  ['priceBoxes', 'Price Boxes'],
]

export function TrendPressureSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const [settings, setSettings] = useState<TrendPressureSettings>(() =>
    trendPressureSettings(indicator),
  )
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const update = <K extends keyof TrendPressureSettings>(key: K, value: TrendPressureSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))
  return (
    <Modal
      title="Zeiierman Trend Pressure"
      description="© Zeiierman · CC BY-NC-SA 4.0 · Pine v6 behavioral port"
      eyebrow="INDICATOR SETTINGS"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              setSettings({ ...TREND_PRESSURE_DEFAULTS })
              setError('')
            }}
          >
            <RotateCcw size={13} /> Original defaults
          </button>
          <button type="submit" form="trend-pressure-settings" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="trend-pressure-settings"
        onSubmit={(event) => {
          event.preventDefault()
          if (!isTrendPressureSettings(settings)) {
            setError('Enter valid values for every field.')
            return
          }
          onSave({ ...indicator, visible, period: settings.pulseRange, trendPressure: settings })
        }}
      >
        {groups.map((group) => (
          <div className="settings-section" key={group.title}>
            <h3>{group.title}</h3>
            <div className="wt-length-fields">
              {group.fields.map(([key, label, min, max, step]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    required
                    min={min}
                    max={max}
                    step={step}
                    value={settings[key]}
                    onChange={(e) =>
                      update(key, e.target.value === '' ? NaN : Number(e.target.value))
                    }
                  />
                </label>
              ))}
            </div>
            {group.title === 'Pressure Exhaustion' && (
              <Toggle
                label="Pulse / Trend Crosses"
                checked={settings.showCrosses}
                onChange={(v) => update('showCrosses', v)}
              />
            )}
            {group.title === 'Colors & Style' && (
              <>
                <div className="wt-length-fields">
                  {colors.map(([key, label]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        type="color"
                        value={String(settings[key])}
                        onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                {booleans
                  .filter(([key]) => key !== 'showCrosses')
                  .map(([key, label]) => (
                    <Toggle
                      key={key}
                      label={label}
                      checked={Boolean(settings[key])}
                      onChange={(v) => setSettings((s) => ({ ...s, [key]: v }))}
                    />
                  ))}
              </>
            )}
          </div>
        ))}
        <Toggle label="Show indicator on chart" checked={visible} onChange={setVisible} />
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
