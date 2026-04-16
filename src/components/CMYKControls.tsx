import { CMYKSettings, CMYKChannel, ChannelView } from '../types'
import { EditableValue } from './EditableValue'

interface Props {
  settings: CMYKSettings
  channelView: ChannelView
  onSettingsChange: (settings: CMYKSettings) => void
  onChannelViewChange: (view: ChannelView) => void
  disabled: boolean
}

const CHANNELS: { key: CMYKChannel; label: string; color: string }[] = [
  { key: 'c', label: 'Cyan',    color: '#00bcd4' },
  { key: 'm', label: 'Magenta', color: '#e91e63' },
  { key: 'y', label: 'Yellow',  color: '#ffc107' },
  { key: 'k', label: 'Black',   color: '#666' },
]

export function CMYKControls({ settings, channelView, onSettingsChange, onChannelViewChange, disabled }: Props) {
  const updateChannel = (ch: CMYKChannel, partial: Partial<typeof settings.c>) => {
    onSettingsChange({ ...settings, [ch]: { ...settings[ch], ...partial } })
  }

  return (
    <div className="control-section">
      <h3 className="section-title">CMYK Channels</h3>

      <div className="channel-tabs">
        <button
          className={`channel-tab ${channelView === 'composite' ? 'active' : ''}`}
          onClick={() => onChannelViewChange('composite')}
        >
          All
        </button>
        {CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            className={`channel-tab ${channelView === key ? 'active' : ''}`}
            style={{ borderColor: channelView === key ? CHANNELS.find(c => c.key === key)!.color : undefined }}
            onClick={() => onChannelViewChange(key)}
          >
            {label[0]}
          </button>
        ))}
      </div>

      {CHANNELS.map(({ key, label, color }) => (
        <div key={key} className="channel-controls" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8 }}>
          <label className="control-row">
            <span>
              <input
                type="checkbox"
                checked={settings[key].enabled}
                onChange={(e) => updateChannel(key, { enabled: e.target.checked })}
                disabled={disabled}
              />
              {' '}{label}
            </span>
          </label>
          <label className="control-row">
            <span>
              Angle{' '}
              <EditableValue
                value={settings[key].angle}
                min={0} max={180} step={1} suffix="°"
                onChange={(v) => updateChannel(key, { angle: v })}
              />
            </span>
            <input
              type="range" min={0} max={180}
              value={settings[key].angle}
              onChange={(e) => updateChannel(key, { angle: Number(e.target.value) })}
              disabled={disabled || !settings[key].enabled}
            />
          </label>
          <label className="control-row">
            <span>
              LPI{' '}
              <EditableValue
                value={settings[key].lpi}
                min={10} max={100} step={1}
                onChange={(v) => updateChannel(key, { lpi: v })}
              />
            </span>
            <input
              type="range" min={10} max={100}
              value={settings[key].lpi}
              onChange={(e) => updateChannel(key, { lpi: Number(e.target.value) })}
              disabled={disabled || !settings[key].enabled}
            />
          </label>
        </div>
      ))}
    </div>
  )
}
