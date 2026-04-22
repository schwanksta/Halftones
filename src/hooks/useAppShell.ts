import { useCallback, useEffect, useState } from 'react'
import { platform } from '../platform'
import { AllSettings, ProjectFile } from '../platform/types'
import { SourceImage } from '../types'

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

  const gatherProjectFile = useCallback((): ProjectFile | null => {
    if (!deps.source) return null
    return {
      name: deps.projectName,
      settings: deps.gatherSettings(),
      image: { bytes: deps.source.rawBytes, fileName: deps.source.fileName },
    }
  }, [deps.source, deps.projectName, deps.gatherSettings])

  const saveAs = useCallback(async () => {
    const pf = gatherProjectFile()
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
    const pf = gatherProjectFile()
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
        const blob = new Blob([loaded.bytes])
        const url = URL.createObjectURL(blob)
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
        URL.revokeObjectURL(url)
        deps.resetToDefaults()
        deps.setProjectName('untitled')
        setCurrentPath(null)
        deps.setSource({ imageData, width: canvas.width, height: canvas.height, fileName: loaded.fileName, rawBytes: loaded.bytes })
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
      platform.onMenuEvent('clearRecent', async () => {
        await platform.clearRecent()
        await platform.refreshRecentMenu([])
      }),
      platform.onMenuEvent('openRecent', openRecent),
      platform.onFileDropped(handleDroppedPaths),
    ]
    return () => unsubs.forEach(u => u())
  }, [deps.isTauri, newProject, openProject, save, saveAs, closeProject, openRecent, handleDroppedPaths])

  return { currentPath, prompt, setPrompt }
}
