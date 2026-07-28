import { useCallback, useEffect, useRef, useState } from 'react'
import { platform } from '../platform'
import { AllSettings, ProjectFile } from '../platform/types'
import { SourceImage, DEFAULT_TRANSFORM_SETTINGS, DEFAULT_OUTPUT_SETTINGS, MaskImage } from '../types'
import { loadMaskFromBytes } from '../engine/mask'
import { generateThumbnail } from '../engine/export'
import { EditMasks } from '../engine/layer-edits'

/** Decode raw PNG bytes (a layer edit mask) into a canvas — same approach as decodeImageBytes below. */
async function decodeMaskCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes])
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode raw image bytes (from a dialog or drop) into a SourceImage. */
async function decodeImageBytes(loaded: { bytes: Uint8Array; fileName: string }): Promise<SourceImage> {
  const blob = new Blob([loaded.bytes])
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { imageData, width: canvas.width, height: canvas.height, fileName: loaded.fileName, rawBytes: loaded.bytes }
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface AppShellDeps {
  projectName: string
  setProjectName: (n: string) => void
  source: SourceImage | null
  setSource: (img: SourceImage | null) => void
  gatherSettings: () => AllSettings
  applySettings: (s: AllSettings) => void
  resetToDefaults: () => void
  dirty: boolean
  markClean: () => void
  markDirty: () => void
  isTauri: boolean
  showToast: (msg: string) => void
  /** Current mask image — included when packing a .halftones file. */
  mask: MaskImage | null
  /** Called after loading a .halftones file that contains a mask image. */
  setMask: (m: MaskImage | null) => void
  /** Current layer-edit masks (layer edit mode) — included when packing a .halftones file. */
  editMasks: EditMasks
  /** The transformKeyOf() geometry the current edit masks were painted against. */
  editMasksKey: string | null
  /** Called after loading a .halftones file — replaces the current layer-edit masks wholesale. */
  setLayerEdits: (masks: EditMasks, key: string | null) => void
  /**
   * Swap the source image in place, keeping all settings (File → Replace
   * Image…). Unlike setSource via a normal load, the implementation must
   * suppress the output-dimension recalc that fires on source changes.
   */
  replaceSource: (img: SourceImage) => void
}

export function useAppShell(deps: AppShellDeps) {
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<null | ((c: 'save' | 'discard' | 'cancel') => void)>(null)

  const confirmIfDirty = useCallback((): Promise<'save' | 'discard' | 'cancel' | 'clean'> => {
    if (!deps.dirty) return Promise.resolve('clean')
    return new Promise(resolve => setPrompt(() => (c: 'save' | 'discard' | 'cancel') => {
      setPrompt(null)
      resolve(c)
    }))
  }, [deps.dirty])

  const gatherProjectFile = useCallback(async (): Promise<ProjectFile | null> => {
    if (!deps.source) return null
    const settings = deps.gatherSettings()
    const pf: ProjectFile = {
      name: deps.projectName,
      settings,
      image: { bytes: deps.source.rawBytes, fileName: deps.source.fileName },
    }
    if (deps.mask?.rawBytes?.length) {
      pf.mask = { bytes: deps.mask.rawBytes, fileName: deps.mask.fileName }
    }
    // Layer edit masks: encode each color's edit canvas to PNG bytes.
    if (deps.editMasks.size > 0) {
      const encoded = await Promise.all(
        Array.from(deps.editMasks.entries()).map(async ([colorId, canvas]) => {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
          const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(0)
          return { colorId, bytes }
        }),
      )
      const layerEdits = encoded.filter((e) => e.bytes.length > 0)
      if (layerEdits.length > 0) {
        pf.layerEdits = layerEdits
        if (deps.editMasksKey) pf.layerEditsKey = deps.editMasksKey
      }
    }
    // Generate thumbnail for the saved file (Finder icon + zip preview).
    // Never blocks the save — generateThumbnail returns null on failure.
    const thumbnail = await generateThumbnail({
      source: deps.source.imageData,
      transformSettings: settings.transform,
      halftoneSettings: settings.halftone,
      cmykSettings: settings.cmyk,
      spotSettings: settings.spot,
      outputSettings: settings.output,
      projectName: deps.projectName,
      mask: deps.mask ?? null,
      maskSettings: settings.mask,
      editMasks: deps.editMasks,
      editMasksKey: deps.editMasksKey,
    })
    if (thumbnail) pf.thumbnail = thumbnail
    return pf
  }, [deps.source, deps.projectName, deps.gatherSettings, deps.mask, deps.editMasks, deps.editMasksKey])

  const saveAs = useCallback(async () => {
    const pf = await gatherProjectFile()
    if (!pf) return false
    const path = await platform.saveProjectAsDialog(pf)
    if (!path) return false
    setCurrentPath(path)
    deps.markClean()
    await platform.setLastProjectPath(path)
    await platform.refreshRecentMenu(await platform.listRecent())
    return true
  }, [gatherProjectFile, deps])

  const save = useCallback(async () => {
    if (!currentPath) return saveAs()
    const pf = await gatherProjectFile()
    if (!pf) return false
    try {
      await platform.saveProject(pf, currentPath)
      deps.markClean()
      await platform.setLastProjectPath(currentPath)
      return true
    } catch (e) {
      console.error('Save failed:', e)
      alert(`Save failed: ${(e as Error).message}`)
      return false
    }
  }, [currentPath, gatherProjectFile, deps, saveAs])

  const loadProjectFile = useCallback(async (pf: ProjectFile, path: string) => {
    deps.applySettings(pf.settings)
    deps.setProjectName(pf.name)
    if (pf.image.bytes.byteLength > 0) {
      const blob = new Blob([pf.image.bytes])
      const url = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('Image decode failed'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      deps.setSource({
        imageData,
        width: canvas.width,
        height: canvas.height,
        fileName: pf.image.fileName,
        rawBytes: pf.image.bytes,
      })
    } else {
      // Spec §7 soft failure: missing source image
      deps.setSource(null)
      alert('The project loaded, but its source image was missing. Please re-import the image.')
    }

    // Restore mask image if present in the project file.
    if (pf.mask?.bytes?.length) {
      try {
        const maskImage = await loadMaskFromBytes(pf.mask.bytes, pf.mask.fileName)
        deps.setMask(maskImage)
      } catch (e) {
        console.warn('Failed to decode mask image from project file:', e)
        deps.setMask(null)
      }
    } else {
      deps.setMask(null)
    }

    // Restore layer edit masks if present in the project file.
    if (pf.layerEdits?.length) {
      try {
        const masks: EditMasks = new Map()
        await Promise.all(pf.layerEdits.map(async (e) => {
          masks.set(e.colorId, await decodeMaskCanvas(e.bytes))
        }))
        deps.setLayerEdits(masks, pf.layerEditsKey ?? null)
      } catch (e) {
        console.warn('Failed to decode layer edit masks from project file:', e)
        deps.setLayerEdits(new Map(), null)
      }
    } else {
      deps.setLayerEdits(new Map(), null)
    }

    setCurrentPath(path)
    await platform.addRecent(path, pf.name)
    await platform.setLastProjectPath(path)
    await platform.refreshRecentMenu(await platform.listRecent())
    deps.markClean()
  }, [deps])

  const newProject = useCallback(async () => {
    const choice = await confirmIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') { const ok = await save(); if (!ok) return }
    deps.resetToDefaults()
    deps.setSource(null)
    deps.setProjectName('untitled')
    setCurrentPath(null)
    deps.markClean()
  }, [confirmIfDirty, save, deps])

  const openProject = useCallback(async () => {
    const choice = await confirmIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') { const ok = await save(); if (!ok) return }
    const result = await platform.openProjectDialog()
    if (!result) return
    await loadProjectFile(result.project, result.path)
  }, [confirmIfDirty, save, loadProjectFile])

  const closeProject = useCallback(async () => {
    const choice = await confirmIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') { const ok = await save(); if (!ok) return }
    deps.resetToDefaults()
    deps.setSource(null)
    deps.setProjectName('untitled')
    setCurrentPath(null)
    deps.markClean()
  }, [confirmIfDirty, save, deps])

  const openRecent = useCallback(async (path: string | undefined) => {
    if (!path) return
    const choice = await confirmIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') { const ok = await save(); if (!ok) return }
    try {
      const project = await platform.loadProjectFromPath(path)
      await loadProjectFile(project, path)
    } catch (e) {
      console.error('[halftones] Failed to open recent:', e)
      alert(`Could not open project: ${(e as Error).message}`)
    }
  }, [confirmIfDirty, save, loadProjectFile])

  const replaceImage = useCallback(async () => {
    // Swap the source image, keeping every setting (transforms, output size,
    // colors, key plate, mask) untouched — unlike a normal image load, which
    // resets transforms and re-fits the output to paper.
    if (!deps.source) {
      deps.showToast('No image to replace — open an image first.')
      return
    }
    try {
      const loaded = await platform.openImageDialog()
      if (!loaded) return
      deps.replaceSource(await decodeImageBytes(loaded))
      deps.markDirty()
    } catch (e) {
      alert(`Couldn't replace image: ${(e as Error).message}`)
    }
  }, [deps])

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    if (paths.length !== 1) return  // multi-file drop → no-op per spec
    const p = paths[0]
    const ext = p.split('.').pop()?.toLowerCase() ?? ''

    if (ext === 'halftones') {
      const choice = await confirmIfDirty()
      if (choice === 'cancel') return
      if (choice === 'save') { const ok = await save(); if (!ok) return }
      try {
        const pf = await platform.loadProjectFromPath(p)
        await loadProjectFile(pf, p)
      } catch (e) {
        alert(`Could not open file: ${(e as Error).message}`)
      }
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const choice = await confirmIfDirty()
      if (choice === 'cancel') return
      if (choice === 'save') { const ok = await save(); if (!ok) return }
      try {
        const loaded = await platform.loadImageFromPath(p)
        const decoded = await decodeImageBytes(loaded)
        // Keep current halftone/color/spot settings (same as Open Image button).
        // Only reset transform and re-fit output dimensions to the current
        // paper size (preserving the image's aspect ratio).  This prevents a
        // blank preview from resetToDefaults() switching to grayscale mode,
        // and gives sensible print sizes for low-resolution source images
        // where pixel-count ÷ DPI would yield absurdly small dimensions.
        const cur = deps.gatherSettings()
        // Always fit new images into the default paper bounds so that stale
        // output dimensions from a previous session never carry over.
        const paperW = DEFAULT_OUTPUT_SETTINGS.widthInches
        const paperH = DEFAULT_OUTPUT_SETTINGS.heightInches
        const imgAR   = decoded.width / decoded.height
        const paperAR = paperW / paperH
        const fitW = imgAR > paperAR ? paperW  : paperH * imgAR
        const fitH = imgAR > paperAR ? paperW / imgAR : paperH
        deps.applySettings({
          ...cur,
          output: {
            ...cur.output,
            widthInches:  Math.round(fitW * 100) / 100,
            heightInches: Math.round(fitH * 100) / 100,
          },
          transform: DEFAULT_TRANSFORM_SETTINGS,
        })
        deps.setProjectName('untitled')
        setCurrentPath(null)
        deps.setSource(decoded)
        deps.markDirty()
      } catch (e) {
        alert(`Couldn't read dropped file: ${(e as Error).message}`)
      }
    }
    // else: unsupported extension → no-op per spec
  }, [confirmIfDirty, save, loadProjectFile, deps])

  // Startup restore (Tauri only — runs once on mount)
  useEffect(() => {
    if (!deps.isTauri) return

    async function startup() {
      // 1. Check for file-association cold-start files (buffered before JS was ready)
      const startupFiles = await platform.getStartupFiles()
      if (startupFiles.length > 0) {
        await handleDroppedPaths(startupFiles)
        return
      }

      // 2. Try to restore the last open project
      const lastPath = await platform.getLastProjectPath()
      if (!lastPath) return  // empty state — nothing to restore

      try {
        const pf = await platform.loadProjectFromPath(lastPath)
        await loadProjectFile(pf, lastPath)
      } catch {
        // File moved or deleted — soft failure per spec §7
        deps.showToast('Could not reopen previous project.')
        // No setCurrentPath — stays at empty state
      }
    }

    startup()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.isTauri])  // runs once; handleDroppedPaths and loadProjectFile are stable callbacks

  // Menu subscriptions (Tauri only — web stubs are no-ops so this is safe)
  useEffect(() => {
    if (!deps.isTauri) return
    const unsubs = [
      platform.onMenuEvent('new', newProject),
      platform.onMenuEvent('open', openProject),
      platform.onMenuEvent('save', save),
      platform.onMenuEvent('saveAs', saveAs),
      platform.onMenuEvent('close', closeProject),
      platform.onMenuEvent('replaceImage', replaceImage),
      platform.onMenuEvent('clearRecent', async () => {
        await platform.clearRecent()
        await platform.refreshRecentMenu([])
      }),
      platform.onMenuEvent('openRecent', openRecent),
      platform.onFileDropped(handleDroppedPaths),
    ]
    return () => unsubs.forEach(u => u())
  }, [deps.isTauri, newProject, openProject, save, saveAs, closeProject, openRecent, handleDroppedPaths, replaceImage])

  // Quit handler — use a ref so the listen closure always sees the freshest
  // confirmIfDirty/save callbacks without re-registering the listener.
  const quitHandlerRef = useRef<() => Promise<'save' | 'discard' | 'cancel'>>(() => Promise.resolve('discard'))
  useEffect(() => {
    quitHandlerRef.current = async () => {
      if (!deps.dirty) return 'discard'
      const choice = await confirmIfDirty()
      if (choice === 'save') {
        const ok = await save()
        if (!ok) return 'cancel'   // save failed → don't quit
      }
      return choice as 'save' | 'discard' | 'cancel'
    }
  })  // no deps — updates every render so callbacks are always fresh

  useEffect(() => {
    if (!deps.isTauri) return
    platform.onBeforeQuit(() => quitHandlerRef.current())
  }, [deps.isTauri])  // runs once

  return { currentPath, prompt, setPrompt }
}
