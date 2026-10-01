import type { Page } from '@playwright/test'

/**
 * The floating chart windows that can open on their own, by the key their open/closed choice is
 * saved under. The oscillator windows all start open by design, and on the 1440×900 test viewport
 * they dock over most of the chart — the indicator legend and the pane legends included — so a
 * test that clicks a legend or draws on the chart would be clicking a window instead.
 */
export const FLOATING_WINDOW_KEYS = {
  'cm-ult-macd': 'osc-hud-visible:cm-ult-macd',
  'wave-trend': 'osc-hud-visible:wave-trend',
  'rsi-divergence': 'osc-hud-visible:rsi-divergence',
  'cm-williams-vix-fix': 'osc-hud-visible:cm-williams-vix-fix',
  'tmo-scalper': 'osc-hud-visible:tmo-scalper',
  'bayesian-nqqe-bankfunds': 'osc-hud-visible:bayesian-nqqe-bankfunds',
  'zeiierman-trend-pressure': 'osc-hud-visible:zeiierman-trend-pressure',
  'timeframe-peek': 'timeframe-peek-visible',
  'candle-pulse': 'candle-pulse-visible',
  'mtf-rsi': 'mtf-rsi-visible',
  'chile-panel': 'chile-panel-visible',
  'randy-v8': 'randy-panel-visible',
  'kalshi-float': 'kalshi-float-visible',
} as const

export type FloatingWindow = keyof typeof FLOATING_WINDOW_KEYS

/**
 * Start the page with every floating window closed except `keep` — the chart a trader sees after
 * putting the windows away. Only a choice that was never made is filled in, so a test that opens or
 * closes a window and reloads still reads back its own choice.
 */
export async function closeFloatingWindows(page: Page, keep: FloatingWindow[] = []) {
  const keys = (Object.keys(FLOATING_WINDOW_KEYS) as FloatingWindow[])
    .filter((name) => !keep.includes(name))
    .map((name) => `atlas.v1.${FLOATING_WINDOW_KEYS[name]}`)
  await page.addInitScript((closed) => {
    // Init scripts run in every frame, including the sandboxed script-runner iframe, where
    // touching localStorage throws. Only the app's own document holds the preferences.
    try {
      for (const key of closed)
        if (localStorage.getItem(key) === null) localStorage.setItem(key, 'false')
    } catch {
      // not the app's document
    }
  }, keys)
}
