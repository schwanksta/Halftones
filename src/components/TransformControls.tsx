import { ImageTransformSettings } from '../types'
import { EditableValue } from './EditableValue'

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
      blur: 0, sharpen: 0, sharpenRadius: 1.5, noise: 0,
    })

  const blur         = settings.blur         ?? 0
  const sharpen      = settings.sharpen      ?? 0
  const sharpenRadius = settings.sharpenRadius ?? 1.5
  const noise        = settings.noise        ?? 0

  const hasCrop = settings.cropLeft > 0 || settings.cropRight > 0 || settings.cropTop > 0 || settings.cropBottom > 0
  const hasRotation = settings.rotation !== 0
  const hasLevels = settings.blackPoint !== 0 || settings.whitePoint !== 255 || settings.gamma !== 1.0
  const hasProcessing = blur > 0 || sharpen > 0 || noise > 0
  const hasAny = hasCrop || hasRotation || hasLevels || hasProcessing

  return (
    <div className="control-section">
      <div className="section-header">
        <h3 className="section-title">Transform</h3>
        {hasAny && (
          <button className="reset-btn" onClick={reset} disabled={disabled}>Reset</button>
        )}
      </div>

      <label className="control-row">
        <span>
          Rotation{' '}
          <EditableValue
            value={settings.rotation}
            min={-180} max={180} step={0.5} suffix="°"
            decimals={1}
            onChange={(v) => update({ rotation: v })}
          />
        </span>
        <input
          type="range" min={-180} max={180} step={0.5}
          value={settings.rotation}
          onChange={(e) => update({ rotation: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>

      <div className="subsection-title">Crop (%)</div>
      <div className="crop-grid">
        {([
          ['Left',   'cropLeft',   1 - settings.cropRight  - 0.01],
          ['Right',  'cropRight',  1 - settings.cropLeft   - 0.01],
          ['Top',    'cropTop',    1 - settings.cropBottom - 0.01],
          ['Bottom', 'cropBottom', 1 - settings.cropTop    - 0.01],
        ] as const).map(([label, key, maxFrac]) => (
          <label key={key} className="control-row">
            <span>
              {label}{' '}
              <EditableValue
                value={Math.round(settings[key] * 100)}
                min={0} max={Math.floor(maxFrac * 100)} step={1} suffix="%"
                onChange={(v) => update({ [key]: Math.min(v / 100, maxFrac) } as Partial<ImageTransformSettings>)}
              />
            </span>
            <input
              type="range" min={0} max={maxFrac} step={0.005}
              value={settings[key]}
              onChange={(e) => update({ [key]: Number(e.target.value) } as Partial<ImageTransformSettings>)}
              disabled={disabled}
            />
          </label>
        ))}
      </div>

      <div className="subsection-title">Levels</div>
      <label className="control-row">
        <span>
          Black pt{' '}
          <EditableValue
            value={settings.blackPoint}
            min={0} max={254} step={1}
            onChange={(v) => update({ blackPoint: Math.min(v, settings.whitePoint - 1) })}
          />
        </span>
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
        <span>
          White pt{' '}
          <EditableValue
            value={settings.whitePoint}
            min={1} max={255} step={1}
            onChange={(v) => update({ whitePoint: Math.max(v, settings.blackPoint + 1) })}
          />
        </span>
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
        <span>
          Midtones{' '}
          <EditableValue
            value={settings.gamma}
            min={0.25} max={4.0} step={0.01} decimals={2}
            onChange={(v) => update({ gamma: v })}
          />
        </span>
        <input
          type="range" min={0.25} max={4.0} step={0.01}
          value={settings.gamma}
          onChange={(e) => update({ gamma: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>

      <div className="subsection-title">Processing</div>
      <label className="control-row">
        <span>
          Blur{' '}
          <EditableValue
            value={blur}
            min={0} max={10} step={0.5} decimals={1}
            onChange={(v) => update({ blur: v })}
          />
        </span>
        <input
          type="range" min={0} max={10} step={0.5}
          value={blur}
          onChange={(e) => update({ blur: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>
      <label className="control-row">
        <span>
          Sharpen{' '}
          <EditableValue
            value={sharpen}
            min={0} max={2} step={0.05} decimals={2}
            onChange={(v) => update({ sharpen: v })}
          />
        </span>
        <input
          type="range" min={0} max={2} step={0.05}
          value={sharpen}
          onChange={(e) => update({ sharpen: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>
      {sharpen > 0 && (
        <label className="control-row">
          <span>
            Sharpen radius{' '}
            <EditableValue
              value={sharpenRadius}
              min={0.5} max={5} step={0.5} decimals={1}
              onChange={(v) => update({ sharpenRadius: v })}
            />
          </span>
          <input
            type="range" min={0.5} max={5} step={0.5}
            value={sharpenRadius}
            onChange={(e) => update({ sharpenRadius: Number(e.target.value) })}
            disabled={disabled}
          />
        </label>
      )}
      <label className="control-row">
        <span>
          Noise{' '}
          <EditableValue
            value={noise}
            min={0} max={50} step={1}
            onChange={(v) => update({ noise: v })}
          />
        </span>
        <input
          type="range" min={0} max={50} step={1}
          value={noise}
          onChange={(e) => update({ noise: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
