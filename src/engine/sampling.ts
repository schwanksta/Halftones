/**
 * Pre-compute a single-channel grayscale luminance buffer from RGBA ImageData.
 * Avoids repeated per-pixel luminance math during sampling.
 */
export function precomputeGrayscale(source: ImageData): Uint8Array {
  const { data, width, height } = source
  const len = width * height
  const gray = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    const j = i * 4
    // Treat transparent pixels as paper (255) so they produce no halftone dots.
    gray[i] = data[j + 3] < 128
      ? 255
      : (77 * data[j] + 150 * data[j + 1] + 29 * data[j + 2]) >> 8
  }
  return gray
}

/**
 * Sample the average brightness of pixels in a region around (cx, cy).
 * Uses a pre-computed grayscale buffer for speed.
 * Sub-samples for large cells to avoid reading hundreds of pixels per cell.
 * Returns a value from 0 (black) to 1 (white).
 */
export function sampleGray(
  gray: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  cellSize: number
): number {
  const half = cellSize / 2
  const x0 = Math.max(0, Math.floor(cx - half))
  const y0 = Math.max(0, Math.floor(cy - half))
  const x1 = Math.min(width - 1, Math.ceil(cx + half))
  const y1 = Math.min(height - 1, Math.ceil(cy + half))

  // Sub-sample: for large cells, skip pixels. No visible quality loss.
  const stride = cellSize > 20 ? 3 : cellSize > 10 ? 2 : 1

  let total = 0
  let count = 0

  for (let y = y0; y <= y1; y += stride) {
    const rowOff = y * width
    for (let x = x0; x <= x1; x += stride) {
      total += gray[rowOff + x]
      count++
    }
  }

  return count > 0 ? total / count / 255 : 1
}

/**
 * Legacy function for backward compatibility — operates directly on ImageData.
 * Prefer precomputeGrayscale + sampleGray for batch operations.
 */
export function sampleCellBrightness(
  source: ImageData,
  cx: number,
  cy: number,
  cellSize: number
): number {
  const { data, width, height } = source
  const half = cellSize / 2
  const x0 = Math.max(0, Math.floor(cx - half))
  const y0 = Math.max(0, Math.floor(cy - half))
  const x1 = Math.min(width - 1, Math.ceil(cx + half))
  const y1 = Math.min(height - 1, Math.ceil(cy + half))

  const stride = cellSize > 20 ? 3 : cellSize > 10 ? 2 : 1

  let total = 0
  let count = 0

  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      const i = (y * width + x) * 4
      total += (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8
      count++
    }
  }

  return count > 0 ? total / count / 255 : 1
}
