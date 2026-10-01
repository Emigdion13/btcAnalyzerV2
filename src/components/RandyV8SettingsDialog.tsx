import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  RANDY_V8_FIELDS,
  isRandyV8Settings,
  randyV8Settings,
  type RandyV8Field,
} from '../lib/randy-v8'
import { RANDY_V8_DEFAULTS, type Indicator, type RandyV8Settings } from '../lib/types'
import { Modal, Toggle } from './ui'

const GROUPS: { id: RandyV8Field['group']; title: string; hint: string }[] = [
  {
    id: 'target',
    title: 'Target',
    hint: 'The contract’s strike is the centre of the system. Type it as Kalshi shows it; the UP/DOWN meter is a V8 technical estimate, not Kalshi’s price and not a guaranteed probability.',
  },
  {
    id: 'engine',
    title: 'Engine',
    hint: 'Lengths and thresholds of the context (1H / 15M / 5M) and 1M scores.',
  },
  {
    id: 'confirm',
    title: 'Target confirmation',
    hint: 'The strict engine that holds a direction to the close of the contract.',
  },
  {
    id: 'scalp',
    title: 'SCALP / impulse',
    hint: 'The faster evidence-count engine behind CHARGING and ENTER.',
  },
  {
    id: 'discipline',
    title: 'Discipline / stages',
    hint: 'What CHARGED and ENTER need, and when the run is spent.',
  },
  {
    id: 'map',
    title: 'Map 1H / 15M',
    hint: 'Where BTC sits against the big zones. They inform; they never veto.',
  },
]

const TOGGLES: { key: keyof RandyV8Settings; title: string; text: string }[] = [
  {
    key: 'showEmas',
    title: 'EMA 9 / 20',
    text: 'The 1M engine’s pair (drawn on a 1m chart only).',
  },
  { key: 'showTarget', title: 'Target line', text: 'The strike as a thick aqua line.' },
  {
    key: 'showLevels',
    title: 'Support / resistance and map',
    text: '5M support/resistance and the 15M / 1H map lines.',
  },
  { key: 'showMarkers', title: 'ENTER dots', text: 'A dot under or over each confirmed ENTER.' },
]

const asText = (settings: RandyV8Settings) =>
  Object.fromEntries(RANDY_V8_FIELDS.map((field) => [field.key, String(settings[field.key])]))

export function RandyV8SettingsDialog({
  indicator,
  onSave,
  onClose,
}: {
  indicator: Indicator
  onSave: (indicator: Indicator) => void
  onClose: () => void
}) {
  const initial = randyV8Settings(indicator)
  const [numbers, setNumbers] = useState<Record<string, string>>(() => asText(initial))
  const [toggles, setToggles] = useState({
    showEmas: initial.showEmas,
    showTarget: initial.showTarget,
    showLevels: initial.showLevels,
    showMarkers: initial.showMarkers,
  })
  const [visible, setVisible] = useState(indicator.visible)
  const [error, setError] = useState('')

  const reset = () => {
    // The strike belongs to the contract, not to the profile: resetting keeps what was typed.
    setNumbers({ ...asText(RANDY_V8_DEFAULTS), target: numbers.target ?? '0' })
    setToggles({
      showEmas: RANDY_V8_DEFAULTS.showEmas,
      showTarget: RANDY_V8_DEFAULTS.showTarget,
      showLevels: RANDY_V8_DEFAULTS.showLevels,
      showMarkers: RANDY_V8_DEFAULTS.showMarkers,
    })
    setError('')
  }

  return (
    <Modal
      title="Randy V8.10 DISCIPLINADO"
      description="BTC / Kalshi 15-minute scalper: type the Target, read the meter and the staged call. Built for a 1m chart."
      eyebrow="INDICATOR SETTINGS"
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={reset}>
            <RotateCcw size={13} /> V8.10 defaults
          </button>
          <button type="submit" form="randy-v8-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="randy-v8-form"
        onSubmit={(event) => {
          event.preventDefault()
          const draft: Record<string, unknown> = { ...toggles }
          for (const field of RANDY_V8_FIELDS) {
            const raw = (numbers[field.key] ?? '').trim()
            draft[field.key] = raw === '' ? Number.NaN : Number(raw)
          }
          const bad = RANDY_V8_FIELDS.find((field) => {
            const value = draft[field.key] as number
            return (
              !Number.isFinite(value) ||
              value < field.min ||
              value > field.max ||
              (field.int && !Number.isInteger(value))
            )
          })
          if (bad || !isRandyV8Settings(draft)) {
            setError(
              bad
                ? `${bad.label}: ${bad.int ? 'a whole number' : 'a number'} from ${bad.min} to ${bad.max}.`
                : 'Some settings are out of range.',
            )
            return
          }
          onSave({
            ...indicator,
            name: 'Randy V8.10',
            visible,
            randyV8: draft as unknown as RandyV8Settings,
          })
        }}
      >
        {GROUPS.map((group) => (
          <section className="settings-section" key={group.id}>
            <h3>{group.title}</h3>
            <p className="settings-hint">{group.hint}</p>
            <div className="smc-grid smc-grid-two">
              {RANDY_V8_FIELDS.filter((field) => field.group === group.id).map((field) => (
                <label className="field smc-number-field" key={field.key}>
                  {field.label}
                  <input
                    aria-label={field.label}
                    inputMode={field.int ? 'numeric' : 'decimal'}
                    value={numbers[field.key] ?? ''}
                    onChange={(event) =>
                      setNumbers((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                  <small>
                    Pine “{field.pine}”. Default {RANDY_V8_DEFAULTS[field.key]}.
                  </small>
                </label>
              ))}
            </div>
          </section>
        ))}

        <section className="settings-section">
          <h3>Draw</h3>
          {TOGGLES.map((toggle) => (
            <div className="setting-row" key={toggle.key}>
              <div>
                <strong>{toggle.title}</strong>
                <p>{toggle.text}</p>
              </div>
              <Toggle
                checked={toggles[toggle.key as keyof typeof toggles]}
                onChange={(value) => setToggles((current) => ({ ...current, [toggle.key]: value }))}
                label={`Show ${toggle.title}`}
              />
            </div>
          ))}
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
