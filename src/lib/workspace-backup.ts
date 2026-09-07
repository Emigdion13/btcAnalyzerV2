import { ASSETS, TIMEFRAMES } from './market'
import { isProductId } from '../../shared/coinbase'
import { isCmMacdSettings } from './cm-ult-macd'
import { isSmartMoneyConceptsSettings } from './smart-money-concepts'
import { isSrBreaksRetestsSettings } from './sr-breaks-retests'
import type { DataSource } from '../../shared/coinbase'
import type {
  ChartSettings,
  ChartType,
  Drawing,
  Indicator,
  PriceAlert,
  SavedScript,
  Timeframe,
} from './types'

export interface WorkspaceBackup {
  version: 1
  dataSource?: DataSource
  exportedAt: string
  workspaceName: string
  symbol: string
  timeframe: Timeframe
  chartType: ChartType
  settings: ChartSettings
  watchlist: string[]
  tabs: string[]
  indicators: Indicator[]
  drawings: Record<string, Drawing[]>
  scripts: SavedScript[]
  draft: { id: string; name: string; source: string }
  alerts: PriceAlert[]
  notes: string
}
const symbols = ASSETS.map((a) => a.symbol)
function validSymbol(value: unknown): value is string {
  return typeof value === 'string' && (symbols.includes(value) || isProductId(value))
}
function symbolValue(value: unknown, field: string): string {
  if (!validSymbol(value)) invalid(field)
  return value
}
function invalid(field: string): never {
  throw new Error(`Invalid workspace backup: ${field}.`)
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    invalid(field)
  return value
}
function number(value: unknown, field: string, min = -1e15, max = 1e15): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    invalid(field)
  return value
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field)
  return value
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(field)
  return value
}
function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(field)
  return value as T
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) invalid('color')
  return value
}
function date(value: unknown, field: string): string {
  const result = text(value, 40, field)
  if (!Number.isFinite(Date.parse(result))) invalid(field)
  return result
}
function unique<T>(items: T[], key: (item: T) => string, field: string): T[] {
  if (new Set(items.map(key)).size !== items.length) invalid(`duplicate ${field}`)
  return items
}
function script(value: unknown): SavedScript {
  const s = record(value, 'script')
  return {
    id: text(s.id, 100, 'script ID'),
    name: text(s.name, 60, 'script name'),
    source: text(s.source, 40000, 'script source', true),
    updatedAt: date(s.updatedAt, 'script date'),
  }
}
function indicator(value: unknown): Indicator {
  const i = record(value, 'indicator')
  const kind = choice(
    i.kind,
    [
      'ema',
      'sma',
      'bb',
      'rsi',
      'macd',
      'cm-ult-macd',
      'smart-money-concepts',
      'sr-breaks-retests',
      'vwap',
      'volume',
      'custom',
    ] as const,
    'indicator kind',
  )
  const period = number(i.period, 'indicator period', 1, 2000)
  if (!Number.isInteger(period)) invalid('indicator period must be an integer')
  const result: Indicator = {
    id: text(i.id, 100, 'indicator ID'),
    kind,
    name: text(i.name, 80, 'indicator name'),
    period,
    color: color(i.color),
    visible: boolean(i.visible, 'indicator visibility'),
  }
  if (kind === 'cm-ult-macd' && i.cmMacd !== undefined) {
    const settings = i.cmMacd
    if (!isCmMacdSettings(settings)) invalid('CM_Ult_MacD_MTF settings')
    result.cmMacd = {
      useCurrentRes: settings.useCurrentRes,
      resCustom: settings.resCustom,
      fastLength: settings.fastLength,
      slowLength: settings.slowLength,
      signalLength: settings.signalLength,
      showLines: settings.showLines,
      showDots: settings.showDots,
      showHistogram: settings.showHistogram,
      macdColorChange: settings.macdColorChange,
      histogramColorChange: settings.histogramColorChange,
    }
    result.period = result.cmMacd.fastLength
  }
  if (kind === 'smart-money-concepts' && i.smc !== undefined) {
    const settings = i.smc
    if (!isSmartMoneyConceptsSettings(settings)) invalid('Smart Money Concepts settings')
    result.smc = {
      mode: settings.mode,
      style: settings.style,
      colorCandles: settings.colorCandles,
      showInternal: settings.showInternal,
      internalBullish: settings.internalBullish,
      internalBearish: settings.internalBearish,
      internalLabelSize: settings.internalLabelSize,
      confluenceFilter: settings.confluenceFilter,
      showSwing: settings.showSwing,
      swingBullish: settings.swingBullish,
      swingBearish: settings.swingBearish,
      swingLabelSize: settings.swingLabelSize,
      showSwingPoints: settings.showSwingPoints,
      showStrongWeakHighsLows: settings.showStrongWeakHighsLows,
      swingLength: settings.swingLength,
      showInternalOrderBlocks: settings.showInternalOrderBlocks,
      internalOrderBlockCount: settings.internalOrderBlockCount,
      showSwingOrderBlocks: settings.showSwingOrderBlocks,
      swingOrderBlockCount: settings.swingOrderBlockCount,
      orderBlockFilter: settings.orderBlockFilter,
      orderBlockMitigation: settings.orderBlockMitigation,
      highlightMitigatedBlocks: settings.highlightMitigatedBlocks,
      showEqualHighLow: settings.showEqualHighLow,
      equalHighLowBars: settings.equalHighLowBars,
      equalHighLowThreshold: settings.equalHighLowThreshold,
      equalHighLowLabelSize: settings.equalHighLowLabelSize,
      showFairValueGaps: settings.showFairValueGaps,
      fvgAutoThreshold: settings.fvgAutoThreshold,
      fvgTimeframe: settings.fvgTimeframe,
      fvgExtend: settings.fvgExtend,
      showDailyHighLow: settings.showDailyHighLow,
      dailyLineStyle: settings.dailyLineStyle,
      showWeeklyHighLow: settings.showWeeklyHighLow,
      weeklyLineStyle: settings.weeklyLineStyle,
      showMonthlyHighLow: settings.showMonthlyHighLow,
      monthlyLineStyle: settings.monthlyLineStyle,
      showPremiumDiscount: settings.showPremiumDiscount,
    }
    result.period = result.smc.swingLength
  }
  if (kind === 'sr-breaks-retests' && i.sr !== undefined) {
    const settings = i.sr
    if (!isSrBreaksRetestsSettings(settings)) invalid('SR Breaks and Retests settings')
    result.sr = {
      lookbackPeriod: settings.lookbackPeriod,
      volumeFilterLength: settings.volumeFilterLength,
      boxWidth: settings.boxWidth,
    }
    result.period = result.sr.lookbackPeriod
  }
  if (kind === 'custom') {
    result.source = text(i.source, 40000, 'custom source', true)
    if (i.scriptId !== undefined) result.scriptId = text(i.scriptId, 100, 'script reference')
    if (i.inputValues !== undefined) {
      const values = Object.entries(record(i.inputValues, 'custom inputs'))
      if (values.length > 30) invalid('too many custom inputs')
      result.inputValues = Object.fromEntries(
        values.map(([key, value]) => [text(key, 80, 'input name'), number(value, 'input value')]),
      )
    }
  }
  return result
}
function drawing(value: unknown): Drawing {
  const d = record(value, 'drawing')
  const tool = choice(
    d.tool,
    ['trend', 'horizontal', 'rectangle', 'fibonacci', 'measure', 'text'] as const,
    'drawing tool',
  )
  const anchor = (value: unknown) => {
    const a = record(value, 'drawing anchor')
    return {
      time: number(a.time, 'drawing timestamp', -1e11, 1e11),
      price: number(a.price, 'drawing price'),
    }
  }
  const result: Drawing = {
    id: text(d.id, 100, 'drawing ID'),
    tool,
    start: anchor(d.start),
    color: color(d.color),
  }
  if (['trend', 'rectangle', 'fibonacci', 'measure'].includes(tool)) result.end = anchor(d.end)
  if (tool === 'text') result.text = text(d.text, 50, 'chart note')
  return result
}
function alert(value: unknown): PriceAlert {
  const a = record(value, 'alert')
  const result: PriceAlert = {
    id: text(a.id, 100, 'alert ID'),
    symbol: symbolValue(a.symbol, 'alert symbol'),
    condition: choice(a.condition, ['above', 'below'] as const, 'alert condition'),
    price: number(a.price, 'alert price', Number.MIN_VALUE, 1e12),
    note: text(a.note, 120, 'alert note', true),
    createdAt: date(a.createdAt, 'alert date'),
    enabled: boolean(a.enabled, 'alert state'),
  }
  if (a.triggeredAt !== undefined) result.triggeredAt = date(a.triggeredAt, 'alert trigger date')
  return result
}
export function parseWorkspaceBackup(value: unknown): WorkspaceBackup {
  const b = record(value, 'file contents')
  if (b.version !== 1) invalid('unsupported version')
  if (
    (b.dataSource === 'coinbase' && !isProductId(b.symbol)) ||
    (b.dataSource === 'demo' && !symbols.includes(String(b.symbol)))
  )
    invalid('data source does not match the active pair')
  const s = record(b.settings, 'chart settings')
  const settings: ChartSettings = {
    grid: boolean(s.grid, 'grid'),
    crosshair: boolean(s.crosshair, 'crosshair'),
    autoScale: boolean(s.autoScale, 'auto scale'),
    upColor: color(s.upColor),
    downColor: color(s.downColor),
    background: color(s.background),
    priceMode: choice(s.priceMode, ['normal', 'log', 'percent'] as const, 'price scale'),
  }
  const drawingEntries = Object.entries(record(b.drawings, 'drawings'))
  if (drawingEntries.length > 1000) invalid('too many drawing groups')
  const drawings = Object.fromEntries(
    drawingEntries.map(([key, value]) => {
      const [symbol, timeframe, ...extra] = key.split(':')
      if (extra.length || !validSymbol(symbol) || !TIMEFRAMES.includes(timeframe as Timeframe))
        invalid('drawing group')
      return [
        key,
        unique(array(value, 100, 'drawings per chart').map(drawing), (d) => d.id, 'drawing ID'),
      ]
    }),
  )
  const draft = record(b.draft, 'editor draft')
  const tabs = unique(
    array(b.tabs, 8, 'chart tabs').map((s) => symbolValue(s, 'tab symbol')),
    (s) => s,
    'chart tab',
  )
  if (!tabs.length) invalid('no open chart tabs')
  return {
    version: 1,
    ...(b.dataSource === undefined
      ? {}
      : { dataSource: choice(b.dataSource, ['coinbase', 'demo'] as const, 'data source') }),
    exportedAt: date(b.exportedAt, 'export date'),
    workspaceName: text(b.workspaceName, 48, 'workspace name'),
    symbol: symbolValue(b.symbol, 'active symbol'),
    timeframe: choice(b.timeframe, TIMEFRAMES, 'timeframe'),
    chartType: choice(
      b.chartType,
      ['candles', 'hollow', 'line', 'area', 'bars'] as const,
      'chart style',
    ),
    settings,
    watchlist: unique(
      array(b.watchlist, 60, 'watchlist').map((s) => symbolValue(s, 'watchlist symbol')),
      (s) => s,
      'watchlist symbol',
    ),
    tabs,
    indicators: unique(
      array(b.indicators, 16, 'indicators').map(indicator),
      (i) => i.id,
      'indicator ID',
    ),
    drawings,
    scripts: unique(array(b.scripts, 30, 'scripts').map(script), (s) => s.id, 'script ID'),
    draft: {
      id: text(draft.id, 100, 'draft ID'),
      name: text(draft.name, 60, 'draft name', true),
      source: text(draft.source, 40000, 'draft source', true),
    },
    alerts: unique(array(b.alerts, 50, 'alerts').map(alert), (a) => a.id, 'alert ID'),
    notes: text(b.notes, 50000, 'notes', true),
  }
}

/** Write a complete backup, rolling back if the browser rejects any write. */
export function persistWorkspaceBackup(backup: WorkspaceBackup): void {
  const entries: [string, unknown][] = [
    ['data-source', backup.dataSource ?? (isProductId(backup.symbol) ? 'coinbase' : 'demo')],
    ['workspace-name', backup.workspaceName],
    ['symbol', backup.symbol],
    ['timeframe', backup.timeframe],
    ['chart-type', backup.chartType],
    ['chart-settings', backup.settings],
    ['watchlist', backup.watchlist],
    ['tabs', backup.tabs],
    ['indicators', backup.indicators],
    ['drawings', backup.drawings],
    ['scripts', backup.scripts],
    ['draft', backup.draft],
    ['alerts', backup.alerts],
    ['notes', backup.notes],
  ]
  const previous = entries.map(([key]) => [key, localStorage.getItem(`atlas.v1.${key}`)] as const)
  try {
    for (const [key, value] of entries)
      localStorage.setItem(`atlas.v1.${key}`, JSON.stringify(value))
  } catch {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(`atlas.v1.${key}`)
        else localStorage.setItem(`atlas.v1.${key}`, value)
      } catch {
        /* Best effort if storage becomes completely unavailable. */
      }
    }
    throw new Error(
      'Not enough browser storage to import this workspace. Your previous workspace was retained where possible.',
    )
  }
}
