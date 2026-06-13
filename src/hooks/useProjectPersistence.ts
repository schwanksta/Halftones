import { useCallback, useState } from 'react'
import { HalftoneSettings, ImageTransformSettings, OutputSettings, CMYKSettings, SpotSettings, MaskSettings } from '../types'

const STORAGE_KEY = 'halftones_projects'
const LAST_PROJECT_KEY = 'halftones_last_project'

export interface ProjectSnapshot {
  savedAt: string
  halftoneSettings: HalftoneSettings
  transformSettings: ImageTransformSettings
  outputSettings: OutputSettings
  cmykSettings: CMYKSettings
  spotSettings?: SpotSettings
  /** Optional — absent in snapshots saved before the layer mask feature. */
  maskSettings?: MaskSettings
}

type ProjectStore = Record<string, ProjectSnapshot>

function readStore(): ProjectStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ProjectStore) : {}
  } catch {
    return {}
  }
}

function writeStore(store: ProjectStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (e) {
    console.warn('localStorage write failed:', e)
  }
}

export function useProjectPersistence() {
  const [projectNames, setProjectNames] = useState<string[]>(() => Object.keys(readStore()))

  const save = useCallback((name: string, snapshot: Omit<ProjectSnapshot, 'savedAt'>) => {
    const store = readStore()
    store[name] = { ...snapshot, savedAt: new Date().toISOString() }
    writeStore(store)
    localStorage.setItem(LAST_PROJECT_KEY, name)
    setProjectNames(Object.keys(store))
  }, [])

  const load = useCallback((name: string): ProjectSnapshot | null => {
    return readStore()[name] ?? null
  }, [])

  const remove = useCallback((name: string) => {
    const store = readStore()
    delete store[name]
    writeStore(store)
    setProjectNames(Object.keys(store))
  }, [])

  const lastProjectName = useCallback((): string | null => {
    return localStorage.getItem(LAST_PROJECT_KEY)
  }, [])

  return { save, load, remove, projectNames, lastProjectName }
}
