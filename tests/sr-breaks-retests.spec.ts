import { expect, test } from '@playwright/test'

test('adds, renders, and persists the SR Breaks and Retests overlay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?source=demo')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('SR Breaks')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // The legend mirrors the TradingView short title with the (20, 2, 1) inputs,
  // and the demo series (900 bars) renders volume-graded zones after the
  // ATR(200) warm-up.
  const legend = page.getByRole('button', { name: 'SR Breaks and Retests (20, 2, 1)' })
  await expect(legend).toBeVisible()
  await expect(page.getByTestId('sr-overlay')).toBeVisible()
  await expect(page.getByTestId('sr-zone').first()).toBeVisible()
  expect(await page.getByTestId('sr-zone').count()).toBeGreaterThan(0)

  // Break labels are messages inside the chart, so they stay transparent: the
  // plate is an outline only (`fill="none"`) and the glyphs carry a halo class
  // instead of a solid background hiding the candles behind the label.
  const breakLabel = page.getByTestId('sr-break-label').first()
  await expect(breakLabel).toBeVisible()
  await expect(breakLabel.locator('rect')).toHaveAttribute('fill', 'none')
  await expect(breakLabel.locator('text')).toHaveClass(/chart-message/)

  await legend.click()
  await expect(page.getByRole('dialog', { name: 'SR Breaks and Retests' })).toBeVisible()
  await expect(page.getByLabel('Lookback period')).toHaveValue('20')
  await expect(page.getByLabel('Delta volume filter length')).toHaveValue('2')
  await expect(page.getByLabel('Adjust box width')).toHaveValue('1')

  await page.getByLabel('Lookback period').fill('10')
  await page.getByLabel('Delta volume filter length').fill('3')
  await page.getByLabel('Adjust box width').fill('0.5')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  await expect(
    page.getByRole('button', { name: 'SR Breaks and Retests (10, 3, 0.5)' }),
  ).toBeVisible()
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.indicators') || '[]'),
  )
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'sr-breaks-retests',
        period: 10,
        sr: { lookbackPeriod: 10, volumeFilterLength: 3, boxWidth: 0.5 },
      }),
    ]),
  )

  // The published defaults restore with one click and survive a reload.
  await page.getByRole('button', { name: 'SR Breaks and Retests (10, 3, 0.5)' }).click()
  await page.getByRole('button', { name: '(20, 2, 1) defaults' }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'SR Breaks and Retests (20, 2, 1)' })).toBeVisible()
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByTestId('sr-zone').first()).toBeVisible()
  expect(errors).toEqual([])
})
