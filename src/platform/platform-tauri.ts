import { open, save } from '@tauri-apps/plugin-dialog'
import {
  readFile,
  writeFile,
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  rename,
} from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  appDataDir,
  join,
  dirname,
  documentDir,
  pictureDir,
} from '@tauri-apps/api/path'

import { PlatformAPI, RecentEntry, MenuEvent } from './types'
import { packHalftonesFile, unpackHalftonesFile } from './halftones-file'

// ─── Prefs ────────────────────────────────────────────────────────────────────

interface Prefs {
  lastProjectPath: string | null
  recent: RecentEntry[]
  lastDirs: {
    open?: string
    save?: string
    export?: string
    image?: string
  }
}

const DEFAULT_PREFS: Prefs = {
  lastProjectPath: null,
  recent: [],
  lastDirs: {},
}

async function prefsPath(): Promise<string> {
  return join(await appDataDir(), 'prefs.json')
}

async function ensureAppDataDir(): Promise<void> {
  const dir = await appDataDir()
  const dirExists = await exists(dir)
  if (!dirExists) {
    await mkdir(dir, { recursive: true })
  }
}

async function readPrefs(): Promise<Prefs> {
  try {
    const path = await prefsPath()
    const fileExists = await exists(path)
    if (!fileExists) return { ...DEFAULT_PREFS, lastDirs: {} }
    const text = await readTextFile(path)
    return JSON.parse(text) as Prefs
  } catch (e) {
    console.warn('[halftones] Failed to read prefs, using defaults:', e)
    return { ...DEFAULT_PREFS, lastDirs: {} }
  }
}

async function writePrefs(prefs: Prefs): Promise<void> {
  await ensureAppDataDir()
  const path = await prefsPath()
  const tmp = path + '.tmp'
  await writeTextFile(tmp, JSON.stringify(prefs, null, 2))
  await rename(tmp, path)
}

async function getLastDir(key: 'open' | 'save' | 'export' | 'image'): Promise<string> {
  const prefs = await readPrefs()
  const stored = prefs.lastDirs[key]
  if (stored) {
    const dirExists = await exists(stored)
    if (dirExists) return stored
  }

  // Fallbacks
  if (key === 'image') {
    return pictureDir()
  }

  // open / save / export → ~/Documents/Halftones/
  const docDir = await documentDir()
  const halftoneDir = await join(docDir, 'Halftones')
  const htExists = await exists(halftoneDir)
  if (!htExists) {
    await mkdir(halftoneDir, { recursive: true })
  }
  return halftoneDir
}

// ─── Slugify (matches toStem logic in export.ts) ──────────────────────────────

function slugify(name: string): string {
  return (name || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled'
}

// ─── Platform implementation ──────────────────────────────────────────────────

export function createPlatform(): PlatformAPI {
  return {
    // ── Project I/O ──────────────────────────────────────────────────────────

    async openProjectDialog() {
      const defaultPath = await getLastDir('open')
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Halftones Project', extensions: ['halftones'] }],
        defaultPath,
      })
      if (!selected) return null

      const path = typeof selected === 'string' ? selected : (selected as string[])[0]
      const bytes = await readFile(path)
      const project = await unpackHalftonesFile(bytes)

      const prefs = await readPrefs()
      prefs.lastDirs.open = await dirname(path)
      // Add to recent
      prefs.recent = prefs.recent.filter((r) => r.path !== path)
      prefs.recent.unshift({ path, name: project.name, lastOpened: Date.now() })
      if (prefs.recent.length > 10) prefs.recent = prefs.recent.slice(0, 10)
      await writePrefs(prefs)

      return { project, path }
    },

    async saveProject(project, path) {
      const bytes = await packHalftonesFile(project)
      const tmp = path + '.tmp'
      try {
        await writeFile(tmp, bytes)
        await rename(tmp, path)
      } catch (err) {
        // Leave tmp file in place; propagate so caller can toast
        throw err
      }

      const prefs = await readPrefs()
      prefs.lastDirs.save = await dirname(path)
      prefs.recent = prefs.recent.filter((r) => r.path !== path)
      prefs.recent.unshift({ path, name: project.name, lastOpened: Date.now() })
      if (prefs.recent.length > 10) prefs.recent = prefs.recent.slice(0, 10)
      await writePrefs(prefs)
    },

    async saveProjectAsDialog(project) {
      const prefs = await readPrefs()
      let defaultDir = prefs.lastDirs.save
      if (!defaultDir) {
        const docDir = await documentDir()
        defaultDir = await join(docDir, 'Halftones')
        const dirExists = await exists(defaultDir)
        if (!dirExists) {
          await mkdir(defaultDir, { recursive: true })
        }
      }

      const defaultFilename = slugify(project.name) + '.halftones'
      const defaultPath = await join(defaultDir, defaultFilename)

      const path = await save({
        defaultPath,
        filters: [{ name: 'Halftones Project', extensions: ['halftones'] }],
      })
      if (!path) return null

      await this.saveProject(project, path)
      return path
    },

    // ── Image import ─────────────────────────────────────────────────────────

    async openImageDialog() {
      const defaultPath = await getLastDir('image')
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        defaultPath,
      })
      if (!selected) return null

      const path = typeof selected === 'string' ? selected : (selected as string[])[0]
      const bytes = await readFile(path)
      const fileName = path.split('/').pop()!

      const prefs = await readPrefs()
      prefs.lastDirs.image = await dirname(path)
      await writePrefs(prefs)

      return { bytes, fileName }
    },

    async loadImageFromPath(path) {
      const bytes = await readFile(path)
      return { bytes, fileName: path.split('/').pop()! }
    },

    // ── Exports ──────────────────────────────────────────────────────────────

    async exportWithDialog(blob, suggestedName, filters) {
      const lastDir = await getLastDir('export')
      const defaultPath = await join(lastDir, suggestedName)

      const path = await save({ defaultPath, filters })
      if (!path) return null

      const bytes = new Uint8Array(await blob.arrayBuffer())
      await writeFile(path, bytes)

      const prefs = await readPrefs()
      prefs.lastDirs.export = await dirname(path)
      await writePrefs(prefs)

      return path
    },

    async exportChannelsWithDialog(files, _suggestedFolder) {
      const defaultPath = await getLastDir('export')
      const selected = await open({
        directory: true,
        defaultPath,
      })
      if (!selected) return null

      const folder = typeof selected === 'string' ? selected : (selected as string[])[0]

      for (const { name, blob } of files) {
        const filePath = await join(folder, name)
        await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()))
      }

      const prefs = await readPrefs()
      prefs.lastDirs.export = folder
      await writePrefs(prefs)

      return folder
    },

    // ── Recent projects ──────────────────────────────────────────────────────

    async listRecent() {
      const prefs = await readPrefs()
      return prefs.recent ?? []
    },

    async addRecent(path, name) {
      const prefs = await readPrefs()
      prefs.recent = (prefs.recent ?? []).filter((r) => r.path !== path)
      prefs.recent.unshift({ path, name, lastOpened: Date.now() })
      if (prefs.recent.length > 10) prefs.recent = prefs.recent.slice(0, 10)
      await writePrefs(prefs)
    },

    async clearRecent() {
      const prefs = await readPrefs()
      prefs.recent = []
      await writePrefs(prefs)
    },

    // ── Window / dirty state ─────────────────────────────────────────────────

    setWindowTitle(title, dirty) {
      const w = getCurrentWindow()
      const displayTitle = dirty ? `${title} — Edited` : title
      w.setTitle(displayTitle).catch((e) => console.warn('[halftones] setTitle failed:', e))
      // setDocumentEdited is macOS-specific; use optional chaining
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(w as any).setDocumentEdited?.(dirty)?.catch?.(() => {})
    },

    // ── Stub subscriptions (wired in later steps) ────────────────────────────

    onBeforeQuit(_handler) {
      // No-op: wired in Step 9
    },

    onMenuEvent(_event: MenuEvent, _handler: () => void) {
      // No-op: wired in Step 5
      return () => {}
    },

    onFileDropped(_handler) {
      // No-op: wired in Step 7
      return () => {}
    },

    // ── Session restore ──────────────────────────────────────────────────────

    async getLastProjectPath() {
      const prefs = await readPrefs()
      return prefs.lastProjectPath ?? null
    },

    async setLastProjectPath(path) {
      const prefs = await readPrefs()
      prefs.lastProjectPath = path
      await writePrefs(prefs)
    },
  }
}
