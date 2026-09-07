import { useCallback, useState } from 'react'

const PREFIX = 'atlas.v1.'
export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(PREFIX + key)
    return value === null ? fallback : (JSON.parse(value) as T)
  } catch {
    return fallback
  }
}
export function writeStored(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readStored(key, initial))
  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const result = typeof next === 'function' ? (next as (p: T) => T)(previous) : next
        writeStored(key, result)
        return result
      })
    },
    [key],
  )
  return [value, update] as const
}
export function downloadFile(name: string, content: Blob | string, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function uid() {
  return crypto.randomUUID()
}
