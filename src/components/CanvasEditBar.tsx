import type { MouseEvent } from 'react'
import { Segmented } from './ui/Segmented'

interface Props {
  /** Name of the plate being edited. */
  name: string
  /** The key plate has no ownership to paint — it is erase-only. */
  eraseOnly: boolean
  brushPx: number
  onBrushPxChange: (px: number) => void
  erase: boolean
  onEraseChange: (erase: boolean) => void
  /** True when the edits were painted at a different crop/rotation and are inactive. */
  stale: boolean
  onDone: () => void
  /** Pointer entered the bar — the canvas hides its brush ring. */
  onHover?: () => void
}

const MODES = [
  { value: false, label: 'Paint' },
  { value: true, label: 'Erase' },
]

const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * Floating bar shown while a plate is in layer edit mode: what is being
 * edited, paint vs erase, brush size, and the way out. Lives on the canvas
 * because that is where the brush is.
 */
export function CanvasEditBar({
  name, eraseOnly, brushPx, onBrushPxChange, erase, onEraseChange, stale, onDone, onHover,
}: Props) {
  return (
    <div
      className="canvas-bar canvas-bar--edit"
      data-canvas-ui
      onMouseDown={stop}
      onMouseUp={stop}
      onMouseMove={stop}
      onMouseEnter={onHover}
    >
      <span title="Other layers are hidden while editing">
        ✎ <strong>{name}</strong>
      </span>

      {eraseOnly ? (
        <span className="canvas-bar__muted" title="Erases dots, stroke and outline">Erase only</span>
      ) : (
        <Segmented size="sm" fill={false} options={MODES} value={erase} onChange={onEraseChange} />
      )}

      <label title="Brush size in image pixels — [ and ] to shrink / grow">
        <span className="canvas-bar__muted">Brush</span>
        <input
          type="range" min={4} max={200} step={1}
          value={brushPx}
          onChange={(e) => onBrushPxChange(Number(e.target.value))}
        />
        <span style={{ minWidth: 36, textAlign: 'right' }}>{brushPx}px</span>
      </label>

      {stale && (
        <span style={{ color: 'var(--warning)' }} title="Painted at a different crop/rotation — edits are inactive. Restore the previous crop, or clear them.">
          ⚠ Inactive at this crop
        </span>
      )}

      <span className="canvas-bar__muted" title="[ ] brush size · ⌘Z undo stroke · E or Esc done">
        [ ] size · ⌘Z undo
      </span>

      <button className="btn--small btn--primary" onClick={onDone} title="Leave edit mode (E or Esc)">
        Done
      </button>
    </div>
  )
}
