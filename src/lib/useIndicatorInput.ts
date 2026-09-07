import { useEffect, useRef, useState } from 'react'
import type { Candle } from './types'
/** Batch automatic custom-script recomputations without starving 2-second jobs. */
export function useIndicatorInput(candles: Candle[], context: string) {
  const latest = useRef({ candles, context, sampledAt: Date.now() })
  if (latest.current.candles !== candles || latest.current.context !== context)
    latest.current = { candles, context, sampledAt: Date.now() }
  const [input, setInput] = useState(latest.current)
  useEffect(() => {
    setInput(latest.current)
    const timer = setInterval(
      () =>
        setInput((previous) =>
          previous.candles === latest.current.candles && previous.context === latest.current.context
            ? previous
            : latest.current,
        ),
      2500,
    )
    return () => clearInterval(timer)
  }, [context])
  return input.context === context ? input : latest.current
}
