import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { closeFloatingWindows } from './floating-windows'

/**
 * The two floating oscillator windows: the last twenty minutes of CM_Ult_MacD_MTF and of
 * WaveTrend [LazyBear], zoomed to their own scale instead of living in a full-height pane.
 *
 * Demo mode is deliberate — its candles are generated locally, so the windows' bars, numbers and
 * shapes stay deterministic without touching the exchange.
 */
const CM_WINDOW = 'CM_Ult_MacD_MTF window'
const WAVE_WINDOW = 'WaveTrend [LazyBear] window'
const RSI_DIV_WINDOW = 'RSI Divergence window'

async function openDemoChart(page: Page) {
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
}

/**
 * The floating windows live behind one toolbar selector. Its menu stays open across picks —
 * several windows can be flipped in one visit — so this opens it only when it is closed.
 */
async function openFloatingMenu(page: Page) {
  const menu = page.locator('.floating-picker .dropdown-menu')
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: /^Floating/ }).click()
    await expect(menu).toBeVisible()
  }
  return menu
}

function cmWindow(page: Page): Locator {
  return page.getByRole('region', { name: CM_WINDOW })
}
function waveWindow(page: Page): Locator {
  return page.getByRole('region', { name: WAVE_WINDOW })
}
function rsiDivWindow(page: Page): Locator {
  return page.getByRole('region', { name: RSI_DIV_WINDOW })
}

/** The oscillator pane a window borrows its settings from, when it is on the chart. */
function pane(page: Page, kind: string) {
  return page.locator(`.oscillator-legend[data-indicator="${kind}"]`)
}

test('both windows open on a fresh chart and show twenty minutes of bars', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openDemoChart(page)
  const cm = cmWindow(page)
  const wave = waveWindow(page)
  const rsiDiv = rsiDivWindow(page)

  await expect(cm).toBeVisible()
  await expect(wave).toBeVisible()
  await expect(rsiDiv).toBeVisible()
  // A 1m chart: twenty bars is exactly the twenty minutes that was asked for.
  await expect(cm).toContainText('20 bars')
  await expect(cm).toContainText('20 min')
  await expect(wave).toContainText('20 bars / 20 min')
  await expect(rsiDiv).toContainText('20 bars / 20 min')

  // Zoomed, and honest about where the settings come from: CM_Ult_MacD_MTF ships on a new
  // workspace, so its window reads that indicator; WaveTrend does not, so it says it is on
  // defaults and offers the pane.
  await expect(cm).toContainText('your indicator')
  await expect(wave).toContainText('default settings')
  await expect(rsiDiv).toContainText('default settings')
  await expect(
    wave.getByRole('button', { name: 'Add the WaveTrend [LazyBear] pane to the chart' }),
  ).toBeVisible()
  await expect(
    rsiDiv.getByRole('button', { name: 'Add the RSI Divergence pane to the chart' }),
  ).toBeVisible()

  // The mini chart is drawn, not described. Counts rather than visibility on purpose: a flat
  // stretch of an oscillator is a zero-height bounding box, and a zero-height box is what
  // Playwright calls invisible — so "it painted" is the claim, and "it painted every bar" is the
  // proof, while a NaN coordinate still fails the shape below.
  await expect(cm.locator('.osc-hud-histogram rect')).toHaveCount(20)
  await expect(cm.locator('.osc-hud-svg polyline')).toHaveCount(2)
  await expect(wave.locator('.osc-hud-svg polyline')).toHaveCount(2)
  await expect(wave.locator('.osc-hud-svg path')).toHaveCount(1)
  await expect(cm.locator('.osc-hud-svg polyline').first()).not.toHaveAttribute(
    'points',
    /NaN|undefined/,
  )
  await expect(wave.locator('.osc-hud-svg polyline').first()).not.toHaveAttribute(
    'points',
    /NaN|undefined/,
  )
  await expect(cm.locator('.osc-hud-verdict')).toContainText(
    /CROSS|ABOVE SIGNAL|BELOW SIGNAL|WARMING/,
  )
  expect(errors).toEqual([])
})

test('the floating selector owns each window, remembers the choice, and leaves the pane alone', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openDemoChart(page)
  const cmItem = page.locator('.menu-item.floating-cm-macd')
  const waveItem = page.locator('.menu-item.floating-wave-trend')
  const rsiDivItem = page.locator('.menu-item.floating-rsi-div')
  await openFloatingMenu(page)
  await expect(cmItem).toHaveClass(/selected/)
  await expect(waveItem).toHaveClass(/selected/)
  await expect(rsiDivItem).toHaveClass(/selected/)

  await cmItem.click()
  await expect(cmWindow(page)).toBeHidden()
  // The window is a view: closing it must not touch the indicator it reads.
  await expect(pane(page, 'cm-ult-macd')).toBeVisible()
  // …and not the other window either.
  await expect(waveWindow(page)).toBeVisible()
  await expect(rsiDivWindow(page)).toBeVisible()
  await expect(cmItem).not.toHaveClass(/selected/)

  await page.reload()
  await expect(cmWindow(page)).toBeHidden()
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('atlas.v1.osc-hud-visible:cm-ult-macd')!),
    ),
  ).toBe(false)

  await openFloatingMenu(page)
  await cmItem.click()
  await expect(cmWindow(page)).toBeVisible()
  await expect(cmWindow(page)).toContainText('20 bars')

  // Closing from the card itself is the same choice as the selector item, not a second
  // preference. The open menu drops over the window's own controls, so dismiss it first.
  await page.keyboard.press('Escape')
  await waveWindow(page).getByRole('button', { name: 'Hide WaveTrend [LazyBear] window' }).click()
  await expect(waveWindow(page)).toBeHidden()
  await openFloatingMenu(page)
  await expect(waveItem).not.toHaveClass(/selected/)
  expect(errors).toEqual([])
})

test('the zoom stepper widens one window without touching the other, and is remembered', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Only the two windows under test: the peek window docks over the CM card's zoom stepper.
  await closeFloatingWindows(page, ['cm-ult-macd', 'wave-trend'])
  await openDemoChart(page)
  const cm = cmWindow(page)
  await cm.getByRole('button', { name: 'More bars of CM_Ult_MacD_MTF in the window' }).click()
  await expect(cm).toContainText('24 bars')
  await expect(waveWindow(page)).toContainText('20 bars')

  await cm.getByRole('button', { name: 'Fewer bars of CM_Ult_MacD_MTF in the window' }).click()
  await cm.getByRole('button', { name: 'Fewer bars of CM_Ult_MacD_MTF in the window' }).click()
  await expect(cm).toContainText('16 bars')
  await expect(cm).toContainText('16 min')
  // The floor keeps a readable window: eight bars is as far as it goes, and the button says so.
  // From 16, two 4-bar steps reach it; a disabled button cannot be clicked a third time.
  for (let i = 0; i < 2; i++) {
    await cm.getByRole('button', { name: 'Fewer bars of CM_Ult_MacD_MTF in the window' }).click()
  }
  await expect(cm.locator('.osc-hud-zoom button').first()).toBeDisabled()
  await expect(cm).toContainText('8 bars')

  await page.reload()
  await expect(cmWindow(page)).toContainText('8 bars')
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('atlas.v1.osc-hud-bars')!)),
  ).toEqual({ 'cm-ult-macd': 8 })
  expect(errors).toEqual([])
})

test('minimizing, dragging and adding the pane all behave like furniture you own', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Only the window under test: dragged left, WaveTrend would slide under the RSI Divergence card.
  await closeFloatingWindows(page, ['wave-trend'])
  await openDemoChart(page)
  const wave = waveWindow(page)

  // Minimized: the chart goes, the call stays, and the choice survives a reload.
  await wave.getByRole('button', { name: 'Minimize WaveTrend [LazyBear] window' }).click()
  await expect(wave.locator('.osc-hud-plot')).toHaveCount(0)
  await expect(wave.locator('.osc-hud-min-row')).toBeVisible()
  await page.reload()
  await expect(waveWindow(page).locator('.osc-hud-min-row')).toBeVisible()
  await waveWindow(page).getByRole('button', { name: 'Expand WaveTrend [LazyBear] window' }).click()
  await expect(waveWindow(page).locator('.osc-hud-svg')).toBeVisible()

  // Dragging the header moves the window, and it stays where it was put.
  const before = await wave.boundingBox()
  const header = wave.locator('.osc-hud-head')
  const from = await header.boundingBox()
  await page.mouse.move(from!.x + 20, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(from!.x - 180, from!.y + 90, { steps: 8 })
  await page.mouse.up()
  const after = await wave.boundingBox()
  expect(after!.x).toBeLessThan(before!.x)
  await expect(wave.locator('.osc-hud-svg')).toBeVisible()

  // Adding the pane from the card: the window is now reading an indicator you own, and the
  // settings button replaces the add button.
  await wave.getByRole('button', { name: 'Add the WaveTrend [LazyBear] pane to the chart' }).click()
  await expect(pane(page, 'wave-trend')).toBeVisible()
  await expect(waveWindow(page)).toContainText('your indicator')
  await waveWindow(page).getByRole('button', { name: 'Settings for WaveTrend [LazyBear]' }).click()
  await expect(page.getByRole('dialog', { name: 'WaveTrend [LazyBear]' })).toBeVisible()
  expect(errors).toEqual([])
})

test('dragging the plot scrolls a window back through history, and live brings it back', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await closeFloatingWindows(page, ['wave-trend'])
  await openDemoChart(page)
  const wave = waveWindow(page)
  const tag = wave.locator('.osc-hud-tag')
  const sub = wave.locator('.osc-hud-sub')
  await expect(tag).toHaveText('LIVE')
  await expect(
    wave.getByRole('button', { name: 'Scroll WaveTrend [LazyBear] toward the live bar' }),
  ).toBeDisabled()
  const liveReadout = await wave.locator('.osc-hud-readout b').first().textContent()

  // Pulling the plot to the right brings older bars in, the way a chart pans: one bar per bar
  // width of drag, and the window says how far back it is looking.
  const card = await wave.boundingBox()
  const plot = await wave.locator('.osc-hud-svg').boundingBox()
  const perBar = plot!.width / 20
  // Start mid-plot, low down: the chart's own zoom toolbar can float over the card's left edge.
  const y = plot!.y + plot!.height * 0.8
  const x = plot!.x + plot!.width * 0.4
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + perBar * 6, y, { steps: 12 })
  await page.mouse.up()
  await expect(tag).toHaveText('HISTORY')
  await expect(sub).toContainText('6 bars back')
  await expect(wave.locator('.osc-hud-svg')).toBeVisible()
  // The bars moved, not the card: the header is still the only thing that relocates it.
  expect((await wave.boundingBox())!.x).toBe(card!.x)

  // The buttons step a quarter of the window at a time.
  await wave
    .getByRole('button', { name: 'Scroll WaveTrend [LazyBear] back through history' })
    .click()
  await expect(sub).toContainText('11 bars back')
  await wave
    .getByRole('button', { name: 'Scroll WaveTrend [LazyBear] toward the live bar' })
    .click()
  await expect(sub).toContainText('6 bars back')

  await wave.getByRole('button', { name: 'Back to the live bar in WaveTrend [LazyBear]' }).click()
  await expect(tag).toHaveText('LIVE')
  await expect(sub).not.toContainText('bars back')
  await expect(wave.locator('.osc-hud-readout b').first()).toHaveText(liveReadout!)
  expect(errors).toEqual([])
})
