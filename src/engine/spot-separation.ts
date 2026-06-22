/**
 * Spot color separation engine.
 *
 * Converts an RGB image into N grayscale channels, one per spot ink color.
 * Uses k-means++ clustering in CIELAB (perceptually uniform) color space so
 * that visually similar colors naturally group together.
 *
 * Channel convention (same as CMYK channels):
 *   black (0)   = full ink at this pixel
 *   white (255) = no ink at this pixel
 */

import { SpotColor, SeparationMode } from '../types'

// ─── CIELAB conversion ────────────────────────────────────────────────────────

function linearize(v: number): number {
  v /= 255
  return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92
}

function fwd(t: number): number {
  return t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = linearize(r), gl = linearize(g), bl = linearize(b)
  // sRGB → XYZ (D65)
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
  // XYZ → LAB (D65 white point)
  const fx = fwd(x / 0.95047)
  const fy = fwd(y / 1.00000)
  const fz = fwd(z / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labInvF(t: number): number {
  return t > 0.206897 ? t ** 3 : (t - 16 / 116) / 7.787
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const x = labInvF(fx) * 0.95047
  const y = labInvF(fy) * 1.00000
  const z = labInvF(fz) * 1.08883
  // XYZ → linear RGB
  let rl =  x * 3.2404542 - y * 1.5371385 - z * 0.4985314
  let gl = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560
  let bl =  x * 0.0556434 - y * 0.2040259 + z * 1.0572252
  // Gamma
  const gamma = (v: number) => Math.max(0, Math.min(255,
    Math.round((v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v) * 255)
  ))
  return [gamma(rl), gamma(gl), gamma(bl)]
}

/** CIE76 perceptual distance (good enough for palette clustering). */
export function deltaE(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

export function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return rgbToLab(r, g, b)
}

export function labToHex(lab: [number, number, number]): string {
  const [r, g, b] = labToRgb(lab[0], lab[1], lab[2])
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

// ─── Saturation boost ─────────────────────────────────────────────────────────

/**
 * Push a hex color's HSL saturation toward 1 by `amount` (0–1).
 * amount=0 → unchanged.  amount=1 → fully saturated.
 * Uses multiplicative fill: newS = s + amount*(1−s), so already-saturated
 * colors don't blow out and grays stay gray.
 */
export function boostSaturation(hex: string, amount: number): string {
  if (amount === 0) return hex
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  // Grays have no hue to boost
  if (s === 0) return hex

  const newS = Math.min(1, s + amount * (1 - s))

  const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS
  const p = 2 * l - q
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v * 255))).toString(16).padStart(2, '0')
  return `#${toHex(hue2rgb(p, q, h + 1 / 3))}${toHex(hue2rgb(p, q, h))}${toHex(hue2rgb(p, q, h - 1 / 3))}`
}

// ─── K-means++ palette extraction ────────────────────────────────────────────

/** Near-white-as-paper options shared by extraction and separation. */
export interface PaperWhiteOptions {
  enabled: boolean
  /** Lightness threshold (L*, 0–100); pixels at/above this AND low-chroma are paper. */
  threshold: number
}

/** Max chroma for a light pixel to still count as paper (keeps pale tints as ink). */
const PAPER_CHROMA_TOL = 12

function isPaperLab(L: number, a: number, b: number, lThreshold: number): boolean {
  return L >= lThreshold && Math.sqrt(a * a + b * b) <= PAPER_CHROMA_TOL
}

/**
 * Sample pixels from source (stride-sampled for speed) and convert to LAB.
 * Returns a Float32Array of [L, a, b] triples.  When `paper` is enabled,
 * near-white pixels are skipped so clustering spends every slot on real inks.
 */
function samplePixelsToLab(source: ImageData, maxSamples = 12000, paper?: PaperWhiteOptions): Float32Array {
  const { data, width, height } = source
  const total = width * height
  const stride = Math.max(1, Math.floor(total / maxSamples))
  const count = Math.ceil(total / stride)
  const out = new Float32Array(count * 3)
  let idx = 0
  for (let i = 0; i < total; i += stride) {
    const p = i * 4
    if (data[p + 3] < 128) continue  // skip transparent pixels
    const [L, a, b] = rgbToLab(data[p], data[p + 1], data[p + 2])
    if (paper?.enabled && isPaperLab(L, a, b, paper.threshold)) continue  // skip paper
    out[idx++] = L
    out[idx++] = a
    out[idx++] = b
  }
  return out.slice(0, idx)
}

/**
 * k-means++ initialisation.
 * If `seeds` is provided, those LAB triples are planted as the first centroids;
 * k-means++ fills the remaining slots by weighted-random distance selection.
 */
function initCentroids(pixels: Float32Array, k: number, seeds?: Array<[number,number,number]>): Float32Array {
  const n = pixels.length / 3
  const centroids = new Float32Array(k * 3)

  // Plant user-provided seeds first
  const numSeeds = Math.min(seeds?.length ?? 0, k)
  for (let s = 0; s < numSeeds; s++) {
    centroids[s * 3]     = seeds![s][0]
    centroids[s * 3 + 1] = seeds![s][1]
    centroids[s * 3 + 2] = seeds![s][2]
  }

  // If no seeds at all, pick the first centroid randomly (standard k-means++)
  let placed = numSeeds
  if (placed === 0) {
    const pick = Math.floor(Math.random() * n) * 3
    centroids[0] = pixels[pick]; centroids[1] = pixels[pick + 1]; centroids[2] = pixels[pick + 2]
    placed = 1
  }

  const dist2 = new Float32Array(n)

  // Fill remaining slots with k-means++ weighted picks
  for (let c = placed; c < k; c++) {
    let total = 0
    for (let i = 0; i < n; i++) {
      let minD = Infinity
      for (let j = 0; j < c; j++) {
        const dl = pixels[i * 3] - centroids[j * 3]
        const da = pixels[i * 3 + 1] - centroids[j * 3 + 1]
        const db = pixels[i * 3 + 2] - centroids[j * 3 + 2]
        const d = dl * dl + da * da + db * db
        if (d < minD) minD = d
      }
      dist2[i] = minD
      total += minD
    }
    let r = Math.random() * total
    for (let i = 0; i < n; i++) {
      r -= dist2[i]
      if (r <= 0) {
        const pick = i * 3
        centroids[c * 3] = pixels[pick]
        centroids[c * 3 + 1] = pixels[pick + 1]
        centroids[c * 3 + 2] = pixels[pick + 2]
        break
      }
    }
  }
  return centroids
}

/** Total within-cluster variance — lower = better clustering. */
function computeInertia(pixels: Float32Array, centroids: Float32Array, k: number): number {
  const n = pixels.length / 3
  let inertia = 0
  for (let i = 0; i < n; i++) {
    let minD = Infinity
    for (let j = 0; j < k; j++) {
      const dl = pixels[i * 3] - centroids[j * 3]
      const da = pixels[i * 3 + 1] - centroids[j * 3 + 1]
      const db = pixels[i * 3 + 2] - centroids[j * 3 + 2]
      minD = Math.min(minD, dl * dl + da * da + db * db)
    }
    inertia += minD
  }
  return inertia
}

/** Run k-means iterations. Returns final centroid array [L,a,b, L,a,b, ...]. */
function kmeans(pixels: Float32Array, k: number, maxIter = 50, seeds?: Array<[number,number,number]>): Float32Array {
  const n = pixels.length / 3
  const centroids = initCentroids(pixels, k, seeds)
  const assignments = new Int32Array(n)
  const sums = new Float32Array(k * 3)
  const counts = new Int32Array(k)

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    // Assign
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let j = 0; j < k; j++) {
        const dl = pixels[i * 3] - centroids[j * 3]
        const da = pixels[i * 3 + 1] - centroids[j * 3 + 1]
        const db = pixels[i * 3 + 2] - centroids[j * 3 + 2]
        const d = dl * dl + da * da + db * db
        if (d < bestD) { bestD = d; best = j }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true }
    }
    if (!changed) break
    // Update centroids
    sums.fill(0); counts.fill(0)
    for (let i = 0; i < n; i++) {
      const j = assignments[i]
      sums[j * 3] += pixels[i * 3]
      sums[j * 3 + 1] += pixels[i * 3 + 1]
      sums[j * 3 + 2] += pixels[i * 3 + 2]
      counts[j]++
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] === 0) continue
      centroids[j * 3] = sums[j * 3] / counts[j]
      centroids[j * 3 + 1] = sums[j * 3 + 1] / counts[j]
      centroids[j * 3 + 2] = sums[j * 3 + 2] / counts[j]
    }
  }
  return centroids
}

let _nextId = 1
function newId() { return `spot-${_nextId++}` }

/** The darkest enabled, non-background spot color (lowest L*), or null if none. */
export function darkestSpotColor(colors: SpotColor[]): SpotColor | null {
  let best: SpotColor | null = null
  for (const c of colors) {
    if (!c.enabled || c.type === 'background') continue
    if (!best || c.lab[0] < best.lab[0]) best = c
  }
  return best
}

// ─── Named color lookup ───────────────────────────────────────────────────────

/**
 * Curated palette of ~90 recognizable color names with hex values.
 * Covers the full gamut with enough granularity to distinguish e.g.
 * Navy from Cobalt from Sky Blue, or Crimson from Coral from Salmon.
 */
const NAMED_COLORS: { name: string; hex: string }[] = [
  // Neutrals
  { name: 'Black',          hex: '#000000' },
  { name: 'Rich Black',     hex: '#0a0a0a' },
  { name: 'Charcoal',       hex: '#36454f' },
  { name: 'Dark Gray',      hex: '#404040' },
  { name: 'Gunmetal',       hex: '#2a3439' },
  { name: 'Slate Gray',     hex: '#708090' },
  { name: 'Gray',           hex: '#808080' },
  { name: 'Cool Gray',      hex: '#9090a0' },
  { name: 'Warm Gray',      hex: '#a09080' },
  { name: 'Silver',         hex: '#c0c0c0' },
  { name: 'Light Gray',     hex: '#d3d3d3' },
  { name: 'Fog',            hex: '#e8e8e8' },
  { name: 'White',          hex: '#ffffff' },
  { name: 'Ivory',          hex: '#fffff0' },
  { name: 'Cream',          hex: '#fffdd0' },
  { name: 'Eggshell',       hex: '#f0ead6' },
  { name: 'Linen',          hex: '#faf0e6' },
  { name: 'Beige',          hex: '#f5f5dc' },
  { name: 'Greige',         hex: '#c8b89a' },
  { name: 'Taupe',          hex: '#b0a090' },
  { name: 'Stone',          hex: '#928e85' },
  // Reds
  { name: 'Red',            hex: '#ff0000' },
  { name: 'Bright Red',     hex: '#ee1111' },
  { name: 'Dark Red',       hex: '#8b0000' },
  { name: 'Maroon',         hex: '#800000' },
  { name: 'Crimson',        hex: '#dc143c' },
  { name: 'Scarlet',        hex: '#ff2400' },
  { name: 'Vermillion',     hex: '#e34234' },
  { name: 'Brick Red',      hex: '#cb4154' },
  { name: 'Indian Red',     hex: '#cd5c5c' },
  { name: 'Tomato',         hex: '#ff6347' },
  { name: 'Coral',          hex: '#ff7f50' },
  { name: 'Salmon',         hex: '#fa8072' },
  { name: 'Light Salmon',   hex: '#ffa07a' },
  { name: 'Dusty Rose',     hex: '#c08080' },
  { name: 'Blush',          hex: '#de8080' },
  { name: 'Rose',           hex: '#ff007f' },
  // Oranges
  { name: 'Orange Red',     hex: '#ff4500' },
  { name: 'Burnt Orange',   hex: '#cc5500' },
  { name: 'Rust',           hex: '#b7410e' },
  { name: 'Terracotta',     hex: '#c66a38' },
  { name: 'Copper',         hex: '#b87333' },
  { name: 'Orange',         hex: '#ffa500' },
  { name: 'Dark Orange',    hex: '#ff8c00' },
  { name: 'Amber',          hex: '#ffbf00' },
  { name: 'Tangerine',      hex: '#f28500' },
  { name: 'Peach',          hex: '#ffcba4' },
  { name: 'Apricot',        hex: '#fbceb1' },
  // Yellows
  { name: 'Yellow',         hex: '#ffff00' },
  { name: 'Lemon',          hex: '#fff44f' },
  { name: 'Gold',           hex: '#ffd700' },
  { name: 'Mustard',        hex: '#ffdb58' },
  { name: 'Dark Mustard',   hex: '#c8a800' },
  { name: 'Dark Yellow',    hex: '#cccc00' },
  { name: 'Ochre',          hex: '#cc7722' },
  { name: 'Goldenrod',      hex: '#daa520' },
  { name: 'Khaki',          hex: '#c3b091' },
  { name: 'Straw',          hex: '#e4d96f' },
  { name: 'Butter',         hex: '#fffaa0' },
  // Yellow-Greens
  { name: 'Yellow Green',   hex: '#9acd32' },
  { name: 'Chartreuse',     hex: '#7fff00' },
  { name: 'Lime',           hex: '#00ff00' },
  { name: 'Lime Green',     hex: '#32cd32' },
  { name: 'Olive',          hex: '#808000' },
  { name: 'Dark Olive',     hex: '#556b2f' },
  { name: 'Olive Drab',     hex: '#6b8e23' },
  { name: 'Avocado',        hex: '#568203' },
  // Greens
  { name: 'Green',          hex: '#008000' },
  { name: 'Forest Green',   hex: '#228b22' },
  { name: 'Dark Green',     hex: '#006400' },
  { name: 'Hunter Green',   hex: '#355e3b' },
  { name: 'Bottle Green',   hex: '#006a4e' },
  { name: 'Pine',           hex: '#01796f' },
  { name: 'Emerald',        hex: '#50c878' },
  { name: 'Medium Green',   hex: '#3cb371' },
  { name: 'Sea Green',      hex: '#2e8b57' },
  { name: 'Moss',           hex: '#8a9a5b' },
  { name: 'Sage',           hex: '#87ae73' },
  { name: 'Fern',           hex: '#4f7942' },
  { name: 'Mint',           hex: '#98ff98' },
  { name: 'Light Mint',     hex: '#c8f0d8' },
  { name: 'Spring Green',   hex: '#00ff7f' },
  { name: 'Jade',           hex: '#00a86b' },
  // Teals / Cyans
  { name: 'Dark Teal',      hex: '#005f5f' },
  { name: 'Teal',           hex: '#008080' },
  { name: 'Medium Teal',    hex: '#008b8b' },
  { name: 'Aqua',           hex: '#00c8c8' },
  { name: 'Aquamarine',     hex: '#7fffd4' },
  { name: 'Turquoise',      hex: '#40e0d0' },
  { name: 'Cyan',           hex: '#00ffff' },
  { name: 'Process Cyan',   hex: '#00b7eb' },
  { name: 'Sky Cyan',       hex: '#80dfff' },
  { name: 'Cerulean',       hex: '#007ba7' },
  // Blues
  { name: 'Powder Blue',    hex: '#b0e0e6' },
  { name: 'Light Blue',     hex: '#add8e6' },
  { name: 'Baby Blue',      hex: '#89cff0' },
  { name: 'Sky Blue',       hex: '#87ceeb' },
  { name: 'Cornflower',     hex: '#6495ed' },
  { name: 'Periwinkle',     hex: '#ccccff' },
  { name: 'Slate Blue',     hex: '#6a5acd' },
  { name: 'Steel Blue',     hex: '#4682b4' },
  { name: 'Dodger Blue',    hex: '#1e90ff' },
  { name: 'Azure',          hex: '#0080ff' },
  { name: 'Blue',           hex: '#0000ff' },
  { name: 'Royal Blue',     hex: '#4169e1' },
  { name: 'Cobalt',         hex: '#0047ab' },
  { name: 'Reflex Blue',    hex: '#001489' },
  { name: 'Navy',           hex: '#000080' },
  { name: 'Dark Navy',      hex: '#03045e' },
  { name: 'Indigo',         hex: '#4b0082' },
  { name: 'Denim',          hex: '#1560bd' },
  // Purples
  { name: 'Purple',         hex: '#800080' },
  { name: 'Dark Purple',    hex: '#4b004b' },
  { name: 'Deep Purple',    hex: '#673ab7' },
  { name: 'Violet',         hex: '#8a2be2' },
  { name: 'Amethyst',       hex: '#9966cc' },
  { name: 'Medium Purple',  hex: '#9370db' },
  { name: 'Grape',          hex: '#6f2da8' },
  { name: 'Eggplant',       hex: '#614051' },
  { name: 'Lavender',       hex: '#e6e6fa' },
  { name: 'Lavender Purple',hex: '#967bb6' },
  { name: 'Mauve',          hex: '#c8a2c8' },
  { name: 'Plum',           hex: '#dda0dd' },
  { name: 'Orchid',         hex: '#da70d6' },
  { name: 'Wisteria',       hex: '#c9a0dc' },
  { name: 'Lilac',          hex: '#c8a2c8' },
  // Pinks / Magentas
  { name: 'Magenta',        hex: '#ff00ff' },
  { name: 'Process Magenta',hex: '#ff0090' },
  { name: 'Fuchsia',        hex: '#c154c1' },
  { name: 'Deep Pink',      hex: '#ff1493' },
  { name: 'Hot Pink',       hex: '#ff69b4' },
  { name: 'Neon Pink',      hex: '#ff44cc' },
  { name: 'Flamingo',       hex: '#fc8eac' },
  { name: 'Pink',           hex: '#ffc0cb' },
  { name: 'Light Pink',     hex: '#ffb6c1' },
  { name: 'Carnation',      hex: '#ff7f7f' },
  // Browns / Earth tones
  { name: 'Dark Brown',     hex: '#5c3317' },
  { name: 'Saddle Brown',   hex: '#8b4513' },
  { name: 'Brown',          hex: '#a52a2a' },
  { name: 'Sienna',         hex: '#a0522d' },
  { name: 'Burnt Sienna',   hex: '#e97451' },
  { name: 'Chocolate',      hex: '#d2691e' },
  { name: 'Peru',           hex: '#cd853f' },
  { name: 'Bronze',         hex: '#cd7f32' },
  { name: 'Caramel',        hex: '#c68642' },
  { name: 'Tan',            hex: '#d2b48c' },
  { name: 'Wheat',          hex: '#f5deb3' },
  { name: 'Sand',           hex: '#c2b280' },
  { name: 'Buff',           hex: '#f0dc82' },
  { name: 'Parchment',      hex: '#f1e9d2' },
]

/** LAB values for NAMED_COLORS, computed once on first use. */
let _namedLab: Array<{ name: string; lab: [number, number, number] }> | null = null
function getNamedLab() {
  if (!_namedLab) {
    _namedLab = NAMED_COLORS.map(({ name, hex }) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return { name, lab: rgbToLab(r, g, b) }
    })
  }
  return _namedLab
}

/**
 * Find the closest named color by CIE76 ΔE in LAB space.
 */
export function guessColorName(L: number, a: number, b: number): string {
  const named = getNamedLab()
  let bestName = 'Color'
  let bestDe = Infinity
  for (const entry of named) {
    const dL = L - entry.lab[0], da = a - entry.lab[1], db = b - entry.lab[2]
    const de = Math.sqrt(dL * dL + da * da + db * db)
    if (de < bestDe) { bestDe = de; bestName = entry.name }
  }
  return bestName
}

/** Standard halftone angles for up to 8 channels. */
const DEFAULT_ANGLES = [45, 75, 15, 0, 30, 60, 105, 90]

/**
 * Extract a spot color palette from an image via k-means++ in LAB space.
 * Returns SpotColor objects ready to use.
 *
 * @param seeds  Optional LAB values to use as fixed starting centroids.
 *               Each seed guarantees a cluster anchored near that color.
 *               Remaining clusters are filled by k-means++ and iteration.
 */
export function extractPalette(
  source: ImageData,
  k: number,
  defaultLpi: number,
  seeds?: Array<[number, number, number]>,
  paper?: PaperWhiteOptions,
): SpotColor[] {
  let pixels = samplePixelsToLab(source, 12000, paper)
  // If paper exclusion left too few pixels (e.g. an almost-all-white image),
  // fall back to sampling everything so extraction still yields a palette.
  if (paper?.enabled && pixels.length < 3 * Math.max(k, 16)) {
    pixels = samplePixelsToLab(source)
  }
  const clampedK = Math.max(1, Math.min(k, 16))

  // Run multiple restarts and keep the best result (lowest within-cluster variance).
  // With user seeds the init is largely deterministic; without seeds this avoids
  // unlucky random initialisations that converge to poor local optima.
  const RESTARTS = seeds?.length ? 2 : 4
  let bestCentroids = kmeans(pixels, clampedK, 50, seeds)
  let bestInertia   = computeInertia(pixels, bestCentroids, clampedK)
  for (let r = 1; r < RESTARTS; r++) {
    const c = kmeans(pixels, clampedK, 50, seeds)
    const inertia = computeInertia(pixels, c, clampedK)
    if (inertia < bestInertia) { bestCentroids = c; bestInertia = inertia }
  }
  const centroids = bestCentroids

  return Array.from({ length: k }, (_, i) => {
    const L = centroids[i * 3]
    const a = centroids[i * 3 + 1]
    const b = centroids[i * 3 + 2]
    const lab: [number, number, number] = [L, a, b]
    return {
      id: newId(),
      name: guessColorName(L, a, b),
      hex: labToHex(lab),
      lab,
      angle: DEFAULT_ANGLES[i % DEFAULT_ANGLES.length],
      lpi: defaultLpi,
      renderMode: 'flat' as const,
      threshold: 0.8,
      enabled: true,
    }
  }).sort((a, b) => b.lab[0] - a.lab[0])  // light → dark order (print order)
}

/**
 * Merge palette entries whose perceptual distance (ΔE) is below the threshold.
 * Merging averages the LAB values of the two closest colors.
 */
export function mergeSimilarColors(colors: SpotColor[], threshold: number): SpotColor[] {
  const result = [...colors]
  let merged = true
  while (merged && result.length > 1) {
    merged = false
    let bestI = -1, bestJ = -1, bestDE = Infinity
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const de = deltaE(result[i].lab, result[j].lab)
        if (de < threshold && de < bestDE) {
          bestDE = de; bestI = i; bestJ = j
        }
      }
    }
    if (bestI >= 0) {
      const a = result[bestI], b = result[bestJ]
      const lab: [number, number, number] = [
        (a.lab[0] + b.lab[0]) / 2,
        (a.lab[1] + b.lab[1]) / 2,
        (a.lab[2] + b.lab[2]) / 2,
      ]
      result[bestI] = {
        ...a,
        lab,
        hex: labToHex(lab),
        name: guessColorName(lab[0], lab[1], lab[2]),
      }
      result.splice(bestJ, 1)
      merged = true
    }
  }
  return result
}

// ─── Channel separation ───────────────────────────────────────────────────────

/**
 * Generate a grayscale mask for a background color layer.
 * transparent pixels (alpha < 128) → 0 (full ink — this is the background)
 * opaque pixels (alpha ≥ 128)      → 255 (no ink — this is the subject)
 *
 * Channel convention matches the rest of the separation system:
 *   black (0)   = full ink   white (255) = no ink
 */
function generateBackgroundChannel(source: ImageData): ImageData {
  const { data, width, height } = source
  const n = width * height
  const buf = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = data[i * 4 + 3] < 128 ? 0 : 255   // transparent → ink, opaque → paper
    buf[i * 4]     = v
    buf[i * 4 + 1] = v
    buf[i * 4 + 2] = v
    buf[i * 4 + 3] = 255
  }
  return new ImageData(buf, width, height)
}

/**
 * Result of the expensive LAB classification pass — a single shared partition
 * of the image into per-pixel color ownership, kept separate from the (cheap,
 * frequently-retuned) smoothing step so smoothing can re-run without redoing
 * the LAB distance computation.
 */
export interface SpotLabelData {
  width: number
  height: number
  /** Owning LAB-color index per pixel, or -1 for transparent/unowned. */
  labels: Int32Array
  /** Lightness-based ink coverage per pixel (0 = full ink, 255 = no ink). */
  values: Uint8ClampedArray
  /** Color id for each label index. */
  labColorIds: string[]
  /** Lightness (L*) for each label index — used to order plates in build-up mode. */
  labColorL: number[]
  /** Alpha-derived channels for background-type colors (not part of the partition). */
  backgroundChannels: Map<string, ImageData>
}

/**
 * Expensive pass: assign every pixel to its nearest palette color (ΔE in LAB)
 * and record that ownership as a single label field plus a coverage value.
 * Background-type colors are handled separately via their alpha mask.
 */
export function computeSpotLabels(source: ImageData, colors: SpotColor[], paper?: PaperWhiteOptions): SpotLabelData {
  const { data, width, height } = source
  const n = width * height

  const labColors = colors.filter(c => c.type !== 'background')
  const labs = labColors.map(c => c.lab)
  const labColorIds = labColors.map(c => c.id)
  const labColorL = labColors.map(c => c.lab[0])

  const labels = new Int32Array(n).fill(-1)
  const values = new Uint8ClampedArray(n)

  if (labColors.length > 0) {
    for (let i = 0; i < n; i++) {
      const p = i * 4
      if (data[p + 3] < 128) continue   // transparent → unowned
      const pixLab = rgbToLab(data[p], data[p + 1], data[p + 2])
      // Near-white → paper: leave unowned (no ink on any plate).
      if (paper?.enabled && isPaperLab(pixLab[0], pixLab[1], pixLab[2], paper.threshold)) continue
      let nearest = 0, minDE = Infinity
      for (let c = 0; c < labs.length; c++) {
        const de = deltaE(pixLab, labs[c])
        if (de < minDE) { minDE = de; nearest = c }
      }
      labels[i] = nearest
      values[i] = Math.round(pixLab[0] / 100 * 255)
    }
  }

  const backgroundChannels = new Map<string, ImageData>()
  for (const color of colors) {
    if (color.type === 'background') {
      backgroundChannels.set(color.id, generateBackgroundChannel(source))
    }
  }

  return { width, height, labels, values, labColorIds, labColorL, backgroundChannels }
}

/**
 * Joint smoothing of the ownership partition.  A pixel is reassigned to the
 * dominant *neighbouring* color only when that color's count among the 8
 * neighbours meets a threshold — operating on the shared label field rather
 * than per-layer masks, so layers never erode apart and open paper seams.
 *
 * `amount` (0–1): low = remove only near-isolated specks (gentle); high =
 * smooth boundaries aggressively (more passes, simple-majority threshold).
 */
function smoothLabelField(
  labels: Int32Array, width: number, height: number, numLabels: number, amount: number,
): Int32Array {
  if (amount <= 0 || numLabels < 2) return labels
  const a = Math.min(1, amount)
  const threshold = Math.max(4, Math.round(8 - 4 * a))   // 8 (gentle) → 4 (majority)
  const passes = Math.max(1, Math.round(1 + 3 * a))       // 1 → 4
  const counts = new Int32Array(numLabels)

  let src = labels
  for (let pass = 0; pass < passes; pass++) {
    const dst = new Int32Array(src)   // unchanged pixels carry over
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const cur = src[i]
        if (cur < 0) continue

        // Tally neighbour labels (8-neighbourhood, in-bounds only).
        let bestLabel = -1, bestCount = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            const nl = src[yy * width + xx]
            if (nl < 0) continue
            const c = ++counts[nl]
            if (c > bestCount) { bestCount = c; bestLabel = nl }
          }
        }
        // Reset touched counters (re-walk the same neighbours, no allocation).
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            const nl = src[yy * width + xx]
            if (nl >= 0) counts[nl] = 0
          }
        }

        if (bestLabel >= 0 && bestLabel !== cur && bestCount >= threshold) {
          dst[i] = bestLabel
        }
      }
    }
    src = dst
  }
  return src
}

/**
 * Build the per-color grayscale channels from a label partition, applying the
 * joint smoothing first.  Channel value encodes ink coverage:
 *   black (0) = full ink   white (255) = no ink (light pixel or owned by another color)
 *
 * In 'buildup' mode the partition becomes nested solid plates: a pixel assigned
 * to a tone inks that plate AND every lighter plate beneath it, so on press the
 * inks stack (darkest opaque ink on top wins) instead of abutting.
 */
export function buildSpotChannels(
  ld: SpotLabelData,
  smoothing: number,
  mode: SeparationMode = 'knockout',
): Map<string, ImageData> {
  const { width, height, values, labColorIds, labColorL, backgroundChannels } = ld
  const n = width * height
  const labels = smoothLabelField(ld.labels, width, height, labColorIds.length, smoothing)
  const nc = labColorIds.length

  const bufs = labColorIds.map(() => new Uint8ClampedArray(n * 4).fill(255))

  if (mode === 'buildup' && nc > 1) {
    // Rank colors by lightness (lightest = rank 0). A pixel assigned to a tone
    // inks its plate plus every lighter plate (lower-or-equal rank), all solid.
    const order = labColorIds.map((_, i) => i).sort((a, b) => labColorL[b] - labColorL[a])
    const rank = new Array<number>(nc)
    order.forEach((idx, pos) => { rank[idx] = pos })
    for (let i = 0; i < n; i++) {
      const lab = labels[i]
      if (lab < 0) continue
      const ar = rank[lab]
      const p = i * 4
      for (let k = 0; k < nc; k++) {
        if (rank[k] <= ar) { const b = bufs[k]; b[p] = 0; b[p + 1] = 0; b[p + 2] = 0 }  // solid ink
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const lab = labels[i]
      if (lab < 0) continue
      const v = values[i]
      const p = i * 4
      const b = bufs[lab]
      b[p] = v; b[p + 1] = v; b[p + 2] = v   // alpha already 255 from fill
    }
  }

  const result = new Map<string, ImageData>()
  for (let k = 0; k < labColorIds.length; k++) {
    result.set(labColorIds[k], new ImageData(bufs[k], width, height))
  }
  for (const [id, img] of backgroundChannels) result.set(id, img)
  return result
}

/** Separable binary erosion — an ink cell survives only if its whole window is ink. */
function erodeBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let m = 1
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= w || !src[row + xx]) { m = 0; break }
      }
      tmp[row + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 1
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) { m = 0; break }
      }
      out[y * w + x] = m
    }
  }
  return out
}

/**
 * Build the underbase channel: union of all inked area (every assigned pixel),
 * choked inward by `chokePx`, as a black-on-white plate (0 = ink, 255 = paper).
 */
export function buildUnderbaseChannel(ld: SpotLabelData, chokePx: number): ImageData {
  const { width, height, labels } = ld
  const n = width * height
  const ink = new Uint8Array(n)
  for (let i = 0; i < n; i++) ink[i] = labels[i] >= 0 ? 1 : 0
  const choked = chokePx >= 1 ? erodeBinary(ink, width, height, Math.round(chokePx)) : ink
  const buf = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = choked[i] ? 0 : 255
    buf[i * 4] = v; buf[i * 4 + 1] = v; buf[i * 4 + 2] = v; buf[i * 4 + 3] = 255
  }
  return new ImageData(buf, width, height)
}

/**
 * Separate an RGB ImageData into one grayscale ImageData per spot color, with
 * optional joint smoothing of the ownership partition.  Convenience wrapper
 * around computeSpotLabels + buildSpotChannels for one-shot callers (export).
 */
export function separateSpotChannels(
  source: ImageData,
  colors: SpotColor[],
  smoothing = 0,
  paper?: PaperWhiteOptions,
  mode: SeparationMode = 'knockout',
): Map<string, ImageData> {
  return buildSpotChannels(computeSpotLabels(source, colors, paper), smoothing, mode)
}

// ─── Flat rendering ───────────────────────────────────────────────────────────

/**
 * Render a spot channel as a flat (binary) mask.
 *
 * Pixels darker than `threshold` become solid black (full ink).
 * Everything else becomes white (no ink).
 *
 * Output format matches renderHalftone: black = ink, white = paper.
 */
export function renderFlat(
  ctx: CanvasRenderingContext2D,
  source: ImageData,
  threshold: number,  // 0–1; pixels with value < threshold*255 → ink
): void {
  const { width, height, data } = source
  const t = threshold * 255
  const out = new Uint8ClampedArray(data.length)

  for (let i = 0; i < width * height; i++) {
    const v = data[i * 4]             // channel value: 0=full ink, 255=no ink
    const ink = v < t ? 0 : 255      // below threshold → solid ink (black)
    out[i * 4] = ink
    out[i * 4 + 1] = ink
    out[i * 4 + 2] = ink
    out[i * 4 + 3] = 255
  }

  ctx.putImageData(new ImageData(out, width, height), 0, 0)
}
