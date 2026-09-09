import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Roomy enough for the window beside the docked peek window, so it starts expanded here.
test.use({ viewport: { width: 1512, height: 982 } })

/**
 * The floating AI decision window: the ensemble's general call, kept in chart context.
 * Demo mode is deliberate — its candles are generated locally, so the verdict and the window's
 * chrome stay deterministic without touching the exchange.
 */
async function openDemoChart(page: Page, timeframe = '1m') {
  await page.goto(`/?source=demo&interval=${timeframe}`)
  await expect(page.locator('canvas').first()).toBeVisible()
  const decision = page.getByTestId('agent-decision')
  await expect(decision).toBeVisible()
  return decision
}

test('shows the ensemble call with its levels, reason and higher frames', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const decision = await openDemoChart(page)

  // The window is the ensemble's verdict, not a specialist's: one call, one confidence.
  await expect(decision.locator('.ai-decision-badge')).toContainText(
    /Bullish|Bearish|No trade|Waiting/,
  )
  await expect(decision.locator('.ai-decision-call')).toBeVisible()
  await expect(decision).toContainText(/score/i)
  await expect(decision).toContainText(/regime/i)
  await expect(decision).toContainText(/support/i)
  await expect(decision).toContainText(/resistance/i)
  // The split bar carries how much of the ensemble agrees, as a hover away from the headline.
  await expect(decision.locator('.ai-decision-split')).toHaveAttribute('title', /specialists/)
  await expect(decision.locator('.ai-decision-reason')).not.toBeEmpty()
  // Higher frames feeding the context agent are shown, not hidden behind the panel.
  await expect(decision.locator('.ai-decision-context-chip').first()).toBeVisible()

  // The deep breakdown stays one click away rather than living in the window.
  await decision.getByRole('button', { name: /Agents/ }).click()
  await expect(page.locator('.agent-panel')).toBeVisible()
  expect(errors).toEqual([])
})

test('drags, minimizes, and remembers the window across a reload', async ({ page }) => {
  const decision = await openDemoChart(page)
  const docked = await decision.boundingBox()
  expect(docked).not.toBeNull()

  const head = decision.locator('.ai-decision-head')
  const from = await head.boundingBox()
  await page.mouse.move(from!.x + 40, from!.y + 8)
  await page.mouse.down()
  await page.mouse.move(from!.x + 200, from!.y + 60, { steps: 6 })
  await page.mouse.up()
  const moved = await decision.boundingBox()
  expect(Math.round(moved!.x)).toBeGreaterThan(Math.round(docked!.x))

  await decision.getByRole('button', { name: 'Minimize the AI decision window' }).click()
  await expect(decision.locator('.ai-decision-min-row')).toBeVisible()
  await expect(decision.locator('.ai-decision-verdict')).toHaveCount(0)
  await decision.getByRole('button', { name: 'Expand the AI decision window' }).click()
  await expect(decision.locator('.ai-decision-verdict')).toBeVisible()

  // A window you placed once stays placed, minimized state included.
  await page.reload()
  const restored = page.getByTestId('agent-decision')
  await expect(restored).toBeVisible()
  expect(Math.round((await restored.boundingBox())!.x)).toBe(Math.round(moved!.x))

  // ...and the reset button hands the docked corner back.
  await restored
    .getByRole('button', { name: 'Snap the AI decision window back to its docked spot' })
    .click()
  expect(Math.round((await restored.boundingBox())!.x)).toBe(Math.round(docked!.x))
})

test('starts minimized on a short chart and expands on request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?source=demo&interval=1m')
  await expect(page.locator('canvas').first()).toBeVisible()
  const decision = page.getByTestId('agent-decision')
  await expect(decision).toBeVisible()
  // A 1440x900 chart has room for the peek window or this one, not both expanded.
  await expect(decision.locator('.ai-decision-min-row')).toBeVisible()
  await expect(decision.locator('.ai-decision-verdict')).toHaveCount(0)
  await decision.getByRole('button', { name: 'Expand the AI decision window' }).click()
  await expect(decision.locator('.ai-decision-verdict')).toBeVisible()
})

test('hides with Alt A, remembers the choice, and stays out of bar replay', async ({ page }) => {
  await openDemoChart(page)
  await page.keyboard.press('Alt+a')
  await expect(page.getByTestId('agent-decision')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('agent-decision')).toHaveCount(0)
  await page.keyboard.press('Alt+a')
  await expect(page.getByTestId('agent-decision')).toBeVisible()

  // Replayed bars are not live candles: the call, like the peek window, steps aside.
  // The replay controls carry their own "Replay …" buttons, so this targets the toolbar toggle.
  const replay = page.locator('.toolbar-button.replay-button')
  await replay.click()
  await expect(page.getByTestId('agent-decision')).toHaveCount(0)
  await replay.click()
  await expect(page.getByTestId('agent-decision')).toBeVisible()
})
