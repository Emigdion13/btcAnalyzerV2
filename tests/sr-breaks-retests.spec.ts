import { expect, test } from '@playwright/test'

test('renders and persists the SR Breaks and Retests overlay', async ({ page }) => {
  await page.goto('/?source=demo')
  await expect(page.locator('canvas').first()).toBeVisible()

  const overlay = page.getByTestId('sr-overlay')
  await expect(overlay.locator('[data-sr-lookback="20"]')).toHaveCount(1)
  // Demo history is long enough for the ATR box width, so boxes must draw.
  await expect(overlay.locator('.sr-box')).not.toHaveCount(0)
  await expect(overlay.locator('.sr-signal')).not.toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^SR Breaks and Retests \[ChartPrime\] \(20, 2, 1\)/ }),
  ).toBeVisible()

  await page
    .getByRole('button', { name: /^SR Breaks and Retests \[ChartPrime\] \(20, 2, 1\)/ })
    .click()
  await expect(page.getByRole('dialog', { name: 'SR Breaks and Retests' })).toBeVisible()
  await expect(page.getByLabel('Lookback period')).toHaveValue('20')
  await expect(page.getByLabel('Delta volume filter length')).toHaveValue('2')
  await expect(page.getByLabel('Adjust box width')).toHaveValue('1')
  await expect(page.getByLabel('ATR length')).toHaveValue('200')
  await expect(page.getByLabel('Maximum boxes')).toHaveValue('50')

  await page.getByLabel('Lookback period').fill('30')
  await page.getByLabel('Adjust box width').fill('0.5')
  await page.getByRole('switch', { name: 'Show break labels' }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  await expect(page.getByTestId('sr-overlay').locator('[data-sr-lookback="30"]')).toHaveCount(1)
  await expect(page.getByTestId('sr-overlay').locator('.sr-break-label')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /^SR Breaks and Retests \[ChartPrime\] \(30, 2, 0.5\)/ }),
  ).toBeVisible()

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.indicators') || '[]'),
  )
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'sr-breaks-retests',
        period: 30,
        sr: expect.objectContaining({
          lookbackPeriod: 30,
          volumeFilterLength: 2,
          boxWidth: 0.5,
          atrLength: 200,
          maxBoxes: 50,
          showBreakLabels: false,
        }),
      }),
    ]),
  )
})

test('rejects out-of-range SR inputs and restores the original defaults', async ({ page }) => {
  await page.goto('/?source=demo')
  await page
    .getByRole('button', { name: /^SR Breaks and Retests \[ChartPrime\] \(20, 2, 1\)/ })
    .click()
  const dialog = page.getByRole('dialog', { name: 'SR Breaks and Retests' })
  await expect(dialog).toBeVisible()

  await page.getByLabel('Lookback period').fill('0')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('whole numbers in range')
  await expect(dialog).toBeVisible()

  await page.getByRole('button', { name: /Original defaults/ }).click()
  await expect(page.getByLabel('Lookback period')).toHaveValue('20')
  await expect(page.getByLabel('Adjust box width')).toHaveValue('1')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByTestId('sr-overlay').locator('[data-sr-lookback="20"]')).toHaveCount(1)
})
