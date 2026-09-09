/**
 * Drag-to-move behaviour shared by the floating chart windows (the timeframe peek and the AI
 * decision window).
 *
 * Both windows start docked in a corner of the chart and stay there until they are dragged, at
 * which point the position is remembered across reloads — a window you placed once should still
 * be where you left it. Positions are stored relative to the chart stage, because the stage
 * changes size whenever the editor, a side panel, or focus mode moves, and a window must never
 * be left stranded outside the area it belongs to.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { readStored, writeStored } from './storage'

export interface FloatingPosition {
  x: number
  y: number
}

export interface FloatingWindow {
  /** Put this on the window element that moves. */
  boxRef: React.RefObject<HTMLElement | null>
  /** The stored position, or null while the window is still docked in its corner. */
  position: FloatingPosition | null
  dragging: boolean
  /** Put this on the element that should start a drag, normally the window header. */
  startDrag: (event: React.PointerEvent) => void
  /** Forget the stored position and fall back to the docked corner. */
  reset: () => void
}

/** How close to the stage edge a window may sit, in pixels. */
const DEFAULT_PADDING = 8

export function useFloatingWindow(storageKey: string, padding = DEFAULT_PADDING): FloatingWindow {
  const [position, setPosition] = useState<FloatingPosition | null>(() =>
    readStored<FloatingPosition | null>(storageKey, null),
  )
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const positionRef = useRef<FloatingPosition | null>(position)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  const clampToStage = useCallback(
    (next: FloatingPosition): FloatingPosition => {
      const box = boxRef.current
      const stage = box?.parentElement
      if (!box || !stage) return next
      const { width, height } = box.getBoundingClientRect()
      const area = stage.getBoundingClientRect()
      const highest = (bound: number) => Math.max(padding, bound)
      return {
        x: Math.min(Math.max(padding, next.x), highest(area.width - width - padding)),
        y: Math.min(Math.max(padding, next.y), highest(area.height - height - padding)),
      }
    },
    [padding],
  )

  // The chart box changes size without a window resize event whenever the editor, a side panel,
  // or focus mode moves — and a dragged window must not end up clipped out of sight by that.
  useEffect(() => {
    const stage = boxRef.current?.parentElement
    if (!stage) return
    const reflow = () => setPosition((current) => (current ? clampToStage(current) : current))
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reflow)
      return () => window.removeEventListener('resize', reflow)
    }
    const observer = new ResizeObserver(reflow)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [clampToStage])

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      // Controls inside the header keep their own click behaviour.
      if ((event.target as HTMLElement).closest('button, select, label, a')) return
      const box = boxRef.current
      const stage = box?.parentElement
      if (!box || !stage) return
      const rect = box.getBoundingClientRect()
      const area = stage.getBoundingClientRect()
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        x: rect.left - area.left,
        y: rect.top - area.top,
      }
      setDragging(true)
      const move = (moveEvent: PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const next = clampToStage({
          x: drag.x + (moveEvent.clientX - drag.startX),
          y: drag.y + (moveEvent.clientY - drag.startY),
        })
        positionRef.current = next
        setPosition(next)
      }
      const stop = () => {
        dragRef.current = null
        setDragging(false)
        writeStored(storageKey, positionRef.current)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    },
    [clampToStage, storageKey],
  )

  const reset = useCallback(() => {
    positionRef.current = null
    setPosition(null)
    writeStored(storageKey, null)
  }, [storageKey])

  return { boxRef, position, dragging, startDrag, reset }
}

/**
 * Where the AI decision window starts.
 *
 * A floating window sits over live candles, so the default is a judgement about what else it would
 * cover. The window docks above the peek window, and both of them together need roughly 460px of
 * chart; the studio panel and toolbars take their fixed share, which puts that at about 940px of
 * viewport height. Below that it starts as a single line, and on a phone-width chart it starts
 * hidden — one keystroke away either way. Every one of those is a starting point only: an
 * explicit show, hide, or minimize is remembered like any other preference.
 */
export const AGENT_DECISION_MIN_WIDTH = 640
export const AGENT_DECISION_ROOMY_WIDTH = 1050
export const AGENT_DECISION_ROOMY_HEIGHT = 940

export const agentDecisionDefaultVisible = (viewportWidth: number): boolean =>
  viewportWidth >= AGENT_DECISION_MIN_WIDTH
export const agentDecisionDefaultMinimized = (width: number, height: number): boolean =>
  width < AGENT_DECISION_ROOMY_WIDTH || height < AGENT_DECISION_ROOMY_HEIGHT
