import { ImageTransformSettings } from '../types'

interface Props {
  settings: ImageTransformSettings
  onChange: (settings: ImageTransformSettings) => void
  disabled: boolean
}

export function TransformControls({ settings, onChange, disabled }: Props) {
  const update = (partial: Partial<ImageTransformSettings>) =>
    onChange({ ...settings, ...partial })

  const reset = () =>
    onChange({
      cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      rotation: 0,
      blackPoint: 0, whitePoint: 255, gamma: 1.0,
    })

  const hasCrop = settings.cropLeft > 0 || settings.cropRight > 0 || settings.cropTop > 0 || settings.cropBottom > 0
  const hasRotation = settings.rotation !== 0
  const hasLevels = settings.blackPoint !== 0 || settings.whitePoint !== 255 || settings.gamma !== 1.0
  const hasAny = hasCrop || hasRotation || hasLevels

  return (
    <div className="control-section">
      <div className="section-header">
        <h3 className="section-title">Transform</h3>
        {hasAny && (
          <button className="reset-btn" onClick={reset} disabled={disabled}>
            Reset
          </button>
        )}
      </div>

      <label className="control-row">
        <span>Rotation <strong>{settings.rotation}°</strong></span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="range"
            min={-180}
            max={180}
            step={0.5}
            value={settings.rotation}
            onChange={(e) => update({ rotation: Number(e.target.value) })}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={-180}
            max={180}
            step={1}
            value={settings.rotation}
            onChange={(e) => update({ rotation: Number(e.target.value) })}
            disabled={disabled}
            style={{ width: 48 }}
          />
        </div>
      </label>

      <div className="subsection-title">Crop (%)</div>
      <div className="crop-grid">
        <label className="control-row">
          <span>Left <strong>{Math.round(settings.cropLeft * 100)}%</strong></span>
          <input
            type="range" min={0} max={0.49} step={0.005}
            value={settings.cropLeft}
            onChange={(e) => update({ cropLeft: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
        <label className="control-row">
          <span>Right <strong>{Math.round(settings.cropRight * 100)}%</strong></span>
          <input
            type="range" min={0} max={0.49} step={0.005}
            value={settings.cropRight}
            onChange={(e) => update({ cropRight: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
        <label className="control-row">
          <span>Top <strong>{Math.round(settings.cropTop * 100)}%</strong></span>
          <input
            type="range" min={0} max={0.49} step={0.005}
            value={settings.cropTop}
            onChange={(e) => update({ cropTop: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
        <label className="control-row">
          <span>Bottom <strong>{Math.round(settings.cropBottom * 100)}%</strong></span>
          <input
            type="range" min={0} max={0.49} step={0.005}
            value={settings.cropBottom}
            onChange={(e) => update({ cropBottom: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="subsection-title">Levels</div>
      <label className="control-row">
        <span>Black pt <strong>{settings.blackPoint}</strong></span>
        <input
          type="range" min={0} max={254} step={1}
          value={settings.blackPoint}
          onChange={(e) => {
            const v = Number(e.target.value)
            update({ blackPoint: Math.min(v, settings.whitePoint - 1) })
          }}
          disabled={disabled}
        />
      </label>
      <label className="control-row">
        <span>White pt <strong>{settings.whitePoint}</strong></span>
        <input
          type="range" min={1} max={255} step={1}
          value={settings.whitePoint}
          onChange={(e) => {
            const v = Number(e.target.value)
            update({ whitePoint: Math.max(v, settings.blackPoint + 1) })
          }}
          disabled={disabled}
        />
      </label>
      <label className="control-row">
        <span>Midtones <strong>{settings.gamma.toFixed(2)}</strong></span>
        <input
          type="range" min={0.25} max={4.0} step={0.01}
          value={settings.gamma}
          onChange={(e) => update({ gamma: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
