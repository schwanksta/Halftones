import JSZip from 'jszip'
import { ProjectFile, AllSettings } from './types'
import { MaskSettings, DEFAULT_MASK_SETTINGS } from '../types'

const CURRENT_SCHEMA_VERSION = 2

interface ProjectJsonV2 {
  schemaVersion: 2
  createdAt: string
  updatedAt: string
  name: string
  sourceFileName: string
  settings: AllSettings
  /**
   * Optional global layer mask settings.  The mask image itself is stored as
   * `mask.<ext>` in the zip root.  Absent = no mask (default off).
   */
  maskSettings?: MaskSettings
  /**
   * Original filename of the mask image (e.g. "mask.svg", "logo.png").
   * Used to recover the file extension and display name on unpack.
   * Absent = no mask stored.
   */
  maskFileName?: string
}

const RECOGNIZED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

function getImageExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return 'png'
  const ext = lower.slice(dotIdx + 1)
  return RECOGNIZED_EXTENSIONS.has(ext) ? ext : 'png'
}

function getMaskExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return 'png'
  return lower.slice(dotIdx + 1)
}

/**
 * Migrates a raw parsed project.json object up to the current schema version.
 * Structure: a switch on schemaVersion that increments until reaching CURRENT_SCHEMA_VERSION.
 * To add a migration, insert a new case before the default and chain it forward.
 */
export function migrateProjectJson(raw: unknown): ProjectJsonV2 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error("This doesn't look like a Halftones project file.")
  }
  const obj = raw as Record<string, unknown>
  const version = obj['schemaVersion']

  if (version === undefined || typeof version !== 'number') {
    throw new Error("This doesn't look like a Halftones project file.")
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of Halftones.')
  }

  // Migration chain: each case falls through to the next until we reach current.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = raw
  switch (data.schemaVersion as number) {
    case 1:
      // v1 → v2: add maskSettings (default off) and maskFileName (absent).
      data = {
        ...data,
        schemaVersion: 2,
        maskSettings: DEFAULT_MASK_SETTINGS,
        // maskFileName intentionally omitted — no mask in v1 files
      }
      return data as ProjectJsonV2
    case 2:
      // Already at current version — cast and return.
      return data as ProjectJsonV2
    default:
      throw new Error(`Unknown schema version: ${data.schemaVersion}`)
  }
}

/**
 * Packs a ProjectFile into a .halftones zip archive (Uint8Array).
 * Contents:
 *   project.json  — ProjectJsonV2 serialized with 2-space indent
 *   source.<ext>  — raw source image bytes
 *   mask.<ext>    — raw mask image bytes (optional, only when mask is loaded)
 */
export async function packHalftonesFile(
  project: ProjectFile,
  opts?: { createdAt?: string },
): Promise<Uint8Array> {
  const now = new Date().toISOString()
  const createdAt = opts?.createdAt ?? now
  const updatedAt = now

  const ext = getImageExtension(project.image.fileName)
  const sourceEntry = `source.${ext}`

  const projectJson: ProjectJsonV2 = {
    schemaVersion: 2,
    createdAt,
    updatedAt,
    name: project.name,
    sourceFileName: project.image.fileName,
    settings: project.settings,
    maskSettings: project.settings.mask,
    maskFileName: project.mask?.fileName,
  }

  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(projectJson, null, 2))
  zip.file(sourceEntry, project.image.bytes)

  // Store the mask image if present
  if (project.mask?.bytes?.length) {
    const maskExt = getMaskExtension(project.mask.fileName)
    zip.file(`mask.${maskExt}`, project.mask.bytes)
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

/**
 * Unpacks a .halftones zip archive (Uint8Array) into a ProjectFile.
 * Throws on malformed/unsupported files; returns a ProjectFile with empty
 * image bytes (soft failure) if the source image entry is missing from the zip.
 */
export async function unpackHalftonesFile(bytes: Uint8Array): Promise<ProjectFile> {
  const zip = await JSZip.loadAsync(bytes)

  // 1. Read and parse project.json
  const jsonFile = zip.file('project.json')
  if (!jsonFile) {
    throw new Error("This doesn't look like a Halftones project file.")
  }

  const jsonText = await jsonFile.async('text')
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    throw new Error("This doesn't look like a Halftones project file.")
  }

  // 2. Migrate to current schema (throws on bad/future versions)
  const migrated = migrateProjectJson(raw)

  // 3. Find source.<ext> entry in the zip root
  const sourceEntry = Object.keys(zip.files).find(
    (name) => /^source\.[^/]+$/.test(name) && !zip.files[name].dir,
  )

  let imageBytes: Uint8Array
  let imageFileName: string

  if (sourceEntry) {
    imageBytes = await zip.files[sourceEntry].async('uint8array')
    // Strip the "source." prefix to recover the original extension,
    // then rebuild the filename using the stored original name.
    // We use migrated.sourceFileName as the authoritative display name.
    imageFileName = migrated.sourceFileName
  } else {
    // Soft failure: missing image — caller shows placeholder and prompts re-import.
    imageBytes = new Uint8Array(0)
    imageFileName = migrated.sourceFileName
  }

  // 4. Find mask.<ext> entry in the zip root (optional — absent in v1 files)
  const maskEntry = Object.keys(zip.files).find(
    (name) => /^mask\.[^/]+$/.test(name) && !zip.files[name].dir,
  )

  let maskData: { bytes: Uint8Array; fileName: string } | undefined
  if (maskEntry && migrated.maskFileName) {
    const maskBytes = await zip.files[maskEntry].async('uint8array')
    maskData = { bytes: maskBytes, fileName: migrated.maskFileName }
  }

  // Merge maskSettings back into the AllSettings object so callers get a
  // unified AllSettings that includes the mask toggle state.
  const settings: AllSettings = {
    ...migrated.settings,
    mask: migrated.maskSettings ?? DEFAULT_MASK_SETTINGS,
  }

  return {
    name: migrated.name,
    settings,
    image: { bytes: imageBytes, fileName: imageFileName },
    mask: maskData,
  }
}
