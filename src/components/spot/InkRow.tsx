import { useState, useEffect } from 'react'
import { SpotColor } from '../../types'
import { labToHex, rgbToLab, guessColorName, resolveMergeTarget, lastPrintedSpotColor } from '../../engine/spot-separation'
import { EditableValue } from '../EditableValue'
import { SliderRow, ToggleRow, Note } from '../ui/rows'
import { Segmented } from '../ui/Segmented'
import { PlateRowShell } from './PlateRowShell'
import { ClearEditsButton } from './ClearEditsButton'

/** Simple RGB channel-sum distance between two #rrggbb hex colors (0–765). */
function hexDistance(a: string, b: string): number {
  const ra = parseInt(a.slice(1, 3), 16), ga = parseInt(a.slice(3, 5), 16), ba = parseInt(a.slice(5, 7), 16)
  const rb = parseInt(b.slice(1, 3), 16), gb = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16)
  return Math.abs(ra - rb) + Math.abs(ga - gb) + Math.abs(ba - bb)
}

export interface MergeOption { id: string; label: string; color: SpotColor }

interface Props {
  color: SpotColor
  index: number
  disabled: boolean
  globalTrap: number
  globalSmooth: boolean
  /** All spot colors in the settings — needed to resolve this color's merge target. */
  allColors: SpotColor[]
  /** Selectable merge targets (enabled, non-background colors), numbered to match their row. */
  mergeOptions: MergeOption[]
  keyEnabled: boolean
  keyStrokeEnabled: boolean
  onChange: (partial: Partial<SpotColor>) => void
  onRemove: () => void
  /** Drag-to-reorder — the list owns the drag state; the grip reports pointer-down. */
  onGripDown: (clientY: number) => void
  /** True while another row is being dragged over this one — draws a drop indicator. */
  isDropTarget: boolean
  /** True while THIS row is the one being dragged. */
  isDragging: boolean
  /** Layer edit mode — true while this row's plate is the one being painted. */
  isEditing: boolean
  onToggleEdit: () => void
  hasEdits: boolean
  onClearEdits: () => void
  editsStale: boolean
}

/** One spot ink (or the background layer) in the plate list. */
export function InkRow({
  color, index, disabled, globalTrap, globalSmooth, allColors, mergeOptions, keyEnabled, keyStrokeEnabled,
  onChange, onRemove, onGripDown, isDropTarget, isDragging,
  isEditing, onToggleEdit, hasEdits, onClearEdits, editsStale,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [hexDraft, setHexDraft] = useState(color.hex)

  // Sync draft when parent changes hex externally (e.g. reset, merge)
  useEffect(() => { setHexDraft(color.hex) }, [color.hex])

  // The original extracted color (from LAB) — used for the reset button
  const originalHex = labToHex(color.lab)
  const isModified = color.hex.toLowerCase() !== originalHex.toLowerCase()

  const commitHex = (raw: string) => {
    const val = raw.startsWith('#') ? raw : `#${raw}`
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const hex = val.toLowerCase()
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const lab = rgbToLab(r, g, b)
      const name = guessColorName(lab[0], lab[1], lab[2])
      // Update hex and name only — lab stays anchored to the original extracted
      // color so separation boundaries don't shift when the display color changes.
      onChange({ hex, name })
      setHexDraft(hex)
    } else {
      setHexDraft(color.hex)
    }
  }

  // Merge target — folds this plate onto another color's screen instead of its own
  const mergeSel = color.mergeTarget ?? (color.mergeWithDarkest ? 'darkest' : '')
  const mergeResolved = resolveMergeTarget(allColors, color, color.id)
  const rowMergeOptions = mergeOptions.filter((o) => o.id !== color.id)
  const isAutoSentinel = mergeSel === 'darkest' || mergeSel === 'last'
  const lastPrinted = lastPrintedSpotColor(allColors)
  const notLast = !!mergeResolved && !!lastPrinted && mergeResolved.id !== lastPrinted.id

  return (
    <PlateRowShell
      swatch={color.hex}
      name={`${index + 1}. ${color.name}`}
      tag={color.type === 'background' ? 'BG' : undefined}
      badge={isEditing ? '✎ Editing' : color.renderMode === 'flat' ? 'Flat' : 'Halftone'}
      enabled={color.enabled}
      onEnabledChange={(enabled) => onChange({ enabled })}
      enableTitle="Enable this color"
      disabled={disabled}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
      grip="grip"
      onGripDown={onGripDown}
      rowIdx={index}
      isDropTarget={isDropTarget}
      isDragging={isDragging}
    >
      {/* Hex color picker + editable hex input */}
      <div className="control-row control-row--inline">
        <span className="control-row__label">Color</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isModified && !disabled && !color.type && (
            <button
              className="btn--icon"
              onClick={() => { onChange({ hex: originalHex }); setHexDraft(originalHex) }}
              title="Reset to extracted color"
            >↺</button>
          )}
          <input
            type="text"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitHex((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
              if (e.key === 'Escape') { setHexDraft(color.hex); (e.target as HTMLInputElement).blur() }
            }}
            disabled={disabled}
            spellCheck={false}
            maxLength={7}
            placeholder="#000000"
            style={{ width: 76, fontSize: 12, fontFamily: 'monospace', padding: '2px 6px' }}
          />
          <input
            type="color"
            className="swatch-input"
            value={hexDraft}
            onChange={(e) => commitHex(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Render mode */}
      <div className="control-row control-row--inline">
        <span className="control-row__label">Render</span>
        <Segmented
          size="sm" fill={false}
          options={[{ value: 'flat', label: 'Flat' }, { value: 'halftone', label: 'Halftone' }]}
          value={color.renderMode}
          onChange={(renderMode) => onChange({ renderMode })}
          disabled={disabled}
        />
      </div>

      {color.renderMode === 'flat' && (
        <>
          <SliderRow
            label="Threshold" value={color.threshold}
            min={0.1} max={1} step={0.01} percent
            onChange={(v) => onChange({ threshold: v })}
            disabled={disabled}
          />
          {/* Smooth edges override — flat plates only. Build-up halftone-mode
              colors actually halftone (carry tone), so vectorize doesn't apply. */}
          <ToggleRow
            label="Vectorize edges"
            title="Trace this plate's edges into vector outlines. Defaults to the global 'Vectorize flat edges' setting — toggle to override for this color (e.g. keep fine line/hatch art as crisp raster)."
            checked={color.smooth ?? globalSmooth}
            onChange={(smooth) => onChange({ smooth })}
            disabled={disabled}
          />
        </>
      )}

      {color.renderMode === 'halftone' && (
        <>
          <SliderRow
            label="LPI" value={color.lpi}
            min={1} max={100} step={1}
            onChange={(v) => onChange({ lpi: v })}
            disabled={disabled}
          />
          <SliderRow
            label="Angle" value={color.angle}
            min={0} max={180} step={1} suffix="°"
            onChange={(v) => onChange({ angle: v })}
            disabled={disabled}
          />
        </>
      )}

      {/* Bleed — background layers only */}
      {color.type === 'background' && (
        <SliderRow
          label="Bleed"
          title="How far the background plate extends into the margin, as a percentage of the (largest) margin. 100% = out to the trim edge."
          value={Math.round(color.bleedPct ?? 0)}
          min={0} max={100} step={1} suffix="%"
          onChange={(v) => onChange({ bleedPct: v })}
          disabled={disabled}
        />
      )}

      {/* Per-color trap override.  color.trap == null → inherit global. */}
      <div className="control-row" title="Per-color trap override (px). Drag to override the global trap value for this color only.">
        <span>
          <span className="control-row__label">Trap</span>
          <span className="control-row__value">
            {color.trap == null ? (
              <small style={{ color: 'var(--text-secondary)' }}>global: {globalTrap}px</small>
            ) : (
              <>
                <EditableValue
                  value={color.trap}
                  min={0} max={10} step={1} suffix="px"
                  onChange={(v) => onChange({ trap: v })}
                />
                {!disabled && (
                  <button className="btn--icon" onClick={() => onChange({ trap: null })} title="Use global trap value">↺</button>
                )}
              </>
            )}
          </span>
        </span>
        <input
          type="range" min={0} max={10} step={1}
          value={color.trap ?? globalTrap}
          onChange={(e) => onChange({ trap: Number(e.target.value) })}
          disabled={disabled}
        />
      </div>

      <label className="control-row" title="Print this plate on another color's screen (one screen, that color's ink) instead of its own. Use for same-ink plates — e.g. a black background folded into your black layer.">
        <span className="control-row__label">
          Merge into
          {isAutoSentinel && (
            <small>{mergeResolved ? `→ ${mergeResolved.name}` : '(no enabled color)'}</small>
          )}
        </span>
        <select
          value={mergeSel}
          onChange={(e) => onChange({ mergeTarget: e.target.value, mergeWithDarkest: undefined })}
          disabled={disabled}
        >
          <option value="">Don't merge (own screen)</option>
          <option value="last">Last printed color (auto)</option>
          {mergeSel === 'darkest' && <option value="darkest">Darkest color (auto, legacy)</option>}
          {rowMergeOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      {mergeResolved && hexDistance(color.hex, mergeResolved.hex) > 150 && (
        <Note tone="warn">Will print in {mergeResolved.name}'s ink, not its own color</Note>
      )}
      {notLast && mergeResolved && (
        <Note tone="warn">⚠ {mergeResolved.name} isn't printed last; colors after it print over this ink.</Note>
      )}

      {/* Key plate knockout toggles */}
      {keyEnabled && (
        <ToggleRow
          label="Key dots"
          title="Print the key plate's halftone dots over this color. Uncheck to keep this ink clean — key dots are erased wherever this color owns the separation."
          checked={color.keyDots !== false}
          onChange={(keyDots) => onChange({ keyDots })}
          disabled={disabled}
        />
      )}
      {keyStrokeEnabled && (
        <ToggleRow
          label="Key stroke"
          title="Print the key plate's edge stroke over this color. Uncheck to erase the stroke in this color's region."
          checked={color.keyStroke !== false}
          onChange={(keyStroke) => onChange({ keyStroke })}
          disabled={disabled}
        />
      )}

      {/* Layer edit mode — brush paint/erase this plate's ownership directly.
          Not offered for background layers (alpha-derived, not LAB-owned).
          Brush size and paint/erase live on the canvas edit bar. */}
      {color.type !== 'background' && hasEdits && editsStale && (
        <Note tone="warn">
          ⚠ Painted at a different crop/rotation — edits are inactive. Restore the previous crop, or clear them.
        </Note>
      )}

      <div className="plate-row__footer">
        {color.type !== 'background' && (
          <button
            className={`btn btn--small${isEditing ? ' is-active' : ''}`}
            onClick={onToggleEdit}
            disabled={disabled}
            title="Brush paint/erase this color's ownership directly — isolates the plate while editing"
            style={{ marginRight: 'auto' }}
          >
            {isEditing ? '✎ Editing…' : '✎ Edit layer'}
          </button>
        )}
        <button className="btn--small btn--ghost" onClick={onRemove} disabled={disabled}>
          Remove color
        </button>
      </div>

      {color.type !== 'background' && hasEdits && (
        <ClearEditsButton
          label={`Clear all edits on ${color.name}`}
          onConfirm={onClearEdits}
          disabled={disabled}
        />
      )}
    </PlateRowShell>
  )
}
