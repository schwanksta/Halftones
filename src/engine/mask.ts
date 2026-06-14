import { MaskSettings, MaskImage, MaskSourceMode } from '../types'

/**
 * Rasterize a MaskImage to a canvas at the given target dimensions.
 *
 * The mask is ALWAYS stretched to fill the target rectangle — the mask's own
 * aspect ratio is ignored.  The target rect equals the transformed image's
 * width × height (source resolution in preview; output resolution on export),
 * so the mask covers exactly the same area as the halftone.
 *
 * SVG masks are re-rasterized at the target size each time, so they stay
 * crisp at any output DPI.  Raster masks are drawImage-scaled to fit.
 */
async function rasterizeMask(
  mask: MaskImage,
  targetW: number,
  targetH: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width  = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')!

  if (mask.isSvg && mask.svgText) {
    // For SVG: turn the markup into a Blob URL, load into an Image, drawImage.
    // This lets the browser render the SVG at the exact pixel dimensions we need.
    const blob = new Blob([mask.svgText], { type: 'image/svg+xml' })
    const url  = URL.createObjectURL(blob)
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image(targetW, targetH)
        img.onload  = () => { ctx.drawImage(img, 0, 0, targetW, targetH); resolve() }
        img.onerror = () => reject(new Error('SVG mask rasterization failed'))
        img.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  } else if (mask.element) {
    ctx.drawImage(mask.element, 0, 0, targetW, targetH)
  }

  return canvas
}

/**
 * Detect whether a rasterized mask canvas has any transparent pixels.
 * Used by 'auto' source mode to decide between alpha and luminance.
 */
function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

/**
 * Determine which source mode to actually use given the 'auto' setting and
 * whether the rasterized mask has any transparency.
 */
function resolveSourceMode(mode: MaskSourceMode, maskHasAlpha: boolean): 'alpha' | 'luminance' {
  if (mode === 'alpha')      return 'alpha'
  if (mode === 'luminance')  return 'luminance'
  // auto
  return maskHasAlpha ? 'alpha' : 'luminance'
}

/**
 * Rasterize the mask and reduce it to a binary CUT field at target resolution:
 *   255 = cut (no ink)   0 = keep (render normally)
 *
 * Applies the source mode (alpha vs luminance), the white=keep convention,
 * the invert toggle, and a hard 0.5 threshold.  This binary field is the basis
 * for both the (optionally feathered) cut overlay and the boundary stroke.
 */
async function computeCutField(
  mask: MaskImage,
  targetW: number,
  targetH: number,
  settings: MaskSettings,
): Promise<Uint8Array> {
  const rasterized = await rasterizeMask(mask, targetW, targetH)
  const { data }   = rasterized.getContext('2d')!.getImageData(0, 0, targetW, targetH)

  const maskHasAlpha  = hasTransparency(rasterized)
  const effectiveMode = resolveSourceMode(settings.source, maskHasAlpha)

  const n = targetW * targetH
  const cut = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3]
    let keep: number
    if (effectiveMode === 'alpha') {
      keep = a / 255
    } else {
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      // Transparent pixels count as white (keep) when reading luminance.
      keep = a < 255 ? (lum * (a / 255) + (1 - a / 255)) : lum
    }
    if (settings.invert) keep = 1 - keep
    cut[i] = keep < 0.5 ? 255 : 0
  }
  return cut
}

// ─── Separable filters (single channel) ───────────────────────────────────────

/** Separable box blur (mean) — O(1) per pixel via a sliding window sum. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = 2 * r + 1
  // Horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let dx = -r; dx <= r; dx++) sum += src[row + Math.max(0, Math.min(w - 1, dx))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win
      const add = row + Math.min(w - 1, x + r + 1)
      const rem = row + Math.max(0, x - r)
      sum += src[add] - src[rem]
    }
  }
  // Vertical
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let dy = -r; dy <= r; dy++) sum += tmp[Math.max(0, Math.min(h - 1, dy)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win
      const add = Math.min(h - 1, y + r + 1) * w + x
      const rem = Math.max(0, y - r) * w + x
      sum += tmp[add] - tmp[rem]
    }
  }
  return out
}

/** Separable morphology on a binary field (0/255). op = Math.max → dilate, Math.min → erode. */
function morph(src: Uint8Array, w: number, h: number, r: number, op: (a: number, b: number) => number): Uint8Array {
  if (r < 1) return src
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = src[row + x]
      for (let dx = -r; dx <= r; dx++) v = op(v, src[row + Math.max(0, Math.min(w - 1, x + dx))])
      tmp[row + x] = v
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = tmp[y * w + x]
      for (let dy = -r; dy <= r; dy++) v = op(v, tmp[Math.max(0, Math.min(h - 1, y + dy)) * w + x])
      out[y * w + x] = v
    }
  }
  return out
}

// ─── Cut overlay (clip) ───────────────────────────────────────────────────────

/** Normalized 8×8 ordered-dither (Bayer) matrix, values in [0,1). */
const BAYER8 = (() => {
  const m = [
     0, 48, 12, 60,  3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
     8, 56,  4, 52, 11, 59,  7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
     2, 50, 14, 62,  1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58,  6, 54,  9, 57,  5, 53,
    42, 26, 38, 22, 41, 25, 37, 21,
  ]
  return m.map((v) => (v + 0.5) / 64)
})()

/**
 * Build a "cut overlay" canvas: opaque white where the mask says CUT, transparent
 * where KEEP.  Drawing it onto a black-on-white plate turns cut areas to white
 * (paper / no ink) and leaves kept areas untouched.
 *
 * When `featherPx > 0`, the binary cut field is box-blurred so the overlay's
 * alpha ramps across the boundary.  With `dither = true` that soft ramp is
 * ordered-dithered into a 1-bit cut/keep pattern — so on a 1-bit plate the
 * feather prints as thinning dots instead of an un-printable gray edge.  With
 * `dither = false` the ramp stays as smooth gray alpha (for preview / proof).
 */
async function buildCutOverlay(
  mask: MaskImage,
  targetW: number,
  targetH: number,
  settings: MaskSettings,
  featherPx: number,
  dither: boolean,
): Promise<HTMLCanvasElement> {
  const cut = await computeCutField(mask, targetW, targetH, settings)
  const n = targetW * targetH
  const overlay = new Uint8ClampedArray(n * 4)

  if (featherPx >= 1) {
    const f = new Float32Array(n)
    for (let i = 0; i < n; i++) f[i] = cut[i]
    const blurred = boxBlur(f, targetW, targetH, Math.round(featherPx))
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const i = y * targetW + x
        overlay[i * 4] = 255; overlay[i * 4 + 1] = 255; overlay[i * 4 + 2] = 255
        if (dither) {
          // cutFrac (0..1) thresholded against the Bayer cell → solid cut or keep.
          const cutFrac = blurred[i] / 255
          overlay[i * 4 + 3] = cutFrac > BAYER8[(y & 7) * 8 + (x & 7)] ? 255 : 0
        } else {
          overlay[i * 4 + 3] = blurred[i]
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      overlay[i * 4] = 255; overlay[i * 4 + 1] = 255; overlay[i * 4 + 2] = 255
      overlay[i * 4 + 3] = cut[i]
    }
  }

  const outCanvas = document.createElement('canvas')
  outCanvas.width  = targetW
  outCanvas.height = targetH
  outCanvas.getContext('2d')!.putImageData(new ImageData(overlay, targetW, targetH), 0, 0)
  return outCanvas
}

/**
 * Apply a cut overlay onto a black-on-white plate canvas (in-place).
 * Cut areas become white (no ink); keep areas are untouched.
 * The overlay must already be at the same pixel dimensions as the plate.
 */
export function applyCutOverlayToCanvas(plate: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
  plate.getContext('2d')!.drawImage(overlay, 0, 0)
}

/**
 * Build a cut overlay at the given target size from a MaskImage + settings.
 * Returns null if the mask is disabled or undefined.  `featherPx` is the feather
 * radius in target pixels (caller converts from inches at the relevant resolution).
 */
export async function buildMaskOverlay(
  mask: MaskImage | null,
  maskSettings: MaskSettings,
  targetW: number,
  targetH: number,
  featherPx = 0,
  dither = false,
): Promise<HTMLCanvasElement | null> {
  if (!mask || !maskSettings.enabled) return null
  return buildCutOverlay(mask, targetW, targetH, maskSettings, featherPx, dither)
}

// ─── Boundary stroke ──────────────────────────────────────────────────────────

/**
 * Build a keyline stroke tracing the mask boundary, `strokePx` wide and centred
 * on the edge.  Returns two canvases at target resolution:
 *   - `colored`: the stroke in its ink color on transparent — for preview/proof
 *     compositing (drawImage on top).
 *   - `plate`:   black stroke on white — a standalone black-on-white plate for
 *     channel/PDF export.
 * Returns null when the stroke is disabled or there's no mask.
 */
export async function buildMaskStroke(
  mask: MaskImage | null,
  maskSettings: MaskSettings,
  targetW: number,
  targetH: number,
  strokePx: number,
): Promise<{ colored: HTMLCanvasElement; plate: HTMLCanvasElement } | null> {
  if (!mask || !maskSettings.enabled || !maskSettings.strokeEnabled || strokePx < 1) return null

  const cut = await computeCutField(mask, targetW, targetH, maskSettings)
  const n = targetW * targetH

  // Ring centred on the boundary: dilate ∧ ¬erode of the cut field by half-width.
  const r = Math.max(1, Math.round(strokePx / 2))
  const dil = morph(cut, targetW, targetH, r, Math.max)
  const ero = morph(cut, targetW, targetH, r, Math.min)

  const hex = maskSettings.strokeColor ?? '#000000'
  const sr = parseInt(hex.slice(1, 3), 16)
  const sg = parseInt(hex.slice(3, 5), 16)
  const sb = parseInt(hex.slice(5, 7), 16)

  const colored = new Uint8ClampedArray(n * 4)
  const plate   = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const onRing = dil[i] > 127 && ero[i] < 128   // boundary band
    colored[i * 4] = sr; colored[i * 4 + 1] = sg; colored[i * 4 + 2] = sb
    colored[i * 4 + 3] = onRing ? 255 : 0
    const v = onRing ? 0 : 255   // black ink on white paper
    plate[i * 4] = v; plate[i * 4 + 1] = v; plate[i * 4 + 2] = v; plate[i * 4 + 3] = 255
  }

  const mk = (buf: Uint8ClampedArray) => {
    const c = document.createElement('canvas')
    c.width = targetW; c.height = targetH
    c.getContext('2d')!.putImageData(new ImageData(buf, targetW, targetH), 0, 0)
    return c
  }
  return { colored: mk(colored), plate: mk(plate) }
}

/**
 * Load a mask image from raw bytes + filename.
 * For SVG: store the text; for raster: decode into an HTMLImageElement.
 */
export async function loadMaskFromBytes(bytes: Uint8Array, fileName: string): Promise<MaskImage> {
  const isSvg = fileName.toLowerCase().endsWith('.svg')

  if (isSvg) {
    const svgText = new TextDecoder().decode(bytes)
    return { isSvg: true, svgText, rawBytes: bytes, fileName }
  }

  const ext = fileName.toLowerCase().split('.').pop() ?? 'png'
  const mimeTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  }
  const mime = mimeTypes[ext] ?? 'image/png'
  const blob = new Blob([bytes], { type: mime })
  const url  = URL.createObjectURL(blob)
  const element = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load mask image'))
    img.src = url
  })
  URL.revokeObjectURL(url)

  return { isSvg: false, element, rawBytes: bytes, fileName }
}

/**
 * Extract the viewport region of an overlay canvas (cut overlay or colored
 * stroke) — same pattern as extractRegionFromCanvas for spot channels.  Areas
 * outside the overlay are transparent (no clip / no stroke).
 */
export function extractOverlayRegion(
  overlayCanvas: HTMLCanvasElement,
  srcX: number, srcY: number, srcW: number, srcH: number,
  targetW: number, targetH: number,
): HTMLCanvasElement {
  const dst = document.createElement('canvas')
  dst.width  = targetW
  dst.height = targetH
  const ctx = dst.getContext('2d')!

  const clampedSrcX  = Math.max(0, srcX)
  const clampedSrcY  = Math.max(0, srcY)
  const clampedSrcX2 = Math.min(overlayCanvas.width,  srcX + srcW)
  const clampedSrcY2 = Math.min(overlayCanvas.height, srcY + srcH)
  if (clampedSrcX2 <= clampedSrcX || clampedSrcY2 <= clampedSrcY) return dst

  const scaleX = targetW / srcW
  const scaleY = targetH / srcH
  ctx.drawImage(
    overlayCanvas,
    clampedSrcX, clampedSrcY, clampedSrcX2 - clampedSrcX, clampedSrcY2 - clampedSrcY,
    (clampedSrcX - srcX) * scaleX, (clampedSrcY - srcY) * scaleY,
    (clampedSrcX2 - clampedSrcX) * scaleX, (clampedSrcY2 - clampedSrcY) * scaleY,
  )
  return dst
}
