import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The floating Chile panel: the V17 score readout for the next round. Demo mode is deliberate —
 * its candles are generated locally, so the panel has feeds to read without the exchange, and it
 * labels them SYNTH.
 */
async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
}

/**
 * The floating windows live behind one toolbar selector. Its menu stays open across picks, so this
 * opens it only when it is closed.
 */
async function openFloatingMenu(page: Page) {
  const menu = page.locator('.floating-picker .dropdown-menu')
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: /^Floating/ }).click()
    await expect(menu).toBeVisible()
  }
  return menu
}

const window_ = (page: Page) => page.getByRole('region', { name: 'Chile panel window' })

test('opens on a wide viewport and reads the next round', async ({ page }: { page: Page }) => {
  await openDemoChart(page)

  // The panel is the shortest of the corner windows, so unlike the Candle Pulse and the MTF RSI
  // window it starts open wherever there is chart width for it — the whole point of the window is
  // that you can see it.
  const hud = window_(page)
  await expect(hud).toBeVisible()
  await expect(hud).toContainText('CHILE PANEL')
  await expect(hud.locator('.chile-panel-tag')).toHaveText('SYNTH')

  // The verdict line: a call and a countdown to the round close.
  await expect(hud.locator('.chile-panel-call')).toBeVisible()
  await expect(hud.locator('.chile-panel-clock')).toContainText(/^\d{2}:\d{2}$/)

  // Every row of the Pine panel, plus the score split behind the verdict.
  await expect(hud.locator('.chile-panel-row')).toHaveCount(8)
  for (const label of ['UP FORCE', 'DOWN FORCE', 'BUYERS', 'SELLERS', 'VOLUME', 'TREND']) {
    await expect(hud.locator('.chile-panel-row', { hasText: label })).toBeVisible()
  }
  await expect(hud.locator('.chile-panel-force-numbers')).toContainText('%')

  // Its own close button is the same choice as the selector, and it persists across reloads.
  await hud.getByRole('button', { name: 'Hide the Chile panel' }).click()
  await expect(window_(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(window_(page)).toHaveCount(0)
})

test('opens from the Floating selector and from Alt L, and remembers the choice', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)
  await window_(page).getByRole('button', { name: 'Hide the Chile panel' }).click()
  await expect(window_(page)).toHaveCount(0)

  await openFloatingMenu(page)
  await page.locator('.menu-item.floating-chile-panel').click()
  await expect(window_(page)).toBeVisible()

  await page.keyboard.press('Alt+l')
  await expect(window_(page)).toHaveCount(0)
  await page.keyboard.press('Alt+l')
  await expect(window_(page)).toBeVisible()

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(window_(page)).toBeVisible()

  // Minimizing is remembered too, and the minimized row keeps the call and the countdown.
  await window_(page).getByRole('button', { name: 'Minimize the Chile panel' }).click()
  await expect(window_(page).locator('.chile-panel-min-row')).toBeVisible()
  await expect(window_(page).locator('.chile-panel-clock')).toContainText(/^\d{2}:\d{2}$/)
})

test('borrows the chart indicator profile, and offers the overlay when there is none', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)

  // No Chile indicator on the chart: the window runs the published defaults and says how to get
  // the profile it is borrowing — its inputs live in the indicator's settings dialog.
  const hud = window_(page)
  await expect(hud).toContainText('next 15m round')
  const add = hud.getByRole('button', { name: 'Add the Chile Reversal overlay to the chart' })
  await expect(add).toBeVisible()
  await add.click()
  await expect(page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 0.1)' })).toBeVisible()
  await expect(add).toHaveCount(0)

  // The panel's score inputs are the indicator's, so changing them changes what the window shows.
  await page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 0.1)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Chile Reversal' })
  await expect(dialog.getByLabel('Panel minimum strength')).toHaveValue('6')
  await expect(dialog.getByLabel('Panel minimum edge')).toHaveValue('2')
  await expect(dialog.getByLabel('ROBEX trend sensitivity')).toHaveValue('2.4')
  await expect(dialog.getByLabel('ROBEX trend ATR length')).toHaveValue('10')
  await dialog.getByLabel('Pivot timeframe').selectOption('1h')
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()

  // The window follows the profile it is borrowing.
  await expect(window_(page)).toContainText('next 1h round')
  await expect(window_(page).locator('.chile-panel-row', { hasText: 'RSI 1h' })).toBeVisible()
})
