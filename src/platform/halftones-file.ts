import JSZip from 'jszip'
import { ProjectFile, AllSettings } from './types'

const CURRENT_SCHEMA_VERSION = 1

interface ProjectJsonV1 {
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  name: string
  sourceFileName: string
  settings: AllSettings
}

const RECOGNIZED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

function getImageExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return 'png'
  const ext = lower.slice(dotIdx + 1)
  return RECOGNIZED_EXTENSIONS.has(ext) ? ext : 'png'
}

/**
 * Migrates a raw parsed project.json object up to the current schema version.
 * Structure: a switch on schemaVersion that increments until reaching CURRENT_SCHEMA_VERSION.
 * To add a migration, insert a new case before the default and chain it forward.
 */
export function migrateProjectJson(raw: unknown): ProjectJsonV1 {
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
      // Already at current version — cast and return.
      return data as ProjectJsonV1
    default:
      throw new Error(`Unknown schema version: ${data.schemaVersion}`)
  }
}

/**
 * Packs a ProjectFile into a .halftones zip archive (Uint8Array).
 * Contents:
 *   project.json  — ProjectJsonV1 serialized with 2-space indent
 *   source.<ext>  — raw image bytes
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

  const projectJson: ProjectJsonV1 = {
    schemaVersion: 1,
    createdAt,
    updatedAt,
    name: project.name,
    sourceFileName: project.image.fileName,
    settings: project.settings,
  }

  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(projectJson, null, 2))
  zip.file(sourceEntry, project.image.bytes)

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

  return {
    name: migrated.name,
    settings: migrated.settings,
    image: { bytes: imageBytes, fileName: imageFileName },
  }
}
