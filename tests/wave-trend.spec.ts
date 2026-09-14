import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const title = 'WaveTrend [LazyBear] (10, 21)'
const legend = '.oscillator-legend[data-indicator="wave-trend"]'
async function demo(page: Page) {
  await page.addInitScript(() => localStorage.setItem('atlas.v1.feed-active', 'false'))
  await page.goto('/?source=demo')
  await expect(page.locator('.chart-canvas canvas').first()).toBeVisible()
}
async function addFromLibrary(page: Page, search = 'LazyBear') {
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators', exact: true }).fill(search)
  await expect(page.locator('.indicator-catalog-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
}
/**
 * The original colors are one-pixel-wide Pine lines and an 80%-transparent area,
 * so exact palette matching is unreliable: count color families instead. `fromY`
 * (a viewport coordinate, e.g. the pane's own legend) restricts the count to the
 * oscillator pane, so the price candles cannot inflate it.
 */
async function palette(page: Page, fromY?: number) {
  return page.locator('.chart-canvas canvas').evaluateAll((canvases, top) => {
    const ratio = window.devicePixelRatio || 1
    let green = 0,
      red = 0,
      blue = 0
    for (const element of canvases) {
      const canvas = element as HTMLCanvasElement
      const start =
        top === undefined
          ? 0
          : Math.max(0, Math.round((top - canvas.getBoundingClientRect().top) * ratio))
      const height = canvas.height - start
      if (height <= 0) continue
      const pixels = canvas.getContext('2d')!.getImageData(0, start, canvas.width, height).data
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) continue
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
        if (g > r + 30 && g > b + 30 && g > 60) green++
        else if (r > g + 60 && r > b + 60 && r > 80) red++
        else if (b > r + 30 && b > g + 30 && b > 40) blue++
      }
    }
    return { green, red, blue }
  }, fromY)
}

test('adds the original wave, dotted signal, area and levels to its own pane', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await demo(page)
  const before = await palette(page)
  await addFromLibrary(page)
  await expect(page.locator(legend)).toBeVisible()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(page.locator(`${legend} [data-plot]`)).toHaveCount(3)
  await expect(page.locator(`${legend} [data-plot="WT1"]`)).not.toHaveText('—')
  await expect(page.locator(`${legend} [data-plot="WT2"]`)).not.toHaveText('—')
  await expect(page.locator(`${legend} [data-plot="WT1 - WT2"]`)).not.toHaveText('—')
  // Inspect the painted canvas, not merely the calculation arrays and legend.
  const box = (await page.locator(legend).boundingBox())!
  const painted = await palette(page, box.y)
  expect(painted.green).toBeGreaterThan(20) // WT1
  expect(painted.red).toBeGreaterThan(20) // WT2 crosses and the overbought levels
  expect(painted.blue).toBeGreaterThan(100) // the transparent WT1 − WT2 area
  // The pane legend reveals its controls on hover, like every other oscillator pane.
  await page.locator(legend).hover()
  await page
    .getByRole('button', { name: 'Toggle WaveTrend [LazyBear] visibility', exact: true })
    .click()
  await expect(page.locator(legend)).toHaveCount(0)
  await expect.poll(async () => (await palette(page)).blue).toBeLessThanOrEqual(before.blue + 20)
  expect(errors).toEqual([])
})

test('persists all six published inputs and restores the original defaults', async ({ page }) => {
  await demo(page)
  await addFromLibrary(page)
  await page.getByRole('button', { name: title, exact: true }).click()
  for (const [name, value] of [
    ['Channel Length', '10'],
    ['Average Length', '21'],
    ['Over Bought Level 1', '60'],
    ['Over Bought Level 2', '53'],
    ['Over Sold Level 1', '-60'],
    ['Over Sold Level 2', '-53'],
  ])
    await expect(page.getByRole('spinbutton', { name, exact: true })).toHaveValue(value)
  await page.getByRole('spinbutton', { name: 'Channel Length', exact: true }).fill('0')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Channel Length', exact: true }).fill('21')
  await page.getByRole('spinbutton', { name: 'Average Length', exact: true }).fill('34')
  await page.getByRole('spinbutton', { name: 'Over Bought Level 1', exact: true }).fill('55')
  await page.getByRole('spinbutton', { name: 'Over Sold Level 1', exact: true }).fill('-55')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  const changed = page.getByRole('button', { name: 'WaveTrend [LazyBear] (21, 34)', exact: true })
  await expect(changed).toBeVisible()
  await page.reload()
  await expect(changed).toBeVisible()
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('atlas.v1.indicators')!).find(
        (i: { kind: string }) => i.kind === 'wave-trend',
      ),
    ),
  ).toMatchObject({
    period: 21,
    waveTrend: {
      channelLength: 21,
      averageLength: 34,
      obLevel1: 55,
      obLevel2: 53,
      osLevel1: -55,
      osLevel2: -53,
    },
  })
  await changed.click()
  await page.getByRole('button', { name: 'Original defaults', exact: true }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
})

test('removes, restores and edits the oscillator on mobile without overflow', async ({ page }) => {
  await demo(page)
  await addFromLibrary(page, 'WaveTrend')
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await page.locator(legend).hover()
  await page.getByRole('button', { name: 'Remove WaveTrend [LazyBear] 10', exact: true }).click()
  await expect(page.locator(legend)).toHaveCount(0)
  await addFromLibrary(page, 'WaveTrend')
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  // The toolbar drops the Indicators button at phone width, so add it first.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Channel Length', exact: true }).fill('14')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'WaveTrend [LazyBear] (14, 21)', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
