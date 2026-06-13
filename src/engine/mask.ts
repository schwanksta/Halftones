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
 * Build a "cut overlay" canvas from a rasterized mask at the given target size.
 *
 * The overlay has:
 *   - opaque white (rgba 255,255,255,255)  where the mask says CUT (no ink)
 *   - transparent (rgba 0,0,0,0)            where the mask says KEEP
 *
 * Drawing this overlay onto a black-on-white halftone plate with
 * ctx.drawImage(overlay, ...) turns cut areas to white (paper/no ink) while
 * leaving kept areas untouched.  This works because white is the "no ink"
 * convention used throughout this codebase.
 *
 * The mask is thresholded hard at 0.5 — v1 is a binary clip only.
 */
async function buildCutOverlay(
  mask: MaskImage,
  targetW: number,
  targetH: number,
  settings: MaskSettings,
): Promise<HTMLCanvasElement> {
  const rasterized = await rasterizeMask(mask, targetW, targetH)
  const srcData    = rasterized.getContext('2d')!.getImageData(0, 0, targetW, targetH)
  const { data }   = srcData

  // Resolve auto mode before the pixel loop.
  const maskHasAlpha  = hasTransparency(rasterized)
  const effectiveMode = resolveSourceMode(settings.source, maskHasAlpha)

  // Build the keep map [0,1] per pixel, then apply invert.
  // alpha mode:     keep = alpha / 255   (opaque = keep = 1)
  // luminance mode: keep = (0.299R + 0.587G + 0.114B) / 255  (white = keep = 1)
  const n = targetW * targetH
  const overlay = new Uint8ClampedArray(n * 4)

  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]

    let keep: number
    if (effectiveMode === 'alpha') {
      keep = a / 255
    } else {
      // Luminance (Rec.601 coefficients)
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      // Blend with alpha: fully transparent pixels count as white (keep=1)
      keep = a < 255 ? (lum * (a / 255) + 1.0 * (1 - a / 255)) : lum
    }

    if (settings.invert) keep = 1 - keep

    // Hard threshold at 0.5
    const isCut = keep < 0.5

    // Cut areas → opaque white; keep areas → transparent
    overlay[i * 4]     = 255
    overlay[i * 4 + 1] = 255
    overlay[i * 4 + 2] = 255
    overlay[i * 4 + 3] = isCut ? 255 : 0
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
 *
 * The overlay must already be at the same pixel dimensions as the plate.
 */
export function applyCutOverlayToCanvas(plate: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
  const ctx = plate.getContext('2d')!
  ctx.drawImage(overlay, 0, 0)
}

/**
 * Build a cut overlay canvas at the given target size from a MaskImage + settings.
 * Returns null if the mask is disabled or undefined.
 *
 * This is the main public API for export paths — call once per export resolution,
 * then pass the result to applyCutOverlayToCanvas for each plate.
 */
export async function buildMaskOverlay(
  mask: MaskImage | null,
  maskSettings: MaskSettings,
  targetW: number,
  targetH: number,
): Promise<HTMLCanvasElement | null> {
  if (!mask || !maskSettings.enabled) return null
  return buildCutOverlay(mask, targetW, targetH, maskSettings)
}

/**
 * Load a mask image from raw bytes + filename.
 * For SVG: store the text; for raster: decode into an HTMLImageElement.
 * Returns a MaskImage ready to store in app state.
 */
export async function loadMaskFromBytes(bytes: Uint8Array, fileName: string): Promise<MaskImage> {
  const isSvg = fileName.toLowerCase().endsWith('.svg')

  if (isSvg) {
    const svgText = new TextDecoder().decode(bytes)
    return { isSvg: true, svgText, rawBytes: bytes, fileName }
  }

  // Raster: decode into an HTMLImageElement via a Blob URL
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
 * Extract the viewport region of a cut-overlay canvas — the same pattern used
 * by extractRegionFromCanvas in the preview hook for spot channels.
 *
 * Returns a new canvas at (targetW × targetH) showing the overlay region
 * covering (srcX, srcY, srcW × srcH) of the source overlay.
 * Areas outside the overlay bounds are transparent (KEEP, so no clipping).
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
  // Default is transparent (keep = no clip) — don't fill with opaque color.

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
