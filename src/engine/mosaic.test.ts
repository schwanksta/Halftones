import { describe, expect, it } from 'vitest'
import { applyMosaic, mosaicGridFor, maybeApplyMosaic, sliderToTileInches, tileInchesToSlider } from './mosaic'
import type { SpotLabelData } from './spot-separation'
import { DEFAULT_SPOT_SETTINGS } from '../types'

/** Label field from rows of characters: '.' = unowned, digits = label index. */
function field(rows: string[], opts: { values?: number; painted?: Uint32Array } = {}): SpotLabelData {
  const height = rows.length, width = rows[0].length
  const labels = new Int32Array(width * height)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { labels[y * width + x] = ch === '.' ? -1 : Number(ch) }))
  return {
    width, height, labels,
    values: new Uint8ClampedArray(width * height).fill(opts.values ?? 100),
    labColorIds: ['a', 'b', 'c'], labColorL: [80, 50, 20],
    backgroundChannels: new Map(),
    painted: opts.painted,
  }
}

const render = (ld: SpotLabelData) => Array.from({ length: ld.height }, (_, y) =>
  Array.from({ length: ld.width }, (_, x) => {
    const l = ld.labels[y * ld.width + x]
    return l < 0 ? '.' : String(l)
  }).join(''))

describe('applyMosaic', () => {
  it('gives each tile its majority label', () => {
    const out = applyMosaic(field([
      '0001',
      '0011',
      '2111',
      '2211',
    ]), { tilePx: 2, groutPx: 0 })
    expect(render(out)).toEqual([
      '0011',
      '0011',
      '2211',
      '2211',
    ])
    expect(out.tiled).toBe(true)
  })

  it('treats paper as a candidate so mostly-blank tiles stay blank', () => {
    const out = applyMosaic(field([
      '..00',
      '.000',
    ]), { tilePx: 2, groutPx: 0 })
    expect(render(out)).toEqual(['..00', '..00'])
  })

  it('cuts grout on interior grid lines only', () => {
    const out = applyMosaic(field(Array(8).fill('00000000')), { tilePx: 4, groutPx: 2 })
    expect(render(out)).toEqual([
      '000..000',
      '000..000',
      '000..000',
      '........',
      '........',
      '000..000',
      '000..000',
      '000..000',
    ])
  })

  it('centers the grid and merges thin edge slivers into their neighbour', () => {
    // 10px at 4px tiles → 1px slivers each side (< tile/4) merge: tiles of 5|5.
    const out = applyMosaic(field(['0000011111']), { tilePx: 4, groutPx: 0 })
    expect(render(out)).toEqual(['0000011111'])
    // 12px at 5px tiles → 1px slivers each side, 1 < 5/4 so they merge: 6|6.
    const out2 = applyMosaic(field(['000000111111']), { tilePx: 5, groutPx: 0 })
    expect(render(out2)).toEqual(['000000111111'])
  })

  it('averages tone over the winning label', () => {
    const ld = field(['0001'])
    ld.values.set([10, 20, 30, 250])
    const out = applyMosaic(ld, { tilePx: 4, groutPx: 0 })
    expect(Array.from(out.values)).toEqual([20, 20, 20, 20])
  })

  it('tiles painted edit bits by majority', () => {
    // Left 2×2 tile: 3 of 4 painted → painted. Right tile: 1 of 4 → not.
    const painted = new Uint32Array([0b10, 0b10, 0, 0, 0b10, 0, 0, 0b10])
    const out = applyMosaic(field(['0000', '0000'], { painted }), { tilePx: 2, groutPx: 0 })
    expect(Array.from(out.painted!)).toEqual([0b10, 0b10, 0, 0, 0b10, 0b10, 0, 0])
  })
})

describe('mosaicGridFor', () => {
  it('is null when mosaic is off', () => {
    expect(mosaicGridFor(DEFAULT_SPOT_SETTINGS, 1000, 10)).toBeNull()
    const ld = field(['00'])
    expect(maybeApplyMosaic(ld, DEFAULT_SPOT_SETTINGS, 10)).toBe(ld)
  })

  it('scales tile and grout with resolution so preview and export match', () => {
    const spot = { ...DEFAULT_SPOT_SETTINGS, mosaic: true, mosaicTileInches: 0.5, mosaicGroutPct: 10 }
    expect(mosaicGridFor(spot, 1000, 10)).toEqual({ tilePx: 50, groutPx: 5 })
    expect(mosaicGridFor(spot, 3000, 10)).toEqual({ tilePx: 150, groutPx: 15 })
  })

  it('rounds grout to whole pixels and never fills a whole tile', () => {
    const spot = { ...DEFAULT_SPOT_SETTINGS, mosaic: true, mosaicTileInches: 0.02, mosaicGroutPct: 15 }
    // 0.02" at 100 ppi = 2px tile; 15% = 0.3px → rounds to 0.
    expect(mosaicGridFor(spot, 1000, 10)).toEqual({ tilePx: 2, groutPx: 0 })
    const fat = { ...spot, mosaicGroutPct: 50 }
    expect(mosaicGridFor(fat, 1000, 10)!.groutPx).toBe(1)
  })

  it('tile slider is logarithmic and round-trips', () => {
    expect(sliderToTileInches(0)).toBe(0.01)
    expect(sliderToTileInches(1)).toBe(0.5)
    // Half the slider travel lands well under the linear midpoint (~0.07").
    expect(sliderToTileInches(0.5)).toBeLessThan(0.1)
    expect(sliderToTileInches(tileInchesToSlider(0.08))).toBeCloseTo(0.08, 3)
  })
})
