import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWorkspaceBackup, persistWorkspaceBackup } from './workspace-backup'
import type { WorkspaceBackup } from './workspace-backup'
import { DEFAULT_INDICATORS, DEFAULT_SETTINGS } from './types'

function backup(): WorkspaceBackup {
  return {
    version: 1,
    exportedAt: '2026-09-07T00:00:00.000Z',
    workspaceName: 'My workspace',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    chartType: 'candles',
    settings: { ...DEFAULT_SETTINGS },
    watchlist: ['BTCUSDT', 'ETHUSDT'],
    tabs: ['BTCUSDT'],
    indicators: DEFAULT_INDICATORS.map((i) => ({ ...i })),
    drawings: {},
    scripts: [],
    draft: { id: 'draft', name: 'Test', source: 'plot(close);' },
    alerts: [],
    notes: 'Risk first.',
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('workspace backups', () => {
  it('round-trips a complete workspace', () =>
    expect(parseWorkspaceBackup(JSON.parse(JSON.stringify(backup())))).toEqual(backup()))
  it('rejects unsupported versions and unknown symbols', () => {
    expect(() => parseWorkspaceBackup({ ...backup(), version: 99 })).toThrow(/version/)
    expect(() => parseWorkspaceBackup({ ...backup(), symbol: 'NOTREAL' })).toThrow(/symbol/)
  })
  it('rejects duplicate IDs, invalid periods, and colors', () => {
    const duplicate = backup()
    duplicate.indicators.push(duplicate.indicators[0])
    expect(() => parseWorkspaceBackup(duplicate)).toThrow(/duplicate/)
    const period = backup()
    period.indicators[0].period = 0
    expect(() => parseWorkspaceBackup(period)).toThrow(/period/)
    expect(() =>
      parseWorkspaceBackup({
        ...backup(),
        settings: { ...DEFAULT_SETTINGS, upColor: 'url(https://example.com)' },
      }),
    ).toThrow(/color/)
  })
  it('rejects oversized scripts, unknown drawing groups, and bad alert dates', () => {
    const large = backup()
    large.draft.source = 'x'.repeat(40001)
    expect(() => parseWorkspaceBackup(large)).toThrow(/source/)
    expect(() => parseWorkspaceBackup({ ...backup(), drawings: { '__proto__:1h': [] } })).toThrow(
      /drawing group/,
    )
    const alerts = [
      {
        id: 'alert',
        symbol: 'BTCUSDT',
        condition: 'above',
        price: 65000,
        note: '',
        enabled: true,
        createdAt: 'not a date',
      },
    ]
    expect(() => parseWorkspaceBackup({ ...backup(), alerts })).toThrow(/date/)
  })
  it('writes the complete workspace and rolls back a failed import', () => {
    const data = new Map<string, string>([
      ['atlas.v1.workspace-name', '"Original"'],
      ['atlas.v1.symbol', '"ETHUSDT"'],
    ])
    const original = new Map(data)
    let calls = 0
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => {
        if (++calls === 3) throw new Error('Quota')
        data.set(key, value)
      },
    })
    expect(() => persistWorkspaceBackup(backup())).toThrow(/storage/)
    expect(data).toEqual(original)
    persistWorkspaceBackup(backup())
    expect(data.get('atlas.v1.notes')).toBe('"Risk first."')
    expect(data.get('atlas.v1.workspace-name')).toBe('"My workspace"')
  })
})
