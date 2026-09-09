import { INTERVAL_SECONDS, type DataSource } from '../../shared/coinbase'
import {
  actualBiasFromOutcome,
  defaultAgentLearningState,
  learnFromOutcome,
  type AgentLearningState,
  type MarketAnalysis,
} from './market-agents'
import { uid } from './storage'
import type { Candle, Timeframe } from './types'

export interface AgentPredictionJournalEntry {
  id: string
  source: DataSource
  symbol: string
  timeframe: Timeframe
  createdAt: string
  candleTime: number
  entryPrice: number
  horizonBars: number
  targetTime: number
  regime: MarketAnalysis['regime']
  bias: MarketAnalysis['bias']
  confidence: number
  score: number
  reasons: string[]
  learningRecord: MarketAnalysis['learningRecord']
  resolvedAt?: string
  resolvedPrice?: number
  move?: number
  actualBias?: MarketAnalysis['bias']
  result?: 'correct' | 'wrong' | 'flat'
}

export interface AgentPredictionJournal {
  version: 1
  updatedAt: string
  autoJournal: boolean
  entries: AgentPredictionJournalEntry[]
}

export interface JournalStats {
  total: number
  pending: number
  resolved: number
  correct: number
  wrong: number
  flat: number
  winRate: number | null
}

const MAX_JOURNAL_ENTRIES = 500
const HORIZON_BARS: Record<Timeframe, number> = {
  '1m': 8,
  '3m': 8,
  '5m': 6,
  '15m': 6,
  '1h': 4,
  '4h': 3,
  '1D': 3,
  '1W': 2,
}

const CONTEXT_TIMEFRAMES: Record<Timeframe, Timeframe[]> = {
  '1m': ['5m', '15m'],
  '3m': ['15m', '1h'],
  '5m': ['15m', '1h'],
  '15m': ['1h', '4h'],
  '1h': ['4h', '1D'],
  '4h': ['1D', '1W'],
  '1D': ['1W'],
  '1W': [],
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const last = <T>(values: T[]) => values[values.length - 1]

export function defaultAgentPredictionJournal(): AgentPredictionJournal {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    autoJournal: true,
    entries: [],
  }
}

export function suggestedHorizonBars(timeframe: Timeframe): number {
  return HORIZON_BARS[timeframe]
}

export function horizonChoices(timeframe: Timeframe): number[] {
  const base = suggestedHorizonBars(timeframe)
  return [...new Set([Math.max(1, Math.round(base / 2)), base, Math.min(24, base * 2)])].sort(
    (a, b) => a - b,
  )
}

export function agentContextTimeframes(timeframe: Timeframe): Timeframe[] {
  return [...CONTEXT_TIMEFRAMES[timeframe]]
}

export function journalStats(journal: AgentPredictionJournal): JournalStats {
  const stats: JournalStats = {
    total: journal.entries.length,
    pending: 0,
    resolved: 0,
    correct: 0,
    wrong: 0,
    flat: 0,
    winRate: null,
  }
  for (const entry of journal.entries) {
    if (!entry.resolvedAt) {
      stats.pending++
      continue
    }
    stats.resolved++
    if (entry.result === 'correct') stats.correct++
    else if (entry.result === 'wrong') stats.wrong++
    else stats.flat++
  }
  const decisive = stats.correct + stats.wrong
  stats.winRate = decisive > 0 ? stats.correct / decisive : null
  return stats
}

export function recordAgentPrediction(
  journal: AgentPredictionJournal,
  params: {
    source: DataSource
    symbol: string
    timeframe: Timeframe
    candles: Candle[]
    analysis: MarketAnalysis
    horizonBars?: number
  },
): AgentPredictionJournal {
  if (!journal.autoJournal || params.candles.length < 2) return journal
  const anchor = last(params.candles)
  const horizonBars = Math.max(1, Math.round(params.horizonBars ?? suggestedHorizonBars(params.timeframe)))
  const targetTime = anchor.time + horizonBars * INTERVAL_SECONDS[params.timeframe]
  const duplicate = journal.entries.some(
    (entry) =>
      entry.source === params.source &&
      entry.symbol === params.symbol &&
      entry.timeframe === params.timeframe &&
      entry.candleTime === anchor.time &&
      entry.horizonBars === horizonBars,
  )
  if (duplicate) return journal
  const nextEntry: AgentPredictionJournalEntry = {
    id: uid(),
    source: params.source,
    symbol: params.symbol,
    timeframe: params.timeframe,
    createdAt: new Date(anchor.time * 1000).toISOString(),
    candleTime: anchor.time,
    entryPrice: anchor.close,
    horizonBars,
    targetTime,
    regime: params.analysis.regime,
    bias: params.analysis.bias,
    confidence: params.analysis.confidence,
    score: params.analysis.score,
    reasons: params.analysis.reasons.slice(0, 3),
    learningRecord: params.analysis.learningRecord,
  }
  return {
    ...journal,
    updatedAt: new Date().toISOString(),
    entries: [...journal.entries, nextEntry].slice(-MAX_JOURNAL_ENTRIES),
  }
}

function classifyResult(predicted: MarketAnalysis['bias'], actual: MarketAnalysis['bias']) {
  if (predicted === actual) return 'correct' as const
  if (actual === 'neutral') return 'flat' as const
  return 'wrong' as const
}

export function resolveAgentPredictionJournal(
  journal: AgentPredictionJournal,
  learning: AgentLearningState,
  params: {
    source: DataSource
    symbol: string
    timeframe: Timeframe
    candles: Candle[]
    flatThreshold?: number
  },
): {
  journal: AgentPredictionJournal
  learning: AgentLearningState
  resolved: AgentPredictionJournalEntry[]
} {
  if (!journal.entries.length || !params.candles.length) return { journal, learning, resolved: [] }
  const resolved: AgentPredictionJournalEntry[] = []
  let nextLearning = learning
  let changed = false
  const entries = journal.entries.map((entry) => {
    if (
      entry.resolvedAt ||
      entry.source !== params.source ||
      entry.symbol !== params.symbol ||
      entry.timeframe !== params.timeframe
    )
      return entry
    const resolutionCandle = params.candles.find((candle) => candle.time >= entry.targetTime)
    if (!resolutionCandle) return entry
    const move = (resolutionCandle.close - entry.entryPrice) / Math.max(entry.entryPrice, 1e-9)
    const actualBias = actualBiasFromOutcome({ move, flatThreshold: params.flatThreshold })
    const resolvedEntry: AgentPredictionJournalEntry = {
      ...entry,
      resolvedAt: new Date(resolutionCandle.time * 1000).toISOString(),
      resolvedPrice: resolutionCandle.close,
      move,
      actualBias,
      result: classifyResult(entry.bias, actualBias),
    }
    nextLearning = learnFromOutcome(nextLearning, entry.learningRecord, {
      move,
      flatThreshold: params.flatThreshold,
    })
    resolved.push(resolvedEntry)
    changed = true
    return resolvedEntry
  })
  if (!changed) return { journal, learning, resolved: [] }
  return {
    journal: {
      ...journal,
      updatedAt: new Date().toISOString(),
      entries: entries.slice(-MAX_JOURNAL_ENTRIES),
    },
    learning: nextLearning,
    resolved,
  }
}

export function journalPreview(entry: AgentPredictionJournalEntry): string {
  const outcome = entry.actualBias ? ` → ${entry.actualBias}` : ''
  return `${entry.symbol} ${entry.timeframe} ${entry.bias}${outcome}`
}

export function normalizeAgentLearningState(value: unknown): AgentLearningState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultAgentLearningState()
  const raw = value as Partial<AgentLearningState>
  if (raw.version !== 1 || !raw.agents || typeof raw.agents !== 'object') return defaultAgentLearningState()
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    agents: raw.agents,
  }
}

export function normalizeAgentPredictionJournal(value: unknown): AgentPredictionJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultAgentPredictionJournal()
  const raw = value as Partial<AgentPredictionJournal>
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(
        (entry): entry is AgentPredictionJournalEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.symbol === 'string' &&
          typeof entry.timeframe === 'string' &&
          typeof entry.candleTime === 'number' &&
          typeof entry.entryPrice === 'number' &&
          typeof entry.horizonBars === 'number',
      )
    : []
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    autoJournal: raw.autoJournal !== false,
    entries: entries.slice(-MAX_JOURNAL_ENTRIES),
  }
}

export function learningHeadline(learning: AgentLearningState, agentId: keyof AgentLearningState['agents']) {
  const entry = learning.agents[agentId]
  if (!entry) return 'No settled outcomes yet.'
  const skill = clamp(entry.overall.skill, 0, 1)
  const samples = entry.overall.samples
  return `${Math.round(skill * 100)}% skill · ${samples} settled ${samples === 1 ? 'sample' : 'samples'}`
}
