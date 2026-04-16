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

import { SpotColor } from '../types'

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

/**
 * Sample pixels from source (stride-sampled for speed) and convert to LAB.
 * Returns a Float32Array of [L, a, b] triples.
 */
function samplePixelsToLab(source: ImageData, maxSamples = 12000): Float32Array {
  const { data, width, height } = source
  const total = width * height
  const stride = Math.max(1, Math.floor(total / maxSamples))
  const count = Math.ceil(total / stride)
  const out = new Float32Array(count * 3)
  let idx = 0
  for (let i = 0; i < total; i += stride) {
    const p = i * 4
    const [L, a, b] = rgbToLab(data[p], data[p + 1], data[p + 2])
    out[idx++] = L
    out[idx++] = a
    out[idx++] = b
  }
  return out.slice(0, idx)
}

/** k-means++ initialisation: pick first centroid randomly, then weight remaining. */
function initCentroids(pixels: Float32Array, k: number): Float32Array {
  const n = pixels.length / 3
  const centroids = new Float32Array(k * 3)

  // First centroid: random
  let pick = Math.floor(Math.random() * n) * 3
  centroids[0] = pixels[pick]; centroids[1] = pixels[pick + 1]; centroids[2] = pixels[pick + 2]

  const dist2 = new Float32Array(n)

  for (let c = 1; c < k; c++) {
    // Compute distance² to nearest existing centroid
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
    // Weighted random pick
    let r = Math.random() * total
    for (let i = 0; i < n; i++) {
      r -= dist2[i]
      if (r <= 0) {
        pick = i * 3
        centroids[c * 3] = pixels[pick]
        centroids[c * 3 + 1] = pixels[pick + 1]
        centroids[c * 3 + 2] = pixels[pick + 2]
        break
      }
    }
  }
  return centroids
}

/** Run k-means iterations. Returns final centroid array [L,a,b, L,a,b, ...]. */
function kmeans(pixels: Float32Array, k: number, maxIter = 50): Float32Array {
  const n = pixels.length / 3
  const centroids = initCentroids(pixels, k)
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

// ─── Named color lookup ───────────────────────────────────────────────────────

/**
 * Curated palette of ~90 recognizable color names with hex values.
 * Covers the full gamut with enough granularity to distinguish e.g.
 * Navy from Cobalt from Sky Blue, or Crimson from Coral from Salmon.
 */
const NAMED_COLORS: { name: string; hex: string }[] = [
  // Neutrals
  { name: 'Black',       hex: '#000000' },
  { name: 'Charcoal',    hex: '#36454f' },
  { name: 'Dark Gray',   hex: '#404040' },
  { name: 'Gray',        hex: '#808080' },
  { name: 'Silver',      hex: '#c0c0c0' },
  { name: 'Light Gray',  hex: '#d3d3d3' },
  { name: 'White',       hex: '#ffffff' },
  { name: 'Ivory',       hex: '#fffff0' },
  { name: 'Cream',       hex: '#fffdd0' },
  { name: 'Beige',       hex: '#f5f5dc' },
  // Reds
  { name: 'Red',         hex: '#ff0000' },
  { name: 'Dark Red',    hex: '#8b0000' },
  { name: 'Maroon',      hex: '#800000' },
  { name: 'Crimson',     hex: '#dc143c' },
  { name: 'Scarlet',     hex: '#ff2400' },
  { name: 'Brick Red',   hex: '#cb4154' },
  { name: 'Indian Red',  hex: '#cd5c5c' },
  { name: 'Tomato',      hex: '#ff6347' },
  { name: 'Coral',       hex: '#ff7f50' },
  { name: 'Salmon',      hex: '#fa8072' },
  { name: 'Light Salmon',hex: '#ffa07a' },
  // Oranges
  { name: 'Orange Red',  hex: '#ff4500' },
  { name: 'Burnt Orange',hex: '#cc5500' },
  { name: 'Orange',      hex: '#ffa500' },
  { name: 'Dark Orange', hex: '#ff8c00' },
  { name: 'Amber',       hex: '#ffbf00' },
  { name: 'Tangerine',   hex: '#f28500' },
  // Yellows
  { name: 'Yellow',      hex: '#ffff00' },
  { name: 'Lemon',       hex: '#fff44f' },
  { name: 'Gold',        hex: '#ffd700' },
  { name: 'Mustard',     hex: '#ffdb58' },
  { name: 'Dark Yellow', hex: '#cccc00' },
  { name: 'Khaki',       hex: '#c3b091' },
  { name: 'Straw',       hex: '#e4d96f' },
  // Yellow-Greens
  { name: 'Yellow Green',hex: '#9acd32' },
  { name: 'Chartreuse',  hex: '#7fff00' },
  { name: 'Lime',        hex: '#00ff00' },
  { name: 'Lime Green',  hex: '#32cd32' },
  { name: 'Olive',       hex: '#808000' },
  { name: 'Olive Drab',  hex: '#6b8e23' },
  // Greens
  { name: 'Green',       hex: '#008000' },
  { name: 'Forest Green',hex: '#228b22' },
  { name: 'Dark Green',  hex: '#006400' },
  { name: 'Emerald',     hex: '#50c878' },
  { name: 'Medium Green',hex: '#3cb371' },
  { name: 'Sea Green',   hex: '#2e8b57' },
  { name: 'Sage',        hex: '#9aae89' },
  { name: 'Mint',        hex: '#98ff98' },
  { name: 'Spring Green',hex: '#00ff7f' },
  // Teals / Cyans
  { name: 'Dark Teal',   hex: '#008080' },
  { name: 'Teal',        hex: '#008b8b' },
  { name: 'Aquamarine',  hex: '#7fffd4' },
  { name: 'Turquoise',   hex: '#40e0d0' },
  { name: 'Cyan',        hex: '#00ffff' },
  { name: 'Sky Cyan',    hex: '#80dfff' },
  // Blues
  { name: 'Powder Blue', hex: '#b0e0e6' },
  { name: 'Light Blue',  hex: '#add8e6' },
  { name: 'Sky Blue',    hex: '#87ceeb' },
  { name: 'Cornflower',  hex: '#6495ed' },
  { name: 'Periwinkle',  hex: '#ccccff' },
  { name: 'Steel Blue',  hex: '#4682b4' },
  { name: 'Dodger Blue', hex: '#1e90ff' },
  { name: 'Blue',        hex: '#0000ff' },
  { name: 'Royal Blue',  hex: '#4169e1' },
  { name: 'Cobalt',      hex: '#0047ab' },
  { name: 'Navy',        hex: '#000080' },
  { name: 'Dark Navy',   hex: '#03045e' },
  { name: 'Slate Blue',  hex: '#6a5acd' },
  { name: 'Indigo',      hex: '#4b0082' },
  // Purples
  { name: 'Purple',      hex: '#800080' },
  { name: 'Dark Purple', hex: '#4b004b' },
  { name: 'Violet',      hex: '#8a2be2' },
  { name: 'Amethyst',    hex: '#9966cc' },
  { name: 'Medium Purple',hex: '#9370db' },
  { name: 'Lavender',    hex: '#e6e6fa' },
  { name: 'Mauve',       hex: '#c8a2c8' },
  { name: 'Plum',        hex: '#dda0dd' },
  { name: 'Orchid',      hex: '#da70d6' },
  // Pinks / Magentas
  { name: 'Magenta',     hex: '#ff00ff' },
  { name: 'Fuchsia',     hex: '#ff0090' },
  { name: 'Deep Pink',   hex: '#ff1493' },
  { name: 'Hot Pink',    hex: '#ff69b4' },
  { name: 'Rose',        hex: '#ff007f' },
  { name: 'Pink',        hex: '#ffc0cb' },
  { name: 'Light Pink',  hex: '#ffb6c1' },
  // Browns / Earth tones
  { name: 'Saddle Brown',hex: '#8b4513' },
  { name: 'Brown',       hex: '#a52a2a' },
  { name: 'Sienna',      hex: '#a0522d' },
  { name: 'Chocolate',   hex: '#d2691e' },
  { name: 'Peru',        hex: '#cd853f' },
  { name: 'Tan',         hex: '#d2b48c' },
  { name: 'Wheat',       hex: '#f5deb3' },
  { name: 'Sand',        hex: '#c2b280' },
  { name: 'Buff',        hex: '#f0dc82' },
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
function guessColorName(L: number, a: number, b: number): string {
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
 */
export function extractPalette(source: ImageData, k: number, defaultLpi: number): SpotColor[] {
  const pixels = samplePixelsToLab(source)
  const centroids = kmeans(pixels, Math.max(1, Math.min(k, 16)))

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
 * Separate an RGB ImageData into one grayscale ImageData per spot color.
 *
 * Each pixel is assigned to its nearest palette color (by ΔE in LAB).
 * The channel value encodes ink coverage:
 *   black (0)   = full ink (dark source pixel)
 *   white (255) = no ink (light source pixel or not assigned to this channel)
 */
export function separateSpotChannels(
  source: ImageData,
  colors: SpotColor[],
): Map<string, ImageData> {
  const { data, width, height } = source
  const n = width * height

  // Pre-allocate all channel buffers filled with 255 (no ink)
  const bufs = new Map<string, Uint8ClampedArray>()
  for (const color of colors) {
    const buf = new Uint8ClampedArray(n * 4).fill(255)
    for (let i = 3; i < n * 4; i += 4) buf[i] = 255  // alpha
    bufs.set(color.id, buf)
  }

  const labs = colors.map(c => c.lab)
  const ids = colors.map(c => c.id)

  for (let i = 0; i < n; i++) {
    const p = i * 4
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const pixLab = rgbToLab(r, g, b)

    // Nearest spot color
    let nearestIdx = 0, minDE = Infinity
    for (let c = 0; c < labs.length; c++) {
      const de = deltaE(pixLab, labs[c])
      if (de < minDE) { minDE = de; nearestIdx = c }
    }

    // Channel value: lightness-based ink coverage.
    // L*=0 (black) → channel value 0 (full ink)
    // L*=100 (white) → channel value 255 (no ink)
    const channelValue = Math.round(pixLab[0] / 100 * 255)
    const buf = bufs.get(ids[nearestIdx])!
    buf[p] = channelValue
    buf[p + 1] = channelValue
    buf[p + 2] = channelValue
    // alpha stays 255
  }

  const result = new Map<string, ImageData>()
  for (const [id, buf] of bufs) {
    result.set(id, new ImageData(buf, width, height))
  }
  return result
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
