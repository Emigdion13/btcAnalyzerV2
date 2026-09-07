import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWorkspaceBackup, persistWorkspaceBackup } from './workspace-backup'
import type { WorkspaceBackup } from './workspace-backup'
import { DEFAULT_INDICATORS, DEFAULT_SETTINGS, SMC_DEFAULTS } from './types'
import { CM_MACD_DEFAULTS } from './cm-ult-macd'

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
  it('round-trips every CM input including false switches and independent lengths', () => {
    const saved = backup()
    const indicator = saved.indicators.find((i) => i.kind === 'cm-ult-macd')!
    indicator.period = 8
    indicator.visible = false
    indicator.cmMacd = {
      useCurrentRes: false,
      resCustom: '4h',
      fastLength: 8,
      slowLength: 33,
      signalLength: 5,
      showLines: false,
      showDots: false,
      showHistogram: false,
      macdColorChange: false,
      histogramColorChange: false,
    }
    expect(parseWorkspaceBackup(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it('rejects malformed CM inputs and strips unrecognized properties on import', () => {
    const original = backup()
    const originalIndicator = original.indicators.find((i) => i.kind === 'cm-ult-macd')!
    for (const cmMacd of [
      [],
      {},
      { ...CM_MACD_DEFAULTS, useCurrentRes: 'false' },
      { ...CM_MACD_DEFAULTS, fastLength: 0 },
      { ...CM_MACD_DEFAULTS, slowLength: 2.4 },
      { ...CM_MACD_DEFAULTS, signalLength: 2001 },
      { ...CM_MACD_DEFAULTS, resCustom: '60' },
    ]) {
      expect(() =>
        parseWorkspaceBackup({ ...original, indicators: [{ ...originalIndicator, cmMacd }] }),
      ).toThrow(/CM_Ult_MacD_MTF/)
    }
    const clean = parseWorkspaceBackup({
      ...original,
      indicators: [{ ...originalIndicator, cmMacd: { ...CM_MACD_DEFAULTS, extra: 'ignored' } }],
    })
    expect(clean.indicators[0].cmMacd).toEqual(CM_MACD_DEFAULTS)
  })
  it('round-trips each Smart Money Concepts input and rejects malformed values', () => {
    const saved = backup()
    const indicator = saved.indicators.find((i) => i.kind === 'smart-money-concepts')!
    indicator.period = 22
    indicator.visible = false
    indicator.smc = {
      ...SMC_DEFAULTS,
      mode: 'Present',
      style: 'Monochrome',
      colorCandles: true,
      confluenceFilter: true,
      showSwingPoints: true,
      showStrongWeakHighsLows: true,
      swingLength: 22,
      showSwingOrderBlocks: true,
      orderBlockFilter: 'Cumulative Mean Range',
      orderBlockMitigation: 'Close',
      highlightMitigatedBlocks: false,
      equalHighLowBars: 4,
      equalHighLowThreshold: 0.2,
      equalHighLowLabelSize: 'Normal',
      showFairValueGaps: true,
      fvgAutoThreshold: false,
      fvgTimeframe: '4h',
      fvgExtend: 12,
      showDailyHighLow: true,
      dailyLineStyle: '----',
      showWeeklyHighLow: true,
      weeklyLineStyle: '····',
      showMonthlyHighLow: true,
      showPremiumDiscount: true,
    }
    indicator.period = indicator.smc.swingLength
    expect(parseWorkspaceBackup(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    expect(() =>
      parseWorkspaceBackup({
        ...backup(),
        indicators: [{ ...indicator, smc: { ...indicator.smc, fvgExtend: 0 } }],
      }),
    ).toThrow(/Smart Money Concepts/)
    const clean = parseWorkspaceBackup({
      ...backup(),
      indicators: [{ ...indicator, smc: { ...indicator.smc, extra: 'ignored' } }],
    })
    expect(clean.indicators[0].smc).toEqual(indicator.smc)
  })
  it('round-trips each SR Breaks and Retests input and rejects malformed values', () => {
    const saved = backup()
    saved.indicators.push({
      id: 'sr',
      kind: 'sr-breaks-retests',
      name: 'SR Breaks and Retests',
      period: 12,
      color: '#4caf50',
      visible: false,
      sr: { lookbackPeriod: 12, volumeFilterLength: 4, boxWidth: 0.5 },
    })
    expect(parseWorkspaceBackup(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    for (const invalid of [
      { lookbackPeriod: 0, volumeFilterLength: 4, boxWidth: 0.5 },
      { lookbackPeriod: 2.5, volumeFilterLength: 4, boxWidth: 0.5 },
      { lookbackPeriod: 12, volumeFilterLength: 0, boxWidth: 0.5 },
      { lookbackPeriod: 12, volumeFilterLength: 4, boxWidth: -0.1 },
      { lookbackPeriod: 12, volumeFilterLength: 4, boxWidth: 1001 },
    ])
      expect(() =>
        parseWorkspaceBackup({
          ...backup(),
          indicators: [
            {
              id: 'sr',
              kind: 'sr-breaks-retests',
              name: 'SR Breaks and Retests',
              period: 20,
              color: '#4caf50',
              visible: true,
              sr: invalid,
            },
          ],
        }),
      ).toThrow(/SR Breaks and Retests/)
    const clean = parseWorkspaceBackup({
      ...backup(),
      indicators: [
        {
          ...saved.indicators.at(-1)!,
          sr: { ...saved.indicators.at(-1)!.sr!, extra: 'ignored' },
        },
      ],
    })
    expect(clean.indicators[0].sr).toEqual({
      lookbackPeriod: 12,
      volumeFilterLength: 4,
      boxWidth: 0.5,
    })
    expect(clean.indicators[0].period).toBe(12)
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
