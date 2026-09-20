import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The floating MTF RSI window: one RSI and one tendency call per watched resolution. Demo mode
 * is deliberate — its candles are generated locally, so the readings and the calls stay
 * deterministic without touching the exchange.
 */
async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
}

/**
 * The floating windows live behind one toolbar selector. Its menu stays open across picks —
 * several windows can be flipped in one visit — so this opens it only when it is closed.
 */
async function openFloatingMenu(page: Page) {
  const menu = page.locator('.floating-picker .dropdown-menu')
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: /^Floating/ }).click()
    await expect(menu).toBeVisible()
  }
  return menu
}

const window_ = (page: Page) => page.getByRole('region', { name: 'Multi-timeframe RSI window' })

test('opens from the Floating selector, shows the five-timeframe ladder, and remembers the choice', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)

  // A corner window starts closed below the roomy viewport, like the Candle Pulse — it must
  // never sit on the chart by default where there is no room for it.
  await expect(window_(page)).toHaveCount(0)

  await openFloatingMenu(page)
  await page.locator('.menu-item.floating-mtf-rsi').click()
  const hud = window_(page)
  await expect(hud).toBeVisible()

  // One row per watched resolution, each with a tendency chip once its feed has history.
  await expect(hud.locator('.mtf-rsi-row')).toHaveCount(5)
  for (const label of ['1m', '5m', '15m', '30m', '1h']) {
    await expect(hud.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(hud.locator('.mtf-rsi-tendency').first()).toBeVisible()
  await expect(hud.locator('.mtf-rsi-bias')).toBeVisible()

  // The choice is remembered across reloads.
  await page.reload()
  await expect(window_(page)).toBeVisible()

  // Its own close button is the same choice as the selector, and it persists too.
  await window_(page).getByRole('button', { name: 'Hide the MTF RSI window' }).click()
  await expect(window_(page)).toHaveCount(0)
  await page.reload()
  await expect(window_(page)).toHaveCount(0)
})

test('Alt R toggles it, and the methodology note explains the call', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)
  await page.keyboard.press('Alt+r')
  const hud = window_(page)
  await expect(hud).toBeVisible()

  // The window says how the tendency is determined instead of leaving the trader to guess.
  await hud.getByRole('button', { name: 'How the tendency is determined' }).click()
  await expect(hud.locator('.mtf-rsi-note')).toContainText('ADX')
  await expect(hud.locator('.mtf-rsi-note')).toContainText('efficiency')

  await page.keyboard.press('Alt+r')
  await expect(window_(page)).toHaveCount(0)
})
