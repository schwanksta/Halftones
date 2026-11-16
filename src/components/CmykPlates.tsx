import { useState } from 'react'
import { CMYKSettings, CMYKChannel, ChannelSettings } from '../types'
import { SliderRow } from './ui/rows'
import { PlateRowShell } from './spot/PlateRowShell'

interface Props {
  settings: CMYKSettings
  onChange: (settings: CMYKSettings) => void
  disabled: boolean
}

const CHANNELS: { key: CMYKChannel; label: string; color: string }[] = [
  { key: 'c', label: 'Cyan',    color: '#00bcd4' },
  { key: 'm', label: 'Magenta', color: '#e91e63' },
  { key: 'y', label: 'Yellow',  color: '#ffc107' },
  { key: 'k', label: 'Black',   color: '#666' },
]

/** The four process plates: enable, screen angle and LPI for each. */
export function CmykPlates({ settings, onChange, disabled }: Props) {
  return (
    <>
      {CHANNELS.map(({ key, label, color }) => (
        <ChannelRow
          key={key}
          label={label}
          color={color}
          channel={settings[key]}
          onChange={(partial) => onChange({ ...settings, [key]: { ...settings[key], ...partial } })}
          disabled={disabled}
        />
      ))}
    </>
  )
}

function ChannelRow({ label, color, channel, onChange, disabled }: {
  label: string
  color: string
  channel: ChannelSettings
  onChange: (partial: Partial<ChannelSettings>) => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const off = disabled || !channel.enabled
  return (
    <PlateRowShell
      swatch={color}
      name={label}
      badge={`${channel.angle}° · ${channel.lpi} LPI`}
      enabled={channel.enabled}
      onEnabledChange={(enabled) => onChange({ enabled })}
      enableTitle="Print this channel"
      disabled={disabled}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
    >
      <SliderRow
        label="Angle" value={channel.angle}
        min={0} max={180} step={1} suffix="°"
        onChange={(v) => onChange({ angle: v })}
        disabled={off}
      />
      <SliderRow
        label="LPI" value={channel.lpi}
        min={10} max={100} step={1}
        onChange={(v) => onChange({ lpi: v })}
        disabled={off}
      />
    </PlateRowShell>
  )
}
