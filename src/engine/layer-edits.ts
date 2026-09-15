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

import { ImageTransformSettings, SeparationMode, SpotColor } from '../types'
import { SpotLabelData, plateRanks } from './spot-separation'

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
 *
 * Every edit targets ONE plate: paint = "this plate prints here", erase =
 * "this plate doesn't". They're recorded as per-plate bits and the pixel's
 * owner is then re-derived from them, never overwritten blindly:
 *
 * - Build-up: an owner implies itself plus every plate printed before it. The
 *   owner becomes the highest-ranked plate that still prints — the original
 *   owner or any painted plate, minus erased ones — so painting two layers in
 *   the same spot honours both, and erasing one keeps the others.
 * - Knockout: exactly one ink per pixel, so overlapping paint is a real
 *   conflict. The most recently edited layer wins (masks are kept in edit
 *   order — see handlePaintStroke). Erasing the owner leaves paper.
 */
export function applyLabelEdits(
  ld: SpotLabelData,
  masks: EditMasks,
  colors: SpotColor[],
  opts: { mode?: SeparationMode; manualOrder?: boolean } = {},
): SpotLabelData {
  if (masks.size === 0) return ld

  const { width, height } = ld
  const labels = new Int32Array(ld.labels)
  const n = width * height
  // Paint is NOT written into `values` (the tone shared by every plate) — see
  // SpotLabelData.painted for why.
  const painted = ld.painted ? new Uint32Array(ld.painted) : new Uint32Array(n)
  const erased = ld.erased ? new Uint32Array(ld.erased) : new Uint32Array(n)
  // Knockout conflict resolution: the last-applied painted plate per pixel.
  const lastPaint = new Int8Array(n).fill(-1)
  let anyPaint = false, anyErase = false

  for (const [colorId, canvas] of masks) {
    const color = colors.find(c => c.id === colorId)
    if (!color || color.type === 'background') continue   // deleted or background — not part of the label partition
    const idx = ld.labColorIds.indexOf(colorId)
    if (idx < 0 || idx > 31) continue
    if (canvas.width !== width || canvas.height !== height) continue   // stale geometry — caller should have gated on transformKeyOf already

    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    const data = ctx.getImageData(0, 0, width, height).data
    const bit = 1 << idx

    for (let i = 0; i < n; i++) {
      const p = i * 4
      if (data[p + 3] < 128) continue   // untouched
      if (data[p] < 128) {
        painted[i] |= bit
        erased[i] &= ~bit
        lastPaint[i] = idx
        anyPaint = true
      } else {
        erased[i] |= bit
        painted[i] &= ~bit
        anyErase = true
      }
    }
  }
  if (!anyPaint && !anyErase) return ld

  const buildup = opts.mode === 'buildup' && ld.labColorIds.length > 1
  const rank = buildup ? plateRanks(ld.labColorL, opts.manualOrder ?? false) : null

  for (let i = 0; i < n; i++) {
    const pBits = painted[i], eBits = erased[i]
    if (pBits === 0 && eBits === 0) continue
    const orig = labels[i]

    if (!rank) {
      // Knockout: one ink per pixel.
      if (lastPaint[i] >= 0) labels[i] = lastPaint[i]
      else if (orig >= 0 && (eBits & (1 << orig)) !== 0) labels[i] = -1
      continue
    }

    // Build-up: plates up to the highest of (original owner, painted plates)
    // print, minus erased ones; the owner is the highest-ranked survivor.
    let top = orig >= 0 ? rank[orig] : -1
    for (let k = 0; k < rank.length; k++) {
      if ((pBits & (1 << k)) !== 0 && rank[k] > top) top = rank[k]
    }
    let owner = -1
    for (let k = 0; k < rank.length; k++) {
      if (rank[k] > top || (eBits & (1 << k)) !== 0) continue
      if (owner < 0 || rank[k] > rank[owner]) owner = k
    }
    labels[i] = owner
  }

  return {
    ...ld,
    labels,
    painted: anyPaint ? painted : ld.painted,
    erased: anyErase ? erased : ld.erased,
  }
}

/**
 * Scale edit masks to the given dimensions (nearest-neighbour, preserving the
 * tri-state encoding). Returns the input untouched when dims already match.
 */
export function scaleEditMasks(masks: EditMasks, width: number, height: number): EditMasks {
  let allMatch = true
  for (const canvas of masks.values()) {
    if (canvas.width !== width || canvas.height !== height) { allMatch = false; break }
  }
  if (allMatch) return masks

  const scaled: EditMasks = new Map()
  for (const [colorId, canvas] of masks) {
    if (canvas.width === width && canvas.height === height) {
      scaled.set(colorId, canvas)
      continue
    }
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(canvas, 0, 0, width, height)
    scaled.set(colorId, out)
  }
  return scaled
}

/** Reserved EditMasks key for the key plate's erase mask. Never a real color id,
 *  so applyLabelEdits ignores it automatically (it isn't in labColorIds). */
export const KEY_EDIT_ID = '__key__'

/**
 * Convert the key's edit mask (opaque white = erased) into a black-on-white
 * knockout mask (black = erase) at the mask's own size, or null if absent.
 */
export function keyEraseKnockoutCanvas(masks: EditMasks): HTMLCanvasElement | null {
  const canvas = masks.get(KEY_EDIT_ID)
  if (!canvas) return null

  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const data = ctx.getImageData(0, 0, width, height).data
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    // opaque AND red >= 128 → erased (black); everything else → white
    const erased = data[p + 3] >= 128 && data[p] >= 128
    const v = erased ? 0 : 255
    out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255
  }

  const result = document.createElement('canvas')
  result.width = width
  result.height = height
  result.getContext('2d')!.putImageData(new ImageData(out, width, height), 0, 0)
  return result
}
