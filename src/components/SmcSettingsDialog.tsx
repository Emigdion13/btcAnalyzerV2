import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { isSmartMoneyConceptsSettings, smcPalette, smcSettings } from '../lib/smart-money-concepts'
import {
  SMC_DEFAULTS,
  type Indicator,
  type SMCLabelSize,
  type SMCStructureFilter,
  type SmartMoneyConceptsSettings,
} from '../lib/types'
import { TIMEFRAMES } from '../lib/market'
import { Modal, Toggle } from './ui'

const STRUCTURE_FILTERS: SMCStructureFilter[] = ['All', 'BOS', 'CHoCH']
const LABEL_SIZES: SMCLabelSize[] = ['Tiny', 'Small', 'Normal']

type NumericDraft = Pick<
  SmartMoneyConceptsSettings,
  | 'swingLength'
  | 'internalOrderBlockCount'
  | 'swingOrderBlockCount'
  | 'equalHighLowBars'
  | 'equalHighLowThreshold'
  | 'fvgExtend'
>
type NumericText = Record<keyof NumericDraft, string>

function numericText(settings: SmartMoneyConceptsSettings): NumericText {
  return {
    swingLength: String(settings.swingLength),
    internalOrderBlockCount: String(settings.internalOrderBlockCount),
    swingOrderBlockCount: String(settings.swingOrderBlockCount),
    equalHighLowBars: String(settings.equalHighLowBars),
    equalHighLowThreshold: String(settings.equalHighLowThreshold),
    fvgExtend: String(settings.fvgExtend),
  }
}

export function SmcSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = smcSettings(indicator)
  const [settings, setSettings] = useState<SmartMoneyConceptsSettings>(initial)
  const [numbers, setNumbers] = useState<NumericText>(() => numericText(initial))
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')
  const update = <K extends keyof SmartMoneyConceptsSettings>(
    key: K,
    value: SmartMoneyConceptsSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }))
  const reset = () => {
    setSettings({ ...SMC_DEFAULTS })
    setNumbers(numericText(SMC_DEFAULTS))
    setError('')
  }
  const setNumber = (key: keyof NumericDraft, value: string) =>
    setNumbers((current) => ({ ...current, [key]: value }))

  return (
    <Modal
      title="Smart Money Concepts"
      description="Independent market-structure overlay · confirmed OHLCV pivots · close-based breaks"
      eyebrow="INDICATOR SETTINGS"
      className="smc-settings-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> SMC defaults
          </button>
          <button className="button button-primary" type="submit" form="smc-settings-form">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="smc-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          const smc: SmartMoneyConceptsSettings = {
            ...settings,
            swingLength: Number(numbers.swingLength),
            internalOrderBlockCount: Number(numbers.internalOrderBlockCount),
            swingOrderBlockCount: Number(numbers.swingOrderBlockCount),
            equalHighLowBars: Number(numbers.equalHighLowBars),
            equalHighLowThreshold: Number(numbers.equalHighLowThreshold),
            fvgExtend: Number(numbers.fvgExtend),
          }
          if (!isSmartMoneyConceptsSettings(smc)) {
            setError(
              'Use whole-number lengths and counts in range. Equal-level threshold must be from 0 to 0.5.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'Smart Money Concepts',
            period: smc.swingLength,
            color: smcPalette(smc).swingBull,
            visible,
            smc,
          })
        }}
      >
        <section className="settings-section smc-settings-section">
          <h3>Smart Money Concepts</h3>
          <div className="smc-grid">
            <label className="field">
              Mode
              <select
                aria-label="SMC mode"
                value={settings.mode}
                onChange={(event) =>
                  update('mode', event.target.value as SmartMoneyConceptsSettings['mode'])
                }
              >
                <option value="Historical">Historical</option>
                <option value="Present">Present</option>
              </select>
              <small>Historical keeps recent confirmed markup; Present keeps the latest set.</small>
            </label>
            <label className="field">
              Style
              <select
                aria-label="SMC style"
                value={settings.style}
                onChange={(event) =>
                  update('style', event.target.value as SmartMoneyConceptsSettings['style'])
                }
              >
                <option value="Colored">Colored</option>
                <option value="Monochrome">Monochrome</option>
              </select>
              <small>Applies to native SMC markup only.</small>
            </label>
          </div>
          <div className="setting-row">
            <div>
              <strong>Color candles</strong>
              <p>Color candles from the latest confirmed internal structure bias.</p>
            </div>
            <Toggle
              checked={settings.colorCandles}
              onChange={(value) => update('colorCandles', value)}
              label="Color candles by SMC structure"
            />
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <div className="smc-section-heading">
            <div>
              <h3>Internal structure</h3>
              <p>Fast confirmed pivots, drawn with dashed break lines.</p>
            </div>
            <Toggle
              checked={settings.showInternal}
              onChange={(value) => update('showInternal', value)}
              label="Show internal structure"
            />
          </div>
          <div className={`smc-disabled-group ${settings.showInternal ? '' : 'is-disabled'}`}>
            <div className="smc-grid smc-grid-three">
              <SelectField
                label="Bullish structure"
                value={settings.internalBullish}
                options={STRUCTURE_FILTERS}
                onChange={(value) => update('internalBullish', value)}
              />
              <SelectField
                label="Bearish structure"
                value={settings.internalBearish}
                options={STRUCTURE_FILTERS}
                onChange={(value) => update('internalBearish', value)}
              />
              <SelectField
                label="Internal label size"
                value={settings.internalLabelSize}
                options={LABEL_SIZES}
                onChange={(value) => update('internalLabelSize', value)}
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>Confluence filter</strong>
                <p>Require a directional close in the breaking candle’s range.</p>
              </div>
              <Toggle
                checked={settings.confluenceFilter}
                onChange={(value) => update('confluenceFilter', value)}
                label="Use internal confluence filter"
              />
            </div>
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <div className="smc-section-heading">
            <div>
              <h3>Swing structure</h3>
              <p>Broader confirmed pivots, drawn with solid break lines.</p>
            </div>
            <Toggle
              checked={settings.showSwing}
              onChange={(value) => update('showSwing', value)}
              label="Show swing structure"
            />
          </div>
          <div className={`smc-disabled-group ${settings.showSwing ? '' : 'is-disabled'}`}>
            <div className="smc-grid smc-grid-three">
              <SelectField
                label="Bullish structure"
                value={settings.swingBullish}
                options={STRUCTURE_FILTERS}
                onChange={(value) => update('swingBullish', value)}
              />
              <SelectField
                label="Bearish structure"
                value={settings.swingBearish}
                options={STRUCTURE_FILTERS}
                onChange={(value) => update('swingBearish', value)}
              />
              <SelectField
                label="Swing label size"
                value={settings.swingLabelSize}
                options={LABEL_SIZES}
                onChange={(value) => update('swingLabelSize', value)}
              />
            </div>
            <label className="field smc-number-field">
              Swing length
              <input
                aria-label="Swing length"
                type="number"
                min="2"
                max="500"
                step="1"
                required
                value={numbers.swingLength}
                onChange={(event) => setNumber('swingLength', event.target.value)}
              />
              <small>Bars on both sides required to confirm a swing high or low.</small>
            </label>
            <div className="setting-row">
              <div>
                <strong>Show swing points</strong>
                <p>Label confirmed HH, HL, LH, and LL pivots.</p>
              </div>
              <Toggle
                checked={settings.showSwingPoints}
                onChange={(value) => update('showSwingPoints', value)}
                label="Show swing point labels"
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>Strong / weak highs & lows</strong>
                <p>Extend the latest swing extremes as likely liquidity targets.</p>
              </div>
              <Toggle
                checked={settings.showStrongWeakHighsLows}
                onChange={(value) => update('showStrongWeakHighsLows', value)}
                label="Show strong and weak highs and lows"
              />
            </div>
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <h3>Order blocks</h3>
          <div className="smc-block-grid">
            <div className="smc-toggle-number">
              <Toggle
                checked={settings.showInternalOrderBlocks}
                onChange={(value) => update('showInternalOrderBlocks', value)}
                label="Show internal order blocks"
              />
              <label className="field">
                Internal order blocks
                <input
                  aria-label="Internal order block count"
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  required
                  value={numbers.internalOrderBlockCount}
                  onChange={(event) => setNumber('internalOrderBlockCount', event.target.value)}
                />
                <small>Most recent active blocks.</small>
              </label>
            </div>
            <div className="smc-toggle-number">
              <Toggle
                checked={settings.showSwingOrderBlocks}
                onChange={(value) => update('showSwingOrderBlocks', value)}
                label="Show swing order blocks"
              />
              <label className="field">
                Swing order blocks
                <input
                  aria-label="Swing order block count"
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  required
                  value={numbers.swingOrderBlockCount}
                  onChange={(event) => setNumber('swingOrderBlockCount', event.target.value)}
                />
                <small>Most recent active blocks.</small>
              </label>
            </div>
          </div>
          <div className="smc-grid">
            <label className="field">
              Order block filter
              <select
                aria-label="Order block filter"
                value={settings.orderBlockFilter}
                onChange={(event) =>
                  update(
                    'orderBlockFilter',
                    event.target.value as SmartMoneyConceptsSettings['orderBlockFilter'],
                  )
                }
              >
                <option value="Atr">Atr</option>
                <option value="Cumulative Mean Range">Cumulative Mean Range</option>
              </select>
              <small>Excludes unusually wide opposite candles.</small>
            </label>
            <label className="field">
              Mitigation source
              <select
                aria-label="Order block mitigation source"
                value={settings.orderBlockMitigation}
                onChange={(event) =>
                  update(
                    'orderBlockMitigation',
                    event.target.value as SmartMoneyConceptsSettings['orderBlockMitigation'],
                  )
                }
              >
                <option value="High/Low">High/Low</option>
                <option value="Close">Close</option>
              </select>
              <small>Price source used to test a return into a block.</small>
            </label>
          </div>
          <div className="setting-row">
            <div>
              <strong>Highlight mitigated order blocks</strong>
              <p>Dim a block once price has returned into it. Invalidated blocks are removed.</p>
            </div>
            <Toggle
              checked={settings.highlightMitigatedBlocks}
              onChange={(value) => update('highlightMitigatedBlocks', value)}
              label="Highlight mitigated order blocks"
            />
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <div className="smc-section-heading">
            <div>
              <h3>Equal highs & lows</h3>
              <p>ATR-scaled, confirmed swing-pair liquidity levels.</p>
            </div>
            <Toggle
              checked={settings.showEqualHighLow}
              onChange={(value) => update('showEqualHighLow', value)}
              label="Show equal highs and lows"
            />
          </div>
          <div className={`smc-disabled-group ${settings.showEqualHighLow ? '' : 'is-disabled'}`}>
            <div className="smc-grid smc-grid-three">
              <label className="field">
                Bars confirmation
                <input
                  aria-label="Equal high low confirmation bars"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                  value={numbers.equalHighLowBars}
                  onChange={(event) => setNumber('equalHighLowBars', event.target.value)}
                />
              </label>
              <label className="field">
                Threshold
                <input
                  aria-label="Equal high low threshold"
                  type="number"
                  min="0"
                  max="0.5"
                  step="0.1"
                  required
                  value={numbers.equalHighLowThreshold}
                  onChange={(event) => setNumber('equalHighLowThreshold', event.target.value)}
                />
              </label>
              <SelectField
                label="Label size"
                value={settings.equalHighLowLabelSize}
                options={LABEL_SIZES}
                onChange={(value) => update('equalHighLowLabelSize', value)}
              />
            </div>
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <div className="smc-section-heading">
            <div>
              <h3>Fair value gaps</h3>
              <p>Three-candle imbalances from the chart or selected native resolution.</p>
            </div>
            <Toggle
              checked={settings.showFairValueGaps}
              onChange={(value) => update('showFairValueGaps', value)}
              label="Show fair value gaps"
            />
          </div>
          <div className={`smc-disabled-group ${settings.showFairValueGaps ? '' : 'is-disabled'}`}>
            <div className="setting-row">
              <div>
                <strong>Auto threshold</strong>
                <p>Hide gaps smaller than ten percent of the local ATR.</p>
              </div>
              <Toggle
                checked={settings.fvgAutoThreshold}
                onChange={(value) => update('fvgAutoThreshold', value)}
                label="Use automatic fair value gap threshold"
              />
            </div>
            <div className="smc-grid">
              <label className="field">
                Timeframe
                <select
                  value={settings.fvgTimeframe}
                  aria-label="Fair value gap timeframe"
                  onChange={(event) =>
                    update(
                      'fvgTimeframe',
                      event.target.value as SmartMoneyConceptsSettings['fvgTimeframe'],
                    )
                  }
                >
                  <option value="">Current chart</option>
                  {TIMEFRAMES.map((timeframe) => (
                    <option key={timeframe} value={timeframe}>
                      {timeframe}
                    </option>
                  ))}
                </select>
                <small>Gaps are calculated on the selected native OHLCV timeframe.</small>
              </label>
              <label className="field">
                Extend FVG
                <input
                  aria-label="Fair value gap extend bars"
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  required
                  value={numbers.fvgExtend}
                  onChange={(event) => setNumber('fvgExtend', event.target.value)}
                />
                <small>Bars to project an unfilled gap.</small>
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section smc-settings-section">
          <h3>Higher-timeframe highs & lows</h3>
          <HighLowRow
            label="Daily"
            checked={settings.showDailyHighLow}
            style={settings.dailyLineStyle}
            onChecked={(value) => update('showDailyHighLow', value)}
            onStyle={(value) => update('dailyLineStyle', value)}
          />
          <HighLowRow
            label="Weekly"
            checked={settings.showWeeklyHighLow}
            style={settings.weeklyLineStyle}
            onChecked={(value) => update('showWeeklyHighLow', value)}
            onStyle={(value) => update('weeklyLineStyle', value)}
          />
          <HighLowRow
            label="Monthly"
            checked={settings.showMonthlyHighLow}
            style={settings.monthlyLineStyle}
            onChecked={(value) => update('showMonthlyHighLow', value)}
            onStyle={(value) => update('monthlyLineStyle', value)}
          />
        </section>

        <section className="settings-section smc-settings-section">
          <div className="setting-row">
            <div>
              <strong>Premium / discount zones</strong>
              <p>
                Show premium, equilibrium, and discount bands between the latest swing extremes.
              </p>
            </div>
            <Toggle
              checked={settings.showPremiumDiscount}
              onChange={(value) => update('showPremiumDiscount', value)}
              label="Show premium discount zones"
            />
          </div>
          <div className="info-box smc-compatibility-note">
            This is a clean-room Atlas implementation of common SMC methods, not a copy of another
            publisher’s source or a claim of exact signal parity. Confirmed pivots arrive after
            their lookback bars and all chart markup is informational—not trading advice.
          </div>
        </section>

        <div className="setting-row">
          <div>
            <strong>Visible on chart</strong>
            <p>Hide the overlay without removing its saved settings.</p>
          </div>
          <Toggle checked={visible} onChange={setVisible} label="Smart Money Concepts visible" />
        </div>
        {error && (
          <p className="negative smc-settings-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function HighLowRow({
  label,
  checked,
  style,
  onChecked,
  onStyle,
}: {
  label: string
  checked: boolean
  style: SmartMoneyConceptsSettings['dailyLineStyle']
  onChecked: (checked: boolean) => void
  onStyle: (style: SmartMoneyConceptsSettings['dailyLineStyle']) => void
}) {
  return (
    <div className="smc-high-low-row">
      <Toggle
        checked={checked}
        onChange={onChecked}
        label={`Show ${label.toLowerCase()} highs and lows`}
      />
      <strong>{label}</strong>
      <select
        aria-label={`${label} high low line style`}
        value={style}
        onChange={(event) =>
          onStyle(event.target.value as SmartMoneyConceptsSettings['dailyLineStyle'])
        }
      >
        <option value="⎯⎯⎯">⎯⎯⎯</option>
        <option value="----">----</option>
        <option value="····">····</option>
      </select>
    </div>
  )
}
