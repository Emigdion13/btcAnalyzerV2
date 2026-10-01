import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { closeFloatingWindows } from './floating-windows'

test.beforeEach(({ page }) => closeFloatingWindows(page))

/**
 * The floating Randy V8.10 window and its chart lines. Demo mode is deliberate — its candles are
 * generated locally, so the engine has its 5m / 15m / 1h feeds without the exchange, and the
 * window labels them SYNTH.
 */
async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
}

const window_ = (page: Page) => page.getByRole('region', { name: 'Randy V8.10 window' })

test('summons with Alt J, asks for a Target, then reads the contract once one is typed', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)
  await expect(window_(page)).toHaveCount(0)
  await page.keyboard.press('Alt+j')

  const hud = window_(page)
  await expect(hud).toBeVisible()
  await expect(hud).toContainText('RANDY V8.10')
  await expect(hud.locator('.randy-panel-tag')).toHaveText('SYNTH')

  // No Target yet: the window says so and calls nothing.
  await expect(hud).toContainText('ENTER A TARGET')
  await expect(page.getByTestId('randy-v8-decision')).toContainText('REVIEW TARGET')

  // A strike nowhere near the demo price is a typo, not a strike.
  const field = hud.getByLabel('Target Kalshi / to beat')
  await field.fill('12')
  await field.press('Enter')
  await expect(hud).toContainText('CHECK TARGET')

  // A strike just under the price: the distance, the meter and the Pine table's rows all appear.
  // The price comes from the watchlist's BTC row; the chart's demo candles sit within a few percent.
  const text = await page.locator('body').innerText()
  const price = Number(/BTC[\s\S]*?(\d{2},\d{3}\.\d{2})/.exec(text)?.[1].replace(',', ''))
  expect(price).toBeGreaterThan(1000)
  await field.fill(String(Math.round(price - 50)))
  await field.press('Enter')
  await expect(hud).toContainText(/\$[\d,.]+ \| [+-]\$[\d,.]+/)
  for (const label of [
    'TIME',
    'DIRECTION',
    'TARGET METER',
    'STRENGTH',
    '1M + 5M',
    'STAGE',
    'MAP 1H/15M',
    'REASON',
  ]) {
    await expect(hud.locator('.randy-panel-row dt', { hasText: label })).toBeVisible()
  }
  await expect(
    hud.locator('.randy-panel-row').filter({ has: page.locator('dt', { hasText: 'DIRECTION' }) }),
  ).toContainText(/UP \d+% \| DOWN \d+%/)
  await expect(page.getByTestId('randy-v8-decision')).not.toContainText('REVIEW TARGET')

  // The first commit added the indicator, so the chart now carries the Target as its legend label.
  await expect(page.getByRole('button', { name: /^Randy V8\.10 \(\d+\)/ })).toBeVisible()
})

test('opens from the Floating selector, remembers the choice, and the Pine table is complete', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)
  await page.getByRole('button', { name: /^Floating/ }).click()
  await page.locator('.menu-item.floating-randy-v8').click()
  await expect(window_(page)).toBeVisible()

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(window_(page)).toBeVisible()

  await window_(page).getByRole('button', { name: 'Hide the Randy V8.10 window' }).click()
  await expect(window_(page)).toHaveCount(0)
  await page.reload()
  await expect(window_(page)).toHaveCount(0)
})

test('Add offers the chart lines, which then share the window’s profile', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)
  await page.keyboard.press('Alt+j')
  const hud = window_(page)
  const add = hud.getByRole('button', { name: 'Add the Randy V8.10 lines to the chart' })
  await expect(add).toBeVisible()
  await add.click()
  await expect(add).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Randy V8.10 (no target)' })).toBeVisible()

  // The settings dialog edits the same profile, and rejects a value outside the Pine range.
  await page.locator('.indicator-legend', { hasText: 'Randy V8.10' }).hover()
  await page.getByRole('button', { name: /^Settings for Randy V8\.10/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Randy V8.10 DISCIPLINADO')
  await dialog.getByLabel('Target (strike)').fill('50000')
  await dialog.getByLabel('1M closes to confirm').fill('9')
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog.getByRole('alert')).toContainText('1M closes to confirm')
  await dialog.getByLabel('1M closes to confirm').fill('2')
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Randy V8.10 (50000)' })).toBeVisible()
})
