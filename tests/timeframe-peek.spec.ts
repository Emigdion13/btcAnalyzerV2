import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The floating timeframe-peek window: a second resolution on the chart, forming bar included.
 * Demo mode is deliberate — its candles are generated locally, so the window's content and the
 * resolution maths stay deterministic without touching the exchange.
 */
async function openDemoChart(page: Page, timeframe = '1m') {
  await page.goto(`/?source=demo&interval=${timeframe}`)
  await expect(page.locator('canvas').first()).toBeVisible()
  const peek = page.getByTestId('timeframe-peek')
  await expect(peek).toBeVisible()
  return peek
}

test('peeks at another timeframe and states the ratio to the chart', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const peek = await openDemoChart(page)
  // Auto follows a 1m chart with 15m: twelve bars, the newest still forming.
  await expect(peek).toContainText('15m')
  await expect(peek).toContainText('1 bar = 15 chart bars')
  await expect(peek.locator('.peek-bar')).toHaveCount(12)
  await expect(peek.locator('.peek-svg')).toBeVisible()
  // Demo bars are a fixed synthetic history, so the panel reports the newest one as closed
  // instead of claiming a live forming bar it cannot have.
  await expect(peek.locator('.peek-state')).toContainText('closed')

  await peek.getByLabel('Timeframe to peek at').selectOption('1h')
  await expect(peek).toContainText('1 bar = 60 chart bars')
  await expect(peek.locator('.peek-bar')).toHaveCount(12)

  await peek.getByRole('button', { name: 'More candles in the peek window' }).click()
  await expect(peek.locator('.peek-bar')).toHaveCount(14)
  expect(errors).toEqual([])
})

test('minimizes, hides, and remembers the window across a reload', async ({ page }) => {
  const peek = await openDemoChart(page)
  await peek.getByRole('button', { name: 'Minimize the peek window' }).click()
  await expect(peek.locator('.peek-min-row')).toBeVisible()
  await expect(peek.locator('.peek-bar')).toHaveCount(0)
  await peek.getByRole('button', { name: 'Expand the peek window' }).click()
  await expect(peek.locator('.peek-bar')).toHaveCount(12)

  await page.getByRole('button', { name: /^Peek/ }).click()
  await expect(peek).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('timeframe-peek')).toBeHidden()
  await page.keyboard.press('Alt+p')
  await expect(page.getByTestId('timeframe-peek')).toBeVisible()

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.timeframe-peek') || 'null'),
  )
  expect(stored).toMatchObject({ resolution: 'auto', bars: 12 })
})

test('steps down when the chart is already the largest resolution', async ({ page }) => {
  const peek = await openDemoChart(page, '1W')
  await expect(peek).toContainText('1D')
  await expect(peek).toContainText('7 bars = 1 chart bar')
  await expect(peek.locator('.peek-bar')).toHaveCount(12)
})
