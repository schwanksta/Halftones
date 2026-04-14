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

/**
 * Approximate a human-readable name from LAB values.
 * Very rough — just enough to label swatches without requiring user input.
 */
function guessColorName(L: number, a: number, b: number): string {
  if (L < 15) return 'Black'
  if (L > 88) return 'White'
  if (L > 70 && Math.abs(a) < 12 && Math.abs(b) < 12) return 'Light Gray'
  if (L > 40 && L < 70 && Math.abs(a) < 12 && Math.abs(b) < 12) return 'Gray'
  if (Math.abs(a) < 10 && Math.abs(b) < 10) return 'Dark Gray'
  const hue = Math.atan2(b, a) * (180 / Math.PI)
  if (hue >= -30 && hue < 30) return L > 55 ? 'Pink' : 'Red'
  if (hue >= 30 && hue < 75) return L > 65 ? 'Light Orange' : 'Orange'
  if (hue >= 75 && hue < 105) return L > 65 ? 'Light Yellow' : 'Yellow'
  if (hue >= 105 && hue < 150) return L > 55 ? 'Light Green' : 'Green'
  if (hue >= 150 && hue < 195) return 'Teal'
  if (hue >= 195 && hue < 255) return L > 55 ? 'Sky Blue' : 'Blue'
  if (hue >= 255 && hue < 315) return L > 55 ? 'Lavender' : 'Purple'
  return L > 55 ? 'Light Pink' : 'Magenta'
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
      renderMode: 'halftone' as const,
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
