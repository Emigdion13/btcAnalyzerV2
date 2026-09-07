import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function getStored<T>(page: Page, key: string): Promise<T> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(`atlas.v1.${key}`) || 'null'), key)
}
async function draw(page: Page, name: string, twoPoints = true) {
  const chart = await page.getByTestId('chart-stage').boundingBox()
  if (!chart) throw new Error('Chart not mounted')
  await page.getByRole('button', { name, exact: true }).click()
  await page.mouse.click(chart.x + chart.width * 0.35, chart.y + chart.height * 0.46)
  if (twoPoints) await page.mouse.click(chart.x + chart.width * 0.6, chart.y + chart.height * 0.33)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?source=demo')
  await expect(page.locator('canvas').first()).toBeVisible()
})

test('switches symbols, timeframes, chart styles, and preserves preferences', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('tab', { name: /ETHUSDT/ }).click()
  await expect(page.locator('.symbol-heading')).toContainText('Ethereum')
  await page.getByRole('button', { name: '4h timeframe', exact: true }).click()
  await expect(page.locator('.symbol-heading')).toContainText('4h')
  await page.getByRole('button', { name: 'Choose chart style' }).click()
  await page.getByRole('button', { name: 'Area', exact: true }).click()
  await expect(page.getByRole('img', { name: /Ethereum 4h area chart/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('img', { name: /Ethereum 4h area chart/ })).toBeVisible()
  await page.getByRole('button', { name: 'Show 1M range', exact: true }).click()
  await expect(page.locator('.symbol-heading')).toContainText('1h')
  await expect(page.getByRole('button', { name: 'Show 1M range', exact: true })).toHaveClass(
    'active',
  )
  expect(errors).toEqual([])
})

test('searches, adds watchlist assets, and respects a shared chart URL', async ({ page }) => {
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: 'Search symbols' }).fill('aave')
  await expect(page.locator('.symbol-result')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add Aave to watchlist', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search symbols' }).press('Enter')
  await expect(page.locator('.symbol-heading')).toContainText('Aave')
  await expect(page.getByRole('button', { name: 'View Aave chart', exact: true })).toBeAttached()
  expect(await getStored<string[]>(page, 'watchlist')).toContain('AAVEUSDT')
  await page.goto('/?symbol=SOLUSDT&interval=4h&style=line')
  await expect(page.getByRole('img', { name: /Solana 4h line chart/ })).toBeVisible()
})

test('adds and customizes built-in indicators', async ({ page }) => {
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Bollinger')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'BB 20', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Length', exact: false }).fill('32')
  await page.getByRole('button', { name: 'Use #ad91e5', exact: true }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'BB 32', exact: true })).toBeVisible()
  const entries = await getStored<{ kind: string; period: number; color: string }[]>(
    page,
    'indicators',
  )
  expect(entries.find((i) => i.kind === 'bb')).toMatchObject({ period: 32, color: '#ad91e5' })
})

test('compiles custom indicators, saves scripts, and recovers from errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const source = page.getByRole('textbox', {
    name: 'Custom indicator JavaScript code',
    exact: true,
  })
  await page
    .getByRole('textbox', { name: 'Indicator script name', exact: true })
    .fill('My trend lens')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  await expect(page.locator('.indicator-legends')).toContainText('My trend lens')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(await getStored<{ name: string }[]>(page, 'scripts')).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'My trend lens' })]),
  )
  await source.fill('plot([1, 2], { title: "Bad length" });')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.editor-status')).toContainText('one value per candle')
  await expect(page.locator('.indicator-legends')).toContainText('My trend lens')
  await source.fill('plot(ta.sma(close, 12), { title: "SMA 12", color: "#b9ee82" });')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  const entries = await getStored<{ kind: string }[]>(page, 'indicators')
  expect(entries.filter((i) => i.kind === 'custom')).toHaveLength(1)
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('times out runaway scripts without blocking the interface', async ({ page }) => {
  await page
    .getByRole('textbox', { name: 'Custom indicator JavaScript code' })
    .fill('while (true) {}')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await page.getByRole('button', { name: 'Chart settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('switch', { name: 'Show grid lines', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Show grid lines', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.getByRole('button', { name: 'Done', exact: false }).click()
  await expect(page.locator('.editor-status')).toContainText('Execution stopped after 2 seconds')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page
    .getByRole('textbox', { name: 'Custom indicator JavaScript code' })
    .fill('plot(close, { title: "Recovered" });')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
})

test('keeps custom code away from application storage and network access', async ({ page }) => {
  let externalRequests = 0
  await page.route('https://example.com/**', (route) => {
    externalRequests++
    return route.abort()
  })
  const source = `
    try { indexedDB.open('atlas'); throw new Error('Storage was accessible'); }
    catch (error) { if (error.name !== 'SecurityError') throw error; }
    fetch('https://example.com/private-data').catch(() => {});
    if (typeof document !== 'undefined' || typeof localStorage !== 'undefined') throw new Error('Application globals leaked');
    plot(close, { title: 'Isolated plot' });
  `
  await page.getByRole('textbox', { name: 'Custom indicator JavaScript code' }).fill(source)
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  expect(externalRequests).toBe(0)
})

test('draws, undoes, redoes, hides, and persists annotations', async ({ page }) => {
  await draw(page, 'Trend line (Alt T)')
  await draw(page, 'Horizontal line (Alt H)', false)
  let drawings = await getStored<Record<string, unknown[]>>(page, 'drawings')
  expect(drawings['BTCUSDT:1h']).toHaveLength(2)
  await page.getByRole('button', { name: 'Undo drawing (Ctrl Z)', exact: true }).click()
  drawings = await getStored(page, 'drawings')
  expect(drawings['BTCUSDT:1h']).toHaveLength(1)
  await page.getByRole('button', { name: 'Redo drawing (Ctrl Shift Z)', exact: true }).click()
  drawings = await getStored(page, 'drawings')
  expect(drawings['BTCUSDT:1h']).toHaveLength(2)
  await page.getByRole('button', { name: 'Hide drawings', exact: true }).click()
  await expect(page.locator('.drawing-overlay > *')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show drawings', exact: true }).click()
  await expect(page.locator('.drawing-overlay > *')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.drawing-overlay > *')).toHaveCount(2)
  await draw(page, 'Text note', false)
  await page.getByRole('textbox', { name: 'Chart note', exact: true }).fill('Key support')
  await page.getByRole('button', { name: 'Add note', exact: false }).click()
  await expect(page.locator('.drawing-overlay')).toContainText('Key support')
})

test('replays individual bars and returns to the demo feed', async ({ page }) => {
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await expect(page.locator('.replay-progress')).toHaveText('780/900')
  await page.getByRole('button', { name: 'Replay next bar', exact: true }).click()
  await expect(page.locator('.replay-progress')).toHaveText('781/900')
  await page.getByRole('button', { name: 'Play replay', exact: true }).click()
  await expect(page.locator('.replay-progress')).not.toHaveText('781/900')
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click()
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
  await expect(page.locator('.replay-controls')).toHaveCount(0)
  await expect(page.getByRole('img', { name: /900 simulated price bars/ })).toBeVisible()
})

test('creates, triggers, and removes an in-app alert', async ({ page }) => {
  await page.getByRole('button', { name: 'Alert', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Target price · USDT', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Create alert', exact: true }).click()
  await expect(page.locator('.alert-card')).toContainText('Triggered')
  await expect(page.locator('.toast-host')).toContainText('Your price alert was triggered')
  await page.getByRole('button', { name: 'Delete alert', exact: true }).click()
  await expect(page.locator('.alert-card')).toHaveCount(0)
})

test('exports a valid PNG, OHLCV CSV, and workspace backup', async ({ page }) => {
  const snapshotDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download chart snapshot', exact: true }).click()
  const snapshot = await snapshotDownload
  expect(snapshot.suggestedFilename()).toMatch(/atlas-BTCUSDT-1h\.png/)
  const stream = await snapshot.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(buffer.length).toBeGreaterThan(5000)
  await page.getByRole('tab', { name: 'Data window', exact: true }).click()
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const csv = await csvDownload
  expect(csv.suggestedFilename()).toContain('-demo.csv')
  await page.getByRole('button', { name: 'Your workspace', exact: true }).click()
  const workspaceDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export workspace backup/ }).click()
  expect((await workspaceDownload).suggestedFilename()).toBe('atlas-workspace.json')
})

test('saves notes and exposes a scoped share link', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle trading notes', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Trading notes', exact: true })
    .fill('Watch the hourly support zone. Risk first.')
  await expect.poll(() => getStored<string>(page, 'notes')).toContain('Risk first.')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Shareable workspace link' })).toHaveValue(
    /symbol=BTCUSDT&interval=1h&style=candles/,
  )
  await expect(page.getByRole('img', { name: 'Preview of your chart snapshot' })).toBeVisible()
})

test('keeps the mobile workspace inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await expect(page.locator('.side-panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle watchlist', exact: true }).click()
  await expect(page.locator('.watchlist-panel')).toBeVisible()
  await page.getByRole('button', { name: 'View Ethereum chart', exact: true }).click()
  await page.getByRole('button', { name: 'Close watchlist', exact: true }).click()
  await expect(page.locator('.symbol-heading')).toContainText('Ethereum')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('imports a validated workspace backup with confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Your workspace', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export workspace backup/ }).click()
  const stream = await (await download).createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const backup = JSON.parse(Buffer.concat(chunks).toString())
  backup.workspaceName = 'Restored workspace'
  backup.symbol = 'SOLUSDT'
  backup.timeframe = '4h'
  backup.chartType = 'area'
  backup.notes = 'This note was imported.'
  await page.getByLabel('Import workspace file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await expect(page.getByRole('dialog')).toContainText('Replace the current workspace?')
  await page.getByRole('button', { name: 'Import backup', exact: true }).click()
  await expect(page.getByRole('img', { name: /Solana 4h area chart/ })).toBeVisible()
  expect(await getStored<string>(page, 'workspace-name')).toBe('Restored workspace')
  await page.getByRole('button', { name: 'Toggle trading notes', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Trading notes', exact: true })).toHaveValue(
    'This note was imported.',
  )
  await page.getByLabel('Import workspace file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  })
  await expect(page.locator('.toast-host')).toContainText('unsupported version')
  expect(await getStored<string>(page, 'workspace-name')).toBe('Restored workspace')
})

test('recalculates custom oscillators and inputs across markets and replay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page
    .getByRole('textbox', { name: 'Indicator script name', exact: true })
    .fill('My oscillator')
  await page
    .getByRole('textbox', { name: 'Custom indicator JavaScript code' })
    .fill(
      'const length = input.number("Length", 14); plot(ta.rsi(close, length), { title: "My RSI", color: "#ad91e5", pane: "oscillator" });',
    )
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  await page.locator('.oscillator-legend').filter({ hasText: 'My oscillator' }).hover()
  await page.getByRole('button', { name: 'Settings for My oscillator 20', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Length', exact: true }).fill('9')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('tab', { name: /ETHUSDT/ }).click()
  await expect(
    page.locator('.oscillator-legend').filter({ hasText: 'My oscillator' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '15m timeframe', exact: true }).click()
  await expect(
    page.locator('.oscillator-legend').filter({ hasText: 'My oscillator' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await page.getByRole('button', { name: 'Replay next bar', exact: true }).click()
  await expect(
    page.locator('.oscillator-legend').filter({ hasText: 'My oscillator' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
  await expect(
    page.locator('.oscillator-legend').filter({ hasText: 'My oscillator' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('supports extra drawing tools and a reversible focus mode', async ({ page }) => {
  await draw(page, 'Rectangle')
  await draw(page, 'Fibonacci retracement')
  await draw(page, 'Measure')
  const drawings = await getStored<Record<string, { tool: string }[]>>(page, 'drawings')
  expect(drawings['BTCUSDT:1h'].map((d) => d.tool)).toEqual(['rectangle', 'fibonacci', 'measure'])
  await page.getByRole('button', { name: 'Enter focus mode', exact: true }).click()
  await expect(page.locator('.topbar')).toBeHidden()
  await expect(page.locator('.studio')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.studio')).toBeVisible()
  await page.getByRole('button', { name: 'Remove all drawings', exact: true }).click()
  await expect(page.locator('.drawing-overlay > *')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.drawing-overlay > *')).toHaveCount(3)
})
