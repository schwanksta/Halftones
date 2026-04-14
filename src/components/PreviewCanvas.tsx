import { useRef, useState, useCallback, useEffect } from 'react'
import {
  HalftoneSettings, CMYKSettings, SourceImage,
  ChannelView, ImageTransformSettings, OutputSettings, SpotSettings,
} from '../types'
import { useHalftonePreview } from '../hooks/useHalftonePreview'
import { useCanvasTransform } from '../hooks/useCanvasTransform'

interface Props {
  source: SourceImage | null
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  channelView: ChannelView
  outputSettings: OutputSettings
  onImageLoad: (image: SourceImage) => void
}

export function PreviewCanvas({
  source, transformSettings, halftoneSettings,
  cmykSettings, spotSettings, channelView, outputSettings, onImageLoad,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Viewport coordinate space is source-image pixels (after transforms).
  // We approximate this with the raw source dimensions — transforms update asynchronously
  // and fitToView is called again when source changes anyway.
  const viewportW = source?.width ?? 0
  const viewportH = source?.height ?? 0

  const { viewport, fitToView, zoomTo } = useCanvasTransform(containerRef, viewportW, viewportH)

  // The zoom level at which renderDpi === outputDpi (accurate 1:1 output preview)
  const outputScaleZoom = source
    ? outputSettings.dpi * outputSettings.widthInches / source.width
    : 1

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

  useHalftonePreview(canvasRef, {
    source,
    transformSettings,
    halftoneSettings,
    cmykSettings,
    spotSettings,
    channelView,
    outputSettings,
    viewport,
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return

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
      })
    }
    img.src = url
  }, [onImageLoad])

  // Display zoom as % of output-accurate scale so "100%" = accurate dots
  const zoomPercent = Math.round((viewport.zoom / outputScaleZoom) * 100)
  const isOutputScale = Math.abs(viewport.zoom - outputScaleZoom) < outputScaleZoom * 0.02

  return (
    <div
      className="preview-area"
      ref={containerRef}
      style={{
        cursor: source ? 'crosshair' : 'default',
        outline: dragOver ? '2px dashed var(--accent)' : undefined,
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
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
          <span className="zoom-label">{zoomPercent}%</span>
        </div>
      )}
    </div>
  )
}
