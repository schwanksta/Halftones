import { useEffect, useRef, useState } from 'react'

/**
 * Simple dirty-boolean tracker: flips true when `watchedKey` changes, flips
 * false only via `markClean()` (after a successful save/load). No deep hashing —
 * "dirty back to the original value" still reads as dirty until save. Good
 * enough for a personal-use app.
 */
export function useDirtyTracking(watchedKey: unknown) {
  const [dirty, setDirty] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    setDirty(true)
  }, [watchedKey])

  return {
    dirty,
    markClean: () => setDirty(false),
    markDirty: () => setDirty(true),
  }
}
