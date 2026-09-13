import { expect, test } from '@playwright/test'

test('adds, renders, and persists the Chile Reversal overlay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // A 1m chart so the default 15m pivot feed is genuinely a higher timeframe.
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Chile Reversal')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // The legend carries the active profile: pivot timeframe, both legs, zone thickness.
  const legend = page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 0.1)' })
  await expect(legend).toBeVisible()
  await expect(page.getByTestId('chile-reversal-overlay').first()).toBeAttached()

  // Demo mode supplies the 15m pivot feed locally, so the engine runs without the
  // exchange. Zones are drawn only for levels that currently qualify — as in Pine,
  // where price further than the ATR filter from every pivot legitimately shows
  // none — so assert the overlay produced either a zone or a reversal marker.
  await expect
    .poll(
      async () =>
        (await page.getByTestId('chile-reversal-zone').count()) +
        (await page.locator('[data-testid^="chile-reversal-"][data-index]').count()),
    )
    .toBeGreaterThan(0)

  await legend.click()
  const dialog = page.getByRole('dialog', { name: 'Chile Reversal' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Pivot left')).toHaveValue('2')
  await expect(page.getByLabel('Pivot right')).toHaveValue('2')
  await expect(page.getByLabel('Max distance in ATR')).toHaveValue('2.5')
  await expect(page.getByLabel('Zone thickness in ATR')).toHaveValue('0.1')

  // Changing the profile re-renders and is reflected in the legend.
  await page.getByLabel('Pivot left').fill('3')
  await page.getByLabel('Zone thickness in ATR').fill('0.2')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Chile Reversal (15m, 3, 2, 0.2)' })).toBeVisible()

  // Settings survive a reload, like every other indicator.
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Chile Reversal (15m, 3, 2, 0.2)' })).toBeVisible()

  expect(errors).toEqual([])
})

test('rejects an out-of-range Chile Reversal profile instead of drawing it', async ({ page }) => {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Chile Reversal')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 0.1)' }).click()
  await page.getByLabel('Pivot left').fill('99')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  // The dialog stays open with an explanation; the chart keeps the last good profile.
  await expect(page.getByRole('alert')).toContainText(/Pivot legs must be whole numbers from 1–5/)
  await expect(page.getByRole('dialog', { name: 'Chile Reversal' })).toBeVisible()
})
