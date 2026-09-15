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
import { EditMasks, transformKeyOf, KEY_EDIT_ID } from './engine/layer-edits'
import {
  SourceImage,
  HalftoneSettings,
  CMYKSettings,
  OutputSettings,
  ImageTransformSettings,
  SpotSettings,
  ChannelView,
  MaskSettings,
  MaskImage,
  DEFAULT_HALFTONE_SETTINGS,
  DEFAULT_CMYK_SETTINGS,
  DEFAULT_SPOT_SETTINGS,
  DEFAULT_OUTPUT_SETTINGS,
  DEFAULT_TRANSFORM_SETTINGS,
  DEFAULT_MASK_SETTINGS,
} from './types'
import { AllSettings } from './platform/types'

const AUTO_SAVE_DELAY = 1000 // ms

/** Layer edit mode: how many strokes Cmd/Ctrl+Z can step back through. */
const STROKE_UNDO_LIMIT = 10
/** …and a memory ceiling, since one huge stroke can snapshot most of a mask. */
const STROKE_UNDO_MAX_BYTES = 256 * 1024 * 1024

/** One undoable stroke: the mask pixels under its bounding box. */
interface StrokePatch {
  colorId: string
  canvas: HTMLCanvasElement
  x: number
  y: number
  data: ImageData
  /** The stroke created this layer's mask — undoing it removes the mask again. */
  createdMask: boolean
}

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
  const [seedColors, setSeedColors] = useState<Array<[number, number, number]>>([])
  const [seedPickingActive, setSeedPickingActive] = useState(false)

  // ── Mask state ───────────────────────────────────────────────────────────────
  // The mask IMAGE (bytes/element) lives here, not in localStorage snapshots —
  // same pattern as the source image.  maskSettings (enabled/invert/source) DO
  // go into project snapshots and the .halftones zip.
  const [maskSettings, setMaskSettings] = useState<MaskSettings>(DEFAULT_MASK_SETTINGS)
  const [mask, setMask] = useState<MaskImage | null>(null)

  const handleMaskLoad = useCallback((m: MaskImage) => {
    setMask(m)
  }, [])

  const handleMaskClear = useCallback(() => {
    setMask(null)
    setMaskSettings(DEFAULT_MASK_SETTINGS)
  }, [])

  // ── Layer edit mode (spot mode only) ──────────────────────────────────────
  // Per-color paint/erase masks live in a ref (canvases are too large/mutable
  // for state) — editsVersion is bumped to force dependent memos/effects to
  // re-evaluate whenever a stroke mutates a mask canvas in place.
  const editMasksRef = useRef<EditMasks>(new Map())
  const [editsVersion, setEditsVersion] = useState(0)
  const [editingColorId, setEditingColorId] = useState<string | null>(null)
  const [editBrushPx, setEditBrushPx] = useState(24)
  const [editErase, setEditErase] = useState(false)
  // The transformKeyOf() the masks were painted against; stamped on the first
  // edit and compared against the live transform to detect staleness.
  const [editMasksKey, setEditMasksKey] = useState<string | null>(null)

  // Stroke undo/redo for the current edit session — wiped when edit mode is
  // exited or switched to another layer. Each entry holds only the pixels
  // under one stroke's bounding box (a full mask copy is ~54MB at 4k), from
  // before the stroke (undo stack) or after it (redo stack).
  const strokeUndoRef = useRef<StrokePatch[]>([])
  const strokeRedoRef = useRef<StrokePatch[]>([])
  // Read by the global Cmd/Ctrl+Z handler, which is registered once.
  const editUndoRef = useRef({ editing: false, undoStroke: () => {}, redoStroke: () => {} })
  useEffect(() => {
    strokeUndoRef.current = []
    strokeRedoRef.current = []
  }, [editingColorId])

  // The layer most recently opened in edit mode, so E can jump back into it.
  const lastEditedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingColorId) lastEditedIdRef.current = editingColorId
  }, [editingColorId])

  /** Replace the layer-edit masks wholesale (project load) — mirrors setMask. */
  const setLayerEdits = useCallback((masks: EditMasks, key: string | null) => {
    editMasksRef.current = masks
    setEditMasksKey(key)
    setEditsVersion((v) => v + 1)
  }, [])

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
      save(projectName, { halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, maskSettings })
    }, AUTO_SAVE_DELAY)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, maskSettings, save])

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  const watchedKey = useMemo(
    () => JSON.stringify({
      projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings,
      transformSettings, maskSettings, sourceName: source?.fileName ?? null,
    }),
    [projectName, halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, maskSettings, source?.fileName],
  )
  const { dirty, markClean, markDirty } = useDirtyTracking(watchedKey)

  // ── Settings gather/apply/reset helpers (needed by useAppShell) ───────────
  const gatherSettings = useCallback((): AllSettings => ({
    halftone: halftoneSettings,
    cmyk: cmykSettings,
    spot: spotSettings,
    output: outputSettings,
    transform: transformSettings,
    mask: maskSettings,
  }), [halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings, maskSettings])

  const applySettings = useCallback((s: AllSettings) => {
    skipDimensionRecalcRef.current = true
    setHalftoneSettings(s.halftone)
    setCmykSettings(s.cmyk)
    setSpotSettings(s.spot)
    setOutputSettings(s.output)
    setTransformSettings(s.transform)
    setMaskSettings(s.mask ?? DEFAULT_MASK_SETTINGS)
  }, [])

  const resetToDefaults = useCallback(() => applySettings({
    halftone: DEFAULT_HALFTONE_SETTINGS,
    cmyk: DEFAULT_CMYK_SETTINGS,
    spot: DEFAULT_SPOT_SETTINGS,
    output: DEFAULT_OUTPUT_SETTINGS,
    transform: DEFAULT_TRANSFORM_SETTINGS,
    mask: DEFAULT_MASK_SETTINGS,
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
      // In layer edit mode these step through brush strokes instead — and
      // never fall through to settings undo, which would change something
      // off-screen while you're looking at an isolated plate.
      const edit = editUndoRef.current
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (edit.editing) { edit.undoStroke(); return }
        const { undo, gatherSettings } = undoActionsRef.current
        undo(gatherSettings())
      } else if ((e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        e.preventDefault()
        if (edit.editing) { edit.redoStroke(); return }
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
  // File → Replace Image…: swap the source pixels, keep every setting.
  // Suppress the dimension-recalc effect that fires on source changes — its
  // skip branch also re-syncs prevTransformRef to the current transforms, so
  // the next user crop delta is computed from the right baseline.
  const handleReplaceSource = useCallback((image: SourceImage) => {
    skipDimensionRecalcRef.current = true
    setSource(image)
  }, [])

  const { prompt } = useAppShell({
    projectName, setProjectName,
    source, setSource,
    gatherSettings, applySettings: applySettingsWithUndoSkip, resetToDefaults,
    dirty, markClean, markDirty,
    isTauri,
    showToast,
    mask,
    setMask,
    editMasks: editMasksRef.current,
    editMasksKey,
    setLayerEdits,
    replaceSource: handleReplaceSource,
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
    setMaskSettings(snapshot.maskSettings ?? DEFAULT_MASK_SETTINGS)
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
      // Always fit new images into the default paper bounds so that stale
      // output dimensions from a previous session never carry over.
      // The user can resize after loading.
      const { widthInches, heightInches } = fitToPaper(
        image.width, image.height,
        DEFAULT_OUTPUT_SETTINGS.widthInches, DEFAULT_OUTPUT_SETTINGS.heightInches,
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

  // ── Layer edit mode: commit a stroke into the editing color's mask canvas ──
  // Called once per stroke (on pointer-up), never per mouse-move — the
  // separation is expensive, and the preview's local canvas feedback already
  // gives live painting feedback without touching it.
  const handlePaintStroke = useCallback((pts: { x: number; y: number }[], brushPx: number, erase: boolean) => {
    if (!transformedImageData || !editingColorId) return
    const masks = editMasksRef.current
    let canvas = masks.get(editingColorId)
    const createdMask = !canvas
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.width = transformedImageData.width
      canvas.height = transformedImageData.height
    }
    // Re-insert so the Map stays in edit order: applyLabelEdits applies masks
    // in iteration order, and in knockout the most recently edited layer wins
    // where two layers' paint overlaps.
    masks.delete(editingColorId)
    masks.set(editingColorId, canvas)
    const ctx = canvas.getContext('2d')!

    // Snapshot the stroke's bounding box before drawing, for Cmd/Ctrl+Z.
    if (pts.length > 0) {
      const pad = brushPx / 2 + 2
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
      const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad))
      const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad))
      const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs) + pad))
      const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys) + pad))
      if (x1 > x0 && y1 > y0) {
        const stack = strokeUndoRef.current
        stack.push({ colorId: editingColorId, canvas, x: x0, y: y0, data: ctx.getImageData(x0, y0, x1 - x0, y1 - y0), createdMask })
        let bytes = stack.reduce((n, s) => n + s.data.data.length, 0)
        while (stack.length > STROKE_UNDO_LIMIT || (stack.length > 1 && bytes > STROKE_UNDO_MAX_BYTES)) {
          bytes -= stack.shift()!.data.data.length
        }
        strokeRedoRef.current = []   // a new stroke forks history
      }
    }
    // IMPORTANT: erase must write OPAQUE WHITE (force paper), not clear to
    // transparent — transparent means "untouched" and falls through to the
    // underlying separation, not "no ink". The key plate has no ownership to
    // paint (it composites on top of everything), so its brush is erase-only —
    // ignore editErase and always write white when editing the key.
    const effectiveErase = editingColorId === KEY_EDIT_ID ? true : erase
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = effectiveErase ? '#ffffff' : '#000000'
    ctx.fillStyle = effectiveErase ? '#ffffff' : '#000000'
    ctx.lineWidth = brushPx
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (pts.length < 2) {
      // Single-point tap — draw a dot so a click without drag still paints.
      const p = pts[0] ?? { x: 0, y: 0 }
      ctx.beginPath()
      ctx.arc(p.x, p.y, brushPx / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }

    // Stamp the geometry signature on the first edit only — later edits keep
    // painting into the same space until the user clears or the crop/rotation
    // changes underneath them (which the UI flags as stale, see editsStale).
    setEditMasksKey((prev) => prev ?? transformKeyOf(transformSettings))
    setEditsVersion((v) => v + 1)
    markDirty()
  }, [transformedImageData, editingColorId, transformSettings, markDirty])

  /** Discard a color's paint/erase edits entirely (the escape hatch — no undo for painting). */
  const clearLayerEdits = useCallback((colorId: string) => {
    if (!editMasksRef.current.delete(colorId)) return
    if (editMasksRef.current.size === 0) setEditMasksKey(null)
    // Clearing is deliberate and confirmed; stroke history pointing at the
    // discarded mask would otherwise undo into a canvas nothing reads.
    strokeUndoRef.current = []
    strokeRedoRef.current = []
    setEditsVersion((v) => v + 1)
    markDirty()
  }, [markDirty])

  /** Swap a patch's pixels into its mask, returning the pixels it replaced. */
  const swapPatch = (patch: StrokePatch): StrokePatch => {
    const ctx = patch.canvas.getContext('2d')!
    const replaced = ctx.getImageData(patch.x, patch.y, patch.data.width, patch.data.height)
    ctx.putImageData(patch.data, patch.x, patch.y)
    return { ...patch, data: replaced }
  }

  const undoStroke = useCallback(() => {
    const patch = strokeUndoRef.current.pop()
    if (!patch) return
    strokeRedoRef.current.push(swapPatch(patch))
    const masks = editMasksRef.current
    if (patch.createdMask && masks.get(patch.colorId) === patch.canvas) {
      masks.delete(patch.colorId)
      if (masks.size === 0) setEditMasksKey(null)
    }
    setEditsVersion((v) => v + 1)
    markDirty()
  }, [markDirty])

  const redoStroke = useCallback(() => {
    const patch = strokeRedoRef.current.pop()
    if (!patch) return
    const masks = editMasksRef.current
    if (!masks.has(patch.colorId)) {
      masks.set(patch.colorId, patch.canvas)
      setEditMasksKey((prev) => prev ?? transformKeyOf(transformSettings))
    }
    strokeUndoRef.current.push(swapPatch(patch))
    setEditsVersion((v) => v + 1)
    markDirty()
  }, [markDirty, transformSettings])

  editUndoRef.current = { editing: editingColorId !== null, undoStroke, redoStroke }

  const hasLayerEdits = useCallback((colorId: string) => editMasksRef.current.has(colorId), [editsVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const editsStale = editMasksKey !== null && editMasksKey !== transformKeyOf(transformSettings)

  const handleToggleEdit = useCallback((colorId: string) => {
    setEditingColorId((cur) => (cur === colorId ? null : colorId))
  }, [])

  // Edit-mode shortcuts: Esc leaves edit mode; [ / ] shrink / grow the brush
  // (the Photoshop convention). Steps are proportional (~15%, at least 1px) so
  // they feel even at both ends of the 4–200px range. Ignored while typing in a
  // field, and while the save prompt is open (it uses Esc for Cancel).
  useEffect(() => {
    if (!editingColorId) return
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || prompt) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditingColorId(null)
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const grow = e.key === ']'
        setEditBrushPx((px) => {
          const step = Math.max(1, Math.round(px * 0.15))
          return Math.min(200, Math.max(4, grow ? px + step : px - step))
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingColorId, prompt])

  // E toggles edit mode on the layer you last edited. Skipped when that layer
  // is gone or no longer editable (deleted, disabled, key plate turned off,
  // or out of spot mode) rather than guessing at a different one.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'e' && e.key !== 'E') return
      if (e.metaKey || e.ctrlKey || e.altKey || prompt) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (editingColorId) { e.preventDefault(); setEditingColorId(null); return }
      const id = lastEditedIdRef.current
      if (!id || !source || halftoneSettings.colorMode !== 'spot') return
      const editable = id === KEY_EDIT_ID
        ? !!spotSettings.key?.enabled
        : spotSettings.colors.some((c) => c.id === id && c.enabled && c.type !== 'background')
      if (!editable) return
      e.preventDefault()
      setEditingColorId(id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingColorId, prompt, source, halftoneSettings.colorMode, spotSettings.colors, spotSettings.key])

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
          mask={mask}
          maskSettings={maskSettings}
          editMasks={editMasksRef.current}
          editMasksKey={editMasksKey}
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
          maskSettings={maskSettings}
          mask={mask}
          onHalftoneChange={setHalftoneSettings}
          onCMYKChange={setCmykSettings}
          onSpotChange={setSpotSettings}
          onOutputChange={setOutputSettings}
          onTransformChange={setTransformSettings}
          onChannelViewChange={setChannelView}
          onMaskSettingsChange={setMaskSettings}
          onMaskLoad={handleMaskLoad}
          onMaskClear={handleMaskClear}
          seedColors={seedColors}
          onClearSeeds={() => setSeedColors([])}
          seedPickingActive={seedPickingActive}
          onToggleSeedPicking={() => setSeedPickingActive(v => !v)}
          editingColorId={editingColorId}
          onToggleEdit={handleToggleEdit}
          editBrushPx={editBrushPx}
          onBrushPxChange={setEditBrushPx}
          editErase={editErase}
          onEraseChange={setEditErase}
          hasEdits={hasLayerEdits}
          onClearEdits={clearLayerEdits}
          editsStale={editsStale}
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
          seedPickingActive={seedPickingActive}
          onSeedPick={(lab) => setSeedColors(prev => [...prev, lab])}
          transformedImageData={transformedImageData}
          mask={mask}
          maskSettings={maskSettings}
          editingColorId={editingColorId}
          editBrushPx={editBrushPx}
          editErase={editErase}
          onPaintStroke={handlePaintStroke}
          editMasks={editMasksRef.current}
          editMasksKey={editMasksKey}
          editsVersion={editsVersion}
        />
      </div>
    </div>
  )
}

export default App
