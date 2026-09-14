import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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

test('toggles the RSI meter without touching the RSI pane, and remembers the choice', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const meter = await openDemoChart(page)
  const toggle = page.locator('.toolbar-button.rsi-meter-toggle')
  const pane = page.locator('.oscillator-legend[data-indicator="rsi"]')

  // A fresh workspace ships RSI as a real indicator, so the pane and the window agree.
  await expect(meter).toContainText('RSI 14')
  await expect(pane).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // The button owns the window only: your indicator keeps its pane.
  await toggle.click()
  await expect(meter).toBeHidden()
  await expect(pane).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await page.reload()
  await expect(page.getByRole('region', { name: 'RSI Meter' })).toBeHidden()
  await expect(page.locator('.oscillator-legend[data-indicator="rsi"]')).toBeVisible()

  await page.locator('.toolbar-button.rsi-meter-toggle').click()
  const reopened = page.getByRole('region', { name: 'RSI Meter' })
  await expect(reopened).toBeVisible()
  await expect(reopened).toContainText('RSI 14')
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('atlas.v1.rsi-meter-visible')!)),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('stands alone when the RSI pane comes off the chart, sharing one editable period', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const meter = await openDemoChart(page)

  // Take the pane off the chart. The window stays, now reading the indicator it added itself —
  // hidden, so nothing is drawn, but on the chart, so the length is still editable.
  await page.getByRole('button', { name: 'Remove RSI 14' }).click()
  await expect(page.locator('.oscillator-legend[data-indicator="rsi"]')).toHaveCount(0)
  await expect(meter).toBeVisible()

  const chip = page.locator('.indicator-legends .muted-legend')
  await expect(chip).toContainText('RSI')
  await chip.getByRole('button', { name: 'Settings for RSI 14' }).click()
  const dialog = page.getByRole('dialog', { name: 'RSI settings' })
  await expect(dialog).toBeVisible()

  // One period, shared: changing it in the dialog moves the window's reading too.
  await page.getByLabel('Length').fill('21')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
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
  await page.getByRole('button', { name: 'Remove RSI 14' }).click()
  await expect(page.locator('.oscillator-legend[data-indicator="rsi"]')).toHaveCount(0)

  // The library still offers RSI even though the meter's hidden one is on the chart, and
  // adding it promotes that indicator instead of refusing a same-length twin.
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Relative Strength')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await expect(page.locator('.oscillator-legend[data-indicator="rsi"]')).toHaveCount(1)
  await expect(page.locator('.indicator-legends .muted-legend')).toHaveCount(0)
  // The window is still there, and still reading the same indicator it was promoted from.
  await expect(meter).toBeVisible()
  await expect(meter).toContainText('RSI 14')
  expect(errors).toEqual([])
})
