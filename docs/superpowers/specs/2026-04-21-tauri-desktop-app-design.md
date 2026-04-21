# Halftones Tauri Desktop App — Design

**Date:** 2026-04-21
**Status:** Approved — ready for implementation planning
**Scope:** v1 macOS desktop build of the existing React halftones web app, wrapped in Tauri with native file I/O, menu, and drag-drop.

---

## 1. Goals & non-goals

### In scope (v1)

- macOS-only native bundle (unsigned dev builds).
- `.halftones` self-contained project file format (zip).
- Native File menu: New / Open / Open Recent / Close / Save / Save As / Export variants.
- Cmd+S explicit save model with dirty-state indicator.
- Drag-drop `.halftones` files and images onto the window or Dock icon.
- File associations: double-click a `.halftones` file in Finder opens it in the app.
- Auto-reopen the last project at launch.
- Native Save/Open dialogs for all project and export I/O.
- A thin platform abstraction so `npm run dev` in a browser still runs for fast iteration (with web fallbacks for unsupported operations).

### Out of scope

- Windows, Linux.
- Auto-updater.
- Code signing, notarization, App Store distribution.
- Multiple windows.
- Preferences window.
- Migration of existing localStorage projects into `.halftones` files. (Users recreate their handful of existing projects manually. If it becomes painful, we can add an "Export project" button to the web version in a follow-up.)
- Crash reports, telemetry, analytics.
- Final app icon (placeholder icon for now).

---

## 2. Architecture

### Source layout

```
src/
├── platform/
│   ├── index.ts             runtime detection → exports `platform`
│   ├── types.ts             PlatformAPI interface
│   ├── platform-web.ts      browser-dev fallback
│   ├── platform-tauri.ts    native implementation via @tauri-apps/api
│   └── halftones-file.ts    shared zip pack/unpack (JSZip); no platform I/O
│
├── components/…             updated: TopBar uses platform for recent list + title
├── hooks/
│   ├── useProjectPersistence.ts   rewritten: routes through platform
│   ├── useDirtyTracking.ts        NEW: watches settings for changes
│   └── useAppShell.ts             NEW: menu + drag-drop + quit wiring
└── (rest unchanged)

src-tauri/                    NEW — standard Tauri crate
├── tauri.conf.json           app config, file associations, bundle identifier
├── src/
│   ├── main.rs               window, menu, close-request handler
│   └── menu.rs               menu builder
├── icons/                    placeholder icon set
├── Cargo.toml
└── build.rs
```

### Runtime detection

`src/platform/index.ts`:

```ts
const isTauri = typeof window !== 'undefined' &&
                '__TAURI_INTERNALS__' in window
export const platform: PlatformAPI = isTauri
  ? await import('./platform-tauri').then(m => m.createTauriPlatform())
  : await import('./platform-web').then(m => m.createWebPlatform())
```

### Build & dev commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server at :5173. Web fallback. For fast UI iteration without the Tauri shell. |
| `npm run tauri:dev` | `tauri dev` — boots Vite + launches the native window. For real native-integration testing. |
| `npm run build` | Existing web build (`tsc -b && vite build`). Unchanged. |
| `npm run tauri:build` | `tauri build` — produces `src-tauri/target/release/bundle/macos/Halftones.app` and `.dmg`. |

---

## 3. `.halftones` file format

### Layout

A zip archive with a fixed contents set:

```
myproject.halftones
├── project.json     required
└── source.<ext>     required — extension preserves original (png|jpg|jpeg|webp)
```

Rename the file to `.zip` and it opens in any zip tool.

### `project.json`

```json
{
  "schemaVersion": 1,
  "createdAt":  "2026-04-21T19:14:00.000Z",
  "updatedAt":  "2026-04-21T19:22:14.000Z",
  "name":       "Band poster",
  "sourceFileName": "original-photo.jpg",
  "settings": {
    "halftone":  { /* HalftoneSettings */ },
    "cmyk":      { /* CMYKSettings */ },
    "spot":      { /* SpotSettings */ },
    "output":    { /* OutputSettings */ },
    "transform": { /* ImageTransformSettings */ }
  }
}
```

`schemaVersion` begins at `1`. Future schema changes bump the version and are handled by a migration chain in `halftones-file.ts` (`migrate1to2`, `migrate2to3`, etc.). Loading a file with `schemaVersion > current` is rejected with a user-facing error.

### Write atomicity

Writes go through a temp-file + rename pattern: write to `project.halftones.tmp`, then rename to `project.halftones`. Tauri's fs plugin supports this on macOS via `rename`. This prevents a corrupted half-written file if the process is killed mid-save.

---

## 4. Platform API surface

```ts
// src/platform/types.ts
export interface PlatformAPI {
  // ── Project I/O ────────────────────────────────────────────────
  openProjectDialog(): Promise<{ project: ProjectFile; path: string } | null>
  saveProject(project: ProjectFile, path: string): Promise<void>
  saveProjectAsDialog(project: ProjectFile): Promise<string | null>

  // ── Image import (New / drag-drop) ─────────────────────────────
  openImageDialog(): Promise<LoadedImage | null>
  loadImageFromPath(path: string): Promise<LoadedImage>

  // ── Exports ────────────────────────────────────────────────────
  exportWithDialog(
    blob: Blob,
    suggestedName: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<string | null>
  exportChannelsWithDialog(
    files: { name: string; blob: Blob }[],
    suggestedFolder: string,
  ): Promise<string | null>

  // ── Recent projects ────────────────────────────────────────────
  listRecent(): Promise<RecentEntry[]>
  addRecent(path: string, name: string): Promise<void>
  clearRecent(): Promise<void>

  // ── Window / dirty state ───────────────────────────────────────
  setWindowTitle(title: string, dirty: boolean): void
  onBeforeQuit(handler: () => Promise<'save' | 'discard' | 'cancel'>): void

  // ── Menu & drag-drop events (subscription) ────────────────────
  onMenuEvent(event: MenuEvent, handler: () => void): () => void
  onFileDropped(handler: (paths: string[]) => void): () => void

  // ── Session restore ────────────────────────────────────────────
  getLastProjectPath(): Promise<string | null>
  setLastProjectPath(path: string | null): Promise<void>
}

export type MenuEvent =
  | 'new' | 'open' | 'save' | 'saveAs' | 'close'
  | 'exportPng' | 'exportChannels' | 'exportPdf' | 'exportProof'

export interface ProjectFile {
  name: string
  settings: AllSettings
  image: { bytes: Uint8Array; fileName: string }
}

export interface LoadedImage {
  bytes: Uint8Array
  fileName: string
}

export interface RecentEntry {
  path: string
  name: string
  lastOpened: number   // ms since epoch
}
```

### Why this shape

- **All I/O async.** Both Tauri and web naturally return Promises.
- **Zip pack/unpack is shared.** `halftones-file.ts` takes/produces `ProjectFile` and uses JSZip. Neither platform implementation reimplements zip handling.
- **Menu and drag-drop as subscriptions.** Tauri emits window events; web mode catches keyboard shortcuts at the window level and synthesizes the same event names. Subscribers live in `useAppShell`.
- **Web mode is intentionally minimal.** In web, `listRecent()` returns `[]`, `onBeforeQuit` is a no-op, `openProjectDialog` uses the existing `<input type="file">` + JSZip, `saveProject` triggers a download with `FileSaver`-style blob URL. Enough for UI iteration without maintaining two product experiences.

### Preferences file

Tauri app state lives at `~/Library/Application Support/halftones/prefs.json`:

```json
{
  "lastProjectPath": "/Users/me/Documents/Halftones/poster.halftones",
  "recent": [
    { "path": "…", "name": "Poster", "lastOpened": 1745264134000 }
  ],
  "lastDirs": {
    "open":    "/Users/me/Documents/Halftones",
    "save":    "/Users/me/Documents/Halftones",
    "export":  "/Users/me/Documents/Halftones",
    "image":   "/Users/me/Pictures"
  }
}
```

Max 10 recent entries. Updated atomically on every write.

---

## 5. Native menu

```
Halftones
  About Halftones
  ─────
  Hide / Hide Others / Show All
  ─────
  Quit Halftones                ⌘Q

File
  New                           ⌘N
  Open…                         ⌘O
  Open Recent                 ▶
    (up to 10, most recent first)
    ─────
    Clear Recent
  Close                         ⌘W   (closes the current project → empty state; window stays open)
  ─────
  Save                          ⌘S
  Save As…                      ⌘⇧S
  ─────
  Export PNG…                   ⌘E
  Export Channels…              ⌘⇧E
  Export PDF…                   ⌘P
  Export Color Proof…

Edit
  (Cut / Copy / Paste / Select All — wired automatically for text fields)

View
  Zoom In                       ⌘+
  Zoom Out                      ⌘−
  Fit to Window                 ⌘0
  Actual Size (100%)            ⌘1

Window
  Minimize                      ⌘M
  Zoom
  ─────
  Halftones                     (the only window)

Help
  (empty — Tauri's injected search field is fine as-is)
```

View menu items emit `MenuEvent`s that `PreviewCanvas` already implements for its zoom controls — they just need a listener.

### Dialog defaults

| Dialog | Default directory | Filename suggestion |
|---|---|---|
| Open Project | `prefs.lastDirs.open`, else `~/Documents` | — |
| Save / Save As | project dir if saved, else `prefs.lastDirs.save`, else `~/Documents/Halftones/` | `{projectName}.halftones` |
| Export PNG | project dir if saved, else `prefs.lastDirs.export`, else `~/Documents/Halftones/` | `{projectSlug}-{pattern}.png` |
| Export Channels | same as PNG (dialog picks a _folder_) | one file per channel: `{slug}-{pattern}-{channel}.png` |
| Export PDF | same as PNG | `{projectSlug}-{pattern}.pdf` |
| Export Color Proof | same as PNG | `{projectSlug}-proof.png` |
| Open Image | `prefs.lastDirs.image`, else `~/Pictures` | — |

`~/Documents/Halftones/` is created on first use if absent.

---

## 6. Dirty state, startup, drag-drop, quit

### Dirty state

A new `useDirtyTracking` hook subscribes to all settings state (halftone, cmyk, spot, output, transform, project name) and exposes `{ dirty, markClean, markDirty }`. Implementation: a simple `dirty` boolean flipped true by any watched-state change and flipped false by `markClean()` after a successful save or load. No deep hashing — a setting that's "dirtied back to its original value" still reads as dirty until save, which is acceptable.

On every dirty-state change:

1. `platform.setWindowTitle(projectName || 'Untitled', dirty)` — Tauri sets the native traffic-light edited indicator (the dot in the red close button) and appends " — Edited" to the title when dirty.
2. In Tauri mode, the current 1-second localStorage auto-save is **removed**. Save is explicit.
3. In web mode, the localStorage auto-save is kept as-is.

### Before any destructive action (New / Open / Close / Open drag-drop)

If dirty, show:

```
┌─────────────────────────────────────┐
│  Save changes to "Band poster"?     │
│                                     │
│  Your changes will be lost          │
│  if you don't save them.            │
│                                     │
│  [Don't Save]  [Cancel]   [Save]    │
└─────────────────────────────────────┘
```

Implemented via Tauri's `dialog` plugin (`ask()` variant). Web mode uses `window.confirm` + a custom three-button modal for Save/Don't Save/Cancel.

### Startup flow

```
App launch
  │
  ├─ Did macOS pass a file path via file-association or "Open With"?
  │     └─ yes → open that .halftones (or import if it's a loose image)
  │
  ├─ platform.getLastProjectPath() returns a path?
  │     ├─ yes → try to load it
  │     │         ├─ success → restore exactly
  │     │         └─ fail (moved/deleted) → empty state + toast "Could not reopen previous project."
  │     └─ no  → empty state
```

"Empty state" is the current placeholder panel — "Drop an image here or use the file picker." No changes needed.

### Drag-drop

Tauri emits `tauri://drag-drop` with an array of dropped file paths. Handler rules:

- Exactly one path ending in `.halftones` → treat as File → Open (dirty prompt if needed).
- Exactly one path with extension in `{png, jpg, jpeg, webp}` → treat as File → New with that image preloaded (dirty prompt if needed).
- Anything else (multiple files, unsupported extension, folders) → no-op.

### Quit flow

Rust intercepts `tauri://close-requested`, forwards it to JS via `emit`. JS runs the dirty prompt (same one above). Replies to Rust with:

- `"save"` → attempt save; on success, allow close; on failure, veto + toast.
- `"discard"` → allow close.
- `"cancel"` → veto close.

Before closing, JS writes `prefs.lastProjectPath` so the next launch resumes correctly.

---

## 7. Error paths worth calling out

- **Zip missing `project.json`** → reject with "This doesn't look like a Halftones project file."
- **`schemaVersion` higher than we support** → reject with "This project was saved by a newer version of Halftones."
- **Source image file inside the zip is corrupt** → keep settings, show a placeholder image, prompt user to re-import.
- **Save fails mid-write** → temp-file + rename pattern prevents partial writes. On rename failure, keep the temp file and show an actionable error toast.
- **Recent entry points to a now-missing file** → skip it silently on next startup; remove from the recent list.
- **Drag-drop of an unreadable path** → no-op with a toast ("Couldn't read dropped file.").

---

## 8. Implementation sequencing (for the plan)

The implementation plan will order work roughly as follows:

1. Scaffold `src-tauri/` crate and wire `npm run tauri:dev` to run alongside Vite.
2. Introduce `platform/` abstraction and migrate existing localStorage/download code through it (web implementation first — should produce no behavioral change in the browser).
3. Implement `halftones-file.ts` zip pack/unpack with schema versioning.
4. Build the Tauri platform implementation: project I/O, image import, exports, prefs file.
5. Build the native menu and wire it to JS event handlers.
6. Implement dirty tracking, window title updates, and the save-prompt modal.
7. Wire drag-drop and file-association handlers.
8. Implement the startup resume flow.
9. Wire the quit-confirmation flow.
10. Smoke-test all flows end-to-end on macOS; build a `.app` and verify it runs from `/Applications/`.

Each step is testable in isolation; the web build must continue to succeed after every step.

---

## 9. Dependencies

New runtime deps:

| Package | Purpose |
|---|---|
| `@tauri-apps/api` | Window, event, invoke |
| `@tauri-apps/plugin-dialog` | Native file dialogs |
| `@tauri-apps/plugin-fs` | File read/write, rename |
| `@tauri-apps/plugin-process` | Clean app quit |
| `jszip` | `.halftones` pack/unpack |

New dev deps:

| Package | Purpose |
|---|---|
| `@tauri-apps/cli` | `tauri dev` / `tauri build` |

Rust crate deps (`src-tauri/Cargo.toml`):

| Crate | Purpose |
|---|---|
| `tauri` | Core |
| `tauri-plugin-dialog` | Dialog plugin backend |
| `tauri-plugin-fs` | FS plugin backend |
| `tauri-plugin-process` | Process plugin backend |
| `serde` / `serde_json` | Config + event payloads |

No Rust-side business logic beyond wiring. All project and file-format logic stays in TypeScript.
