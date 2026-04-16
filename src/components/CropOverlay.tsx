import { useRef, useCallback, useState } from 'react'
import type { Viewport } from '../hooks/useCanvasTransform'
import { ImageTransformSettings } from '../types'

type Handle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br'

const CURSORS: Record<Handle, string> = {
  tl: 'nwse-resize', tr: 'nesw-resize',
  bl: 'nesw-resize', br: 'nwse-resize',
  left: 'ew-resize',  right: 'ew-resize',
  top: 'ns-resize',   bottom: 'ns-resize',
}

interface CropValues {
  cropLeft: number; cropRight: number; cropTop: number; cropBottom: number
}

interface DragState {
  handle: Handle
  startSettings: ImageTransformSettings
  /** Pre-crop rotated image size — constant for this drag. */
  rotatedW: number
  rotatedH: number
  zoom: number
  finalCrop: CropValues
}

interface Props {
  viewport: Viewport
  /** Post-rotation + post-crop image dimensions (what the viewport shows). */
  transformedW: number
  transformedH: number
  settings: ImageTransformSettings
  onChange: (s: ImageTransformSettings) => void
}

/**
 * Transparent overlay rendered on top of the preview canvas.
 * Shows a white outline around the current crop boundary and 8 drag handles.
 *
 * During drag, only local state updates (cheap overlay repositioning).
 * onChange fires exactly once on mouseup — the halftone never re-renders
 * mid-drag.
 *
 * Coordinate notes
 * ────────────────
 * viewport.panX/panY are in POST-CROP image space.
 *   screen x = (postCropX - panX) * zoom
 *
 * Idle: the image occupies [0, transformedW] × [0, transformedH] in that space.
 *   lx = -panX * zoom   rx = (transformedW - panX) * zoom   (etc.)
 *
 * During drag: panX/zoom don't change (pan is inhibited). The handle moves by
 * the crop delta expressed in post-crop pixels:
 *   Δ_left  =  rotatedW * (liveCropLeft  - startCropLeft)
 *   Δ_right = -rotatedW * (liveCropRight - startCropRight)
 */
export function CropOverlay({ viewport, transformedW, transformedH, settings, onChange }: Props) {
  const [liveCrop, setLiveCrop] = useState<CropValues | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const { zoom, panX, panY } = viewport

  // Screen positions of the four crop edges.
  let lx: number, rx: number, ty: number, by: number
  if (liveCrop && dragRef.current) {
    const { rotatedW, rotatedH, startSettings: s } = dragRef.current
    // Express boundaries in post-crop image space (origin = start left/top edge).
    lx = Math.round((rotatedW * (liveCrop.cropLeft  - s.cropLeft)              - panX) * zoom)
    rx = Math.round((rotatedW * (1 - liveCrop.cropRight - s.cropLeft)          - panX) * zoom)
    ty = Math.round((rotatedH * (liveCrop.cropTop   - s.cropTop)               - panY) * zoom)
    by = Math.round((rotatedH * (1 - liveCrop.cropBottom - s.cropTop)          - panY) * zoom)
  } else {
    // Idle: image occupies [0, transformedW] × [0, transformedH] in viewport space.
    lx = Math.round(-panX * zoom)
    rx = Math.round((transformedW - panX) * zoom)
    ty = Math.round(-panY * zoom)
    by = Math.round((transformedH - panY) * zoom)
  }
  const midX = Math.round((lx + rx) / 2)
  const midY = Math.round((ty + by) / 2)

  const startDrag = useCallback((handle: Handle, e: React.MouseEvent) => {
    e.preventDefault()
    const { cropLeft, cropRight, cropTop, cropBottom } = settings
    const rW = transformedW / Math.max(0.001, 1 - cropLeft - cropRight)
    const rH = transformedH / Math.max(0.001, 1 - cropTop - cropBottom)
    const initial: CropValues = { cropLeft, cropRight, cropTop, cropBottom }

    dragRef.current = {
      handle,
      startSettings: { ...settings },
      rotatedW: rW, rotatedH: rH,
      zoom: viewport.zoom,
      finalCrop: { ...initial },
    }
    setLiveCrop(initial)
    document.body.style.cursor = CURSORS[handle]

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const startX = e.clientX
    const startY = e.clientY

    const onMove = (me: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (me.clientX - startX) / d.zoom
      const dy = (me.clientY - startY) / d.zoom
      const s = d.startSettings
      let { cropLeft, cropRight, cropTop, cropBottom } = s

      if (handle === 'left' || handle === 'tl' || handle === 'bl') {
        cropLeft = clamp(s.cropLeft + dx / d.rotatedW, 0, 1 - s.cropRight - 0.01)
      }
      if (handle === 'right' || handle === 'tr' || handle === 'br') {
        cropRight = clamp(s.cropRight - dx / d.rotatedW, 0, 1 - s.cropLeft - 0.01)
      }
      if (handle === 'top' || handle === 'tl' || handle === 'tr') {
        cropTop = clamp(s.cropTop + dy / d.rotatedH, 0, 1 - s.cropBottom - 0.01)
      }
      if (handle === 'bottom' || handle === 'bl' || handle === 'br') {
        cropBottom = clamp(s.cropBottom - dy / d.rotatedH, 0, 1 - s.cropTop - 0.01)
      }

      const next: CropValues = { cropLeft, cropRight, cropTop, cropBottom }
      d.finalCrop = next   // saved for mouseup
      setLiveCrop(next)    // move the overlay, no parent onChange call
    }

    const onUp = () => {
      const d = dragRef.current
      if (d) onChange({ ...d.startSettings, ...d.finalCrop })
      dragRef.current = null
      setLiveCrop(null)
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [viewport.zoom, transformedW, transformedH, settings, onChange])

  const SZ = 10
  const H  = SZ / 2

  const handles: { id: Handle; sx: number; sy: number }[] = [
    { id: 'tl',     sx: lx,   sy: ty   },
    { id: 'tr',     sx: rx,   sy: ty   },
    { id: 'bl',     sx: lx,   sy: by   },
    { id: 'br',     sx: rx,   sy: by   },
    { id: 'left',   sx: lx,   sy: midY },
    { id: 'right',  sx: rx,   sy: midY },
    { id: 'top',    sx: midX, sy: ty   },
    { id: 'bottom', sx: midX, sy: by   },
  ]

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Outline around the keep-region */}
      <div style={{
        position: 'absolute',
        left: lx, top: ty,
        width: Math.max(0, rx - lx),
        height: Math.max(0, by - ty),
        outline: '1px solid rgba(255,255,255,0.6)',
        boxSizing: 'border-box',
      }} />

      {/* Handles — turn amber while dragging so the user knows something is pending */}
      {handles.map(({ id, sx, sy }) => (
        <div
          key={id}
          data-crop-handle="1"
          onMouseDown={(e) => startDrag(id, e)}
          style={{
            position: 'absolute',
            left: sx - H,
            top: sy - H,
            width: SZ,
            height: SZ,
            background: liveCrop ? 'rgba(255,210,60,0.95)' : 'rgba(255,255,255,0.92)',
            border: '1.5px solid rgba(0,0,0,0.4)',
            borderRadius: 2,
            cursor: CURSORS[id],
            pointerEvents: 'all',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
          }}
        />
      ))}
    </div>
  )
}
