import { BellRing, Check, Plus, Trash2, Volume2, VolumeX } from 'lucide-react'
import {
  ALARM_LIMIT,
  ALARM_POLL_MS,
  alarmEntries,
  alarmHeadline,
  alarmIndicatorLabel,
  alarmMatch,
} from '../lib/indicator-alarms'
import type { AlarmReading } from '../lib/indicator-alarms'
import type { AlarmFeedHealth } from '../lib/useIndicatorAlarms'
import { alarmFiredLabel, alarmStatus } from '../lib/alarm-status'
import { getAsset } from '../lib/market'
import type { DataSource } from '../../shared/coinbase'
import type { IndicatorAlarm } from '../lib/types'
import { CoinIcon, EmptyState, IconButton, Toggle } from './ui'

export function IndicatorAlarmList({
  alarms,
  readings,
  health,
  source,
  connected,
  soundEnabled,
  onToggleSound,
  onAdd,
  onRemove,
  onToggle,
  onToggleAlarmSound,
  onSelect,
}: {
  alarms: IndicatorAlarm[]
  readings: Record<string, AlarmReading>
  health: Record<string, AlarmFeedHealth>
  source: DataSource
  connected: boolean
  soundEnabled: boolean
  onToggleSound: () => void
  onAdd: () => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  onToggleAlarmSound: (id: string) => void
  onSelect: (symbol: string) => void
}) {
  const watching = alarms.filter((alarm) => alarm.enabled).length
  return (
    <section className="alarm-section">
      <div className="alarm-section-heading">
        <h3>
          Indicator alarms <span className="count-badge">{watching}</span>
        </h3>
        <div className="row">
          <IconButton
            icon={soundEnabled ? Volume2 : VolumeX}
            label={soundEnabled ? 'Mute alarm chimes' : 'Unmute alarm chimes'}
            active={!soundEnabled}
            onClick={onToggleSound}
          />
          <IconButton icon={Plus} label="Create indicator alarm" onClick={onAdd} />
        </div>
      </div>
      {!alarms.length ? (
        <EmptyState
          icon={BellRing}
          title="Your own triggers"
          description="Build an alarm on MACD, RSI or the Williams Vix Fix — a cross before it happens, a colour change, a level, a fear spike."
        >
          <button className="button button-primary" onClick={onAdd}>
            <Plus size={14} />
            Build an indicator alarm
          </button>
        </EmptyState>
      ) : (
        alarms.map((alarm) => {
          const reading = readings[alarm.id]
          const status = alarmStatus(
            alarm,
            reading,
            health[`${alarm.symbol}|${alarm.timeframe}`],
            source,
            connected,
          )
          return (
            <div
              className={`alert-card alarm-card ${status.tone === 'positive' ? 'triggered' : ''}`}
              key={alarm.id}
            >
              <div className="row between">
                <button className="alert-asset" onClick={() => onSelect(alarm.symbol)}>
                  <CoinIcon asset={getAsset(alarm.symbol)} size={23} />
                  <strong>{alarm.symbol}</strong>
                  <span className="alarm-chip mono">{alarm.timeframe}</span>
                </button>
                <IconButton icon={Trash2} label="Delete alarm" onClick={() => onRemove(alarm.id)} />
              </div>
              <div className="alarm-headline">{alarmHeadline(alarm)}</div>
              <div className="alarm-indicator">{alarmIndicatorLabel(alarm)}</div>
              {(() => {
                const count = alarmEntries(alarm).length
                return count > 1 ? (
                  <div className="alarm-combo-chip">
                    {alarmMatch(alarm) === 'any' ? 'Any of' : 'All of'} {count} conditions
                  </div>
                ) : null
              })()}
              {reading && <div className="alarm-reading mono">{reading.reading}</div>}
              {alarm.note && <p>{alarm.note}</p>}
              <div className={`alarm-state ${status.tone}`}>{status.label}</div>
              <div className="row between alarm-card-foot">
                <span className="alert-state">
                  <Check size={12} />
                  {alarmFiredLabel(alarm)}
                </span>
                <div className="row">
                  <IconButton
                    icon={alarm.sound ? Volume2 : VolumeX}
                    label={alarm.sound ? 'Silence this alarm' : 'Unsilence this alarm'}
                    onClick={() => onToggleAlarmSound(alarm.id)}
                  />
                  <Toggle
                    label="Enable alarm"
                    checked={alarm.enabled}
                    onChange={() => onToggle(alarm.id)}
                  />
                </div>
              </div>
            </div>
          )
        })
      )}
      <div className="alarm-section-foot">
        {alarms.length >= ALARM_LIMIT
          ? `${ALARM_LIMIT} alarms is the limit — remove one to add another.`
          : `Alarms on the open chart react to the live stream; other pairs are polled every ${Math.round(ALARM_POLL_MS / 1000)} seconds.`}
      </div>
    </section>
  )
}
