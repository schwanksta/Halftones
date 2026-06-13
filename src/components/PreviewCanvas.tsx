import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import {
  HalftoneSettings, CMYKSettings, SourceImage,
  ChannelView, ImageTransformSettings, OutputSettings, SpotSettings,
  MaskSettings, MaskImage,
} from '../types'
import { useHalftonePreview } from '../hooks/useHalftonePreview'
import { useCanvasTransform } from '../hooks/useCanvasTransform'
import { CropOverlay } from './CropOverlay'
import { rgbToLab } from '../engine/spot-separation'

interface Props {
  source: SourceImage | null
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  channelView: ChannelView
  outputSettings: OutputSettings
  onImageLoad: (image: SourceImage) => void
  onTransformChange: (settings: ImageTransformSettings) => void
  /** When true, clicks on the canvas sample the source image color as a seed. */
  seedPickingActive?: boolean
  /** Called with the LAB value of the sampled pixel when a seed click is detected. */
  onSeedPick?: (lab: [number, number, number]) => void
  /** Source image data for seed color sampling (pre-halftone, post-transform). */
  transformedImageData?: ImageData | null
  mask?: MaskImage | null
  maskSettings?: MaskSettings
}

export function PreviewCanvas({
  source, transformSettings, halftoneSettings,
  cmykSettings, spotSettings, channelView, outputSettings,
  onImageLoad, onTransformChange,
  seedPickingActive, onSeedPick, transformedImageData,
  mask, maskSettings,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Track mouse-down position — set up after viewport is available (see below).
  const seedMouseDown = useRef<{ x: number; y: number } | null>(null)

  // Editable zoom state
  const [zoomEditing, setZoomEditing] = useState(false)
  const [zoomDraft, setZoomDraft] = useState('')
  const zoomInputRef = useRef<HTMLInputElement>(null)

  const viewportW = source?.width ?? 0
  const viewportH = source?.height ?? 0

  const { viewport, fitToView, zoomTo } = useCanvasTransform(containerRef, viewportW, viewportH)

  const handleSeedMouseDown = useCallback((e: React.MouseEvent) => {
    if (!seedPickingActive) return
    seedMouseDown.current = { x: e.clientX, y: e.clientY }
  }, [seedPickingActive])

  const handleSeedMouseUp = useCallback((e: React.MouseEvent) => {
    if (!seedPickingActive || !onSeedPick || !transformedImageData || !seedMouseDown.current) return
    const dx = e.clientX - seedMouseDown.current.x
    const dy = e.clientY - seedMouseDown.current.y
    seedMouseDown.current = null
    if (Math.sqrt(dx * dx + dy * dy) > 5) return  // drag, not click

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top
    const srcX = Math.round(viewport.panX + canvasX / viewport.zoom)
    const srcY = Math.round(viewport.panY + canvasY / viewport.zoom)
    if (srcX < 0 || srcY < 0 || srcX >= transformedImageData.width || srcY >= transformedImageData.height) return
    const idx = (srcY * transformedImageData.width + srcX) * 4
    onSeedPick(rgbToLab(
      transformedImageData.data[idx],
      transformedImageData.data[idx + 1],
      transformedImageData.data[idx + 2],
    ))
  }, [seedPickingActive, onSeedPick, transformedImageData, viewport])

  // Compute post-transform image dimensions (fast arithmetic, no canvas ops).
  // Needed to position the crop overlay handles correctly.
  const transformedDims = useMemo(() => {
    if (!source) return { width: 0, height: 0 }
    let w = source.width
    let h = source.height
    if (transformSettings.rotation !== 0) {
      const rad = Math.abs(transformSettings.rotation) * Math.PI / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      w = Math.round(source.width * cos + source.height * sin)
      h = Math.round(source.width * sin + source.height * cos)
    }
    const { cropLeft, cropRight, cropTop, cropBottom } = transformSettings
    const x0 = Math.round(cropLeft * w)
    const y0 = Math.round(cropTop * h)
    const x1 = w - Math.round(cropRight * w)
    const y1 = h - Math.round(cropBottom * h)
    return { width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
  }, [source, transformSettings])

  // The zoom level at which renderDpi === outputDpi (accurate 1:1 output preview)
  const outputScaleZoom = source
    ? outputSettings.dpi * outputSettings.widthInches / source.width
    : 1

  // Display zoom as % of output-accurate scale so "100%" = accurate dots
  const zoomPercent = Math.round((viewport.zoom / outputScaleZoom) * 100)
  const isOutputScale = Math.abs(viewport.zoom - outputScaleZoom) < outputScaleZoom * 0.02

  // Size canvas to container and re-fit when container resizes or image loads
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Fit when a new image is loaded
  useEffect(() => {
    if (source) fitToView()
  }, [source?.fileName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus and select zoom input when entering edit mode
  useEffect(() => {
    if (zoomEditing) {
      setTimeout(() => zoomInputRef.current?.select(), 0)
    }
  }, [zoomEditing])

  useHalftonePreview(canvasRef, {
    source,
    transformSettings,
    halftoneSettings,
    cmykSettings,
    spotSettings,
    channelView,
    outputSettings,
    viewport,
    mask: mask ?? null,
    maskSettings,
  })

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return

    const rawBytes = new Uint8Array(await file.arrayBuffer())
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      onImageLoad({
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height,
        fileName: file.name,
        rawBytes,
      })
    }
    img.src = url
  }, [onImageLoad])

  const commitZoom = (raw: string) => {
    const v = parseFloat(raw)
    if (!isNaN(v) && v > 0) zoomTo((v / 100) * outputScaleZoom)
    setZoomEditing(false)
  }

  return (
    <div
      className="preview-area"
      ref={containerRef}
      style={{
        cursor: seedPickingActive ? 'cell' : source ? 'crosshair' : 'default',
        outline: seedPickingActive
          ? '2px solid var(--accent)'
          : dragOver ? '2px dashed var(--accent)' : undefined,
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseDown={handleSeedMouseDown}
      onMouseUp={handleSeedMouseUp}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: source ? 'block' : 'none',
        }}
      />

      {source && (
        <CropOverlay
          viewport={viewport}
          transformedW={transformedDims.width}
          transformedH={transformedDims.height}
          settings={transformSettings}
          onChange={onTransformChange}
        />
      )}

      {!source && (
        <div className="preview-placeholder">
          {dragOver ? 'Drop image here' : 'Drop an image here or use the file picker above'}
        </div>
      )}

      {source && (
        <div className="zoom-controls">
          <button className="zoom-btn" onClick={fitToView} title="Fit to view">
            Fit
          </button>
          <button
            className={`zoom-btn${isOutputScale ? ' zoom-btn--active' : ''}`}
            onClick={() => zoomTo(outputScaleZoom)}
            title="100% — one output pixel per screen pixel, accurate dot size"
          >
            100%
          </button>

          {zoomEditing ? (
            <input
              ref={zoomInputRef}
              type="number"
              value={zoomDraft}
              onChange={(e) => setZoomDraft(e.target.value)}
              onBlur={(e) => commitZoom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setZoomEditing(false)
              }}
              style={{
                width: 56,
                fontSize: 12,
                fontFamily: 'monospace',
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent)',
                borderRadius: 3,
                padding: '1px 4px',
                color: 'var(--text-primary)',
                textAlign: 'right',
                MozAppearance: 'textfield' as React.CSSProperties['MozAppearance'],
              }}
            />
          ) : (
            <span
              className="zoom-label"
              onClick={() => { setZoomDraft(String(zoomPercent)); setZoomEditing(true) }}
              title="Click to enter zoom %"
              style={{ cursor: 'text', borderBottom: '1px dotted color-mix(in srgb, var(--text-secondary) 60%, transparent)', paddingBottom: 1 }}
            >
              {zoomPercent}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}
