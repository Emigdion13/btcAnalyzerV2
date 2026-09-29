import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { closeFloatingWindows } from './floating-windows'

// The RSI meter is not one of these windows and stays; the others dock over the RSI pane it reads.
test.beforeEach(({ page }) => closeFloatingWindows(page))

/**
 * The floating RSI meter: the reading as a window instead of a whole oscillator pane.
 * Demo mode is deliberate — its candles are generated locally, so the meter's value and the
 * indicator behind it stay deterministic without touching the exchange.
 */
async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
  const meter = page.getByRole('region', { name: 'RSI Meter' })
  await expect(meter).toBeVisible()
  return meter
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

/** The RSI oscillator pane, when RSI is on the chart as a real indicator. */
function rsiPane(page: Page) {
  return page.locator('.oscillator-legend[data-indicator="rsi"]')
}

/**
 * Take the RSI pane off the chart through its own legend. The legend's action buttons are
 * hover-revealed, so hover first — the same pattern the workspace tests use.
 */
async function removeRsiPane(page: Page) {
  const pane = rsiPane(page)
  await expect(pane).toBeVisible()
  await pane.hover()
  await pane.getByRole('button', { name: 'Remove RSI 14', exact: true }).click()
  await expect(rsiPane(page)).toHaveCount(0)
}

test('toggles the RSI meter without touching the RSI pane, and remembers the choice', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const meter = await openDemoChart(page)
  const item = page.locator('.menu-item.floating-rsi-meter')

  // A fresh workspace ships RSI as a real indicator, so the pane and the window agree.
  await expect(meter).toContainText('RSI 14')
  await expect(rsiPane(page)).toBeVisible()
  await openFloatingMenu(page)
  await expect(item).toHaveClass(/selected/)

  // The selector owns the window only: your indicator keeps its pane.
  await item.click()
  await expect(meter).toBeHidden()
  await expect(rsiPane(page)).toBeVisible()
  await expect(item).not.toHaveClass(/selected/)

  await page.reload()
  await expect(page.getByRole('region', { name: 'RSI Meter' })).toBeHidden()
  await expect(rsiPane(page)).toBeVisible()

  await openFloatingMenu(page)
  await item.click()
  const reopened = page.getByRole('region', { name: 'RSI Meter' })
  await expect(reopened).toBeVisible()
  await expect(reopened).toContainText('RSI 14')
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('atlas.v1.rsi-meter-visible')!)),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('stands alone when the RSI pane comes off the chart, sharing one editable length', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const meter = await openDemoChart(page)

  // Take the pane off the chart. The window stays, now reading the indicator it added itself —
  // hidden, so nothing is drawn, but on the chart, so the length is still editable.
  await removeRsiPane(page)
  await expect(meter).toBeVisible()

  const chip = page.locator('.indicator-legends .muted-legend')
  await expect(chip).toHaveCount(1)
  await expect(chip).toContainText('RSI')
  await chip.getByRole('button', { name: 'Settings for RSI 14', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'RSI settings' })
  await expect(dialog).toBeVisible()

  // One length, shared: changing it in the dialog moves the window's reading too.
  // The field's label wraps a hint, so the accessible name is longer than "Length".
  await dialog.getByRole('spinbutton', { name: 'Length', exact: false }).fill('21')
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(meter).toContainText('RSI 21')
  expect(errors).toEqual([])
})

test('RSI stays an indicator you can add, promoting the meter’s hidden one to a pane', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const meter = await openDemoChart(page)
  await removeRsiPane(page)

  // The library still offers RSI even though the meter's hidden one is on the chart, and
  // adding it promotes that indicator instead of refusing a same-length twin.
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Relative Strength')
  // The divergence entry's description matches the same search, so pick the row that is the
  // RSI indicator itself instead of the first Add button the search happens to surface.
  const rsiRow = page
    .locator('.indicator-catalog-row')
    .filter({ has: page.getByRole('heading', { name: /^Relative Strength Index/ }) })
  await rsiRow.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await expect(rsiPane(page)).toHaveCount(1)
  // The promoted indicator is visible, so it is no longer the window's hidden one.
  await expect(page.locator('.indicator-legends .muted-legend')).toHaveCount(0)
  // The window is still there, and still reading the same indicator it was promoted from.
  await expect(meter).toBeVisible()
  await expect(meter).toContainText('RSI 14')
  expect(errors).toEqual([])
})
