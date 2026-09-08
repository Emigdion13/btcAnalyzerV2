import { expect, test } from '@playwright/test'

const NAME = 'Pivot Points High Low & Missed Reversal Levels'

test('adds, renders, and persists the Pivot Points High Low & Missed Reversal Levels overlay', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?source=demo')
  await expect(page.locator('canvas').first()).toBeVisible()

  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators' }).fill('Missed Reversal')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  // The legend mirrors the TradingView title with the published (50) input,
  // and the demo series (900 bars) renders regular pivots, a zig-zag through
  // them and the trailing reversal estimate with its level.
  const legend = page.getByRole('button', { name: `${NAME} (50)` })
  await expect(legend).toBeVisible()
  await expect(page.getByTestId('pivot-overlay')).toBeVisible()
  await expect(page.getByTestId('pivot-label-regular-high').first()).toBeVisible()
  await expect(page.getByTestId('pivot-label-regular-low').first()).toBeVisible()
  expect(await page.getByTestId('pivot-zigzag').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('pivot-estimate-label')).toHaveCount(1)
  await expect(page.getByTestId('pivot-estimate-level')).toHaveCount(1)
  await expect(page.getByTestId('pivot-estimate-leg')).toHaveAttribute('stroke-dasharray', /\d/)

  // Labels are messages inside the chart, so they stay transparent: the plate
  // is an outline only (`fill="none"`) and the glyph carries a halo class
  // instead of a solid background hiding the candles behind it.
  const label = page.getByTestId('pivot-label-regular-high').first()
  await expect(label.locator('rect')).toHaveAttribute('fill', 'none')
  await expect(label.locator('text')).toHaveClass(/chart-message/)
  await expect(label.locator('text')).toHaveText('▼')
  await expect(page.getByTestId('pivot-label-regular-low').first().locator('text')).toHaveText('▲')
  await expect(page.getByTestId('pivot-estimate-label').locator('text')).toHaveText('👻')

  // Every regular pivot label carries the published `str.tostring(price)` tooltip.
  const tooltip = await label.locator('title').textContent()
  expect(Number(tooltip)).toBeGreaterThan(0)

  await legend.click()
  await expect(page.getByRole('dialog', { name: NAME })).toBeVisible()
  await expect(page.getByLabel('Pivot length')).toHaveValue('50')
  await expect(page.getByRole('switch', { name: 'Show regular pivots' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Show missed pivots' })).toBeChecked()
  await expect(page.getByLabel('Regular high color hex')).toHaveValue('#ef5350')
  await expect(page.getByLabel('Missed low color hex')).toHaveValue('#26a69a')

  // A shorter window prints more pivots; missed reversals switch off separately.
  await page.getByLabel('Pivot length').fill('10')
  await page.getByRole('switch', { name: 'Show missed pivots' }).click()
  await page.getByLabel('Regular low color hex').fill('#00ff00')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()

  await expect(page.getByRole('button', { name: `${NAME} (10)` })).toBeVisible()
  await expect(page.getByTestId('pivot-estimate-label')).toHaveCount(0)
  await expect(page.getByTestId('pivot-estimate-level')).toHaveCount(1)
  await expect(page.getByTestId('pivot-label-regular-low').first().locator('rect')).toHaveAttribute(
    'stroke',
    '#00ff00',
  )
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.indicators') || '[]'),
  )
  expect(stored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'pivot-points-missed-reversals',
        period: 10,
        pivots: {
          pivotLength: 10,
          showRegular: true,
          regularHighColor: '#ef5350',
          regularLowColor: '#00ff00',
          showMissed: false,
          missedHighColor: '#ef5350',
          missedLowColor: '#26a69a',
          labelTextColor: '#ffffff',
        },
      }),
    ]),
  )

  // Malformed inputs are refused with a message instead of a silent fallback.
  await page.getByRole('button', { name: `${NAME} (10)` }).click()
  await page.getByLabel('Pivot length').fill('0')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('whole pivot length')

  // The published defaults restore with one click and survive a reload.
  await page.getByRole('button', { name: '(50) defaults' }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: `${NAME} (50)` })).toBeVisible()
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByRole('button', { name: `${NAME} (50)` })).toBeVisible()
  await expect(page.getByTestId('pivot-label-regular-high').first()).toBeVisible()
  await expect(page.getByTestId('pivot-estimate-label')).toHaveCount(1)
  expect(errors).toEqual([])
})
