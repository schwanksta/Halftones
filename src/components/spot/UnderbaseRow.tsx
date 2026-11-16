import { useState } from 'react'
import { UnderbaseSettings, DEFAULT_UNDERBASE } from '../../types'
import { SliderRow, ColorRow, Note } from '../ui/rows'
import { PlateRowShell } from './PlateRowShell'

interface Props {
  /** `undefined` for projects that have never had an underbase. */
  underbase: UnderbaseSettings | undefined
  onChange: (underbase: UnderbaseSettings) => void
  disabled: boolean
}

/**
 * The underbase plate: union of all inked area, choked inward, printed first.
 * Always first in the plate list (dimmed while off) because it always prints first.
 */
export function UnderbaseRow({ underbase, onChange, disabled }: Props) {
  const [expanded, setExpanded] = useState(false)
  const current: UnderbaseSettings = { ...DEFAULT_UNDERBASE, ...underbase }
  const off = disabled || !current.enabled
  const update = (partial: Partial<UnderbaseSettings>) => onChange({ ...current, ...partial })

  return (
    <PlateRowShell
      swatch={current.color}
      name="Underbase"
      badge="Prints first"
      enabled={current.enabled}
      onEnabledChange={(enabled) => {
        update({ enabled })
        if (enabled) setExpanded(true)
      }}
      enableTitle="Generate a base plate (union of all inked area, choked inward) printed first — e.g. white or silver under the whole design."
      disabled={disabled}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
      grip="spacer"
    >
      {!current.enabled && (
        <Note>A base plate under the whole design — e.g. white or silver on dark stock. Tick the box to add it.</Note>
      )}
      <ColorRow
        label="Base ink"
        value={current.color}
        onChange={(color) => update({ color })}
        disabled={off}
        dimmed={!current.enabled}
      />
      <SliderRow
        label="Choke"
        title="Pull the underbase inward from the print edge so it doesn't peek out past the colors."
        value={Math.round(current.chokeInches * 100) / 100}
        min={0} max={0.2} step={0.01} suffix={'"'}
        onChange={(chokeInches) => update({ chokeInches })}
        disabled={off}
        dimmed={!current.enabled}
      />
    </PlateRowShell>
  )
}
