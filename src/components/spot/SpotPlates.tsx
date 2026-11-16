import { useState, useEffect, useMemo } from 'react'
import { SpotColor, SpotSettings, KeyPlateSettings, DEFAULT_KEY_PLATE, RenderMode } from '../../types'
import { KEY_EDIT_ID } from '../../engine/layer-edits'
import { Note } from '../ui/rows'
import { Segmented } from '../ui/Segmented'
import { PalettePanel } from './PalettePanel'
import { UnderbaseRow } from './UnderbaseRow'
import { InkRow, type MergeOption } from './InkRow'
import { KeyRow } from './KeyRow'
import { SeparationPanel } from './SeparationPanel'

interface Props {
  settings: SpotSettings
  onChange: (settings: SpotSettings) => void
  /** ImageData to extract palette from (the transformed source image). */
  sourceImageData: ImageData | null
  defaultLpi: number
  disabled: boolean
  /** LAB seed colors clicked by the user on the preview canvas. */
  seedColors: Array<[number, number, number]>
  onClearSeeds: () => void
  seedPickingActive: boolean
  onToggleSeedPicking: () => void
  /** Layer edit mode: id of the plate currently being painted, or null. */
  editingColorId: string | null
  onToggleEdit: (colorId: string) => void
  hasEdits: (colorId: string) => boolean
  onClearEdits: (colorId: string) => void
  /** True when edits exist but were painted at a crop/rotation that no longer matches. */
  editsStale: boolean
}

const RENDER_MODES: { value: RenderMode; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'halftone', label: 'Halftone' },
]

/**
 * Spot mode's Plates section: where the inks come from (Palette), every plate
 * in print order (underbase → background → inks → key), then the settings
 * that apply to all of them (Separation, Edges).
 */
export function SpotPlates({
  settings, onChange, sourceImageData, defaultLpi, disabled,
  seedColors, onClearSeeds, seedPickingActive, onToggleSeedPicking,
  editingColorId, onToggleEdit, hasEdits, onClearEdits, editsStale,
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const update = (partial: Partial<SpotSettings>) => onChange({ ...settings, ...partial })

  /** Reorder a layer by drag-and-drop. Background layers always stay pinned
   * to the front; dragging in build-up mode switches to manual print order. */
  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...settings.colors]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    // Background layers are the backdrop — always keep them at the front,
    // preserving the new relative order of everything else.
    const bg = next.filter(c => c.type === 'background')
    const rest = next.filter(c => c.type !== 'background')
    const patch: Partial<SpotSettings> = { colors: [...bg, ...rest] }
    // Dragging in build-up means the user wants their order, not the auto sort.
    if (settings.separationMode === 'buildup') patch.manualOrder = true
    update(patch)
  }

  // Pointer-based drag tracking. While a grip is held, follow the pointer at
  // the window level (so the drag survives leaving the row) and resolve which
  // row is under it via the data-row-idx attribute. Commit on release.
  useEffect(() => {
    if (dragIdx === null) return
    /** Row whose vertical band contains y (nearest one if between/outside). */
    const rowIdxAt = (y: number): number | null => {
      const rows = Array.from(document.querySelectorAll('[data-row-idx]'))
      let best: number | null = null
      let bestDist = Infinity
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        if (dist < bestDist) {
          bestDist = dist
          const n = Number(row.getAttribute('data-row-idx'))
          if (Number.isFinite(n)) best = n
        }
      }
      return best
    }
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      setOverIdx(rowIdxAt(e.clientY))
    }
    const onUp = (e: PointerEvent) => {
      const to = rowIdxAt(e.clientY)
      if (to !== null) reorder(dragIdx, to)
      setDragIdx(null)
      setOverIdx(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  // reorder closes over settings.colors, which is current on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, settings.colors, settings.separationMode])

  const sortLightToDark = () => {
    const bg = settings.colors.filter(c => c.type === 'background')
    const rest = [...settings.colors.filter(c => c.type !== 'background')].sort((a, b) => b.lab[0] - a.lab[0])
    update({ colors: [...bg, ...rest], manualOrder: false })
  }

  const updateKey = (partial: Partial<KeyPlateSettings>) => {
    const current = settings.key ?? { ...DEFAULT_KEY_PLATE, lpi: defaultLpi }
    update({ key: { ...current, ...partial } })
  }

  const updateColor = (id: string, partial: Partial<SpotColor>) => {
    onChange({
      ...settings,
      colors: settings.colors.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })
  }

  const removeColor = (id: string) => {
    update({ colors: settings.colors.filter((c) => c.id !== id) })
  }

  const setAllRenderMode = (mode: RenderMode) => {
    update({ colors: settings.colors.map((c) => ({ ...c, renderMode: mode })) })
  }

  /** True when the source image has any transparent pixels. */
  const hasTransparency = useMemo(() => {
    if (!sourceImageData) return false
    const d = sourceImageData.data
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 128) return true
    }
    return false
  }, [sourceImageData])

  /** Selectable merge targets: enabled, non-background colors, numbered to match their row. */
  const mergeOptions: MergeOption[] = settings.colors
    .map((c, i) => ({ id: c.id, label: `${i + 1}. ${c.name}`, color: c }))
    .filter(o => o.color.enabled && o.color.type !== 'background')

  const allMode: RenderMode | null = settings.colors.length === 0
    ? null
    : settings.colors.every((c) => c.renderMode === 'flat') ? 'flat'
    : settings.colors.every((c) => c.renderMode === 'halftone') ? 'halftone'
    : null

  return (
    <>
      <PalettePanel
        settings={settings}
        update={update}
        sourceImageData={sourceImageData}
        defaultLpi={defaultLpi}
        hasTransparency={hasTransparency}
        disabled={disabled}
        seedColors={seedColors}
        onClearSeeds={onClearSeeds}
        seedPickingActive={seedPickingActive}
        onToggleSeedPicking={onToggleSeedPicking}
      />

      <div className="plate-list-header">
        <span>Print order</span>
        {settings.colors.length > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Set every ink to flat or halftone">
            All
            <Segmented size="sm" fill={false} options={RENDER_MODES} value={allMode} onChange={setAllRenderMode} disabled={disabled} />
          </span>
        )}
      </div>

      <UnderbaseRow
        underbase={settings.underbase}
        onChange={(underbase) => update({ underbase })}
        disabled={disabled}
      />

      {settings.colors.length === 0 && (
        <div style={{ margin: '8px 0 2px' }}>
          <Note>No inks yet — load an image and use Extract palette above.</Note>
        </div>
      )}

      {settings.colors.map((color, idx) => (
        <InkRow
          key={color.id}
          color={color}
          index={idx}
          disabled={disabled}
          globalTrap={settings.trap ?? 0}
          globalSmooth={settings.smoothFlat ?? false}
          allColors={settings.colors}
          mergeOptions={mergeOptions}
          keyEnabled={settings.key?.enabled ?? false}
          keyStrokeEnabled={(settings.key?.enabled && settings.key?.strokeEnabled) ?? false}
          onChange={(partial) => updateColor(color.id, partial)}
          onRemove={() => removeColor(color.id)}
          onGripDown={() => setDragIdx(idx)}
          isDropTarget={overIdx === idx && dragIdx !== null && dragIdx !== idx}
          isDragging={dragIdx === idx}
          isEditing={editingColorId === color.id}
          onToggleEdit={() => onToggleEdit(color.id)}
          hasEdits={hasEdits(color.id)}
          onClearEdits={() => onClearEdits(color.id)}
          editsStale={editsStale}
        />
      ))}

      <KeyRow
        keySettings={settings.key}
        onChange={updateKey}
        colors={settings.colors}
        mergeOptions={mergeOptions}
        hasTransparency={hasTransparency}
        disabled={disabled}
        isEditing={editingColorId === KEY_EDIT_ID}
        onToggleEdit={() => onToggleEdit(KEY_EDIT_ID)}
        hasEdits={hasEdits(KEY_EDIT_ID)}
        onClearEdits={() => onClearEdits(KEY_EDIT_ID)}
        editsStale={editsStale}
      />

      <div style={{ marginTop: 10 }}>
        <SeparationPanel
          settings={settings}
          update={update}
          onSortLightToDark={sortLightToDark}
          disabled={disabled}
        />
      </div>
    </>
  )
}
