import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
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
import { ShopProfile } from '../types'
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
  /** Shop screen/mesh inventory for the Print Plan. Absent until the user edits it. */
  shopProfile?: ShopProfile
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

// ─── Menu event subscription plumbing ────────────────────────────────────────

const menuListeners = new Map<MenuEvent, Set<(p?: string) => void>>()
let globalMenuUnlisten: Promise<() => void> | null = null

function ensureMenuListener() {
  if (globalMenuUnlisten) return
  globalMenuUnlisten = listen<{ event: MenuEvent; payload: string | null }>(
    'menu-event',
    (e) => {
      const subs = menuListeners.get(e.payload.event)
      if (!subs) return
      for (const h of subs) h(e.payload.payload ?? undefined)
    },
  )
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

    async loadProjectFromPath(path) {
      const bytes = await readFile(path)
      return unpackHalftonesFile(bytes)
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

    onBeforeQuit(handler) {
      listen('close-requested', async () => {
        const choice = await handler()
        if (choice !== 'cancel') {
          // Handler performed save (if chosen) before returning — safe to close.
          invoke('confirm_close')
        }
        // 'cancel' → close already vetoed; do nothing.
      })
    },

    onMenuEvent(event: MenuEvent, handler: (payload?: string) => void) {
      ensureMenuListener()
      let set = menuListeners.get(event)
      if (!set) { set = new Set(); menuListeners.set(event, set) }
      set.add(handler)
      return () => { set!.delete(handler) }
    },

    onFileDropped(handler) {
      // Two sources:
      //   1. OS drag-drop via the webview's onDragDropEvent (correct Tauri 2 API)
      //   2. Finder double-click / "Open With" forwarded via Rust as "file-opened"
      let unlisten1: (() => void) | null = null
      let unlisten2: (() => void) | null = null

      getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === 'drop') {
            handler(e.payload.paths)
          }
        })
        .then((u) => { unlisten1 = u })

      listen<string[]>('file-opened', (e) => handler(e.payload))
        .then((u) => { unlisten2 = u })

      return () => { unlisten1?.(); unlisten2?.() }
    },

    async refreshRecentMenu(entries) {
      await invoke('set_recent_menu', {
        items: entries.map((e) => ({ path: e.path, name: e.name })),
      })
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

    async getStartupFiles() {
      return invoke<string[]>('take_startup_files')
    },

    async getShopProfile() {
      const prefs = await readPrefs()
      return prefs.shopProfile ?? null
    },

    async setShopProfile(profile: ShopProfile) {
      const prefs = await readPrefs()
      prefs.shopProfile = profile
      await writePrefs(prefs)
    },
  }
}
