import { useRef, useCallback } from 'react'
import { AllSettings } from '../platform/types'

const MAX_HISTORY = 50
const DEBOUNCE_MS = 600

/**
 * Limited undo/redo history for settings snapshots.
 *
 * Usage:
 *   const { pushSnapshot, undo, redo, canUndo, canRedo } = useUndoHistory(applySettings)
 *
 *   // After a programmatic applySettings call (project load, undo/redo itself),
 *   // set skipNextPushRef.current = true so the settings-change watcher doesn't
 *   // push a redundant snapshot.
 */
export function useUndoHistory(applySettings: (s: AllSettings) => void) {
  // past[past.length - 1] is the most recent saved state (before current)
  const pastRef   = useRef<AllSettings[]>([])
  // future[0] is the next redo target
  const futureRef = useRef<AllSettings[]>([])

  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef      = useRef<AllSettings | null>(null)

  /**
   * Set this to true before calling applySettings() from undo/redo/project-load
   * so the settings-change watcher skips one push.
   */
  const skipNextPushRef = useRef(false)

  /** Flush any pending debounced snapshot immediately. */
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (pendingRef.current) {
      const snap = pendingRef.current
      pendingRef.current = null
      const past = pastRef.current
      // Avoid pushing identical consecutive states
      if (past.length > 0) {
        const last = past[past.length - 1]
        if (JSON.stringify(last) === JSON.stringify(snap)) return
      }
      past.push(snap)
      if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY)
    }
  }, [])

  /**
   * Called whenever settings change.  Debounces: rapid slider drags
   * only produce one history entry.  Clears the redo stack on any
   * new user action.
   */
  const pushSnapshot = useCallback((settings: AllSettings) => {
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }

    // Clear redo on any new user-initiated change
    futureRef.current = []

    pendingRef.current = settings

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      if (pendingRef.current) {
        const snap = pendingRef.current
        pendingRef.current = null
        const past = pastRef.current
        if (past.length > 0) {
          const last = past[past.length - 1]
          if (JSON.stringify(last) === JSON.stringify(snap)) return
        }
        past.push(snap)
        if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY)
      }
    }, DEBOUNCE_MS)
  }, [])

  const undo = useCallback((currentSettings: AllSettings) => {
    flush()
    const past = pastRef.current
    if (past.length === 0) return
    const prev = past.pop()!
    futureRef.current.unshift(currentSettings)
    skipNextPushRef.current = true
    applySettings(prev)
  }, [applySettings, flush])

  const redo = useCallback((currentSettings: AllSettings) => {
    flush()
    const future = futureRef.current
    if (future.length === 0) return
    const next = future.shift()!
    pastRef.current.push(currentSettings)
    skipNextPushRef.current = true
    applySettings(next)
  }, [applySettings, flush])

  const canUndo = useCallback(() => pastRef.current.length > 0 || pendingRef.current !== null, [])
  const canRedo = useCallback(() => futureRef.current.length > 0, [])

  /** Call when loading a project/image to clear history entirely. */
  const clearHistory = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    pendingRef.current = null
    pastRef.current = []
    futureRef.current = []
  }, [])

  return { pushSnapshot, undo, redo, canUndo, canRedo, clearHistory, skipNextPushRef }
}
