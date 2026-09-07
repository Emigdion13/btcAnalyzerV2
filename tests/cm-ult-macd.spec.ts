import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const title = 'CM_Ult_MacD_MTF (60, 12, 26, 9)'
async function demo(page: Page) {
  await page.addInitScript(() => localStorage.setItem('atlas.v1.feed-active', 'false'))
  await page.goto('/?source=demo')
  await expect(page.locator('.cm-oscillator-legend')).toBeVisible()
}
async function palette(page: Page) {
  return page.locator('.chart-canvas canvas').evaluateAll((canvases) => {
    const counts: Record<string, number> = Object.fromEntries(
      ['00ffff', '0000ff', 'ff0000', '800000', 'ffff00', '00ff00', 'ffffff'].map((c) => [c, 0]),
    )
    for (const element of canvases) {
      const canvas = element as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) continue
        const color = [pixels[i], pixels[i + 1], pixels[i + 2]]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
        if (color in counts) counts[color]++
      }
    }
    return counts
  })
}

test('renders the original four histogram colors, lines, dots and white zero line', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await demo(page)
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.cm-resolution-badge')).toHaveText('Chart · 1h')
  await expect(page.locator('.cm-oscillator-legend [data-plot]')).toHaveCount(4)
  await expect(page.locator('.cm-oscillator-legend [data-plot="MACD"]')).not.toHaveText('—')
  // Inspect the actual chart canvas, not merely the calculation arrays/legend.
  for (const color of ['00ffff', '0000ff', 'ff0000', '800000', 'ffff00', '00ff00', 'ffffff'])
    await expect.poll(async () => (await palette(page))[color]).toBeGreaterThan(5)
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show Histogram?', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('[data-plot="Histogram"]')).toHaveText('—')
  await expect.poll(async () => (await palette(page))['00ffff']).toBe(0)
  await expect.poll(async () => (await palette(page))['0000ff']).toBe(0)
  await expect.poll(async () => (await palette(page))['800000']).toBe(0)
  expect(errors).toEqual([])
})

test('preserves all original inputs, supports native validation and restores defaults', async ({
  page,
}) => {
  await demo(page)
  await page.getByRole('button', { name: title, exact: true }).click()
  const resolution = page.getByRole('combobox', { name: /Use Different Timeframe/ })
  await expect(
    page.getByRole('checkbox', { name: 'Use Current Chart Resolution?', exact: true }),
  ).toBeChecked()
  await expect(resolution).toBeDisabled()
  await expect(resolution).toHaveValue('1h')
  for (const name of [
    'Show MacD & Signal Line? Also Turn Off Dots Below',
    'Show Dots When MacD Crosses Signal Line?',
    'Show Histogram?',
    'Change MacD Line Color-Signal Line Cross?',
    'MacD Histogram 4 Colors?',
  ])
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked()
  await page.getByRole('spinbutton', { name: 'Fast Length', exact: true }).fill('0')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Fast Length', exact: true }).fill('8')
  await page.getByRole('spinbutton', { name: 'Slow Length', exact: true }).fill('21')
  await page.getByRole('spinbutton', { name: 'Signal Length', exact: true }).fill('5')
  await page.getByRole('checkbox', { name: 'Use Current Chart Resolution?', exact: true }).uncheck()
  await resolution.selectOption('4h')
  await page
    .getByRole('checkbox', { name: 'Change MacD Line Color-Signal Line Cross?', exact: true })
    .uncheck()
  await page.getByRole('checkbox', { name: 'MacD Histogram 4 Colors?', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('.cm-resolution-badge')).toHaveText('MTF · 4h')
  await page.reload()
  const changed = page.getByRole('button', { name: 'CM_Ult_MacD_MTF (240, 8, 21, 5)', exact: true })
  await expect(changed).toBeVisible()
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas.v1.indicators')!).find(
      (i: { kind: string }) => i.kind === 'cm-ult-macd',
    ),
  )
  expect(saved.cmMacd).toMatchObject({
    fastLength: 8,
    slowLength: 21,
    signalLength: 5,
    resCustom: '4h',
    useCurrentRes: false,
    macdColorChange: false,
    histogramColorChange: false,
  })
  await expect(page.locator('.cm-oscillator-legend [data-plot="Signal Line"]')).toHaveCSS(
    'color',
    'rgb(0, 255, 0)',
  )
  await changed.click()
  await page.getByRole('button', { name: 'Original defaults', exact: true }).click()
  await expect(resolution).toBeDisabled()
  await expect(page.getByRole('spinbutton', { name: 'Slow Length', exact: true })).toHaveValue('26')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(page.locator('.cm-resolution-badge')).toHaveText('Chart · 1h')
})

test('hides, restores, removes and finds the clone by its original author', async ({ page }) => {
  await demo(page)
  await page.getByRole('button', { name: 'Toggle CM_Ult_MacD_MTF visibility', exact: true }).click()
  await expect(page.locator('.cm-oscillator-legend')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle CM_Ult_MacD_MTF 12', exact: true }).click()
  await expect(page.locator('.cm-oscillator-legend')).toBeVisible()
  await page.getByRole('button', { name: 'Remove CM_Ult_MacD_MTF 12', exact: true }).click()
  await expect(page.locator('.cm-oscillator-legend')).toHaveCount(0)
  await page.getByRole('button', { name: /^Indicators/ }).click()
  await page.getByRole('textbox', { name: 'Search indicators', exact: true }).fill('ChrisMoody')
  await expect(page.locator('.indicator-catalog-row')).toHaveCount(1)
  await expect(page.locator('.indicator-catalog-row')).toContainText('CM_Ult_MacD_MTF')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '5m timeframe', exact: true }).click()
  await expect(page.locator('.cm-resolution-badge')).toHaveText('Chart · 5m')
})

test('keeps the zero line when all original plots are off and exports that chart', async ({
  page,
}) => {
  await demo(page)
  await page.getByRole('button', { name: title, exact: true }).click()
  for (const name of [
    'Show MacD & Signal Line? Also Turn Off Dots Below',
    'Show Dots When MacD Crosses Signal Line?',
    'Show Histogram?',
  ])
    await page.getByRole('checkbox', { name, exact: true }).uncheck()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('.cm-oscillator-legend [data-plot]')).toHaveText(['—', '—', '—', '—'])
  await expect.poll(async () => (await palette(page))['ffffff']).toBeGreaterThan(10)
  await expect.poll(async () => (await palette(page))['00ff00']).toBe(0)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download chart snapshot', exact: true }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/\.png$/)
  expect(await file.failure()).toBeNull()
})

test('opens and edits the original controls on mobile without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await demo(page)
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('checkbox', { name: 'Use Current Chart Resolution?', exact: true }).uncheck()
  await page.getByRole('spinbutton', { name: 'Slow Length', exact: true }).fill('30')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('.cm-resolution-badge')).toHaveText('MTF · 1h')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(
    page.getByRole('button', { name: 'CM_Ult_MacD_MTF (60, 12, 30, 9)', exact: true }),
  ).toBeVisible()
})
