import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initializeCoinbaseWorkspace } from './lib/market-settings'
import './styles.css'

initializeCoinbaseWorkspace()

// React's development build records a performance.measure (with a ~1 KB "changed props" detail)
// for every component render, and the browser keeps every entry until the page closes. On the
// live feed that is ~250 entries a second, enough for Chrome to reload a tab left open for
// hours. DevTools profiles read the trace, not this buffer, so dropping it loses nothing.
// Production React records none.
if (import.meta.env.DEV) setInterval(() => performance.clearMeasures(), 30_000)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
