import { useRef, useCallback } from 'react'
import type { Viewport } from '../hooks/useCanvasTransform'
import { ImageTransformSettings } from '../types'

type Handle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br'

const CURSORS: Record<Handle, string> = {
  tl: 'nwse-resize', tr: 'nesw-resize',
  bl: 'nesw-resize', br: 'nwse-resize',
  left: 'ew-resize',  right: 'ew-resize',
  top: 'ns-resize',   bottom: 'ns-resize',
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
 * Draws a border around the current image boundary and 8 drag handles
 * (4 corners + 4 edge midpoints) to adjust crop.
 *
 * Handles carry data-crop-handle so useCanvasTransform skips pan on them.
 */
export function CropOverlay({ viewport, transformedW, transformedH, settings, onChange }: Props) {
  const dragRef = useRef<{
    handle: Handle
    startX: number
    startY: number
    startSettings: ImageTransformSettings
    /** Post-rotation, pre-crop dimensions — needed to convert px deltas to crop fractions. */
    rotatedW: number
    rotatedH: number
    zoom: number
  } | null>(null)

  const { zoom, panX, panY } = viewport

  // Screen coordinates of the image edges.
  const lx = Math.round(-panX * zoom)
  const rx = Math.round((transformedW - panX) * zoom)
  const ty = Math.round(-panY * zoom)
  const by = Math.round((transformedH - panY) * zoom)
  const midX = Math.round((lx + rx) / 2)
  const midY = Math.round((ty + by) / 2)

  const startDrag = useCallback((handle: Handle, e: React.MouseEvent) => {
    e.preventDefault()

    const { cropLeft, cropRight, cropTop, cropBottom } = settings
    // Recover pre-crop rotated dimensions (fractions × pre-crop size = transformed size).
    const rW = transformedW / Math.max(0.001, 1 - cropLeft - cropRight)
    const rH = transformedH / Math.max(0.001, 1 - cropTop - cropBottom)

    dragRef.current = {
      handle,
      startX: e.clientX, startY: e.clientY,
      startSettings: { ...settings },
      rotatedW: rW, rotatedH: rH,
      zoom: viewport.zoom,
    }
    document.body.style.cursor = CURSORS[handle]

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

    const onMove = (me: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (me.clientX - d.startX) / d.zoom  // output pixels
      const dy = (me.clientY - d.startY) / d.zoom
      const s = d.startSettings

      let { cropLeft, cropRight, cropTop, cropBottom } = s

      if (d.handle === 'left' || d.handle === 'tl' || d.handle === 'bl') {
        cropLeft = clamp(s.cropLeft + dx / d.rotatedW, 0, 1 - s.cropRight - 0.01)
      }
      if (d.handle === 'right' || d.handle === 'tr' || d.handle === 'br') {
        cropRight = clamp(s.cropRight - dx / d.rotatedW, 0, 1 - s.cropLeft - 0.01)
      }
      if (d.handle === 'top' || d.handle === 'tl' || d.handle === 'tr') {
        cropTop = clamp(s.cropTop + dy / d.rotatedH, 0, 1 - s.cropBottom - 0.01)
      }
      if (d.handle === 'bottom' || d.handle === 'bl' || d.handle === 'br') {
        cropBottom = clamp(s.cropBottom - dy / d.rotatedH, 0, 1 - s.cropTop - 0.01)
      }

      onChange({ ...s, cropLeft, cropRight, cropTop, cropBottom })
    }

    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [viewport.zoom, transformedW, transformedH, settings, onChange])

  const SZ = 10   // handle size (px)
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

      {/* Drag handles */}
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
            background: 'rgba(255,255,255,0.92)',
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
