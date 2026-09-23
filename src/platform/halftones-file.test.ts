import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { migrateProjectJson, packHalftonesFile, unpackHalftonesFile } from './halftones-file'
import { AllSettings, ProjectFile } from './types'
import {
  DEFAULT_CMYK_SETTINGS, DEFAULT_HALFTONE_SETTINGS, DEFAULT_MASK_SETTINGS,
  DEFAULT_OUTPUT_SETTINGS, DEFAULT_SPOT_SETTINGS, DEFAULT_TRANSFORM_SETTINGS,
} from '../types'

const baseSettings: AllSettings = {
  halftone: DEFAULT_HALFTONE_SETTINGS,
  cmyk: DEFAULT_CMYK_SETTINGS,
  spot: DEFAULT_SPOT_SETTINGS,
  output: DEFAULT_OUTPUT_SETTINGS,
  transform: DEFAULT_TRANSFORM_SETTINGS,
}

const v1Json = {
  schemaVersion: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  name: 'Old project',
  sourceFileName: 'photo.jpg',
  settings: baseSettings,
}

describe('migrateProjectJson', () => {
  it('upgrades v1 to v2 with default mask settings', () => {
    const out = migrateProjectJson(v1Json)
    expect(out.schemaVersion).toBe(2)
    expect(out.maskSettings).toEqual(DEFAULT_MASK_SETTINGS)
    expect(out.maskFileName).toBeUndefined()
    expect(out.name).toBe('Old project')
    expect(out.settings).toEqual(baseSettings)
  })

  it('passes v2 through unchanged', () => {
    const v2 = { ...v1Json, schemaVersion: 2, maskFileName: 'm.png', layerEditsKey: 'k' }
    expect(migrateProjectJson(v2)).toEqual(v2)
  })

  it('rejects non-projects and future versions', () => {
    expect(() => migrateProjectJson(null)).toThrow(/Halftones project/)
    expect(() => migrateProjectJson({ foo: 1 })).toThrow(/Halftones project/)
    expect(() => migrateProjectJson({ ...v1Json, schemaVersion: 99 })).toThrow(/newer version/)
  })
})

describe('pack/unpack .halftones', () => {
  const bytes = (...b: number[]) => new Uint8Array(b)

  it('round-trips image, mask, thumbnail, layer edits and settings', async () => {
    const project: ProjectFile = {
      name: 'Round trip',
      settings: { ...baseSettings, mask: { ...DEFAULT_MASK_SETTINGS, enabled: true } },
      image: { bytes: bytes(1, 2, 3), fileName: 'Photo.JPEG' },
      mask: { bytes: bytes(4, 5), fileName: 'logo.svg' },
      thumbnail: bytes(6),
      layerEdits: [{ colorId: 'c1', bytes: bytes(7, 8) }, { colorId: 'c2', bytes: bytes(9) }],
      layerEditsKey: 'geom-key',
    }
    const out = await unpackHalftonesFile(await packHalftonesFile(project))

    expect(out.name).toBe(project.name)
    expect(out.settings).toEqual(project.settings)
    expect(out.image).toEqual(project.image)
    expect(out.mask).toEqual(project.mask)
    expect(out.thumbnail).toEqual(project.thumbnail)
    expect(out.layerEdits?.sort((a, b) => a.colorId.localeCompare(b.colorId))).toEqual(project.layerEdits)
    expect(out.layerEditsKey).toBe('geom-key')
  })

  it('opens a v1 file with no mask and default mask settings', async () => {
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify(v1Json))
    zip.file('source.jpg', bytes(1, 2))
    const out = await unpackHalftonesFile(await zip.generateAsync({ type: 'uint8array' }))

    expect(out.settings.mask).toEqual(DEFAULT_MASK_SETTINGS)
    expect(out.mask).toBeUndefined()
    expect(out.layerEdits).toBeUndefined()
    expect(out.image).toEqual({ bytes: bytes(1, 2), fileName: 'photo.jpg' })
  })

  it('soft-fails with empty image bytes when the source entry is missing', async () => {
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify(v1Json))
    const out = await unpackHalftonesFile(await zip.generateAsync({ type: 'uint8array' }))
    expect(out.image.bytes.length).toBe(0)
  })

  it('rejects a zip without project.json', async () => {
    const zip = new JSZip()
    zip.file('other.txt', 'hi')
    await expect(unpackHalftonesFile(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/Halftones project/)
  })
})
