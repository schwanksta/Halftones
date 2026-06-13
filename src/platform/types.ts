import { HalftoneSettings, CMYKSettings, SpotSettings, OutputSettings, ImageTransformSettings, MaskSettings } from '../types'

export interface AllSettings {
  halftone: HalftoneSettings
  cmyk: CMYKSettings
  spot: SpotSettings
  output: OutputSettings
  transform: ImageTransformSettings
  /** Optional — absent in old projects; default applied in applySettings. */
  mask?: MaskSettings
}

// src/platform/types.ts
export interface PlatformAPI {
  // ── Project I/O ────────────────────────────────────────────────
  openProjectDialog(): Promise<{ project: ProjectFile; path: string } | null>
  saveProject(project: ProjectFile, path: string): Promise<void>
  saveProjectAsDialog(project: ProjectFile): Promise<string | null>

  // ── Image import (New / drag-drop) ─────────────────────────────
  openImageDialog(): Promise<LoadedImage | null>
  loadImageFromPath(path: string): Promise<LoadedImage>

  // ── Project load by path (used by Open Recent) ─────────────────
  loadProjectFromPath(path: string): Promise<ProjectFile>

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
  onMenuEvent(event: MenuEvent, handler: (payload?: string) => void): () => void
  onFileDropped(handler: (paths: string[]) => void): () => void

  /** Push the recent-projects list to the native menu. No-op on web. */
  refreshRecentMenu(entries: RecentEntry[]): Promise<void>

  // ── Session restore ────────────────────────────────────────────
  getLastProjectPath(): Promise<string | null>
  setLastProjectPath(path: string | null): Promise<void>
  /** Drains file paths queued before JS was ready (cold-start file associations). */
  getStartupFiles(): Promise<string[]>
}

export type MenuEvent =
  | 'new' | 'open' | 'save' | 'saveAs' | 'close'
  | 'exportPng' | 'exportChannels' | 'exportPdf' | 'exportProof'
  | 'zoomIn' | 'zoomOut' | 'zoomFit' | 'zoomActual'
  | 'clearRecent' | 'openRecent'

export interface ProjectFile {
  name: string
  settings: AllSettings
  image: { bytes: Uint8Array; fileName: string }
  /**
   * Optional mask image.  Present when the project was saved with a mask loaded.
   * Callers are responsible for re-decoding the bytes into a MaskImage after unpack.
   */
  mask?: { bytes: Uint8Array; fileName: string }
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
