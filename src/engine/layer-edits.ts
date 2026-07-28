/**
 * Layer edit mode — brush paint/erase on a spot color's OWNERSHIP, not its
 * rendered plate. Edits are stored as per-color RGBA canvases (transparent =
 * untouched, opaque black = force ink, opaque white = force paper) at
 * transformed-image dimensions, and applied to the shared SpotLabelData
 * partition before it flows into channels / underbase / key knockout / build-up
 * ranks / merge — so every downstream consumer inherits edits for free, and
 * edits survive LPI/angle/threshold/trap changes because they never touch the
 * rendered pixels directly.
 */

import { ImageTransformSettings, SpotColor } from '../types'
import { SpotLabelData } from './spot-separation'

/** Per-color edit masks, keyed by color id. RGBA at transformed-image dims:
 *  transparent = untouched, opaque black = force ink, opaque white = force paper. */
export type EditMasks = Map<string, HTMLCanvasElement>

/**
 * Signature of the geometry the masks were painted against. Edits are stored
 * in transformed-image space, so a crop/rotation change invalidates their
 * alignment with the current label field.
 */
export function transformKeyOf(t: ImageTransformSettings): string {
  return `${t.rotation}|${t.cropLeft}|${t.cropRight}|${t.cropTop}|${t.cropBottom}`
}

/**
 * Apply edit masks to a label field. Returns a NEW SpotLabelData (never
 * mutates the input — it's memoized upstream). Masks whose dimensions don't
 * match the label field, or whose color id is background-type/deleted, are
 * skipped defensively.
 */
export function applyLabelEdits(ld: SpotLabelData, masks: EditMasks, colors: SpotColor[]): SpotLabelData {
  if (masks.size === 0) return ld

  const { width, height } = ld
  const labels = new Int32Array(ld.labels)
  const values = new Uint8ClampedArray(ld.values)
  const n = width * height

  for (const [colorId, canvas] of masks) {
    const color = colors.find(c => c.id === colorId)
    if (!color || color.type === 'background') continue   // deleted or background — not part of the label partition
    const idx = ld.labColorIds.indexOf(colorId)
    if (idx < 0) continue
    if (canvas.width !== width || canvas.height !== height) continue   // stale geometry — caller should have gated on transformKeyOf already

    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    const data = ctx.getImageData(0, 0, width, height).data

    for (let i = 0; i < n; i++) {
      const p = i * 4
      if (data[p + 3] < 128) continue   // untouched
      if (data[p] < 128) {
        labels[i] = idx
        values[i] = 0
      } else {
        labels[i] = -1
      }
    }
  }

  return { ...ld, labels, values }
}
