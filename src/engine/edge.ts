/**
 * Edge detection for the key plate stroke overlay.
 *
 * Applies a 3×3 Sobel operator to the source luminance channel and thresholds
 * the resulting gradient magnitude to produce a binary edge mask.
 *
 * Convention matches the rest of the system:
 *   black (0)   = edge / ink
 *   white (255) = no edge / paper
 *
 * Transparent pixels (already mapped to white by precomputeGrayscale) produce
 * strong edges at the subject boundary — giving a natural outline around cutouts.
 */

import { precomputeGrayscale } from './sampling'
import { dilateMask } from './dilate'

/**
 * Compute a black-on-white edge mask via the Sobel operator.
 *
 * @param source     - Source ImageData (any resolution; transparent px → white).
 * @param threshold  - Gradient magnitude threshold relative to the image's max,
 *                     0–1. 0.1 = many fine edges; 0.5 = only strong edges.
 * @returns          - ImageData where edge pixels are 0 (black), others 255 (white).
 */
export function computeEdgeMask(source: ImageData, threshold: number): ImageData {
  const { width, height } = source
  const gray = precomputeGrayscale(source)

  // ── Sobel gradient magnitude ──────────────────────────────────────────────
  const magnitude = new Float32Array(width * height)
  let maxMag = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = gray[(y - 1) * width + (x - 1)]
      const tc = gray[(y - 1) * width +  x      ]
      const tr = gray[(y - 1) * width + (x + 1)]
      const ml = gray[ y      * width + (x - 1)]
      const mr = gray[ y      * width + (x + 1)]
      const bl = gray[(y + 1) * width + (x - 1)]
      const bc = gray[(y + 1) * width +  x      ]
      const br = gray[(y + 1) * width + (x + 1)]

      // Gx kernel: [[-1,0,1],[-2,0,2],[-1,0,1]]
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br
      // Gy kernel: [[-1,-2,-1],[0,0,0],[1,2,1]]
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br

      const mag = Math.sqrt(gx * gx + gy * gy)
      magnitude[y * width + x] = mag
      if (mag > maxMag) maxMag = mag
    }
  }

  // ── Threshold to binary ───────────────────────────────────────────────────
  // If the image is perfectly flat (maxMag=0), no edges exist regardless of threshold.
  const thresh = maxMag > 0 ? threshold * maxMag : Infinity

  const buf = new Uint8ClampedArray(width * height * 4).fill(255)  // all white
  for (let i = 0; i < width * height; i++) {
    if (magnitude[i] >= thresh) {
      buf[i * 4]     = 0
      buf[i * 4 + 1] = 0
      buf[i * 4 + 2] = 0
      // alpha already 255 from fill
    }
    buf[i * 4 + 3] = 255
  }

  return new ImageData(buf, width, height)
}

/**
 * Compute a solid outline ring traced around the subject's alpha-channel silhouette.
 *
 * Produces a binary mask where only the pixels immediately outside the subject
 * boundary (up to `strokeWidth` pixels) are black (ink). All other pixels are
 * white (paper). Unlike Sobel edge detection, this traces only the silhouette —
 * internal tonal edges in the image are ignored entirely.
 *
 * Only meaningful for transparent-background images. For fully opaque images the
 * returned mask is empty (all white).
 *
 * @param source      - Source ImageData with an alpha channel.
 * @param strokeWidth - How many pixels outward from the subject edge to fill.
 * @returns           - Black-on-white ImageData: outline pixels are 0, rest are 255.
 */
export function computeAlphaBoundaryMask(source: ImageData, strokeWidth: number): ImageData {
  const { data, width, height } = source
  const n = width * height

  if (strokeWidth <= 0) {
    return new ImageData(new Uint8ClampedArray(n * 4).fill(255), width, height)
  }

  // Build binary subject mask: subject (alpha ≥ 128) → 0 (black), transparent → 255 (white)
  const subjectBuf = new Uint8ClampedArray(n * 4)
  let hasTransparent = false
  for (let i = 0; i < n; i++) {
    const isSubject = data[i * 4 + 3] >= 128
    if (!isSubject) hasTransparent = true
    const v = isSubject ? 0 : 255
    subjectBuf[i * 4]     = v
    subjectBuf[i * 4 + 1] = v
    subjectBuf[i * 4 + 2] = v
    subjectBuf[i * 4 + 3] = 255
  }

  // No transparent pixels → no silhouette boundary → return empty mask
  if (!hasTransparent) {
    return new ImageData(new Uint8ClampedArray(n * 4).fill(255), width, height)
  }

  // Dilate the subject mask outward by strokeWidth pixels
  const subjectCanvas = document.createElement('canvas')
  subjectCanvas.width = width; subjectCanvas.height = height
  subjectCanvas.getContext('2d')!.putImageData(new ImageData(subjectBuf, width, height), 0, 0)
  const dilatedCanvas = dilateMask(subjectCanvas, strokeWidth)
  const dilatedData = dilatedCanvas.getContext('2d')!.getImageData(0, 0, width, height).data

  // Ring = pixels that became black in the dilated mask but were white (transparent) originally.
  // These are the pixels added by dilation — the outer stroke ring.
  const ringBuf = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const inDilated  = dilatedData[i * 4] < 128    // black in dilated = covered
    const inOriginal = subjectBuf[i * 4]  < 128    // black in original = subject
    const v = (inDilated && !inOriginal) ? 0 : 255  // ring pixel = added by dilation
    ringBuf[i * 4]     = v
    ringBuf[i * 4 + 1] = v
    ringBuf[i * 4 + 2] = v
    ringBuf[i * 4 + 3] = 255
  }

  return new ImageData(ringBuf, width, height)
}

/**
 * Composite an edge mask onto an existing black-on-white BW canvas.
 * Edge pixels (black) are burned into the canvas wherever they appear —
 * existing ink is preserved and edges add new ink on top.
 *
 * Uses multiply blend mode: black(0) × anything = 0 (edge wins),
 * white(255) × anything = anything (no change where no edge).
 */
export function applyEdgeMaskToCanvas(
  target: HTMLCanvasElement,
  edgeMask: ImageData,
): void {
  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width  = edgeMask.width
  tmpCanvas.height = edgeMask.height
  tmpCanvas.getContext('2d')!.putImageData(edgeMask, 0, 0)

  const ctx = target.getContext('2d')!
  const prev = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(tmpCanvas, 0, 0)
  ctx.globalCompositeOperation = prev
}
