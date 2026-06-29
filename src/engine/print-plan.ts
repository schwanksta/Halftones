/**
 * Print Plan — recommends how many screens, which frame size, and which mesh
 * count per plate for the current job, given the shop's screen inventory.
 *
 * Pure / framework-free: the UI passes in the current settings and shop profile
 * and renders the returned PrintPlan. Nothing here touches the DOM.
 */

import {
  ColorMode, HalftoneSettings, SpotSettings, CMYKSettings, MaskSettings,
  OutputSettings, ShopFrame, ShopProfile,
} from '../types'
import { darkestSpotColor } from './spot-separation'

export type PlateKind = 'halftone' | 'flat' | 'underbase' | 'stroke'

export interface Plate {
  name: string
  kind: PlateKind
  /** Lines-per-inch for halftone plates (undefined for flat/underbase/stroke). */
  lpi?: number
  /** Minimum dot fraction (0–1) for halftone plates, used for the mesh hold-check. */
  minDot?: number
}

export interface PlatePlan {
  plate: Plate
  mesh: number
  /** Set when the plate's min dot is finer than the suggested mesh can hold. */
  warning?: string
}

export interface PrintPlan {
  plateCount: number
  /** Smallest stocked frame that fits one-up AND stocks fine-enough mesh; null if none. */
  frame: ShopFrame | null
  /** Smallest frame that fits two copies side-by-side, or null. */
  twoUpFrame: ShopFrame | null
  plates: PlatePlan[]
  notes: string[]
}

// ── Mesh selection ──────────────────────────────────────────────────────────

const MESH_TARGET_FACTOR = 4.5   // ideal mesh ≈ LPI × this
const MESH_MIN_FACTOR = 3.5      // never coarser than LPI × this for a halftone

/** Roughly the finest dot a mesh can hold, as a fraction (0–1). */
function holdableMinDot(mesh: number): number {
  if (mesh >= 305) return 0.05
  if (mesh >= 230) return 0.08
  if (mesh >= 195) return 0.10
  if (mesh >= 156) return 0.12
  return 0.15
}

function nearest(target: number, options: number[]): number {
  return options.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best), options[0])
}

/** Suggested mesh for a plate, chosen from the meshes stocked on its frame. */
export function suggestMesh(plate: Plate, meshes: number[]): number {
  const sorted = [...meshes].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  if (plate.kind === 'underbase') return sorted[0]          // lowest = heaviest deposit
  if (plate.kind === 'flat' || plate.kind === 'stroke') return nearest(230, sorted)  // solid coverage
  // halftone: aim for ~4.5× LPI, but never coarser than 3.5×
  const lpi = plate.lpi ?? 55
  let m = nearest(lpi * MESH_TARGET_FACTOR, sorted)
  if (m < lpi * MESH_MIN_FACTOR) {
    const finer = sorted.find((x) => x >= lpi * MESH_MIN_FACTOR)
    if (finer) m = finer
  }
  return m
}

// ── Plate derivation ────────────────────────────────────────────────────────

/**
 * Derive the list of physical plates (= screens) the current settings produce —
 * mirrors what the export paths emit, so the count matches what you'd burn.
 */
export function derivePlates(
  colorMode: ColorMode,
  halftone: HalftoneSettings,
  spot: SpotSettings,
  cmyk: CMYKSettings,
  mask: MaskSettings,
): Plate[] {
  const plates: Plate[] = []

  if (colorMode === 'grayscale') {
    plates.push({ name: 'Image', kind: 'halftone', lpi: halftone.lpi, minDot: halftone.minDot })
    return plates
  }

  if (colorMode === 'cmyk') {
    const names: Record<'c' | 'm' | 'y' | 'k', string> = { c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' }
    ;(['c', 'm', 'y', 'k'] as const).forEach((ch) => {
      if (cmyk[ch].enabled) {
        plates.push({ name: names[ch], kind: 'halftone', lpi: cmyk[ch].lpi, minDot: halftone.minDot })
      }
    })
    return plates
  }

  // spot
  const buildup = spot.separationMode === 'buildup'
  if (spot.underbase?.enabled) plates.push({ name: 'Underbase', kind: 'underbase' })
  for (const c of spot.colors) {
    if (!c.enabled) continue
    const flat = buildup || c.renderMode === 'flat'
    plates.push(flat
      ? { name: c.name, kind: 'flat' }
      : { name: c.name, kind: 'halftone', lpi: c.lpi, minDot: halftone.minDot })
  }
  if (spot.key?.enabled) {
    // A key merged into the darkest color is NOT its own screen.
    const merged = spot.key.mergeWithDarkest && darkestSpotColor(spot.colors)
    if (!merged) plates.push({ name: 'Key', kind: 'halftone', lpi: spot.key.lpi, minDot: spot.key.minDot })
  }
  if (mask?.enabled && mask?.strokeEnabled) plates.push({ name: 'Mask stroke', kind: 'stroke' })

  return plates
}

// ── Frame fit ───────────────────────────────────────────────────────────────

const frameArea = (f: ShopFrame) => f.widthIn * f.heightIn
const maxMesh = (f: ShopFrame) => (f.meshes.length ? Math.max(...f.meshes) : 0)

/** Usable image area (inches) after clearance on every side. */
function usable(f: ShopFrame, clearance: number): { short: number; long: number } {
  const short = Math.max(0, Math.min(f.widthIn, f.heightIn) - 2 * clearance)
  const long = Math.max(0, Math.max(f.widthIn, f.heightIn) - 2 * clearance)
  return { short, long }
}

/** Does a w×h print fit in a usable area, trying both orientations? */
function fitsRect(w: number, h: number, uShort: number, uLong: number): boolean {
  return (w <= uLong && h <= uShort) || (w <= uShort && h <= uLong)
}

/** Can this frame hold a fine-enough mesh for every halftone plate (LPI × 3.5)? */
function meshCapable(f: ShopFrame, plates: Plate[]): boolean {
  const need = plates
    .filter((p) => p.kind === 'halftone')
    .reduce((mx, p) => Math.max(mx, (p.lpi ?? 55) * MESH_MIN_FACTOR), 0)
  return maxMesh(f) >= need
}

const TWO_UP_GAP_IN = 1.5

export function planScreens(plates: Plate[], output: OutputSettings, profile: ShopProfile): PrintPlan {
  const pw = output.widthInches
  const ph = output.heightInches
  const clr = profile.edgeClearanceIn
  const frames = [...profile.frames].sort((a, b) => frameArea(a) - frameArea(b))

  const frame = frames.find((f) => {
    const u = usable(f, clr)
    return fitsRect(pw, ph, u.short, u.long) && meshCapable(f, plates)
  }) ?? null

  const twoUpFrame = frames.find((f) => {
    const u = usable(f, clr)
    const sideBySide =
      (2 * pw + TWO_UP_GAP_IN <= u.long && ph <= u.short) ||
      (2 * ph + TWO_UP_GAP_IN <= u.long && pw <= u.short)
    return sideBySide && meshCapable(f, plates)
  }) ?? null

  // Mesh suggestions use the recommended frame's stock; if nothing fits, fall
  // back to the largest frame so the user still sees sensible mesh numbers.
  const meshFrame = frame ?? frames[frames.length - 1] ?? null

  const platePlans: PlatePlan[] = plates.map((plate) => {
    const mesh = meshFrame ? suggestMesh(plate, meshFrame.meshes) : 0
    let warning: string | undefined
    if (plate.kind === 'halftone' && plate.minDot != null && mesh > 0) {
      const floor = holdableMinDot(mesh)
      if (plate.minDot < floor) {
        warning = `Min Dot ${Math.round(plate.minDot * 100)}% may not hold on ${mesh} mesh — raise to ~${Math.round(floor * 100)}% or use a finer mesh`
      }
    }
    return { plate, mesh, warning }
  })

  const notes: string[] = []
  if (!frame) {
    if (frames.length === 0) notes.push('No screens configured — add your frame sizes below.')
    else notes.push('This print is larger than any configured screen (or needs a finer mesh than they stock) — size up or reduce the output.')
  }

  return { plateCount: plates.length, frame, twoUpFrame, plates: platePlans, notes }
}
