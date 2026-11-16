import { useState } from 'react'
import { SpotColor, KeyPlateSettings } from '../../types'
import { resolveMergeTarget, lastPrintedSpotColor } from '../../engine/spot-separation'
import { SliderRow, ToggleRow, ColorRow, Note } from '../ui/rows'
import { PlateRowShell } from './PlateRowShell'
import { ClearEditsButton } from './ClearEditsButton'
import type { MergeOption } from './InkRow'

interface Props {
  /** `undefined` for projects that have never had a key plate. */
  keySettings: KeyPlateSettings | undefined
  /** Merges into the current key settings (creating them from defaults if absent). */
  onChange: (partial: Partial<KeyPlateSettings>) => void
  colors: SpotColor[]
  mergeOptions: MergeOption[]
  hasTransparency: boolean
  disabled: boolean
  /** Layer edit mode — true while the key plate is the one being erased. */
  isEditing: boolean
  onToggleEdit: () => void
  hasEdits: boolean
  onClearEdits: () => void
  editsStale: boolean
}

/**
 * The key plate: a halftone of the full image over all colors. Always last in
 * the plate list (dimmed while off) because it prints last.
 */
export function KeyRow({
  keySettings, onChange, colors, mergeOptions, hasTransparency, disabled,
  isEditing, onToggleEdit, hasEdits, onClearEdits, editsStale,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const enabled = keySettings?.enabled ?? false

  const mergeSel = keySettings ? (keySettings.mergeTarget ?? (keySettings.mergeWithDarkest ? 'darkest' : '')) : ''
  const mergeResolved = (keySettings && enabled ? resolveMergeTarget(colors, keySettings) : null) ?? undefined

  return (
    <PlateRowShell
      swatch={mergeResolved?.hex ?? keySettings?.color ?? '#000000'}
      name="Key"
      badge={isEditing ? '✎ Editing' : mergeResolved ? `→ ${mergeResolved.name}` : 'Prints last'}
      enabled={enabled}
      onEnabledChange={(next) => {
        onChange({ enabled: next })
        if (next) setExpanded(true)
      }}
      enableTitle="Key plate — a halftone of the whole image printed over all colors"
      disabled={disabled}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
      grip="spacer"
    >
      {(!keySettings || !enabled) ? (
        <Note>A halftone of the whole image printed over all colors, for tonal depth and detail. Tick the box to add it.</Note>
      ) : (
        <KeyBody
          keySettings={keySettings}
          onChange={onChange}
          colors={colors}
          mergeOptions={mergeOptions}
          mergeSel={mergeSel}
          mergeResolved={mergeResolved}
          hasTransparency={hasTransparency}
          disabled={disabled}
          isEditing={isEditing}
          onToggleEdit={onToggleEdit}
          hasEdits={hasEdits}
          onClearEdits={onClearEdits}
          editsStale={editsStale}
        />
      )}
    </PlateRowShell>
  )
}

function KeyBody({
  keySettings, onChange, colors, mergeOptions, mergeSel, mergeResolved, hasTransparency, disabled,
  isEditing, onToggleEdit, hasEdits, onClearEdits, editsStale,
}: Omit<Props, 'keySettings'> & {
  keySettings: KeyPlateSettings
  mergeSel: string
  mergeResolved: SpotColor | undefined
}) {
  const dotsOff = keySettings.dotsEnabled === false

  const isAutoSentinel = mergeSel === 'darkest' || mergeSel === 'last'
  const lastPrinted = lastPrintedSpotColor(colors)
  const notLast = !!mergeResolved && !!lastPrinted && mergeResolved.id !== lastPrinted.id
  // Colors printed after the resolved target — if all of them already
  // knock the key out, nothing gets buried and the warning is moot.
  const printedOrder = colors.filter(c => c.enabled && c.type !== 'background')
  const targetIdx = mergeResolved ? printedOrder.findIndex(c => c.id === mergeResolved.id) : -1
  const afterTarget = targetIdx >= 0 ? printedOrder.slice(targetIdx + 1) : []
  const suppressWarning = afterTarget.length > 0 && afterTarget.every(c => c.keyDots === false && c.keyStroke === false)
  const showWarning = notLast && !suppressWarning

  return (
    <>
      <label className="control-row" title="Print the key plate on another color's screen (one screen, that color's ink) instead of its own. Useful when the key is meant to print in the same ink as one of your separation colors.">
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
          {mergeOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
      {showWarning && mergeResolved && (
        <Note tone="warn">
          ⚠ Colors printed after {mergeResolved.name} will cover the key detail — drag {mergeResolved.name} last to fix.
        </Note>
      )}

      <ColorRow
        label="Ink"
        title={mergeResolved ? `Unused while merged — uses ${mergeResolved.name}'s ink` : 'Key plate ink color'}
        value={keySettings.color}
        onChange={(color) => onChange({ color })}
        disabled={disabled || !!mergeResolved}
        dimmed={!!mergeResolved}
      />

      <ToggleRow
        label="Halftone dots"
        checked={!dotsOff}
        onChange={(dotsEnabled) => onChange({ dotsEnabled })}
        disabled={disabled}
      />
      <SliderRow
        label="LPI" value={keySettings.lpi}
        min={1} max={100} step={1}
        onChange={(v) => onChange({ lpi: v })}
        disabled={disabled || dotsOff} dimmed={dotsOff}
      />
      <SliderRow
        label="Angle" value={keySettings.angle}
        min={0} max={180} step={1} suffix="°"
        onChange={(v) => onChange({ angle: v })}
        disabled={disabled || dotsOff} dimmed={dotsOff}
      />
      <SliderRow
        label="Min Dot" value={keySettings.minDot}
        min={0} max={0.5} step={0.01} percent
        onChange={(v) => onChange({ minDot: v })}
        disabled={disabled || dotsOff} dimmed={dotsOff}
      />
      <SliderRow
        label="Max Dot" value={keySettings.maxDot}
        min={0.5} max={1} step={0.01} percent
        onChange={(v) => onChange({ maxDot: v })}
        disabled={disabled || dotsOff} dimmed={dotsOff}
      />

      {/* Edge stroke */}
      <ToggleRow
        label="Edge stroke"
        title="Overlay Sobel edge detection lines on the key plate halftone — adds hard drawn-looking contours at tonal transitions"
        checked={keySettings.strokeEnabled ?? false}
        onChange={(strokeEnabled) => onChange({ strokeEnabled })}
        disabled={disabled}
      />
      {keySettings.strokeEnabled && (
        <>
          <SliderRow
            label="Stroke threshold"
            title="Gradient magnitude threshold — lower detects more/finer edges, higher detects only strong edges"
            value={keySettings.strokeThreshold ?? 0.3}
            min={0.01} max={1} step={0.01} percent
            onChange={(v) => onChange({ strokeThreshold: v })}
            disabled={disabled}
          />
          <SliderRow
            label="Stroke width"
            title="Edge line width in output pixels"
            value={keySettings.strokeWidth ?? 2}
            min={1} max={10} step={1} suffix="px"
            onChange={(v) => onChange({ strokeWidth: v })}
            disabled={disabled}
          />
        </>
      )}

      {/* Silhouette outline (alpha boundary) */}
      <ToggleRow
        label={<>Outline{hasTransparency ? '' : <small>(needs transparency)</small>}</>}
        title="Solid outline ring traced around the subject's alpha-channel silhouette — clean crisp border, no internal edges"
        checked={keySettings.outlineEnabled ?? false}
        onChange={(outlineEnabled) => onChange({ outlineEnabled })}
        disabled={disabled || !hasTransparency}
      />
      {keySettings.outlineEnabled && hasTransparency && (
        <SliderRow
          label="Outline width"
          title="Outline width in output pixels — how far the stroke extends from the silhouette edge"
          value={keySettings.outlineWidth ?? 3}
          min={1} max={20} step={1} suffix="px"
          onChange={(v) => onChange({ outlineWidth: v })}
          disabled={disabled}
        />
      )}

      {hasEdits && editsStale && (
        <Note tone="warn">
          ⚠ Painted at a different crop/rotation — edits are inactive. Restore the previous crop, or clear them.
        </Note>
      )}

      {/* Key plate erase brush — the key has no ownership to paint, so unlike
          per-color layer edit this is erase-only: one brush wipes dots, stroke,
          and outline uniformly wherever painted. Brush size is on the canvas. */}
      <div className="plate-row__footer">
        <button
          className={`btn btn--small${isEditing ? ' is-active' : ''}`}
          onClick={onToggleEdit}
          disabled={disabled}
          title="Brush erase on the key plate — isolates the plate while editing"
          style={{ marginRight: 'auto' }}
        >
          {isEditing ? '✎ Editing…' : '✎ Erase on key plate'}
        </button>
      </div>

      {hasEdits && (
        <ClearEditsButton
          label="Clear all key plate erasing"
          onConfirm={onClearEdits}
          disabled={disabled}
        />
      )}
    </>
  )
}
