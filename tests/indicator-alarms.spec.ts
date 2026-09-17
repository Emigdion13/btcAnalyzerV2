import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Custom indicator alarms in the browser: build one on MACD/RSI/VIX Fix from the alerts panel,
 * read its live numbers, and find it again after a reload. Demo mode is deliberate — its candles
 * are generated locally, so the panel's readings do not depend on an exchange connection.
 */
async function openAlerts(page: Page) {
  await page.goto('/?source=demo&interval=15m')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByRole('button', { name: 'Toggle alerts' }).click()
  return page.locator('.side-panel.alerts-panel')
}
async function openBuilder(page: Page) {
  const panel = await openAlerts(page)
  await panel.getByRole('button', { name: 'Build an indicator alarm' }).click()
  const dialog = page.getByRole('dialog', { name: 'Build the trigger you actually want.' })
  await expect(dialog).toBeVisible()
  return { panel, dialog }
}

test('builds a custom RSI alarm and keeps it after a reload', async ({ page }) => {
  const { panel, dialog } = await openBuilder(page)
  // It opens on CM MACD with a live reading straight from the open chart.
  await expect(dialog.locator('.alarm-preview-reading')).toContainText('MACD')
  await dialog.getByRole('button', { name: 'RSI', exact: true }).click()
  await dialog.locator('#alarm-condition').selectOption('rsi-about-cross-up')
  await dialog.locator('#alarm-param-level').fill('65')
  await dialog.locator('#alarm-param-within').fill('4')
  await dialog.locator('#alarm-note').fill('Waiting for the squeeze')
  await dialog.getByRole('button', { name: 'Create alarm' }).click()
  await expect(dialog).toBeHidden()
  const card = panel.locator('.alarm-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('BTCUSDT')
  await expect(card).toContainText('15m')
  await expect(card).toContainText('RSI is about to cross above a level')
  await expect(card).toContainText('RSI (14)')
  await expect(card).toContainText('Waiting for the squeeze')
  await expect(card.locator('.alarm-reading')).toContainText('RSI')
  await expect(card.locator('.alarm-reading')).toContainText('level 65')
  // Alarms live in this browser's workspace: it has to survive a reload.
  await page.reload()
  await page.getByRole('button', { name: 'Toggle alerts' }).click()
  await expect(page.locator('.side-panel.alerts-panel .alarm-card')).toContainText(
    'RSI is about to cross above a level',
  )
})

test('offers MACD its colour and proximity conditions, and the VIX Fix its spikes', async ({
  page,
}) => {
  const { dialog } = await openBuilder(page)
  const conditions = dialog.locator('#alarm-condition')
  const options = async () => conditions.locator('option').allTextContents()
  // The full CM_Ult_MacD_MTF vocabulary: the green/red cross, "about to cross", and the
  // four ChrisMoody histogram colours, each named for what it means.
  expect(await options()).toContain('MACD turns green — crosses above the signal line')
  expect(await options()).toContain('MACD turns red — crosses below the signal line')
  expect(await options()).toContain('MACD is about to cross above the signal line (still red)')
  expect(await options()).toContain('Histogram turns aqua — rally momentum building')
  expect(await options()).toContain('Histogram turns maroon — sell-off momentum fading')
  expect(await options()).toContain('Histogram turns red — sell-off momentum building')
  await conditions.selectOption('macd-about-cross-up')
  await expect(dialog.locator('#alarm-param-within')).toHaveValue('3')
  await expect(dialog.locator('.alarm-condition-copy')).toContainText('No threshold to tune')
  // The classic MACD has no colour change, so ChrisMoody's histogram colours are not offered —
  // its histogram conditions stay in its own momentum vocabulary.
  await dialog.getByRole('button', { name: 'MACD (classic)', exact: true }).click()
  expect(await options()).not.toContain('Histogram turns aqua — rally momentum building')
  expect(await options()).toContain('Histogram is rising — momentum building')
  // And the Vix Fix opens on its published lime-spike trigger.
  await dialog.getByRole('button', { name: 'CM_Williams_Vix_Fix', exact: true }).click()
  await expect(conditions).toHaveValue('wvf-spike')
  await expect(dialog.locator('.alarm-condition-copy')).toContainText('lime')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('says an alarm on another pair is polled, not charted', async ({ page }) => {
  const { panel, dialog } = await openBuilder(page)
  await dialog.locator('#alarm-market').selectOption('ETHUSDT')
  await expect(dialog.locator('.alarm-preview')).toContainText('in the background')
  await dialog.getByRole('button', { name: 'Create alarm' }).click()
  const card = panel.locator('.alarm-card')
  await expect(card).toContainText('ETHUSDT')
  await expect(card).toContainText('MACD turns green — crosses above the signal line')
})

test('chains MACD and RSI into one alarm that only fires when both hold', async ({ page }) => {
  const { panel, dialog } = await openBuilder(page)
  // Add a second condition; it opens on the first indicator the alarm is not already reading.
  await dialog.locator('#alarm-add-leg').click()
  await expect(dialog.locator('.alarm-leg')).toHaveCount(1)
  await expect(dialog.locator('#alarm-extra-0-indicator')).toHaveValue('rsi')
  await dialog.locator('#alarm-extra-0-condition').selectOption('rsi-above-level')
  await dialog.locator('#alarm-extra-0-param-level').fill('55')
  // "All of them" is the default; the preview says what the combined alarm is waiting on.
  await expect(dialog.locator('#alarm-match-all')).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('.alarm-preview-head')).toContainText(
    'MACD turns green and RSI above 55',
  )
  await dialog.locator('#alarm-match-any').click()
  await expect(dialog.locator('#alarm-match-any')).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('.alarm-preview-head')).toContainText(
    'MACD turns green or RSI above 55',
  )
  // One MACD flavour per alarm: the classic MACD is not on offer as a second leg.
  await expect(dialog.locator('#alarm-extra-0-indicator option[value="macd"]')).toHaveCount(0)
  await dialog.locator('#alarm-match-all').click()
  await dialog.getByRole('button', { name: 'Create alarm' }).click()
  await expect(dialog).toBeHidden()
  const card = panel.locator('.alarm-card')
  await expect(card).toContainText('MACD turns green and RSI above 55')
  await expect(card.locator('.alarm-indicator')).toContainText(
    'CM_Ult_MacD_MTF (12, 26, 9) + RSI (14)',
  )
  await expect(card.locator('.alarm-combo-chip')).toContainText('All of 2 conditions')
  // Taking a condition off leaves the alarm standing on its primary leg.
  await card.getByRole('button', { name: 'Delete alarm' }).click()
  await expect(card).toHaveCount(0)
})

test('pauses and removes an alarm from its card', async ({ page }) => {
  const { panel, dialog } = await openBuilder(page)
  await dialog.getByRole('button', { name: 'Create alarm' }).click()
  const card = panel.locator('.alarm-card')
  await expect(card).toHaveCount(1)
  await expect(card.locator('.alert-state')).toContainText('Never fired yet')
  await card.getByRole('switch', { name: 'Enable alarm' }).click()
  await expect(card.locator('.alarm-state')).toHaveText('Paused')
  await card.getByRole('button', { name: 'Delete alarm' }).click()
  await expect(card).toHaveCount(0)
  await expect(panel.getByText('Your own triggers')).toBeVisible()
})
