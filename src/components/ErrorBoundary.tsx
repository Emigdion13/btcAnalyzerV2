import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence around the whole workspace.
 *
 * React unmounts the entire tree when an error escapes a render or an effect and
 * nothing catches it, which leaves an empty root over the near-black page
 * background — the app looks like it simply died, with no way to tell what
 * happened and no way back short of a reload. Catching here turns that into a
 * message and a reload button.
 *
 * This is a net, not a substitute for handling known failure modes where they
 * happen: state that arrives from localStorage is normalized at the boundary it
 * crosses, and effects that can be poisoned by a single bad entry guard
 * themselves. Anything landing here is a bug worth reading.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Atlas crashed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-panel" role="alert">
        <h1>Atlas hit an unexpected error</h1>
        <p>
          The chart is still there — reloading restores your workspace, drawings, alerts and agent
          journal from local storage.
        </p>
        <pre>{this.state.error.message || String(this.state.error)}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Atlas
        </button>
      </div>
    )
  }
}
