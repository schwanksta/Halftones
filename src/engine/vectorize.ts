/**
 * Dependency-free raster → polygon vectorizer.
 *
 * Used to smooth flat spot-color plate edges: a staircased diagonal edge in a
 * rasterized mask becomes a clean, simplified, rounded polygon outline.
 *
 * Convention (matches the rest of src/engine/): masks are black-on-white
 * `ImageData` where a red-channel value below `threshold*255` is "inside" the
 * inked region (black, 0) and everything else is "outside" (white, 255).
 *
 * Output polygons are mask-pixel coordinates, meant to be filled with
 * even-odd winding (`ctx.fill(path, 'evenodd')`). Marching squares naturally
 * produces one closed loop per topological boundary — both the outer
 * silhouette of a region and the boundary of any hole inside it. We don't
 * need to classify which is which: even-odd fill alternates "inside-ness"
 * each time a boundary is crossed, so nested loops automatically render as
 * holes without any extra bookkeeping here.
 */

export interface VectorizeOptions {
  /** 0–1. A pixel is "inside" when its red-channel value < threshold*255. */
  threshold: number
  /** 0–100. Higher = more aggressive simplification + smoothing. */
  strength: number
}

export type Polygon = { x: number; y: number }[]

/** Perf-cap downsample factor for a mask of the given size (1 = trace natively). */
function downsampleFactor(width: number, height: number): number {
  const maxDim = Math.max(width, height)
  return maxDim > 2000 ? Math.ceil(maxDim / 2000) : 1
}

/**
 * Douglas–Peucker tolerance (in downsampled-grid units). Kept small and
 * CONSTANT — just enough to collapse the 1px separation staircase into straight
 * edges. Smoothness comes from Chaikin rounding instead; deliberately NOT raised
 * with the strength slider, because a larger tolerance makes each plate's shared
 * boundary diverge more from its neighbour's, which would force a wider overlap
 * (see flatOverlapWidth) and visibly fatten every flat shape as smoothness goes up.
 */
const SIMPLIFY_EPSILON = 1.0


/** A single marching-squares segment: two grid-corner endpoints (in corner-grid units). */
interface Segment {
  ax: number
  ay: number
  bx: number
  by: number
}

/**
 * Trace the inside region of a black-on-white mask into closed polygons
 * (mask-pixel coords). Render with ctx.fill(path, 'evenodd') to handle holes.
 */
export function traceBinaryMask(mask: ImageData, opts: VectorizeOptions): Polygon[] {
  const { width, height, data } = mask
  if (width <= 0 || height <= 0) return []

  const thresh = opts.threshold * 255

  // ── Step 1: binary inside grid at native resolution ───────────────────────
  const insideNative = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    insideNative[i] = data[i * 4] < thresh ? 1 : 0
  }

  // ── Step 2: downsample for perf cap ────────────────────────────────────────
  const f = downsampleFactor(width, height)

  let gridW: number
  let gridH: number
  let inside: Uint8Array

  if (f === 1) {
    gridW = width
    gridH = height
    inside = insideNative
  } else {
    gridW = Math.ceil(width / f)
    gridH = Math.ceil(height / f)
    inside = new Uint8Array(gridW * gridH)
    for (let gy = 0; gy < gridH; gy++) {
      const sy = Math.min(gy * f, height - 1)
      for (let gx = 0; gx < gridW; gx++) {
        const sx = Math.min(gx * f, width - 1)
        inside[gy * gridW + gx] = insideNative[sy * width + sx]
      }
    }
  }

  // ── Step 3: marching squares contour extraction ───────────────────────────
  const loops = traceContours(inside, gridW, gridH)

  // ── Step 4+5+6: simplify, smooth, drop degenerate, rescale ────────────────
  const epsilon = SIMPLIFY_EPSILON
  const chaikinIterations = Math.round((opts.strength / 100) * 4)

  const result: Polygon[] = []
  for (const loop of loops) {
    let poly = douglasPeuckerClosed(loop, epsilon)
    if (poly.length < 3) continue

    poly = chaikinSmoothClosed(poly, chaikinIterations)
    if (poly.length < 3) continue

    if (Math.abs(polygonArea(poly)) < 1.0) continue

    result.push(f === 1 ? poly : poly.map((p) => ({ x: p.x * f, y: p.y * f })))
  }

  return result
}

/** Build one Path2D (mask-pixel coords) containing all polygons as closed subpaths. */
export function polygonsToPath2D(polys: Polygon[]): Path2D {
  const path = new Path2D()
  for (const poly of polys) {
    if (poly.length < 2) continue
    path.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) {
      path.lineTo(poly[i].x, poly[i].y)
    }
    path.closePath()
  }
  return path
}

// ─────────────────────────────────────────────────────────────────────────────
// Marching squares
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sample the inside grid at corner coordinates (cx, cy) in [0, gridW] x [0, gridH].
 * Corners outside the source data (i.e. the implicit border) are treated as
 * "outside" (0), so silhouettes touching the image edge still close up cleanly.
 */
function sampleCorner(inside: Uint8Array, gridW: number, gridH: number, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) return 0
  return inside[cy * gridW + cx]
}

/**
 * Walk every cell of the (gridW-1) x (gridH-1)... actually gridW x gridH cell
 * grid (cells extend one past the sample grid on each side to close boundaries
 * touching the image edge) and emit marching-squares segments, then stitch
 * matching endpoints into closed loops.
 *
 * Cell (cx, cy) for cx in [-1, gridW-1], cy in [-1, gridH-1] has corners:
 *   TL = sample(cx,   cy)
 *   TR = sample(cx+1, cy)
 *   BL = sample(cx,   cy+1)
 *   BR = sample(cx+1, cy+1)
 * in corner-grid coordinates (cx, cy) .. (cx+1, cy+1).
 *
 * Edge midpoints are used as contour points (standard marching squares at
 * iso level 0.5 between a 0 and a 1 corner sample land exactly at the
 * midpoint since both corner values are equally distant from 0.5).
 */
function traceContours(inside: Uint8Array, gridW: number, gridH: number): Polygon[] {
  const segments: Segment[] = []

  for (let cy = -1; cy < gridH; cy++) {
    for (let cx = -1; cx < gridW; cx++) {
      const tl = sampleCorner(inside, gridW, gridH, cx, cy)
      const tr = sampleCorner(inside, gridW, gridH, cx + 1, cy)
      const bl = sampleCorner(inside, gridW, gridH, cx, cy + 1)
      const br = sampleCorner(inside, gridW, gridH, cx + 1, cy + 1)

      const caseIndex = tl * 8 + tr * 4 + br * 2 + bl * 1
      if (caseIndex === 0 || caseIndex === 15) continue

      // Edge midpoints, in corner-grid coordinates.
      const top: [number, number] = [cx + 0.5, cy]
      const bottom: [number, number] = [cx + 0.5, cy + 1]
      const left: [number, number] = [cx, cy + 0.5]
      const right: [number, number] = [cx + 1, cy + 0.5]

      // Standard marching-squares case table. Segment direction is chosen so
      // that walking from `a` to `b` keeps "inside" (value 1) on the left —
      // this consistent winding is what lets stitched loops nest correctly
      // without explicit outer/hole classification.
      //
      // Saddle cases (5 and 10, where opposite corners agree but adjacent
      // corners don't — ambiguous whether the two inside regions connect)
      // are resolved with a fixed convention: treat them as two separate
      // diagonal pass-throughs (no center-connecting branch), i.e. case 5 is
      // handled identically to "case 5a" and case 10 to "case 10a" in the
      // classic lookup table. Applied uniformly, this never produces
      // crossing segments — each saddle cell still emits exactly two
      // independent segments that stitch cleanly with their neighbours.
      switch (caseIndex) {
        case 1: // BL only
          pushSeg(segments, left, bottom)
          break
        case 2: // BR only
          pushSeg(segments, bottom, right)
          break
        case 3: // BL+BR
          pushSeg(segments, left, right)
          break
        case 4: // TR only
          pushSeg(segments, right, top)
          break
        case 5: // TR+BL (saddle) — two diagonal segments, no center join
          pushSeg(segments, left, top)
          pushSeg(segments, right, bottom)
          break
        case 6: // TR+BR
          pushSeg(segments, bottom, top)
          break
        case 7: // TR+BR+BL
          pushSeg(segments, left, top)
          break
        case 8: // TL only
          pushSeg(segments, top, left)
          break
        case 9: // TL+BL
          pushSeg(segments, top, bottom)
          break
        case 10: // TL+BR (saddle) — two diagonal segments, no center join
          pushSeg(segments, top, right)
          pushSeg(segments, bottom, left)
          break
        case 11: // TL+BL+BR
          pushSeg(segments, top, right)
          break
        case 12: // TL+TR
          pushSeg(segments, right, left)
          break
        case 13: // TL+TR+BL
          pushSeg(segments, right, bottom)
          break
        case 14: // TL+TR+BR
          pushSeg(segments, bottom, left)
          break
        default:
          break
      }
    }
  }

  return stitchSegments(segments)
}

function pushSeg(segments: Segment[], a: [number, number], b: [number, number]): void {
  segments.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] })
}

/** Quantize a corner-grid coordinate to a stable hash key (coords are always integer or .5). */
function pointKey(x: number, y: number): string {
  // Multiply by 2 so the .5 fractions become exact integers before stringifying,
  // avoiding any floating point equality issues.
  return `${Math.round(x * 2)},${Math.round(y * 2)}`
}

/**
 * Stitch directed segments (each oriented so "inside" is on its left) into
 * closed loops by chaining each segment's end point to a segment starting at
 * that same point. Every point in this segment set has exactly one outgoing
 * and one incoming segment (standard marching-squares property away from
 * saddle ambiguity, which is already resolved at generation time), so this
 * produces clean, non-crossing closed loops.
 */
function stitchSegments(segments: Segment[]): Polygon[] {
  const startMap = new Map<string, Segment[]>()
  for (const seg of segments) {
    const key = pointKey(seg.ax, seg.ay)
    const list = startMap.get(key)
    if (list) list.push(seg)
    else startMap.set(key, [seg])
  }

  const used = new Set<Segment>()
  const loops: Polygon[] = []

  for (const seg of segments) {
    if (used.has(seg)) continue

    const loop: Polygon = []
    let current: Segment | undefined = seg
    const startKey = pointKey(seg.ax, seg.ay)

    // Safety cap to guarantee termination even if input data were malformed.
    const maxSteps = segments.length + 1
    let steps = 0

    while (current && !used.has(current) && steps < maxSteps) {
      used.add(current)
      loop.push({ x: current.ax, y: current.ay })
      steps++

      const nextKey = pointKey(current.bx, current.by)
      if (nextKey === startKey) {
        current = undefined // closed the loop
        break
      }

      const candidates = startMap.get(nextKey)
      const next = candidates?.find((c) => !used.has(c))
      current = next
    }

    if (loop.length >= 3) loops.push(loop)
  }

  return loops
}

// ─────────────────────────────────────────────────────────────────────────────
// Douglas–Peucker simplification (closed polygon)
// ─────────────────────────────────────────────────────────────────────────────

function perpendicularDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = p.x - a.x
    const ey = p.y - a.y
    return Math.sqrt(ex * ex + ey * ey)
  }
  // Cross product magnitude / segment length = perpendicular distance.
  const cross = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x))
  return cross / Math.sqrt(lenSq)
}

function douglasPeucker(points: Polygon, epsilon: number): Polygon {
  if (points.length < 3) return points.slice()

  let maxDist = -1
  let maxIndex = 0
  const a = points[0]
  const b = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], a, b)
    if (dist > maxDist) {
      maxDist = dist
      maxIndex = i
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIndex), epsilon)
    return left.slice(0, -1).concat(right)
  }

  return [a, b]
}

/**
 * Douglas–Peucker simplification for a closed loop. Splits the loop at its
 * two most-separated points to get two open chains (so the anchor endpoints
 * aren't an arbitrary, possibly-collinear-with-everything pair), simplifies
 * each independently, then re-joins them into a single closed ring.
 */
function douglasPeuckerClosed(points: Polygon, epsilon: number): Polygon {
  const n = points.length
  if (n < 3) return points.slice()

  // Find the two points with maximum separation to use as split anchors —
  // this avoids degenerate behavior from picking an arbitrary fixed point.
  let i0 = 0
  let i1 = 1
  let maxDistSq = -1
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x
      const dy = points[i].y - points[j].y
      const d2 = dx * dx + dy * dy
      if (d2 > maxDistSq) {
        maxDistSq = d2
        i0 = i
        i1 = j
      }
    }
  }
  // Cost above is O(n^2); contours are typically small after downsampling,
  // and this only runs once per loop, so it stays well within budget.

  const lo = Math.min(i0, i1)
  const hi = Math.max(i0, i1)

  const chainA = points.slice(lo, hi + 1) // lo..hi inclusive
  const chainB = points.slice(hi).concat(points.slice(0, lo + 1)) // hi..end + start..lo

  const simpA = douglasPeucker(chainA, epsilon)
  const simpB = douglasPeucker(chainB, epsilon)

  // Join: simpA goes lo -> hi, simpB goes hi -> lo (wrapping). Drop the
  // duplicated shared endpoints to form a single closed ring without a
  // repeated closing point.
  const merged = simpA.slice(0, -1).concat(simpB.slice(0, -1))
  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaikin corner-cutting smoothing (closed polygon, corner-preserving)
// ─────────────────────────────────────────────────────────────────────────────

/** Interior turn angle (radians, 0 = straight through) at vertex i of a closed polygon. */
function turnAngle(prev: { x: number; y: number }, cur: { x: number; y: number }, next: { x: number; y: number }): number {
  const v1x = cur.x - prev.x
  const v1y = cur.y - prev.y
  const v2x = next.x - cur.x
  const v2y = next.y - cur.y
  const len1 = Math.sqrt(v1x * v1x + v1y * v1y)
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y)
  if (len1 === 0 || len2 === 0) return 0
  const dot = (v1x * v2x + v1y * v2y) / (len1 * len2)
  const clamped = Math.max(-1, Math.min(1, dot))
  return Math.acos(clamped) // 0 = collinear/straight, PI = full reversal
}

const CORNER_ANGLE_THRESHOLD = (60 * Math.PI) / 180

/**
 * Chaikin corner-cutting with per-vertex corner exclusion: vertices whose
 * interior turn angle exceeds ~60° are flagged as "real corners" up front
 * and are never cut in any pass, so genuinely sharp features (e.g. a plate's
 * straight-edge corner) survive smoothing while staircase noise along runs
 * between corners gets rounded off.
 *
 * (Chosen over the uniform-smoothing fallback because the per-vertex
 * exclusion is straightforward to do correctly on a closed polygon: corner
 * flags are computed once from the ORIGINAL geometry and an excluded vertex
 * is simply copied through unchanged in every pass, with its neighbours
 * cutting against its true position rather than a moving target.)
 */
function chaikinSmoothClosed(points: Polygon, iterations: number): Polygon {
  if (iterations <= 0 || points.length < 3) return points

  const n = points.length
  const isCorner = new Array<boolean>(n)
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const cur = points[i]
    const next = points[(i + 1) % n]
    isCorner[i] = turnAngle(prev, cur, next) > CORNER_ANGLE_THRESHOLD
  }

  let current = points
  let cornerFlags = isCorner

  for (let pass = 0; pass < iterations; pass++) {
    const m = current.length
    if (m < 3) break

    const next: Polygon = []
    const nextCornerFlags: boolean[] = []

    for (let i = 0; i < m; i++) {
      const p = current[i]
      const q = current[(i + 1) % m]
      const pIsCorner = cornerFlags[i]
      const qIsCorner = cornerFlags[(i + 1) % m]

      if (pIsCorner) {
        // Preserve the corner vertex itself unchanged.
        next.push({ x: p.x, y: p.y })
        nextCornerFlags.push(true)
      } else {
        // Standard Chaikin cut point at 1/4 along the edge from p.
        next.push({ x: p.x + 0.25 * (q.x - p.x), y: p.y + 0.25 * (q.y - p.y) })
        nextCornerFlags.push(false)
      }

      if (qIsCorner) {
        // Corner vertex already emitted on its own turn as the "p" of the
        // next edge — skip emitting a second copy here to avoid duplicates.
        continue
      } else {
        // Standard Chaikin cut point at 3/4 along the edge from p.
        next.push({ x: p.x + 0.75 * (q.x - p.x), y: p.y + 0.75 * (q.y - p.y) })
        nextCornerFlags.push(false)
      }
    }

    current = next
    cornerFlags = nextCornerFlags
  }

  return current
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Signed polygon area via the shoelace formula (closed polygon, no duplicated endpoint). */
function polygonArea(points: Polygon): number {
  let sum = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}
