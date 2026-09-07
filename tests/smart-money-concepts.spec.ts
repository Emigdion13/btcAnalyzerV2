import { expect, test } from '@playwright/test'

test('renders and persists the independent Smart Money Concepts overlay', async ({ page }) => {
  await page.goto('/?source=demo')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByTestId('smc-overlay').locator('[data-smc-mode="Historical"]')).toHaveCount(
    1,
  )
  await expect(page.getByRole('button', { name: /^Smart Money Concepts \(/ })).toBeVisible()

  await page.getByRole('button', { name: /^Smart Money Concepts \(/ }).click()
  await expect(page.getByRole('dialog', { name: 'Smart Money Concepts' })).toBeVisible()
  await expect(page.getByLabel('SMC mode')).toHaveValue('Historical')
  await expect(page.getByLabel('SMC style')).toHaveValue('Colored')
  await expect(page.getByLabel('Swing length')).toHaveValue('50')
  await expect(page.getByLabel('Order block mitigation source')).toHaveValue('High/Low')
  await expect(page.getByLabel('Equal high low confirmation bars')).toHaveValue('3')
  await expect(page.getByLabel('Equal high low threshold')).toHaveValue('0.1')
  await expect(page.getByLabel('Fair value gap timeframe')).toHaveValue('')

  await page.getByLabel('SMC mode').selectOption('Present')
  await page.getByLabel('Fair value gap timeframe').selectOption('4h')
  await page.getByRole('switch', { name: 'Show fair value gaps' }).click()
  await page.getByRole('switch', { name: 'Show premium discount zones' }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  await expect(page.getByTestId('smc-overlay').locator('[data-smc-mode="Present"]')).toHaveCount(1)
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.indicators') || '[]'),
  )
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'smart-money-concepts',
        period: 50,
        smc: expect.objectContaining({
          mode: 'Present',
          fvgTimeframe: '4h',
          showFairValueGaps: true,
          showPremiumDiscount: true,
        }),
      }),
    ]),
  )
})
