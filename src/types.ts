export interface SourceImage {
  imageData: ImageData
  width: number
  height: number
  fileName: string
  rawBytes: Uint8Array   // original file bytes (for .halftones packing)
}

export type PatternType = 'dot' | 'line' | 'ellipse' | 'diamond' | 'euclidean' | 'stochastic' | 'stipple' | 'crosshatch' | 'concentric' | 'brick' | 'hex' | 'radial' | 'radial-lines'

export type ColorMode = 'grayscale' | 'cmyk' | 'spot'

export type RenderMode = 'halftone' | 'flat'

export interface SpotColor {
  id: string
  name: string
  hex: string
  lab: [number, number, number]
  angle: number
  lpi: number
  renderMode: RenderMode
  /** 0–1: pixels lighter than this threshold are not inked (flat mode only) */
  threshold: number
  enabled: boolean
  /**
   * Per-color trap override in pixels. `null` (or undefined for older files) =
   * use the global SpotSettings.trap value. A number here — including 0 — takes
   * precedence over the global value for this color only.
   */
  trap?: number | null
  /**
   * Per-color "smooth flat edges" override. `undefined` = follow the global
   * SpotSettings.smoothFlat toggle. `true`/`false` force vectorization on/off
   * for this plate — e.g. leave a fine line/hatch plate as crisp raster while
   * smoothing the flat masses. Only affects flat-rendered plates.
   */
  smooth?: boolean
  /**
   * Bleed: extends a background-type color plate outward from the image edge
   * into the margin, as a percentage (0–100) of the margin. 100 = fills the
   * margin out to the trim edge. Measured against the largest side margin
   * (on tighter sides the symmetric bleed simply runs past the trim). 0 = no bleed.
   * Only meaningful when `type === 'background'`.
   */
  bleedPct?: number
  /** @deprecated legacy inches-based bleed; superseded by bleedPct. */
  bleedInches?: number
  /**
   * 'background': mask is derived from the source image's alpha channel
   * (transparent pixels = full ink, opaque = no ink) rather than LAB distance.
   * Used to add a background color plate behind cutout/transparent images.
   * Absent or undefined = normal LAB-distance separation.
   */
  type?: 'background'
}

/**
 * Key plate: a halftone of the full luminance image composited (overprint)
 * on top of all spot color layers.  Adds tonal depth and detail to flat color
 * separations — the classic screenprint "key" technique.
 */
export interface KeyPlateSettings {
  enabled: boolean
  /** Ink color (hex). Default black. */
  color: string
  lpi: number
  angle: number
  /** Minimum darkness — suppress near-white tones so highlights stay clean. */
  minDot: number
  /** Maximum darkness ceiling. */
  maxDot: number
  /**
   * Edge stroke: overlay Sobel-detected contour lines on the key plate halftone.
   * Produces hard drawn-looking outlines at tonal transitions in the source image.
   */
  strokeEnabled?: boolean
  /**
   * Gradient magnitude threshold 0–1. Lower = more / finer edges detected;
   * higher = only the sharpest transitions. Default 0.3.
   */
  strokeThreshold?: number
  /**
   * Stroke line width in output-DPI pixels. Dilates detected edges to control
   * line weight. Default 2. Scaled to viewport pixels in preview.
   */
  strokeWidth?: number
  /**
   * Outline stroke: a clean solid ring traced around the alpha-channel silhouette.
   * Only meaningful for transparent-background images — traces exactly where the
   * subject meets the transparent area, adding a crisp printed outline.
   */
  outlineEnabled?: boolean
  /**
   * Outline width in output-DPI pixels. Controls how many pixels the stroke
   * extends outward from the subject boundary. Default 3.
   */
  outlineWidth?: number
  /**
   * Whether to render the halftone dot/pattern layer. Default true.
   * Set to false to use only edge stroke and/or outline without tonal dots.
   */
  dotsEnabled?: boolean
  /**
   * Merge the key plate into the darkest enabled spot color's plate instead of
   * exporting/rendering it as its own overprinted layer. Useful when the key
   * detail is meant to print in the same ink as the darkest separation color
   * (one screen instead of two). The merged content uses that color's ink hue.
   */
  mergeWithDarkest?: boolean
}

export const DEFAULT_KEY_PLATE: KeyPlateSettings = {
  enabled: true,
  color: '#000000',
  lpi: 55,
  angle: 45,
  minDot: 0.1,
  maxDot: 0.95,
}

export type SeparationMode = 'knockout' | 'buildup'

export interface UnderbaseSettings {
  /** Whether to generate an underbase plate. */
  enabled: boolean
  /** Underbase ink color (hex) — e.g. white or silver. Shown in proof/preview. */
  color: string
  /** Choke the underbase inward from the print edge, in inches (so it doesn't peek out). */
  chokeInches: number
}

export const DEFAULT_UNDERBASE: UnderbaseSettings = {
  enabled: false,
  color: '#c0c0c0',
  chokeInches: 0.01,
}

export interface SpotSettings {
  numColors: number
  mergeThreshold: number
  /** 0–1: pushes each color's saturation toward fully vivid (preview only). */
  vibrancy: number
  /**
   * Global trap amount in pixels. Each color's mask is dilated (black expanded)
   * by this many pixels before colorize, causing layers to bleed into each
   * other and hiding visible outlines between halftone and flat layers.
   * Interpreted as pixels in the current render target: viewport pixels in
   * preview, output pixels at export DPI. 0 = no trap.
   */
  trap: number
  /**
   * Global smoothing amount (0–100%). Jointly smooths the color-ownership
   * partition so adjacent layers never erode apart (no paper seams): low values
   * remove near-isolated specks, high values smooth boundaries more. 0 = off.
   */
  smoothing: number
  /**
   * Treat near-white (high lightness, low chroma) pixels as bare paper:
   * excludes them from palette extraction (so every requested color is a real
   * ink, not a wasted white plate) and renders them with no ink on any plate.
   * Turn OFF when printing white ink on colored stock.
   */
  paperWhite?: boolean
  /** Lightness threshold (L*, 0–100) at/above which a low-chroma pixel is paper. Default 92. */
  paperWhiteThreshold?: number
  /**
   * Separation mode:
   * - 'knockout' (default): each pixel = exactly one ink, exclusive regions.
   * - 'buildup': nested cumulative overprint — a pixel inks its tone plate plus
   *   every lighter plate beneath it (solid, printed light→dark). Registration-
   *   forgiving; best for tonal / duotone palettes.
   */
  separationMode?: SeparationMode
  /** Optional underbase plate: union of all inked area, choked, printed first. */
  underbase?: UnderbaseSettings
  /** Substrate (paper/garment) color the proof and preview composite onto. Default white. */
  substrate?: string
  /**
   * Smooth flat-plate edges by tracing each flat color's binary mask into vector
   * outlines instead of rendering the raw per-pixel staircase. Flat plates only
   * (halftone plates are unaffected). Off by default. Absent in older files = off.
   */
  smoothFlat?: boolean
  /** 0–100: aggressiveness of the flat-edge simplification + smoothing. Default 50. */
  smoothFlatStrength?: number
  colors: SpotColor[]
  /**
   * Optional key plate: a halftone of the full image rendered on top of all
   * spot color layers (overprint).  Undefined / absent = no key plate.
   */
  key?: KeyPlateSettings
}

export const DEFAULT_SPOT_SETTINGS: SpotSettings = {
  numColors: 5,
  mergeThreshold: 15,
  vibrancy: 0,
  trap: 0,
  smoothing: 0,
  paperWhite: true,
  paperWhiteThreshold: 92,
  separationMode: 'knockout',
  substrate: '#ffffff',
  smoothFlat: false,
  smoothFlatStrength: 50,
  colors: [],
}

export interface HalftoneSettings {
  lpi: number
  angle: number
  pattern: PatternType
  colorMode: ColorMode
  invert: boolean
  /** Radial origin as fraction of image dimensions. 0.5/0.5 = center. */
  radialOriginX: number
  radialOriginY: number
  /** Minimum darkness threshold (0–1). Marks below this are suppressed (highlights). */
  minDot: number
  /** Maximum darkness ceiling (0–1). Marks are capped here (shadows). */
  maxDot: number
  /** Dot gain compensation (0–0.5). Pre-shrinks all marks by this fraction. */
  dotGain: number
  /** Dot size multiplier (0.5–1.5). Scales all marks relative to their cell. */
  dotSize: number
  /** Tone curve gamma (0.5–3). > 1 boosts midtone dots; < 1 flattens them. */
  halftoneGamma: number
  /** Shadow contrast boost (0–1). Expands dot variation in dark tones. */
  shadowBoost: number
  /** Highlight contrast boost (0–1). Expands dot variation in light tones. */
  highlightBoost: number
  /** Ink color (foreground). Defaults to black. */
  fgColor: string
  /** Paper color (background). Defaults to white. */
  bgColor: string
}

export interface ChannelSettings {
  angle: number
  lpi: number
  enabled: boolean
}

export interface CMYKSettings {
  c: ChannelSettings
  m: ChannelSettings
  y: ChannelSettings
  k: ChannelSettings
}

export interface OutputSettings {
  widthInches: number
  heightInches: number
  dpi: number
  lockAspectRatio: boolean
  /**
   * Margin around the image for registration/crop marks, in inches. Used for
   * all sides when margins are linked, and as the fallback for any unset
   * per-side value below.
   */
  marginInches: number
  /**
   * When false, margins are set independently per side (marginTop/Bottom/
   * Left/Right below). Absent or true = all sides use marginInches (legacy
   * behavior, and how older projects load).
   */
  marginLinked?: boolean
  /** Per-side margins in inches (used only when marginLinked === false). */
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  /** Whether to include crop marks in PDF export. Defaults to true. */
  cropMarks?: boolean
  /** Whether to include the margin in PDF export. Defaults to true. */
  showMargin?: boolean
  /** Render dots/lines as PDF vector paths instead of an embedded raster image. Defaults to true. */
  vectorPDF?: boolean
  /** Draw registration marks (circle + crosshair) at side midpoints for multi-layer alignment. */
  alignmentMarks?: boolean
}

/** Resolved per-side margins, in inches. */
export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Resolve the effective per-side margins (inches). When margins are linked
 * (default), every side uses marginInches. When unlinked, each side uses its
 * own value, falling back to marginInches if a side is unset.
 */
export function resolveMargins(s: OutputSettings): Margins {
  const base = s.marginInches ?? 1
  if (s.marginLinked === false) {
    return {
      top: s.marginTop ?? base,
      right: s.marginRight ?? base,
      bottom: s.marginBottom ?? base,
      left: s.marginLeft ?? base,
    }
  }
  return { top: base, right: base, bottom: base, left: base }
}

export interface ImageTransformSettings {
  /** Crop as fractions of source dimensions (0–1). */
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
  /** Rotation in degrees, applied before crop. */
  rotation: number
  /** Levels: input black point 0–255 */
  blackPoint: number
  /** Levels: input white point 0–255 */
  whitePoint: number
  /** Midtone gamma: 0.25–4.0 */
  gamma: number
  /**
   * Gaussian blur radius in pixels applied before halftoning (0 = off).
   * Smooths gradients and removes noise so dots render more cleanly.
   */
  blur?: number
  /**
   * Unsharp-mask strength (0 = off, 0.5 = moderate, 2 = heavy).
   * Sharpens edges so detail holds through the halftone screen.
   */
  sharpen?: number
  /**
   * Unsharp-mask radius in pixels (0.5–5).
   * Controls the width of edges affected by the sharpen pass.
   */
  sharpenRadius?: number
  /**
   * Random film-grain amount (0 = off, 50 = heavy).
   * Added after all other processing; breaks up banding in smooth gradients.
   */
  noise?: number
}

export const DEFAULT_TRANSFORM_SETTINGS: ImageTransformSettings = {
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  rotation: 0,
  blackPoint: 0,
  whitePoint: 255,
  gamma: 1.0,
  blur: 0,
  sharpen: 0,
  sharpenRadius: 1.5,
  noise: 0,
}

export const DEFAULT_HALFTONE_SETTINGS: HalftoneSettings = {
  lpi: 55,
  angle: 45,
  pattern: 'dot',
  colorMode: 'grayscale',
  invert: false,
  radialOriginX: 0.5,
  radialOriginY: 0.5,
  minDot: 0.05,
  maxDot: 0.95,
  dotGain: 0,
  dotSize: 1,
  halftoneGamma: 1,
  shadowBoost: 0,
  highlightBoost: 0,
  fgColor: '#000000',
  bgColor: '#ffffff',
}

export const DEFAULT_CMYK_SETTINGS: CMYKSettings = {
  c: { angle: 15, lpi: 55, enabled: true },
  m: { angle: 75, lpi: 55, enabled: true },
  y: { angle: 0, lpi: 55, enabled: true },
  k: { angle: 45, lpi: 55, enabled: true },
}

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  widthInches: 13,
  heightInches: 19,
  dpi: 300,
  lockAspectRatio: true,
  marginInches: 1,
  cropMarks: true,
  showMargin: true,
  vectorPDF: true,
  alignmentMarks: false,
}

export type CMYKChannel = 'c' | 'm' | 'y' | 'k'
export type ChannelView = 'composite' | CMYKChannel | `spot-${string}`

/**
 * Source mode for the layer mask.
 *
 * 'auto'      — use alpha channel if the image has any transparency;
 *               otherwise fall back to luminance.
 * 'alpha'     — always derive keep/cut from alpha (opaque = keep).
 * 'luminance' — always derive keep/cut from luminance (white = keep).
 */
export type MaskSourceMode = 'auto' | 'alpha' | 'luminance'

/**
 * Settings for the global layer mask.  Stored in the project snapshot / zip.
 * The mask image itself (too large for localStorage) is held separately in
 * app state, mirroring how the source image is handled.
 */
export interface MaskSettings {
  /** Whether the mask is active. False = pass-through (no clipping). */
  enabled: boolean
  /** Invert the keep/cut map after building it. */
  invert: boolean
  /** Which channel of the loaded mask image to derive keep/cut from. */
  source: MaskSourceMode
  /** Draw a keyline stroke tracing the mask boundary. */
  strokeEnabled?: boolean
  /** Stroke line width in inches (centered on the mask boundary). */
  strokeWidthInches?: number
  /** Stroke ink color (hex). Shown in preview/proof; exported as its own plate. */
  strokeColor?: string
}

export const DEFAULT_MASK_SETTINGS: MaskSettings = {
  enabled: false,
  invert: false,
  source: 'auto',
  strokeEnabled: false,
  strokeWidthInches: 0.05,
  strokeColor: '#000000',
}

/**
 * A loaded mask image — raster (from an HTMLImageElement bitmap) or SVG
 * (stored as raw markup text so it can be re-rasterized at any target size).
 * The mask is stretched to fit the image rectangle; the SVG path scales
 * with the target resolution, so SVG masks stay crisp at any output DPI.
 */
export interface MaskImage {
  isSvg: boolean
  /** SVG text (isSvg = true) or undefined. */
  svgText?: string
  /** Raster HTMLImageElement (isSvg = false) or undefined. */
  element?: HTMLImageElement
  /** Original file bytes for .halftones zip persistence. */
  rawBytes: Uint8Array
  /** Original filename (e.g. "mask.svg", "logo.png"). */
  fileName: string
}

// ─── Shop profile (screen/mesh inventory) ──────────────────────────────────────
//
// Machine-level config describing the physical screens a shop owns: used by the
// Print Plan to recommend how many screens, which frame size, and which mesh
// count per plate. Persisted in app prefs (prefs.json on native; localStorage
// on web), NOT in the per-project file.

/** One frame the shop stocks: outside dimensions (inches) + available mesh counts. */
export interface ShopFrame {
  widthIn: number
  heightIn: number
  /** Mesh counts stocked in this frame size, e.g. [110, 156, 230]. */
  meshes: number[]
}

export interface ShopProfile {
  frames: ShopFrame[]
  /**
   * Clearance to reserve on each side (inches) = frame rails + squeegee/flood
   * buffer. Usable image area ≈ frame − 2 × this. Default 3.25.
   */
  edgeClearanceIn: number
  /**
   * Gang two different plates onto one screen (side by side) to halve the
   * screen count. Plates are paired so consecutive print colors land on
   * different screens (1&3 on one, 2&4 on another) — each screen rests between
   * its two runs. Underbase / mask-stroke stay on their own screens.
   */
  gangPerScreen?: boolean
}

export const DEFAULT_SHOP_PROFILE: ShopProfile = {
  frames: [
    { widthIn: 20, heightIn: 24, meshes: [110, 156, 230] },
    { widthIn: 23, heightIn: 31, meshes: [195, 230, 305] },
    { widthIn: 25, heightIn: 36, meshes: [195, 230, 305] },
    { widthIn: 30, heightIn: 40, meshes: [195, 230, 305] },
  ],
  edgeClearanceIn: 3.25,
}
