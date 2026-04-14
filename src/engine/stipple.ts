import { HalftoneSettings } from '../types'
import { precomputeGrayscale, sampleGray } from './sampling'
import { applyDotSettings } from './dot-settings'

/**
 * Max dots before spacing is auto-scaled up to keep runtime reasonable.
 * ~40 k dots with K=20 candidates each runs in ~200–500 ms in JS.
 */
const MAX_DOTS = 40_000

/** Bridson candidates per active point. */
const K = 20

/**
 * Min-dist scaling by darkness:
 *   pure black  → cellSize × MIN_SCALE  (dense)
 *   pure white  → cellSize × MAX_SCALE  (sparse)
 */
const MIN_SCALE = 0.6
const MAX_SCALE = 2.5

/**
 * Poisson-disk stipple halftone.
 *
 * Dots are placed using Bridson's algorithm with a per-point minimum distance
 * that shrinks in dark regions (denser packing) and grows in light regions
 * (sparser packing).  Dot radius scales with local darkness so dark areas get
 * large, closely packed dots and light areas get small, widely spaced ones.
 *
 * Cell size should correspond to the target LPI at the render DPI
 * (cellSize = renderDpi / lpi).
 */
export function renderStipple(
  ctx: CanvasRenderingContext2D,
  source: ImageData,
  cellSize: number,
  settings: HalftoneSettings,
  fgColor: string,
  bgColor: string,
): void {
  const { width, height } = source

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, width, height)

  const gray = precomputeGrayscale(source)

  // Auto-scale cellSize so we never exceed MAX_DOTS (keeps runtime bounded).
  const estimatedDots = ((width * height) / (cellSize * MIN_SCALE) ** 2) * 0.65
  const cs = estimatedDots > MAX_DOTS
    ? cellSize * Math.sqrt(estimatedDots / MAX_DOTS)
    : cellSize

  /** Minimum distance between dots at (x, y). Darker → smaller → denser. */
  function minDist(x: number, y: number): number {
    const b = sampleGray(gray, width, height, x, y, cs)
    const darkness = 1 - b
    return cs * (MAX_SCALE - darkness * (MAX_SCALE - MIN_SCALE))
  }

  // Spatial grid: each cell is (cs × MIN_SCALE / √2) so any two conflicting
  // points always fall within 2 cells of each other.
  const gridCell = (cs * MIN_SCALE) / Math.SQRT2
  const gw = Math.ceil(width  / gridCell) + 1
  const gh = Math.ceil(height / gridCell) + 1
  const grid = new Int32Array(gw * gh).fill(-1)

  const ptsX: number[] = []
  const ptsY: number[] = []

  function addPt(x: number, y: number): number {
    const idx = ptsX.length
    ptsX.push(x)
    ptsY.push(y)
    const gx = Math.floor(x / gridCell)
    const gy = Math.floor(y / gridCell)
    if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) grid[gy * gw + gx] = idx
    return idx
  }

  function isValid(x: number, y: number, r: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const gx = Math.floor(x / gridCell)
    const gy = Math.floor(y / gridCell)
    const search = Math.ceil(r / gridCell) + 1
    const r2 = r * r
    for (let dy = -search; dy <= search; dy++) {
      for (let dx = -search; dx <= search; dx++) {
        const nx = gx + dx, ny = gy + dy
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue
        const idx = grid[ny * gw + nx]
        if (idx < 0) continue
        const ex = ptsX[idx] - x
        const ey = ptsY[idx] - y
        if (ex * ex + ey * ey < r2) return false
      }
    }
    return true
  }

  // Seed from center, then grow outward using an active list.
  addPt(width / 2, height / 2)
  const active: number[] = [0]

  while (active.length > 0) {
    // Pick a random active point (uniform selection keeps distribution even).
    const ai = Math.floor(Math.random() * active.length)
    const idx = active[ai]
    const px = ptsX[idx]
    const py = ptsY[idx]
    const r  = minDist(px, py)

    let found = false
    for (let k = 0; k < K; k++) {
      const angle = Math.random() * 2 * Math.PI
      const dist  = r * (1 + Math.random())   // uniform in [r, 2r]
      const cx = px + dist * Math.cos(angle)
      const cy = py + dist * Math.sin(angle)
      const nr = minDist(cx, cy)

      // Use the smaller of the two radii so the constraint is symmetric.
      if (isValid(cx, cy, Math.min(r, nr))) {
        active.push(addPt(cx, cy))
        found = true
        break
      }
    }

    if (!found) {
      // O(1) swap-pop removal
      active[ai] = active[active.length - 1]
      active.pop()
    }
  }

  // ── Draw all dots in a single Path2D ──────────────────────────────────────
  const path = new Path2D()
  const TWO_PI  = 2 * Math.PI
  const dotMult = settings.dotSize ?? 1

  for (let i = 0; i < ptsX.length; i++) {
    const x = ptsX[i]
    const y = ptsY[i]

    const b = sampleGray(gray, width, height, x, y, cs)
    const rawDarkness = 1 - b
    const darkness = applyDotSettings(rawDarkness, settings)
    if (darkness === null || darkness < 0.01) continue

    // Radius scales with local spacing (large gap → large dot in light areas)
    // and with darkness weight (√darkness gives perceptually linear coverage).
    const localR = minDist(x, y)
    const radius = localR * 0.44 * Math.sqrt(darkness) * dotMult
    if (radius < 0.3) continue

    path.moveTo(x + radius, y)
    path.arc(x, y, radius, 0, TWO_PI)
  }

  ctx.fillStyle = fgColor
  ctx.fill(path)
}
