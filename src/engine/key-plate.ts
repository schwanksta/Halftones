import { HalftoneSettings, KeyPlateSettings } from '../types'
import { renderHalftone } from './halftone'
import { computeEdgeMask, applyEdgeMaskToCanvas } from './edge'
import { dilateMask } from './dilate'

export interface KeyPlateCanvasOptions {
  width: number
  height: number
  /** Source to render the key's halftone dots from, at `width`×`height`. */
  dotsSource: ImageData
  key: KeyPlateSettings
  /**
   * Base halftone settings (pattern, gamma, dot gain, etc). lpi/angle/minDot/
   * maxDot/fgColor/bgColor/invert are always overridden from `key` below, so
   * callers can pass settings as-is regardless of color mode.
   */
  baseSettings: HalftoneSettings
  renderDpi: number
  outputDpi?: number
  isExport?: boolean
  radialCenter: { x: number; y: number }
  /** Sobel edge-stroke mask, already scaled/cropped/dilated to width×height. */
  edgeMask?: ImageData | null
  /** Alpha-boundary outline mask, already scaled/cropped to width×height. */
  outlineMask?: ImageData | null
}

/**
 * Build the key plate's black-on-white content: halftone dots (or a blank
 * white fill when disabled), then the edge-stroke and outline masks
 * multiply-composited on top.
 *
 * Used identically by the live preview and both export paths (channel/PDF
 * export and color proof) — callers acquire `dotsSource`/`edgeMask`/
 * `outlineMask` using whatever resolution/caching strategy suits them
 * (preview crops memoized source-resolution masks per frame; export
 * computes and scales them fresh against the full output canvas), then
 * hand off to this function for the actual render + composite.
 */
export function buildKeyPlateCanvas(opts: KeyPlateCanvasOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = opts.width
  canvas.height = opts.height
  const ctx = canvas.getContext('2d')!

  if (opts.key.dotsEnabled !== false) {
    renderHalftone(ctx, {
      source: opts.dotsSource,
      settings: {
        ...opts.baseSettings,
        lpi: opts.key.lpi,
        angle: opts.key.angle,
        minDot: opts.key.minDot,
        maxDot: opts.key.maxDot,
        fgColor: '#000000',
        bgColor: '#ffffff',
        invert: false,
      },
      renderDpi: opts.renderDpi,
      radialCenter: opts.radialCenter,
      outputDpi: opts.outputDpi,
      isExport: opts.isExport,
    })
  } else {
    // No dots — fill white so strokes/outline still composite correctly.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, opts.width, opts.height)
  }

  if (opts.edgeMask) applyEdgeMaskToCanvas(canvas, opts.edgeMask)
  if (opts.outlineMask) applyEdgeMaskToCanvas(canvas, opts.outlineMask)

  return canvas
}

/**
 * Detect Sobel edges at source resolution, scale to the target size
 * (nearest-neighbor, to keep edges crisp/1-bit), then dilate to the
 * requested stroke width. Shared by both export paths, which always
 * render the key's edge stroke against a freshly scaled full-frame source
 * — unlike the preview, which crops a memoized source-resolution mask per
 * frame instead (resolution-dependent Sobel thresholding requires
 * detecting at a fixed resolution everywhere; see git history for the bug
 * this caused when export and preview detected edges at different sizes).
 */
export function buildExportEdgeMask(
  transformed: ImageData,
  targetWidth: number,
  targetHeight: number,
  threshold: number,
  strokeWidthPx: number,
): ImageData {
  const edgeSrc = computeEdgeMask(transformed, threshold)
  const edgeSrcCanvas = document.createElement('canvas')
  edgeSrcCanvas.width = transformed.width
  edgeSrcCanvas.height = transformed.height
  edgeSrcCanvas.getContext('2d')!.putImageData(edgeSrc, 0, 0)

  const edgeScaled = document.createElement('canvas')
  edgeScaled.width = targetWidth
  edgeScaled.height = targetHeight
  const esCtx = edgeScaled.getContext('2d')!
  esCtx.imageSmoothingEnabled = false
  esCtx.drawImage(edgeSrcCanvas, 0, 0, targetWidth, targetHeight)

  const edgeFinal = strokeWidthPx > 1 ? dilateMask(edgeScaled, strokeWidthPx) : edgeScaled
  return edgeFinal.getContext('2d')!.getImageData(0, 0, targetWidth, targetHeight)
}
