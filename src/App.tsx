import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import './App.css'
import { TopBar } from './components/TopBar'
import { ControlPanel } from './components/ControlPanel'
import { PreviewCanvas } from './components/PreviewCanvas'
import { ExportBar } from './components/ExportBar'
import { SavePromptModal } from './components/SavePromptModal'
import { Toast } from './components/Toast'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { useDirtyTracking } from './hooks/useDirtyTracking'
import { useAppShell } from './hooks/useAppShell'
import { useUndoHistory } from './hooks/useUndoHistory'
import { platform, isTauri } from './platform'
import { applyTransforms } from './engine/transform'
import {
  SourceImage,
  HalftoneSettings,
  CMYKSettings,
  OutputSettings,
  ImageTransformSettings,
  SpotSettings,
  ChannelView,
  DEFAULT_HALFTONE_SETTINGS,
  DEFAULT_CMYK_SETTINGS,
  DEFAULT_SPOT_SETTINGS,
  DEFAULT_OUTPUT_SETTINGS,
  DEFAULT_TRANSFORM_SETTINGS,
} from './types'
import { AllSettings } from './platform/types'

const AUTO_SAVE_DELAY = 1000 // ms

/**
 * Fit an image inside the current paper bounds while preserving its aspect
 * ratio.  Returns print dimensions (inches) where one of the two dimensions
 * equals its paper bound and the other is smaller.  This is the default
 * sizing behaviour on image load — the older "pixelCount ÷ DPI" formula
 * produced absurdly small outputs for low-resolution source images
 * (e.g. a 768×1024 PNG at 300 DPI → 2.56×3.41 in).
 */
function fitToPaper(
  imgW: number, imgH: number,
  paperW: number, paperH: number,
): { widthInches: number; heightInches: number } {
  const imgAR   = imgW   / imgH
  const paperAR = paperW / paperH
  let w: number, h: number
  if (imgAR > paperAR) {
    // Image is wider (relative to paper) — constrain by paper width
    w = paperW
    h = paperW / imgAR
  } else {
    h = paperH
    w = paperH * imgAR
  }
  return {
    widthInches:  Math.round(w * 100) / 100,
    heightInches: Math.round(h * 100) / 100,
  }
}

function App() {
  const [projectName, setProjectName] = useState('untitled')
  const [source, setSource] = useState<SourceImage | null>(null)
  const [halftoneSettings, setHalftoneSettings] = useState<HalftoneSettings>(DEFAULT_HALFTONE_SETTINGS)
  const [cmykSettings, setCmykSettings] = useState<CMYKSettings>(DEFAULT_CMYK_SETTINGS)
  const [spotSettings, setSpotSettings] = useState<SpotSettings>(DEFAULT_SPOT_SETTINGS)
  const [outputSettings, setOutputSettings] = useState<OutputSettings>(DEFAULT_OUTPUT_SETTINGS)
  const [transformSettings, setTransformSettings] = useState<ImageTransformSettings>(DEFAULT_TRANSFORM_SETTINGS)
  const [channelView, setChannelView] = useState<ChannelView>('composite')

  const { save, load, remove, projectNames, lastProjectName } = useProjectPersistence()
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When applySettings is called (project load), suppress the dimension-recalc
  // useEffect that fires because `source` changed — the saved widthInches/heightInches
  // are already correct and must not be overwritten by pixel-count arithmetic.
  const skipDimensionRecalcRef = useRef(false)
  // Tracks the crop/rotation transform that the current output dimensions
  // already reflect.  Used by the crop/rotation useEffect to compute how much
  // the visible region has changed so dimensions can be scaled proportionally
  // rather than derived from pixel-count ÷ DPI (which breaks when the load
  // path uses fit-to-paper instead of native-DPI sizing).
  const prevTransformRef = useRef({
    cropLeft: DEFAULT_TRANSFORM_SETTINGS.cropLeft,
    cropRight: DEFAULT_TRANSFORM_SETTINGS.cropRight,
    cropTop: DEFAULT_TRANSFORM_SETTINGS.cropTop,
    cropBottom: DEFAULT_TRANSFORM_SETTINGS.cropBottom,
    rotation: DEFAULT_TRANSFORM_SETTINGS.rotation,
  })

  // On mount, restore the last used project (web mode only — Tauri handles startup in Step 8)
  useEffect(() => {
    if (isTauri) return
    const last = lastProjectName()
    if (last) {
      const snapshot = load(last)
      if (snapshot) {
        setProjectName(last)
        setHalftoneSettings(snapshot.halftoneSettings)
        setCmykSettings(snapshot.cmykSettings)
        setSpotSettings(snapshot.spotSettings ?? DEFAULT_SPOT_SETTINGS)
        setOutputSettings(snapshot.outputSettings)
        setTransformSettings(snapshot.transformSettings)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save whenever settings change (web mode only — Tauri uses explicit save)
  useEffect(() => {
    if (isTauri) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      save(projectName, { halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings })
    }, AUTO_SAVE_DELAY)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, save])

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  const watchedKey = useMemo(
    () => JSON.stringify({
      projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings,
      transformSettings, sourceName: source?.fileName ?? null,
    }),
    [projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, source?.fileName],
  )
  const { dirty, markClean, markDirty } = useDirtyTracking(watchedKey)

  // ── Settings gather/apply/reset helpers (needed by useAppShell) ───────────
  const gatherSettings = useCallback((): AllSettings => ({
    halftone: halftoneSettings,
    cmyk: cmykSettings,
    spot: spotSettings,
    output: outputSettings,
    transform: transformSettings,
  }), [halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings])

  const applySettings = useCallback((s: AllSettings) => {
    skipDimensionRecalcRef.current = true
    setHalftoneSettings(s.halftone)
    setCmykSettings(s.cmyk)
    setSpotSettings(s.spot)
    setOutputSettings(s.output)
    setTransformSettings(s.transform)
  }, [])

  const resetToDefaults = useCallback(() => applySettings({
    halftone: DEFAULT_HALFTONE_SETTINGS,
    cmyk: DEFAULT_CMYK_SETTINGS,
    spot: DEFAULT_SPOT_SETTINGS,
    output: DEFAULT_OUTPUT_SETTINGS,
    transform: DEFAULT_TRANSFORM_SETTINGS,
  }), [applySettings])

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const { pushSnapshot, undo, redo, clearHistory, skipNextPushRef: undoSkipRef } = useUndoHistory(applySettings)

  // Push a debounced snapshot on every settings change.
  useEffect(() => {
    pushSnapshot(gatherSettings())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings])

  // Clear undo history when the source image changes (new image or project
  // load) so undo can't restore settings that don't match the current image.
  useEffect(() => {
    clearHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // Keep a ref so the keyboard listener always uses the freshest callbacks
  // without being recreated on every settings change.
  const undoActionsRef = useRef({ undo, redo, gatherSettings })
  useEffect(() => { undoActionsRef.current = { undo, redo, gatherSettings } })

  // Cmd/Ctrl+Z → undo, Cmd/Ctrl+Shift+Z → redo.
  // Skipped when focus is inside a text input to avoid eating normal typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const { undo, gatherSettings } = undoActionsRef.current
        undo(gatherSettings())
      } else if ((e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        e.preventDefault()
        const { redo, gatherSettings } = undoActionsRef.current
        redo(gatherSettings())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // stable — uses undoActionsRef

  // Expose skipNextPushRef to applySettings so project/image loads don't push
  // a redundant snapshot (applySettings is also called during undo/redo).
  // We patch the ref directly here because useAppShell's loadProjectFile calls
  // applySettings, and that call should not be recorded in undo history.
  const applySettingsWithUndoSkip = useCallback((s: AllSettings) => {
    undoSkipRef.current = true
    applySettings(s)
  }, [applySettings, undoSkipRef])

  // ── Toast notifications ───────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = useCallback((msg: string) => setToastMessage(msg), [])

  // ── App shell (Tauri menu handlers) ──────────────────────────────────────
  const { prompt } = useAppShell({
    projectName, setProjectName,
    source, setSource,
    gatherSettings, applySettings: applySettingsWithUndoSkip, resetToDefaults,
    dirty, markClean, markDirty,
    isTauri,
    showToast,
  })

  // ── Window title sync ────────────────────────────────────────────────────
  useEffect(() => {
    platform.setWindowTitle(projectName || 'Untitled', dirty)
  }, [projectName, dirty])

  const handleLoadProject = useCallback((name: string) => {
    const snapshot = load(name)
    if (!snapshot) return
    setProjectName(name)
    // Suppress the next undo push (this is a load, not a user edit)
    undoSkipRef.current = true
    setHalftoneSettings(snapshot.halftoneSettings)
    setCmykSettings(snapshot.cmykSettings)
    setSpotSettings(snapshot.spotSettings ?? DEFAULT_SPOT_SETTINGS)
    setOutputSettings(snapshot.outputSettings)
    // Suppress crop/rotation useEffect so saved widthInches/heightInches aren't
    // overwritten; sync the baseline transform so the next user crop delta is
    // computed from the correct starting point.
    skipDimensionRecalcRef.current = true
    const t = snapshot.transformSettings
    prevTransformRef.current = {
      cropLeft: t.cropLeft, cropRight: t.cropRight,
      cropTop: t.cropTop, cropBottom: t.cropBottom, rotation: t.rotation,
    }
    setTransformSettings(t)
  }, [load, undoSkipRef])

  const handleDeleteProject = useCallback((name: string) => {
    remove(name)
    if (name === projectName) setProjectName('untitled')
  }, [remove, projectName])

  const handleImageLoad = useCallback((image: SourceImage) => {
    setSource(image)
    setTransformSettings(DEFAULT_TRANSFORM_SETTINGS)
    // Suppress the dimension-recalc useEffect that would otherwise fire on
    // the source change and overwrite the fit-to-paper values below.
    skipDimensionRecalcRef.current = true
    setOutputSettings((prev) => {
      // Guard against stale small paper bounds (e.g. from a previous session
      // where pixelCount ÷ DPI produced sub-4" values that were auto-saved).
      // If either dimension is suspiciously small, reset to the default paper.
      const MIN_PAPER_IN = 4
      const validBounds = prev.widthInches >= MIN_PAPER_IN && prev.heightInches >= MIN_PAPER_IN
      const paperW = validBounds ? prev.widthInches  : DEFAULT_OUTPUT_SETTINGS.widthInches
      const paperH = validBounds ? prev.heightInches : DEFAULT_OUTPUT_SETTINGS.heightInches
      const { widthInches, heightInches } = fitToPaper(
        image.width, image.height, paperW, paperH,
      )
      return { ...prev, widthInches, heightInches }
    })
  }, [])

  // Keep output width/height in sync with crop and rotation.
  // Only fires when the geometry changes (not on levels adjustments).
  // Skipped on project load / image load (caller sets skipDimensionRecalcRef).
  //
  // Uses proportional scaling: computes the ratio of visible pixels BEFORE vs
  // AFTER the crop/rotation change and applies that ratio to the existing
  // output dimensions.  This is independent of DPI and works correctly whether
  // the initial size came from fit-to-paper, native-DPI, or manual input.
  useEffect(() => {
    if (!source) return
    if (skipDimensionRecalcRef.current) {
      skipDimensionRecalcRef.current = false
      // Sync the "previous" transform baseline to whatever was just applied
      // (from project/image load), so the next crop delta is computed from
      // the right starting point.
      prevTransformRef.current = {
        cropLeft:  transformSettings.cropLeft,
        cropRight: transformSettings.cropRight,
        cropTop:   transformSettings.cropTop,
        cropBottom: transformSettings.cropBottom,
        rotation:  transformSettings.rotation,
      }
      return
    }

    // Helper: compute visible pixel dimensions after rotation + crop.
    const visiblePx = (t: typeof prevTransformRef.current) => {
      let w = source.width, h = source.height
      if (t.rotation !== 0) {
        const rad = Math.abs(t.rotation) * Math.PI / 180
        const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
        ;[w, h] = [Math.round(w * cos + h * sin), Math.round(w * sin + h * cos)]
      }
      const imgW = Math.max(1, w - Math.round(t.cropLeft  * w) - Math.round(t.cropRight  * w))
      const imgH = Math.max(1, h - Math.round(t.cropTop   * h) - Math.round(t.cropBottom * h))
      return { w: imgW, h: imgH }
    }

    const prev = prevTransformRef.current
    const newT = {
      cropLeft:  transformSettings.cropLeft,
      cropRight: transformSettings.cropRight,
      cropTop:   transformSettings.cropTop,
      cropBottom: transformSettings.cropBottom,
      rotation:  transformSettings.rotation,
    }

    const prevPx = visiblePx(prev)
    const newPx  = visiblePx(newT)

    setOutputSettings((prevOut) => ({
      ...prevOut,
      widthInches:  Math.round(prevOut.widthInches  * (newPx.w / prevPx.w) * 100) / 100,
      heightInches: Math.round(prevOut.heightInches * (newPx.h / prevPx.h) * 100) / 100,
    }))

    prevTransformRef.current = newT
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source,
    transformSettings.cropLeft, transformSettings.cropRight,
    transformSettings.cropTop,  transformSettings.cropBottom,
    transformSettings.rotation,
  ])

  // Transformed image for palette extraction — respects crop, rotation, levels
  const transformedImageData = useMemo(() => {
    if (!source) return null
    return applyTransforms(source.imageData, transformSettings)
  }, [source, transformSettings])

  // Use the TRANSFORMED image's actual aspect ratio so that OutputControls'
  // aspect-ratio lock uses the post-crop/rotation dimensions.  The raw
  // source AR (source.width / source.height) ignores crop and rotation, so
  // a user who crops a portrait image to landscape and then edits a
  // dimension with the lock on would get the wrong (portrait) AR applied,
  // snapping the output back to portrait.
  const sourceAspect = transformedImageData
    ? transformedImageData.width / transformedImageData.height
    : (source ? source.width / source.height : null)

  return (
    <div className="app">
      {prompt && <SavePromptModal projectName={projectName} onChoose={prompt} />}
      {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
      <TopBar
        onImageLoad={handleImageLoad}
        fileName={source?.fileName}
        projectName={projectName}
        projectNames={projectNames}
        onProjectNameChange={setProjectName}
        onLoadProject={handleLoadProject}
        onDeleteProject={handleDeleteProject}
      >
        <ExportBar
          source={source}
          transformSettings={transformSettings}
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          outputSettings={outputSettings}
          projectName={projectName}
        />
      </TopBar>
      <div className="main-area">
        <ControlPanel
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          outputSettings={outputSettings}
          transformSettings={transformSettings}
          channelView={channelView}
          hasImage={source !== null}
          sourceAspect={sourceAspect}
          sourceImageData={transformedImageData}
          onHalftoneChange={setHalftoneSettings}
          onCMYKChange={setCmykSettings}
          onSpotChange={setSpotSettings}
          onOutputChange={setOutputSettings}
          onTransformChange={setTransformSettings}
          onChannelViewChange={setChannelView}
        />
        <PreviewCanvas
          source={source}
          transformSettings={transformSettings}
          halftoneSettings={halftoneSettings}
          cmykSettings={cmykSettings}
          spotSettings={spotSettings}
          channelView={channelView}
          outputSettings={outputSettings}
          onImageLoad={handleImageLoad}
          onTransformChange={setTransformSettings}
        />
      </div>
    </div>
  )
}

export default App
