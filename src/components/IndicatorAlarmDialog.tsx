import { useMemo, useRef, useState } from 'react'
import { BellRing, Info, Plus, Volume2, Wand2, X } from 'lucide-react'
import {
  ALARM_ENTRY_LIMIT,
  ALARM_ENTRY_LIMIT_MESSAGE,
  ALARM_INDICATOR_LABELS,
  ALARM_INDICATORS,
  ALARM_MATCHES,
  ALARM_POLL_MS,
  alarmHeadline,
  alarmIndicatorLabel,
  alarmSeries,
  alarmVenueActive,
  closedCandles,
  conditionSpec,
  conditionsFor,
  defaultParams,
  evaluateIndicatorAlarm,
  isMacdKind,
  newIndicatorAlarm,
} from '../lib/indicator-alarms'
import {
  alarmChimeForCondition,
  alarmAudioAvailable,
  playAlarmChime,
  primeAlarmAudio,
} from '../lib/alarm-sound'
import { CM_MACD_DEFAULTS } from '../lib/cm-ult-macd'
import { CM_WILLIAMS_VIX_FIX_DEFAULTS } from '../lib/cm-williams-vix-fix'
import { TIMEFRAMES } from '../lib/market'
import { isMetalInterval, isMetalSymbol } from '../../shared/kalshi'
import type {
  AlarmConditionId,
  AlarmIndicatorKind,
  AlarmMatch,
  Asset,
  Candle,
  IndicatorAlarm,
  Timeframe,
} from '../lib/types'
import { Modal, Toggle } from './ui'

/** The lengths each indicator exposes, in the order the config grids show them. */
const MACD_FIELDS = [
  ['fast', 'Fast length'],
  ['slow', 'Slow length'],
  ['signal', 'Signal length'],
] as const
const WVF_FIELDS = [
  ['pd', 'pd · highest close'],
  ['bbl', 'bbl · Bollinger length'],
  ['mult', 'mult · deviation'],
  ['lb', 'lb · percentile range'],
  ['ph', 'ph · range-high factor'],
  ['pl', 'pl · range-low factor'],
] as const
const textOf = (value: number) => String(value)
const chimeHint: Record<string, string> = {
  bull: 'a rising two-note chime',
  bear: 'a falling two-note chime',
  neutral: 'a flat two-note chime',
}
/** One extra leg of a combined alarm, with its inputs held as text while they are typed. */
interface DraftLeg {
  key: number
  indicator: AlarmIndicatorKind
  condition: AlarmConditionId
  params: Record<string, string>
}
const paramsAsText = (condition: AlarmConditionId): Record<string, string> =>
  Object.fromEntries(
    Object.entries(defaultParams(condition)).map(([key, value]) => [key, textOf(value)]),
  )

export function IndicatorAlarmDialog({
  symbol: chartSymbol,
  timeframe: chartTimeframe,
  source,
  assets,
  candles,
  connected,
  onCreate,
  onClose,
}: {
  symbol: string
  timeframe: Timeframe
  source: 'coinbase' | 'demo'
  assets: Asset[]
  candles: Candle[]
  connected: boolean
  onCreate: (alarm: IndicatorAlarm) => void
  onClose: () => void
}) {
  const [symbol, setSymbol] = useState(chartSymbol)
  const [timeframe, setTimeframe] = useState<Timeframe>(chartTimeframe)
  const [indicator, setIndicator] = useState<AlarmIndicatorKind>('cm-ult-macd')
  const [condition, setCondition] = useState<AlarmConditionId>('macd-cross-up')
  const [params, setParams] = useState<Record<string, string>>(() => paramsAsText('macd-cross-up'))
  const [legs, setLegs] = useState<DraftLeg[]>([])
  const [match, setMatch] = useState<AlarmMatch>('all')
  const legKey = useRef(0)
  const [macd, setMacd] = useState(() => ({
    fast: textOf(CM_MACD_DEFAULTS.fastLength),
    slow: textOf(CM_MACD_DEFAULTS.slowLength),
    signal: textOf(CM_MACD_DEFAULTS.signalLength),
  }))
  const [rsiPeriod, setRsiPeriod] = useState('14')
  const [vixFix, setVixFix] = useState(() => ({
    pd: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.pd),
    bbl: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.bbl),
    mult: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.mult),
    lb: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.lb),
    ph: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.ph),
    pl: textOf(CM_WILLIAMS_VIX_FIX_DEFAULTS.pl),
  }))
  const [sound, setSound] = useState(true)
  const [repeat, setRepeat] = useState<IndicatorAlarm['repeat']>('bar')
  const [bars, setBars] = useState<IndicatorAlarm['bars']>('forming')
  const [note, setNote] = useState('')
  const [soundReport, setSoundReport] = useState('')
  const [error, setError] = useState('')
  const spec = conditionSpec(condition)
  /** Every family the alarm will read — the primary leg, plus whatever the extra legs add. */
  const families = useMemo(
    () => [...new Set<AlarmIndicatorKind>([indicator, ...legs.map((leg) => leg.indicator)])],
    [indicator, legs],
  )
  const macdFamily = families.find(isMacdKind)
  /** A condition another leg already watches: offering it twice would be meaningless. */
  const takenBy = (kind: AlarmIndicatorKind, id: AlarmConditionId, skip: number | null) =>
    (kind === indicator && id === condition && skip !== null) ||
    legs.some((leg, index) => leg.indicator === kind && leg.condition === id && index !== skip)
  const offered = useMemo(
    () => conditionsFor(indicator).filter((item) => !takenBy(indicator, item.id, null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicator, condition, legs],
  )
  /**
   * A leg may not read the other MACD flavour — the alarm already reads one — and never a family
   * whose conditions another leg has all taken. The primary may switch freely between flavours
   * *unless* a leg has claimed one, which is what `blockedForPrimary` watches.
   */
  const blockedForLeg = (kind: AlarmIndicatorKind, skip: number | null = null) => {
    if (isMacdKind(kind) && families.some((family) => isMacdKind(family) && family !== kind))
      return true
    return conditionsFor(kind).every((item) => takenBy(kind, item.id, skip))
  }
  const blockedForPrimary = (kind: AlarmIndicatorKind) =>
    isMacdKind(kind) && legs.some((leg) => isMacdKind(leg.indicator) && leg.indicator !== kind)
  const canAdd =
    legs.length < ALARM_ENTRY_LIMIT - 1 &&
    ALARM_INDICATORS.some((kind) => !families.includes(kind) && !blockedForLeg(kind))
  const metal = isMetalSymbol(symbol)
  const timeframes = metal ? TIMEFRAMES.filter(isMetalInterval) : TIMEFRAMES
  const onChart =
    symbol === chartSymbol && timeframe === chartTimeframe && alarmVenueActive(symbol, source)
  const chime = alarmChimeForCondition(condition)

  const chooseIndicator = (next: AlarmIndicatorKind) => {
    if (next === indicator) return
    const free =
      conditionsFor(next).find((item) => !takenBy(next, item.id, null)) ?? conditionsFor(next)[0]
    setIndicator(next)
    setCondition(free.id)
    setParams(paramsAsText(free.id))
  }
  const chooseCondition = (next: AlarmConditionId) => {
    const previous = spec.params
    const defaults = defaultParams(next)
    setCondition(next)
    setParams((current) =>
      Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => {
          // Keep a number the trader already typed when the new condition uses the same input.
          const carried = previous.some((param) => param.id === key) ? current[key] : undefined
          return [key, carried ?? textOf(value)]
        }),
      ),
    )
  }
  const addLeg = () => {
    const next = ALARM_INDICATORS.find((kind) => !families.includes(kind) && !blockedForLeg(kind))
    if (!next) return
    const condition2 = conditionsFor(next).find((item) => !takenBy(next, item.id, null))!
    legKey.current += 1
    setLegs((current) => [
      ...current,
      {
        key: legKey.current,
        indicator: next,
        condition: condition2.id,
        params: paramsAsText(condition2.id),
      },
    ])
  }
  const chooseLegIndicator = (index: number, next: AlarmIndicatorKind) => {
    if (next === legs[index].indicator) return
    const free =
      conditionsFor(next).find((item) => !takenBy(next, item.id, index)) ?? conditionsFor(next)[0]
    setLegs((current) =>
      current.map((leg, i) =>
        i === index
          ? { ...leg, indicator: next, condition: free.id, params: paramsAsText(free.id) }
          : leg,
      ),
    )
  }
  const chooseLegCondition = (index: number, next: AlarmConditionId) => {
    const previous = conditionSpec(legs[index].condition).params
    const defaults = defaultParams(next)
    setLegs((current) =>
      current.map((leg, i) =>
        i === index
          ? {
              ...leg,
              condition: next,
              params: Object.fromEntries(
                Object.entries(defaults).map(([key, value]) => {
                  const carried = previous.some((param) => param.id === key)
                    ? leg.params[key]
                    : undefined
                  return [key, carried ?? textOf(value)]
                }),
              ),
            }
          : leg,
      ),
    )
  }
  const number = (value: string, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  /** The alarm as configured right now — also what the preview evaluates. */
  const draft = useMemo((): IndicatorAlarm => {
    const base = newIndicatorAlarm({
      id: 'preview',
      symbol,
      timeframe,
      indicator,
      createdAt: new Date().toISOString(),
    })
    return {
      ...base,
      condition,
      params: Object.fromEntries(
        spec.params.map((param) => [param.id, number(params[param.id] ?? '', param.default)]),
      ),
      ...(legs.length
        ? {
            also: legs.map((leg) => ({
              indicator: leg.indicator,
              condition: leg.condition,
              params: Object.fromEntries(
                conditionSpec(leg.condition).params.map((param) => [
                  param.id,
                  number(leg.params[param.id] ?? '', param.default),
                ]),
              ),
            })),
            match,
          }
        : {}),
      rsi: { period: number(rsiPeriod, 14) },
      macd: {
        fast: number(macd.fast, CM_MACD_DEFAULTS.fastLength),
        slow: number(macd.slow, CM_MACD_DEFAULTS.slowLength),
        signal: number(macd.signal, CM_MACD_DEFAULTS.signalLength),
      },
      cmMacd: {
        ...CM_MACD_DEFAULTS,
        fastLength: number(macd.fast, CM_MACD_DEFAULTS.fastLength),
        slowLength: number(macd.slow, CM_MACD_DEFAULTS.slowLength),
        signalLength: number(macd.signal, CM_MACD_DEFAULTS.signalLength),
      },
      williamsVixFix: {
        ...CM_WILLIAMS_VIX_FIX_DEFAULTS,
        pd: number(vixFix.pd, CM_WILLIAMS_VIX_FIX_DEFAULTS.pd),
        bbl: number(vixFix.bbl, CM_WILLIAMS_VIX_FIX_DEFAULTS.bbl),
        mult: number(vixFix.mult, CM_WILLIAMS_VIX_FIX_DEFAULTS.mult),
        lb: number(vixFix.lb, CM_WILLIAMS_VIX_FIX_DEFAULTS.lb),
        ph: number(vixFix.ph, CM_WILLIAMS_VIX_FIX_DEFAULTS.ph),
        pl: number(vixFix.pl, CM_WILLIAMS_VIX_FIX_DEFAULTS.pl),
      },
      sound,
      repeat,
      bars,
      note: note.trim(),
    }
  }, [
    symbol,
    timeframe,
    indicator,
    condition,
    params,
    legs,
    match,
    macd,
    rsiPeriod,
    vixFix,
    sound,
    repeat,
    bars,
    note,
    spec,
  ])
  const preview = useMemo(() => {
    if (!onChart || candles.length < 2) return null
    const source2 = bars === 'closed' ? closedCandles(candles, timeframe) : candles
    if (source2.length < 2) return null
    return evaluateIndicatorAlarm(draft, alarmSeries(source2, draft))
  }, [onChart, candles, draft, bars, timeframe])
  const testSound = () => {
    primeAlarmAudio()
    const played = playAlarmChime(chime)
    setSoundReport(
      played
        ? `Played ${chimeHint[chime]}.`
        : alarmAudioAvailable()
          ? 'The browser blocked audio until you interact with the page.'
          : 'This browser cannot play the alarm chime.',
    )
  }
  const submit = () => {
    const checkEntry = (
      id: AlarmConditionId,
      values: Record<string, string>,
      prefix: string,
    ): string | null => {
      for (const param of conditionSpec(id).params) {
        const value = Number(values[param.id])
        if (!Number.isFinite(value) || value < param.min || value > param.max) {
          return `${prefix}${param.label} must be between ${param.min} and ${param.max}.`
        }
      }
      return null
    }
    const problems = [
      checkEntry(condition, params, ''),
      ...legs.map((leg, index) =>
        checkEntry(leg.condition, leg.params, `Condition ${index + 2}: `),
      ),
    ]
    const problem = problems.find((item): item is string => item !== null)
    if (problem) {
      setError(problem)
      return
    }
    if (macdFamily) {
      const lengths = Object.values(macd).map(Number)
      if (lengths.some((value) => !Number.isInteger(value) || value < 1 || value > 2000)) {
        setError('MACD lengths must be whole numbers between 1 and 2000.')
        return
      }
    }
    if (families.includes('rsi')) {
      const period = Number(rsiPeriod)
      if (!Number.isInteger(period) || period < 1 || period > 2000) {
        setError('The RSI length must be a whole number between 1 and 2000.')
        return
      }
    }
    if (families.includes('cm-williams-vix-fix')) {
      const values = Object.values(vixFix).map(Number)
      if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 2000)) {
        setError('Every VIX Fix input must be a positive number.')
        return
      }
    }
    onCreate({ ...draft, createdAt: new Date().toISOString() })
  }
  const legSpec = (leg: DraftLeg) => conditionSpec(leg.condition)
  return (
    <Modal
      title="Build the trigger you actually want."
      eyebrow="CUSTOM INDICATOR ALARM"
      description="Pick an indicator, pick the moment — and chain up to four conditions into one alarm. Atlas watches it on the chart in front of you, or on any pair you name."
      className="alarm-modal"
      onClose={onClose}
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" form="indicator-alarm-form">
            <BellRing size={14} />
            Create alarm
          </button>
        </>
      }
    >
      <form
        id="indicator-alarm-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <label className="field">
            Market · {source === 'demo' ? 'demo instruments' : 'live venue'}
            <select
              value={symbol}
              onChange={(event) => {
                const next = event.target.value
                setSymbol(next)
                if (isMetalSymbol(next) && !isMetalInterval(timeframe)) setTimeframe('15m')
              }}
            >
              <optgroup label="This chart">
                <option value={chartSymbol}>
                  {chartSymbol} · {chartTimeframe}
                </option>
              </optgroup>
              <optgroup label="Every market">
                {assets
                  .filter((item) => item.symbol !== chartSymbol)
                  .map((item) => (
                    <option key={item.symbol} value={item.symbol}>
                      {item.symbol} · {item.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <label className="field" htmlFor="alarm-timeframe">
            Timeframe
            <select
              id="alarm-timeframe"
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as Timeframe)}
            >
              {timeframes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        {metal && (
          <div className="info-box">
            <Info size={16} />
            <span>
              Kalshi publishes silver once per quarter hour, so alarms on {symbol} start at 15m.
            </span>
          </div>
        )}
        <div className="alarm-indicator-picker" role="group" aria-label="Indicator">
          {ALARM_INDICATORS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={kind === indicator ? 'active' : ''}
              aria-pressed={kind === indicator}
              disabled={blockedForPrimary(kind)}
              title={blockedForPrimary(kind) ? 'One MACD flavour per alarm' : undefined}
              onClick={() => chooseIndicator(kind)}
            >
              {ALARM_INDICATOR_LABELS[kind]}
            </button>
          ))}
        </div>
        <label className="field" htmlFor="alarm-condition">
          What should trigger it?
          <select
            id="alarm-condition"
            value={condition}
            onChange={(event) => chooseCondition(event.target.value as AlarmConditionId)}
          >
            {[...new Set(offered.map((item) => item.group))].map((group) => (
              <optgroup label={group} key={group}>
                {offered
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="alarm-condition-copy">{spec.description}</p>
        {spec.params.length > 0 && (
          <div className="form-grid">
            {spec.params.map((param) => (
              <label className="field" key={param.id} htmlFor={`alarm-param-${param.id}`}>
                {param.label}
                <input
                  id={`alarm-param-${param.id}`}
                  type="number"
                  value={params[param.id] ?? ''}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(event) =>
                    setParams((current) => ({ ...current, [param.id]: event.target.value }))
                  }
                  required
                />
              </label>
            ))}
          </div>
        )}
        <div className="alarm-combo">
          <div className="row between alarm-combo-head">
            <div>
              <strong>Combine it with more conditions</strong>
              <span>
                {legs.length === 0
                  ? 'Optional — gate this alarm on another indicator on the same bar.'
                  : `${legs.length + 1} conditions in one alarm.`}
              </span>
            </div>
            <button
              type="button"
              id="alarm-add-leg"
              className="button button-quiet"
              disabled={!canAdd}
              title={canAdd ? undefined : ALARM_ENTRY_LIMIT_MESSAGE}
              onClick={addLeg}
            >
              <Plus size={13} />
              Add condition
            </button>
          </div>
          {legs.length > 0 && (
            <>
              <div className="alarm-match" role="group" aria-label="How the conditions combine">
                {ALARM_MATCHES.map((option) => (
                  <button
                    type="button"
                    key={option}
                    id={`alarm-match-${option}`}
                    className={match === option ? 'active' : ''}
                    aria-pressed={match === option}
                    onClick={() => setMatch(option)}
                  >
                    {option === 'all' ? 'All of them' : 'Any of them'}
                  </button>
                ))}
              </div>
              <p className="alarm-condition-copy">
                {match === 'all'
                  ? 'Every condition has to be true on the same bar before the alarm fires.'
                  : 'The alarm fires when any one of these conditions becomes true.'}
              </p>
              {legs.map((leg, index) => (
                <div className="alarm-leg" key={leg.key}>
                  <div className="row between alarm-leg-head">
                    <span>Condition {index + 2}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove condition ${index + 2}`}
                      onClick={() => setLegs((current) => current.filter((_, i) => i !== index))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field" htmlFor={`alarm-extra-${index}-indicator`}>
                      Indicator
                      <select
                        id={`alarm-extra-${index}-indicator`}
                        value={leg.indicator}
                        onChange={(event) =>
                          chooseLegIndicator(index, event.target.value as AlarmIndicatorKind)
                        }
                      >
                        {ALARM_INDICATORS.filter((kind) => !blockedForLeg(kind, index)).map(
                          (kind) => (
                            <option key={kind} value={kind}>
                              {ALARM_INDICATOR_LABELS[kind]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="field" htmlFor={`alarm-extra-${index}-condition`}>
                      Condition
                      <select
                        id={`alarm-extra-${index}-condition`}
                        value={leg.condition}
                        onChange={(event) =>
                          chooseLegCondition(index, event.target.value as AlarmConditionId)
                        }
                      >
                        {conditionsFor(leg.indicator)
                          .filter((item) => !takenBy(leg.indicator, item.id, index))
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <p className="alarm-condition-copy quiet">{legSpec(leg).description}</p>
                  {legSpec(leg).params.length > 0 && (
                    <div className="form-grid">
                      {legSpec(leg).params.map((param) => (
                        <label
                          className="field"
                          key={param.id}
                          htmlFor={`alarm-extra-${index}-param-${param.id}`}
                        >
                          {param.label}
                          <input
                            id={`alarm-extra-${index}-param-${param.id}`}
                            type="number"
                            value={leg.params[param.id] ?? ''}
                            min={param.min}
                            max={param.max}
                            step={param.step}
                            onChange={(event) =>
                              setLegs((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        params: {
                                          ...item.params,
                                          [param.id]: event.target.value,
                                        },
                                      }
                                    : item,
                                ),
                              )
                            }
                            required
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        {families.includes('cm-williams-vix-fix') && (
          <div className="form-grid">
            {WVF_FIELDS.map(([key, label]) => (
              <label className="field" key={key} htmlFor={`alarm-wvf-${key}`}>
                {label}
                <input
                  id={`alarm-wvf-${key}`}
                  type="number"
                  value={vixFix[key]}
                  min="0.01"
                  max="2000"
                  step="any"
                  onChange={(event) =>
                    setVixFix((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        )}
        {families.includes('rsi') && (
          <label className="field" htmlFor="alarm-rsi-period">
            RSI length
            <input
              id="alarm-rsi-period"
              type="number"
              value={rsiPeriod}
              min="1"
              max="2000"
              step="1"
              onChange={(event) => setRsiPeriod(event.target.value)}
            />
          </label>
        )}
        {macdFamily && (
          <div className="form-grid">
            {MACD_FIELDS.map(([key, label]) => (
              <label className="field" key={key} htmlFor={`alarm-macd-${key}`}>
                {label}
                <input
                  id={`alarm-macd-${key}`}
                  type="number"
                  value={macd[key]}
                  min="1"
                  max="2000"
                  step="1"
                  onChange={(event) =>
                    setMacd((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        )}
        {macdFamily === 'macd' && (
          <p className="alarm-condition-copy quiet">
            The classic MACD pane has no colour change, so green and red here mean the MACD line
            above or below its signal line. Signal is an EMA of the MACD line, exactly as the pane
            plots it.
          </p>
        )}
        {macdFamily === 'cm-ult-macd' && (
          <p className="alarm-condition-copy quiet">
            CM's maths — Pine's seeded EMA plus an SMA signal — evaluated at this alarm's own
            timeframe ({timeframe}), whatever the chart is showing.
          </p>
        )}
        <div className="form-grid">
          <label className="field" htmlFor="alarm-repeat">
            Re-arm
            <select
              id="alarm-repeat"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as IndicatorAlarm['repeat'])}
            >
              <option value="bar">Every new bar that satisfies it</option>
              <option value="once">Once, then pause the alarm</option>
            </select>
          </label>
          <label className="field" htmlFor="alarm-bars">
            Evaluate
            <select
              id="alarm-bars"
              value={bars}
              onChange={(event) => setBars(event.target.value as IndicatorAlarm['bars'])}
            >
              <option value="forming">Forming bar — fastest, can repaint</option>
              <option value="closed">Closed bars only — confirmed</option>
            </select>
          </label>
        </div>
        <div className="alert-delivery">
          <Volume2 size={16} />
          <div>
            <strong>In-app notification {sound ? '+ chime' : 'only'}</strong>
            <span>
              {chimeHint[chime]} ·{' '}
              {sound ? 'sound is on for this alarm' : 'this alarm stays silent'}
            </span>
          </div>
          <Toggle label="Play the alarm chime" checked={sound} onChange={setSound} />
        </div>
        <div className="row between alarm-sound-test">
          <button type="button" className="button button-quiet" onClick={testSound}>
            <Wand2 size={13} />
            Test the chime
          </button>
          {soundReport && <span className="alarm-sound-report">{soundReport}</span>}
        </div>
        <label className="field" htmlFor="alarm-note">
          A note to your future self <span className="optional">Optional</span>
          <input
            id="alarm-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={120}
            placeholder="e.g. Only take the cross if it is above the 200 EMA"
          />
        </label>
        <div className="alarm-preview">
          <div className="alarm-preview-head">
            <BellRing size={15} />
            <div>
              <strong>{alarmIndicatorLabel(draft)}</strong>
              <span>{alarmHeadline(draft)}</span>
            </div>
          </div>
          {preview ? (
            <>
              <div className="alarm-preview-reading mono">{preview.reading}</div>
              <p>{preview.detail}</p>
              <span className="alarm-preview-foot">
                Live from the open chart's {timeframe} candles
                {bars === 'forming' ? ' · forming bar included' : ' · closed bars only'}
              </span>
            </>
          ) : (
            <p>
              {onChart
                ? 'Waiting for the chart to load candles before showing the live reading.'
                : `Not the open chart: Atlas polls ${symbol} ${timeframe} in the background every ${Math.round(ALARM_POLL_MS / 1000)} seconds instead.`}
            </p>
          )}
        </div>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
        <div className="info-box">
          <Info size={16} />
          <span>
            {connected
              ? 'Alarms pause while replaying or disconnected, fire once per bar, and place no orders.'
              : `The market feed is not live right now. This alarm is saved and starts watching as soon as ${source === 'demo' ? 'the demo tape reconnects' : 'the venue reconnects'}.`}
          </span>
        </div>
      </form>
    </Modal>
  )
}
