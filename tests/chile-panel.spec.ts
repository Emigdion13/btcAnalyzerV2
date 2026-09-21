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

test('summons with Alt L on a plain laptop viewport and reads the next round', async ({
  page,
}: {
  page: Page
}) => {
  await openDemoChart(page)

  // 1440x900 has no free corner for it: the legend owns the top-left, the oscillator HUD cards
  // tile the width below it, the peek window the bottom-right and the MTF RSI window the
  // bottom-left. Like the other corner windows it waits for a roomy viewport, and stays one
  // keystroke away everywhere else.
  await expect(window_(page)).toHaveCount(0)
  await page.keyboard.press('Alt+l')

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
  await page.keyboard.press('Alt+l')

  // No Chile indicator on the chart: the window runs the published defaults and says how to get
  // the profile it is borrowing.
  const hud = window_(page)
  await expect(hud).toContainText('next 15m round')
  await expect(hud.locator('.chile-panel-row', { hasText: 'RSI 15m' })).toBeVisible()

  const add = hud.getByRole('button', { name: 'Add the Chile Reversal overlay to the chart' })
  await expect(add).toBeVisible()
  await add.click()

  // One engine, two surfaces: the chart now carries the indicator the panel is reading, so the
  // offer disappears and the legend names the shared profile. Changing that profile happens in the
  // indicator's settings dialog, which the unit tests drive directly.
  await expect(add).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 6/2)' })).toBeVisible()
  await expect(hud).toContainText('next 15m round')
})
