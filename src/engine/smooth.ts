/**
 * Edge-preserving smoothing for spot-channel coverage masks.
 *
 * Spot separation assigns each pixel to its nearest palette color by a hard
 * per-pixel LAB decision, which scatters isolated speckle (stray pixels claimed
 * by a color) and leaves jagged classification boundaries.  A median filter
 * removes that speckle and smooths the edges while keeping them crisp — unlike
 * a Gaussian blur, which softens everything and rounds off detail.
 *
 * Operates on the grayscale coverage value (the R channel, with G/B mirrored;
 * 0 = full ink, 255 = no ink).  Alpha is preserved.
 */
export function medianFilterMask(src: ImageData, radius: number): ImageData {
  const r = Math.max(0, Math.floor(radius))
  if (r === 0) return src

  const { data, width, height } = src
  const out = new Uint8ClampedArray(data.length)
  const win: number[] = []

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width - 1, x + r)
      win.length = 0
      for (let yy = y0; yy <= y1; yy++) {
        let p = (yy * width + x0) * 4
        for (let xx = x0; xx <= x1; xx++) {
          win.push(data[p])
          p += 4
        }
      }
      win.sort((a, b) => a - b)
      const m = win[win.length >> 1]
      const o = (y * width + x) * 4
      out[o] = m
      out[o + 1] = m
      out[o + 2] = m
      out[o + 3] = data[o + 3]   // preserve alpha
    }
  }

  return new ImageData(out, width, height)
}
