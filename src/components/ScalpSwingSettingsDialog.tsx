import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  isScalpSwingSettings,
  scalpSwingSettings,
  SCALPSWING_COLORS,
} from '../lib/scalpswing'
import {
  SCALPSWING_DEFAULTS,
  type Indicator,
  type ScalpSwingSettings,
} from '../lib/types'
import { Modal, Toggle } from './ui'

type NumericDraft = Pick<ScalpSwingSettings, 'pacLength' | 'emaFilterLength'>
type NumericText = Record<keyof NumericDraft, string>
type ColorKey = 'buyColor' | 'sellColor'

function numericText(settings: ScalpSwingSettings): NumericText {
  return {
    pacLength: String(settings.pacLength),
    emaFilterLength: String(settings.emaFilterLength),
  }
}

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
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color`}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color hex`}
          spellCheck={false}
        />
      </span>
    </label>
  )
}

export function ScalpSwingSettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = scalpSwingSettings(indicator)
  const [numbers, setNumbers] = useState<NumericText>(() => numericText(initial))
  const [filterWithEma, setFilterWithEma] = useState(initial.filterWithEma)
  const [showPacChannel, setShowPacChannel] = useState(initial.showPacChannel)
  const [showEmaFilter, setShowEmaFilter] = useState(initial.showEmaFilter)
  const [useBigArrows, setUseBigArrows] = useState(initial.useBigArrows)
  const [showLabels, setShowLabels] = useState(initial.showLabels)
  const [signalOnNextBar, setSignalOnNextBar] = useState(initial.signalOnNextBar)
  const [colors, setColors] = useState<Record<ColorKey, string>>({
    buyColor: initial.buyColor,
    sellColor: initial.sellColor,
  })
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const setNumber = (key: keyof NumericDraft, value: string) =>
    setNumbers((cur) => ({ ...cur, [key]: value }))
  const setColor = (key: ColorKey, value: string) =>
    setColors((cur) => ({ ...cur, [key]: value }))

  const reset = () => {
    const d = SCALPSWING_DEFAULTS
    setNumbers(numericText({ ...d }))
    setFilterWithEma(d.filterWithEma)
    setShowPacChannel(d.showPacChannel)
    setShowEmaFilter(d.showEmaFilter)
    setUseBigArrows(d.useBigArrows)
    setShowLabels(d.showLabels)
    setSignalOnNextBar(d.signalOnNextBar)
    setColors({ buyColor: d.buyColor, sellColor: d.sellColor })
    setError('')
  }

  return (
    <Modal
      title="SCALPSWING R1-6 (10)"
      description="Small bottom/top arrows – PAC EMA High/Low/Close breakout with optional 200EMA filter. Faithful port of JustUncleL's published (10) logic."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> (10) defaults
          </button>
          <button type="submit" form="scalpswing-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="scalpswing-form"
        onSubmit={(e) => {
          e.preventDefault()
          const s: ScalpSwingSettings = {
            pacLength: Number(numbers.pacLength),
            emaFilterLength: Number(numbers.emaFilterLength),
            filterWithEma,
            showPacChannel,
            showEmaFilter,
            useBigArrows,
            showLabels,
            signalOnNextBar,
            buyColor: colors.buyColor.trim().toLowerCase(),
            sellColor: colors.sellColor.trim().toLowerCase(),
          }
          if (!isScalpSwingSettings(s)) {
            setError(
              'PAC length 2-200, EMA filter 1-2000 as whole numbers, and six-digit hex colors like #26a69a.',
            )
            return
          }
          onSave({
            ...indicator,
            name: `SCALPSWING R1-6 (${s.pacLength})`,
            period: s.pacLength,
            color: s.buyColor,
            visible,
            scalpswing: s,
          })
        }}
      >
        <section className="settings-section">
          <h3>Published inputs</h3>
          <div className="smc-grid smc-grid-two">
            <label className="field smc-number-field">
              PAC Length
              <input
                aria-label="PAC Length"
                inputMode="numeric"
                value={numbers.pacLength}
                onChange={(e) => setNumber('pacLength', e.target.value)}
              />
              <small>EMA of High/Low/Close – original default 10. (SCALPSWING R1-6 (10))</small>
            </label>
            <label className="field smc-number-field">
              EMA Filter Length
              <input
                aria-label="EMA Filter Length"
                inputMode="numeric"
                value={numbers.emaFilterLength}
                onChange={(e) => setNumber('emaFilterLength', e.target.value)}
              />
              <small>Original uses 200 (180 on 1m). Filters BUY/SELL by PAC close vs this EMA.</small>
            </label>
          </div>

          <div className="smc-grid pivot-color-grid">
            <ColorField label="Buy arrow" value={colors.buyColor} onChange={(v) => setColor('buyColor', v)} />
            <ColorField label="Sell arrow" value={colors.sellColor} onChange={(v) => setColor('sellColor', v)} />
          </div>

          <div className="setting-row">
            <div>
              <strong>Filter PAC Alerts with EMA</strong>
              <p>When on, BUY only if PAC close &gt; EMA filter, SELL only if PAC close &lt; EMA filter – original checkbox.</p>
            </div>
            <Toggle checked={filterWithEma} onChange={setFilterWithEma} label="Filter PAC Alerts with EMA" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show PAC Channel</strong>
              <p>Draw EMA(High), EMA(Low), EMA(Close) lines – the Price Action Channel.</p>
            </div>
            <Toggle checked={showPacChannel} onChange={setShowPacChannel} label="Show PAC Channel" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show EMA Filter line</strong>
              <p>Draw the EMA filter (200) line used for trend filtering.</p>
            </div>
            <Toggle checked={showEmaFilter} onChange={setShowEmaFilter} label="Show EMA Filter" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Use Big Arrows</strong>
              <p>Original option: aqua/fuchsia plotarrow instead of small green/red shape arrows.</p>
            </div>
            <Toggle checked={useBigArrows} onChange={setUseBigArrows} label="Use Big Arrows" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show BUY/SELL labels</strong>
              <p>Show text next to arrows, as in original plotshape text.</p>
            </div>
            <Toggle checked={showLabels} onChange={setShowLabels} label="Show BUY/SELL labels" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Signal on next bar (original offset)</strong>
              <p>Replicate Pine's up_alert[1]==1 behavior – arrow appears one bar after breakout. Off = arrow on breakout candle itself.</p>
            </div>
            <Toggle checked={signalOnNextBar} onChange={setSignalOnNextBar} label="Signal on next bar" />
          </div>

          <div className="setting-row">
            <div>
              <strong>Show indicator</strong>
              <p>Hide to keep config without drawing arrows.</p>
            </div>
            <Toggle checked={visible} onChange={setVisible} label="Show SCALPSWING R1-6" />
          </div>
        </section>

        <section className="settings-section">
          <h3>How it works – original logic</h3>
          <ul className="sr-reading-list">
            <li>
              <span className="sr-diamond" style={{ color: SCALPSWING_COLORS.pac }}>—</span>
              PAC = EMA(High, Len), EMA(Low, Len), EMA(Close, Len). Colored bars: blue above PAC, red below, gray inside.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: colors.buyColor }}>▲</span>
              BUY arrow: close &gt; open AND close &gt; PAC High AND previous close &lt; previous PAC High, optionally PAC Close &gt; EMA200.
            </li>
            <li>
              <span className="sr-diamond" style={{ color: colors.sellColor }}>▼</span>
              SELL arrow: close &lt; open AND close &lt; PAC Low AND previous close &gt; previous PAC Low, optionally PAC Close &lt; EMA200.
            </li>
            <li>
              <span className="sr-diamond">ⓘ</span>
              Original plots small arrows below/above bar with BUY/SELL text, or big aqua/fuchsia plotarrow when enabled. Atlas draws same arrows as SVG overlay.
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
