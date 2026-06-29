/**
 * Print Plan — recommends how many screens, which frame size, and which mesh
 * count per plate for the current job, given the shop's screen inventory.
 *
 * Pure / framework-free: the UI passes in the current settings and shop profile
 * and renders the returned PrintPlan. Nothing here touches the DOM.
 */

import {
  ColorMode, HalftoneSettings, SpotSettings, CMYKSettings, MaskSettings,
  OutputSettings, ShopFrame, ShopProfile, resolveMargins,
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

/** One physical screen: 1 plate normally, or 2 when ganging. */
export interface ScreenPlan {
  plates: Plate[]
  frame: ShopFrame | null
  /** One mesh for the whole screen (finest its plates need, so all hold). */
  mesh: number
  /** True when the screen carries two images side-by-side (ganged). */
  twoUp: boolean
  warnings: string[]
}

export interface PrintPlan {
  plateCount: number
  screenCount: number
  screens: ScreenPlan[]
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

function fitsOneUp(f: ShopFrame, pw: number, ph: number, clr: number): boolean {
  const u = usable(f, clr)
  return fitsRect(pw, ph, u.short, u.long)
}

function fitsTwoUp(f: ShopFrame, pw: number, ph: number, clr: number): boolean {
  const u = usable(f, clr)
  return (
    (2 * pw + TWO_UP_GAP_IN <= u.long && ph <= u.short) ||
    (2 * ph + TWO_UP_GAP_IN <= u.long && pw <= u.short)
  )
}

/** The mesh a plate ideally wants (before snapping to a frame's stock). */
function idealMesh(p: Plate): number {
  if (p.kind === 'underbase') return 110
  if (p.kind === 'halftone') return (p.lpi ?? 55) * MESH_TARGET_FACTOR
  return 230
}

/** Build a screen for the given plates (1, or 2 when ganged). */
function buildScreen(
  sp: Plate[], frames: ShopFrame[], pw: number, ph: number, clr: number, twoUp: boolean,
): ScreenPlan {
  const frame = frames.find((f) =>
    (twoUp ? fitsTwoUp(f, pw, ph, clr) : fitsOneUp(f, pw, ph, clr)) && meshCapable(f, sp),
  ) ?? null
  const meshFrame = frame ?? frames[frames.length - 1] ?? null
  // One mesh per screen = the finest any of its plates needs, so all hold.
  const mesh = meshFrame ? sp.reduce((mx, p) => Math.max(mx, suggestMesh(p, meshFrame.meshes)), 0) : 0

  const warnings: string[] = []
  for (const p of sp) {
    if (p.kind === 'halftone' && p.minDot != null && mesh > 0) {
      const floor = holdableMinDot(mesh)
      if (p.minDot < floor) {
        warnings.push(`${p.name}: Min Dot ${Math.round(p.minDot * 100)}% may not hold on ${mesh} — raise to ~${Math.round(floor * 100)}%`)
      }
    }
  }
  if (sp.length > 1) {
    const ideals = sp.map(idealMesh)
    if (Math.max(...ideals) / Math.min(...ideals) >= 1.6) {
      warnings.push(`${sp.map((p) => p.name).join(' + ')} want different mesh — sharing ${mesh} is a compromise`)
    }
  }
  if (!frame) {
    warnings.push(twoUp
      ? 'No screen fits two images side-by-side — turn off ganging or size up'
      : 'Larger than any configured screen — size up or reduce output')
  }
  return { plates: sp, frame, mesh, twoUp, warnings }
}

export function planScreens(
  plates: Plate[], output: OutputSettings, profile: ShopProfile, gang: boolean,
): PrintPlan {
  // The screen must hold the whole film positive — image + margins + the
  // crop/registration-mark strip — i.e. the full output page (the same total
  // shown as "Output: W × H" in the Output panel), not just the image.
  const m = resolveMargins(output)
  const showM = output.showMargin !== false
  const cropIn = output.cropMarks !== false ? 0.5 : 0
  const pw = output.widthInches + (showM ? m.left + m.right : 0) + 2 * cropIn
  const ph = output.heightInches + (showM ? m.top + m.bottom : 0) + 2 * cropIn
  const clr = profile.edgeClearanceIn
  const frames = [...profile.frames].sort((a, b) => frameArea(a) - frameArea(b))

  const screens: ScreenPlan[] = []

  if (!gang) {
    for (const p of plates) screens.push(buildScreen([p], frames, pw, ph, clr, false))
  } else {
    // Underbase / mask-stroke get their own screens (special ink & mesh).
    const isSolo = (p: Plate) => p.kind === 'underbase' || p.kind === 'stroke'
    const gangable = plates.filter((p) => !isSolo(p))
    const S = Math.ceil(gangable.length / 2)
    // Underbase first (prints first).
    for (const p of plates.filter((p) => p.kind === 'underbase')) {
      screens.push(buildScreen([p], frames, pw, ph, clr, false))
    }
    // Pair plate k with plate k+S so consecutive colors land on different screens.
    for (let k = 0; k < S; k++) {
      const pair = [gangable[k], gangable[k + S]].filter(Boolean) as Plate[]
      screens.push(buildScreen(pair, frames, pw, ph, clr, pair.length > 1))
    }
    for (const p of plates.filter((p) => p.kind === 'stroke')) {
      screens.push(buildScreen([p], frames, pw, ph, clr, false))
    }
  }

  const notes: string[] = []
  if (frames.length === 0) notes.push('No screens configured — add your frame sizes below.')

  return { plateCount: plates.length, screenCount: screens.length, screens, notes }
}
