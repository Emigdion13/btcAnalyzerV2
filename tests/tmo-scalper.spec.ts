import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * The TMO Scalper pane and its floating window: L&L Capital's three wheels folded from the
 * chart's own streams, the (1, 5, 30, 14, 5, 3, 3, 2, 9, -9, ▴, ▾, ▴, ▾) profile, and the
 * ▲/▼ markers drawn for real.
 *
 * Demo mode is deliberate — its candles are generated locally, so the wheels' values, the
 * bars and the marker counts stay deterministic without touching the exchange.
 */
const TMO_WINDOW = 'TMO Scalper window'

async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
}

async function openFloatingMenu(page: Page) {
  const menu = page.locator('.floating-picker .dropdown-menu')
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: /^Floating/ }).click()
    await expect(menu).toBeVisible()
  }
  return menu
}

function tmoWindow(page: Page): Locator {
  return page.getByRole('region', { name: TMO_WINDOW })
}

/** The oscillator pane a window borrows its settings from, when it is on the chart. */
function pane(page: Page, kind: string) {
  return page.locator(`.oscillator-legend[data-indicator="${kind}"]`)
}

test('the TMO window opens on a fresh chart and draws the three wheels', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openDemoChart(page)
  const tmo = tmoWindow(page)

  await expect(tmo).toBeVisible()
  // A 1m chart: twenty bars is exactly the twenty minutes that was asked for.
  await expect(tmo).toContainText('20 bars / 20 min')
  // TMO Scalper ships off a new workspace, so the window runs on the published profile and
  // offers the pane whose settings it would borrow.
  await expect(tmo).toContainText('default settings')
  await expect(
    tmo.getByRole('button', { name: 'Add the TMO Scalper pane to the chart' }),
  ).toBeVisible()
  await expect(tmo).toContainText('(1, 5, 30, 14, 5, 3)')

  // Six wheel traces, one per Main/Signal pair — painted, not described, and counting them is
  // the point (see osc-hud.spec.ts for why counts beat visibility here).
  await expect(tmo.locator('.osc-hud-svg polyline')).toHaveCount(6)
  await expect(tmo.locator('.osc-hud-svg polyline').first()).not.toHaveAttribute(
    'points',
    /NaN|undefined/,
  )
  // The readouts quote each wheel under its own time-frame label.
  await expect(tmo.locator('.osc-hud-readout small').nth(0)).toHaveText('1m')
  await expect(tmo.locator('.osc-hud-readout small').nth(1)).toHaveText('5m')
  await expect(tmo.locator('.osc-hud-readout small').nth(2)).toHaveText('30m')
  await expect(tmo.locator('.osc-hud-verdict')).toContainText(
    /EXTREME|SIGNAL|cross|OVERBOUGHT|OVERSOLD|ZONE|TMO 3|WARMING/,
  )
  expect(errors).toEqual([])
})

test('Alt O and the floating selector own the window, and the choice survives a reload', async ({
  page,
}) => {
  await openDemoChart(page)
  await expect(tmoWindow(page)).toBeVisible()

  const menu = await openFloatingMenu(page)
  const item = menu.locator('.menu-item.floating-tmo-scalper')
  await expect(item).toHaveClass(/selected/)
  await expect(item).toContainText('Alt O')

  await page.keyboard.press('Alt+o')
  await expect(tmoWindow(page)).toBeHidden()

  await page.reload()
  await expect(tmoWindow(page)).toBeHidden()
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('atlas.v1.osc-hud-visible:tmo-scalper')!),
    ),
  ).toBe(false)

  await page.keyboard.press('Alt+o')
  await expect(tmoWindow(page)).toBeVisible()
})

test('the pane plots the wheels with the library edit available from the window', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openDemoChart(page)

  // Library add: one catalog row, named like its legend.
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators', exact: true }).fill('TMO')
  await expect(page.locator('.indicator-catalog-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(pane(page, 'tmo-scalper')).toBeVisible()
  await expect(pane(page, 'tmo-scalper')).toContainText('TMO Scalper (1, 5, 30, 14, 5, 3)')
  // The window now owns the pane's settings instead of the published defaults.
  await expect(tmoWindow(page)).toContainText('your indicator')

  // The gear opens the same dialog the legend does, with the profile values in its fields.
  await tmoWindow(page).getByRole('button', { name: 'Settings for TMO Scalper' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('TMO Scalper')
  // Exact labels: "TMO 1 signals" et al. are the display switches on the same dialog.
  await expect(dialog.getByLabel('TMO 1', { exact: true })).toHaveValue('1')
  await expect(dialog.getByLabel('TMO 2', { exact: true })).toHaveValue('5')
  await expect(dialog.getByLabel('TMO 3', { exact: true })).toHaveValue('30')
  await expect(dialog.getByLabel('Length', { exact: true })).toHaveValue('14')
  await expect(dialog.getByLabel('Calc Length')).toHaveValue('5')
  await expect(dialog.getByLabel('Smooth Length')).toHaveValue('3')
  await expect(dialog.getByLabel('Signal Size')).toHaveValue('3')
  await expect(dialog.getByLabel('Signal Offset')).toHaveValue('2')
  await expect(dialog.getByLabel('Extreme Overbought')).toHaveValue('9')
  await expect(dialog.getByLabel('Extreme Oversold')).toHaveValue('-9')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})
