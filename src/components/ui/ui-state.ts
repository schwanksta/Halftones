import { useState } from 'react'

/**
 * Which sidebar sections / groups are open. Machine-level UI state, kept in
 * localStorage (works in both the browser and the Tauri webview) — NOT in the
 * project file, so opening someone else's project doesn't rearrange your panel.
 */
const STORAGE_KEY = 'halftones_ui'

export type OpenState = Record<string, boolean>

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Read the saved open/closed map. Never throws; anything unreadable is `{}`. */
export function readOpenState(storage: StorageLike | null | undefined): OpenState {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: OpenState = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the open/closed map. Never throws (private mode, quota, no storage). */
export function writeOpenState(storage: StorageLike | null | undefined, state: OpenState): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // UI state is a convenience — losing it is fine.
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

// Shared across every Section/Group so one toggle doesn't clobber another's entry.
let cache: OpenState | null = null

/** Open/closed state for one collapsible, remembered across launches. */
export function usePersistedOpen(id: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    cache ??= readOpenState(browserStorage())
    return cache[id] ?? defaultOpen
  })
  const toggle = () => {
    const next = !open
    cache = { ...(cache ?? {}), [id]: next }
    writeOpenState(browserStorage(), cache)
    setOpen(next)
  }
  return [open, toggle]
}
