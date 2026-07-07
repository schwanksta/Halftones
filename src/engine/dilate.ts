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
  // Cap iterations to prevent runaway if a caller passes Infinity or a huge value.
  const n = Math.min(Math.round(trapPx), 100)
  if (n <= 0 || !isFinite(n)) return srcCanvas

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

/** One dilation pass at a fixed offset `s` — same 8-compass darken composite
 *  as `dilateMask`'s inner loop, but at distance `s` instead of 1. */
function dilatePass(srcCanvas: HTMLCanvasElement, s: number): HTMLCanvasElement {
  const w = srcCanvas.width
  const h = srcCanvas.height
  const next = document.createElement('canvas')
  next.width = w
  next.height = h
  const ctx = next.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(srcCanvas, 0, 0)

  ctx.globalCompositeOperation = 'darken'
  ctx.drawImage(srcCanvas,  s,  0)
  ctx.drawImage(srcCanvas, -s,  0)
  ctx.drawImage(srcCanvas,  0,  s)
  ctx.drawImage(srcCanvas,  0, -s)
  ctx.drawImage(srcCanvas,  s,  s)
  ctx.drawImage(srcCanvas, -s,  s)
  ctx.drawImage(srcCanvas,  s, -s)
  ctx.drawImage(srcCanvas, -s, -s)
  ctx.globalCompositeOperation = 'source-over'

  return next
}

/**
 * Chebyshev dilation by `radiusPx` using a doubling schedule — O(log r) passes
 * instead of O(r). Each pass darken-composites the mask at the 8 compass
 * offsets of distance s (plus center); offsets {−s,0,s}² Minkowski-compose, so
 * s = 1,2,4,… then a remainder step reaches any radius exactly. Returns a new
 * canvas; source untouched. For radii ≤ 4 just delegates to dilateMask.
 *
 * Schedule invariant: after `covered` px are guaranteed reached, the next step
 * `s` must satisfy `s <= 2*covered + 1` so the {−s,0,s} offsets, composed with
 * everything already covered, keep the reached interval contiguous (no gaps).
 * The classic doubling schedule s = covered+1 (1, 2, 4, 8, …) satisfies this
 * with equality and covers `radius` in O(log radius) passes; the final step is
 * simply whatever remains.
 */
export function dilateMaskBy(srcCanvas: HTMLCanvasElement, radiusPx: number): HTMLCanvasElement {
  const radius = Math.max(0, Math.min(2000, Math.round(radiusPx)))
  if (radius <= 0) return srcCanvas
  if (radius <= 4) return dilateMask(srcCanvas, radius)

  let current = srcCanvas
  let covered = 0
  while (covered < radius) {
    // Next step must be <= 2*covered+1 to keep contiguous coverage; the
    // doubling schedule (s = covered+1) hits that bound exactly, except the
    // final step which is clamped to the remaining distance.
    const s = Math.min(covered + 1, radius - covered)
    current = dilatePass(current, s)
    covered += s
  }

  return current
}
