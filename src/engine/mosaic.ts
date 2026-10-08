/**
 * Mosaic separation — quantizes the color-ownership partition to a square
 * tile grid. Each tile goes entirely to the label that owns most of its
 * pixels (paper/unowned counts as a candidate, so mostly-blank tiles stay
 * blank), with an optional grout gap of bare paper between tiles.
 *
 * Runs on SpotLabelData after layer edits and before buildSpotChannels, so
 * every downstream consumer (plates, underbase, key knockout, build-up
 * reach) inherits the tiles. Tile and grout sizes are in inches and the grid
 * is centered on the image, so preview (source resolution) and export
 * (output resolution) tile identically.
 */
import { SpotSettings } from '../types'
import type { SpotLabelData } from './spot-separation'

export interface MosaicGrid {
  /** Tile pitch in label-field pixels (fractional OK). Tiles are square. */
  tilePx: number
  /** Grout width in label-field pixels; 0 = tiles abut. */
  groutPx: number
}

export const DEFAULT_MOSAIC_TILE_INCHES = 0.25
export const DEFAULT_MOSAIC_GROUT_INCHES = 0.02

/**
 * Mosaic grid for a label field `width` pixels wide printed `widthInches`
 * wide, or null when mosaic is off. Scale comes from width alone (the color
 * proof derives its height from the image aspect, not heightInches), so
 * preview, plates and proof all tile identically. Grout gets a 1px floor so
 * it stays visible in a low-resolution preview.
 */
export function mosaicGridFor(spot: SpotSettings, width: number, widthInches: number): MosaicGrid | null {
  if (!spot.mosaic) return null
  const ppi = width / Math.max(0.01, widthInches)
  const tileIn = spot.mosaicTileInches ?? DEFAULT_MOSAIC_TILE_INCHES
  const groutIn = spot.mosaicGroutInches ?? DEFAULT_MOSAIC_GROUT_INCHES
  const tilePx = Math.max(2, tileIn * ppi)
  const groutPx = groutIn > 0 ? Math.min(tilePx - 1, Math.max(1, groutIn * ppi)) : 0
  return { tilePx, groutPx }
}

/**
 * Per-column (or per-row) tile index along one axis, or -1 for grout.
 * The grid is centered so partial tiles at both edges are equal; edge
 * slivers under a quarter tile are merged into their neighbour rather than
 * left as a thin strip. Grout sits on interior grid lines only (never at the
 * image edge).
 */
function axisTiles(len: number, tilePx: number, groutPx: number): { index: Int32Array; count: number } {
  const sliver = (len % tilePx) / 2
  const hasSliver = sliver > 1e-6
  // Grid line k sits at k*tilePx + off, between tile k-1 and tile k.
  const off = hasSliver ? sliver - tilePx : 0
  const lastTile = Math.floor((len - 0.5 - off) / tilePx)
  const merge = hasSliver && sliver < tilePx / 4 && lastTile >= 2
  const minTile = merge ? 1 : 0
  const maxTile = merge ? lastTile - 1 : lastTile

  const index = new Int32Array(len)
  for (let x = 0; x < len; x++) {
    const u = x + 0.5 - off
    const t = Math.min(maxTile, Math.max(minTile, Math.floor(u / tilePx)))
    const k = Math.round(u / tilePx)
    // Only lines that separate two surviving tiles carry grout.
    const isGrout = groutPx > 0 && k > minTile && k <= maxTile && Math.abs(u - k * tilePx) < groutPx / 2
    index[x] = isGrout ? -1 : t - minTile
  }
  return { index, count: maxTile - minTile + 1 }
}

/** Quantize the ownership partition to mosaic tiles. Returns a new SpotLabelData marked `tiled`. */
export function applyMosaic(ld: SpotLabelData, grid: MosaicGrid): SpotLabelData {
  const { width, height, labels, values, painted, erased } = ld
  const nc = ld.labColorIds.length
  const slots = nc + 1                     // slot nc = paper / unowned
  const cols = axisTiles(width, grid.tilePx, grid.groutPx)
  const rows = axisTiles(height, grid.tilePx, grid.groutPx)
  const ntx = cols.count

  const outLabels = new Int32Array(width * height).fill(-1)
  const outValues = new Uint8ClampedArray(width * height)
  const outPainted = painted ? new Uint32Array(width * height) : undefined
  const outErased = erased ? new Uint32Array(width * height) : undefined

  // One tile row (band) at a time keeps the tally arrays small.
  const counts = new Int32Array(ntx * slots)
  const valSums = new Float64Array(ntx * slots)
  const totals = new Int32Array(ntx)
  const paintCounts = painted ? new Int32Array(ntx * 32) : null
  const eraseCounts = erased ? new Int32Array(ntx * 32) : null
  const winLabel = new Int32Array(ntx)
  const winValue = new Uint8Array(ntx)
  const winPaint = new Uint32Array(ntx)
  const winErase = new Uint32Array(ntx)

  const tallyBits = (tally: Int32Array, base: number, bits: number) => {
    while (bits !== 0) {
      const b = 31 - Math.clz32(bits)
      tally[base + b]++
      bits &= ~(1 << b)
    }
  }
  const majorityBits = (tally: Int32Array, base: number, total: number) => {
    let bits = 0
    for (let b = 0; b < 32; b++) if (tally[base + b] * 2 > total) bits |= 1 << b
    return bits >>> 0
  }

  let y = 0
  while (y < height) {
    const ty = rows.index[y]
    let yEnd = y + 1
    while (yEnd < height && rows.index[yEnd] === ty) yEnd++
    if (ty < 0) { y = yEnd; continue }     // grout band: stays -1 (no ink)

    counts.fill(0); valSums.fill(0); totals.fill(0)
    paintCounts?.fill(0); eraseCounts?.fill(0)

    for (let yy = y; yy < yEnd; yy++) {
      const row = yy * width
      for (let x = 0; x < width; x++) {
        const tx = cols.index[x]
        if (tx < 0) continue
        const i = row + x
        const lab = labels[i]
        const slot = tx * slots + (lab < 0 ? nc : lab)
        counts[slot]++
        valSums[slot] += values[i]
        totals[tx]++
        if (paintCounts && painted![i]) tallyBits(paintCounts, tx * 32, painted![i])
        if (eraseCounts && erased![i]) tallyBits(eraseCounts, tx * 32, erased![i])
      }
    }

    for (let tx = 0; tx < ntx; tx++) {
      if (totals[tx] === 0) continue
      let best = nc, bestCount = -1
      for (let s = 0; s < slots; s++) {
        const c = counts[tx * slots + s]
        if (c > bestCount) { bestCount = c; best = s }
      }
      winLabel[tx] = best === nc ? -1 : best
      winValue[tx] = best === nc ? 0 : Math.round(valSums[tx * slots + best] / bestCount)
      winPaint[tx] = paintCounts ? majorityBits(paintCounts, tx * 32, totals[tx]) : 0
      winErase[tx] = eraseCounts ? majorityBits(eraseCounts, tx * 32, totals[tx]) : 0
    }

    for (let yy = y; yy < yEnd; yy++) {
      const row = yy * width
      for (let x = 0; x < width; x++) {
        const tx = cols.index[x]
        if (tx < 0) continue
        const i = row + x
        outLabels[i] = winLabel[tx]
        outValues[i] = winValue[tx]
        if (outPainted) outPainted[i] = winPaint[tx]
        if (outErased) outErased[i] = winErase[tx]
      }
    }
    y = yEnd
  }

  return { ...ld, labels: outLabels, values: outValues, painted: outPainted, erased: outErased, tiled: true }
}

/** applyMosaic when the settings enable it, else the input unchanged. */
export function maybeApplyMosaic(ld: SpotLabelData, spot: SpotSettings, widthInches: number): SpotLabelData {
  const grid = mosaicGridFor(spot, ld.width, widthInches)
  return grid ? applyMosaic(ld, grid) : ld
}
