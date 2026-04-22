/**
 * Morphological dilation for black-on-white masks.
 *
 * Used by spot-color trapping: each color channel is rendered as a BW mask
 * (0=ink, 255=paper), then dilated to make the ink regions spread outward by
 * N pixels.  When multiple layers are composited, the dilation causes them to
 * overlap at their boundaries — this hides visible seams between halftone and
 * flat layers that would otherwise show a paper-coloured gap between them.
 *
 * Implementation: iterative 3×3 dilation using the `darken` composite
 * operation.  Each iteration copies the current mask onto a fresh canvas at
 * all 8 compass offsets; `darken` picks the minimum of each pixel, so any
 * pixel that had a black neighbour within 1 pixel becomes black.  After N
 * iterations, the black region has grown by N pixels (Chebyshev / square).
 *
 * Cost: O(N × w × h × 9).  For typical trap values (1–5 px) and preview-sized
 * canvases this is well under 1 ms on modern GPUs.  Returns the input
 * unchanged when `trapPx <= 0`.
 */
export function dilateMask(srcCanvas: HTMLCanvasElement, trapPx: number): HTMLCanvasElement {
  const n = Math.round(trapPx)
  if (n <= 0) return srcCanvas

  const w = srcCanvas.width
  const h = srcCanvas.height

  let current = srcCanvas
  for (let i = 0; i < n; i++) {
    const next = document.createElement('canvas')
    next.width = w
    next.height = h
    const ctx = next.getContext('2d')!

    // Start from a white background so pixels outside the current black
    // region remain white (the `darken` min-blend preserves white unless
    // overwritten by a black neighbour).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    // Base layer in source-over so the first draw establishes the mask.
    ctx.drawImage(current, 0, 0)

    // 8-neighbour dilation via darken compositing.
    ctx.globalCompositeOperation = 'darken'
    ctx.drawImage(current,  1,  0)
    ctx.drawImage(current, -1,  0)
    ctx.drawImage(current,  0,  1)
    ctx.drawImage(current,  0, -1)
    ctx.drawImage(current,  1,  1)
    ctx.drawImage(current, -1,  1)
    ctx.drawImage(current,  1, -1)
    ctx.drawImage(current, -1, -1)
    ctx.globalCompositeOperation = 'source-over'

    current = next
  }

  return current
}
