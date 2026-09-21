import { expect, test } from '@playwright/test'

test('adds, renders, and persists the Chile Reversal overlay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // A 1m chart so the default 15m round feed is genuinely a higher timeframe.
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Chile Reversal')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // The legend carries the active profile: round timeframe, both pivot legs, and the two score
  // gates (minimum strength / minimum edge).
  const legend = page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 6/2)' })
  await expect(legend).toBeVisible()
  await expect(page.getByTestId('chile-reversal-overlay').first()).toBeAttached()

  // Demo mode supplies the 15m round feed and the 5m momentum feed locally, so the engine runs
  // without the exchange. What the script paints is drawn as one overlay: the ROBEX Trend line,
  // the EMA pair, VWAP, and the nearby levels.
  await expect(page.getByTestId('chile-reversal-plots').first()).toBeAttached()
  await expect(page.getByTestId('chile-reversal-trend').first()).toBeAttached()

  // Levels are drawn only when a remembered pivot is inside the ATR filter — as in Pine, where
  // price further than `maxDistATR` from every pivot legitimately shows none — so assert the
  // overlay produced either a level line or one of the ARRIBA/ABAJO labels.
  await expect
    .poll(
      async () =>
        (await page.getByTestId('chile-reversal-level').count()) +
        (await page.locator('[data-testid^="chile-reversal-a"][data-index]').count()),
    )
    .toBeGreaterThan(0)

  // Labels are ephemeral by default and the legend carries an eraser to wipe the ones on screen
  // without waiting for them to fade.
  await expect(page.getByRole('button', { name: 'Clear Chile Reversal markers' })).toBeVisible()

  // Settings survive a reload, like every other indicator. (The settings dialog itself is reached
  // through the legend button, which the oscillator HUD cards currently cover — see the next test.)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 6/2)' })).toBeVisible()

  expect(errors).toEqual([])
})

test('rejects an out-of-range Chile Reversal profile instead of drawing it', async ({ page }) => {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Chile Reversal')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('button', { name: 'Chile Reversal (15m, 2, 2, 6/2)' }).click()
  await expect(page.getByLabel('Round timeframe')).toHaveValue('15m')
  await expect(page.getByLabel('Minimum strength')).toHaveValue('6')
  await expect(page.getByLabel('Minimum edge')).toHaveValue('2')
  await expect(page.getByLabel('Pivot left')).toHaveValue('2')
  await expect(page.getByLabel('Pivot right')).toHaveValue('2')
  await expect(page.getByLabel('Max distance in ATR')).toHaveValue('2.5')
  await expect(page.getByLabel('Line length in bars')).toHaveValue('35')
  await expect(page.getByLabel('ROBEX trend sensitivity')).toHaveValue('2.4')
  await expect(page.getByLabel('Label lifetime in seconds')).toHaveValue('60')
  await expect(page.getByLabel('Label fade in seconds')).toHaveValue('15')

  await page.getByLabel('Pivot left').fill('99')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  // The dialog stays open with an explanation; the chart keeps the last good profile.
  await expect(page.getByRole('alert')).toContainText(/pivot legs whole numbers from 1–5/)
  await expect(page.getByRole('dialog', { name: 'Chile Reversal' })).toBeVisible()
})
