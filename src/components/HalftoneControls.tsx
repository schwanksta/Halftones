import { HalftoneSettings, PatternType, ColorMode } from '../types'
import { EditableValue } from './EditableValue'

interface Props {
  settings: HalftoneSettings
  onChange: (settings: HalftoneSettings) => void
  disabled: boolean
}

const PATTERNS: { value: PatternType; label: string }[] = [
  { value: 'dot', label: 'Dot' },
  { value: 'euclidean', label: 'Euclidean Dot' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'hex', label: 'Hexagonal' },
  { value: 'line', label: 'Line' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'brick', label: 'Brick' },
  { value: 'radial', label: 'Radial (dots)' },
  { value: 'radial-lines', label: 'Radial (lines)' },
  { value: 'stochastic', label: 'Stochastic (FM)' },
  { value: 'stipple', label: 'Stipple (Poisson)' },
]

export function HalftoneControls({ settings, onChange, disabled }: Props) {
  const update = (partial: Partial<HalftoneSettings>) =>
    onChange({ ...settings, ...partial })

  const noAngle = new Set(['stochastic', 'stipple', 'concentric', 'brick', 'radial', 'radial-lines'])
  const noLpi = new Set(['stochastic'])
  const isStochastic = settings.pattern === 'stochastic'
  const isStipple = settings.pattern === 'stipple'
  const isRadial = settings.pattern === 'radial' || settings.pattern === 'radial-lines'
  const showAngle = !noAngle.has(settings.pattern)
  const showLpi = !noLpi.has(settings.pattern)

  const minDot = settings.minDot ?? 0
  const maxDot = settings.maxDot ?? 1
  const dotGain = settings.dotGain ?? 0
  const dotSize = settings.dotSize ?? 1

  return (
    <div className="control-section">
      <h3 className="section-title">Halftone</h3>

      <label className="control-row">
        <span>Pattern</span>
        <select
          value={settings.pattern}
          onChange={(e) => update({ pattern: e.target.value as PatternType })}
          disabled={disabled}
        >
          {PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      {showLpi && (
        <>
          <label className="control-row">
            <span>
              {isStipple ? 'Density' : 'LPI'}{' '}
              <EditableValue
                value={settings.lpi}
                min={isStipple ? 5 : 1}
                max={isStipple ? 80 : 100}
                step={1}
                suffix={isStipple ? ' dpi' : ''}
                onChange={(v) => update({ lpi: v })}
              />
            </span>
            <input
              type="range"
              min={isStipple ? 5 : 1}
              max={isStipple ? 80 : 100}
              value={settings.lpi}
              onChange={(e) => update({ lpi: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>

          {showAngle && (
            <label className="control-row">
              <span>
                Angle{' '}
                <EditableValue
                  value={settings.angle}
                  min={0} max={180} step={1} suffix="°"
                  onChange={(v) => update({ angle: v })}
                />
              </span>
              <input
                type="range"
                min={0} max={180}
                value={settings.angle}
                onChange={(e) => update({ angle: Number(e.target.value) })}
                disabled={disabled}
              />
            </label>
          )}
        </>
      )}

      {isRadial && (
        <>
          <label className="control-row">
            <span>
              Origin X{' '}
              <EditableValue
                value={Math.round((settings.radialOriginX ?? 0.5) * 100)}
                min={0} max={100} step={1} suffix="%"
                onChange={(v) => update({ radialOriginX: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={1} step={0.01}
              value={settings.radialOriginX ?? 0.5}
              onChange={(e) => update({ radialOriginX: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Origin Y{' '}
              <EditableValue
                value={Math.round((settings.radialOriginY ?? 0.5) * 100)}
                min={0} max={100} step={1} suffix="%"
                onChange={(v) => update({ radialOriginY: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={1} step={0.01}
              value={settings.radialOriginY ?? 0.5}
              onChange={(e) => update({ radialOriginY: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
        </>
      )}

      {!isStochastic && (
        <>
          <div className="subsection-title">Tone &amp; Dots</div>
          <label className="control-row">
            <span>
              Min Dot{' '}
              <EditableValue
                value={Math.round(minDot * 100)}
                min={0} max={50} step={1} suffix="%"
                onChange={(v) => update({ minDot: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={0.5} step={0.01}
              value={minDot}
              onChange={(e) => update({ minDot: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Max Dot{' '}
              <EditableValue
                value={Math.round(maxDot * 100)}
                min={50} max={100} step={1} suffix="%"
                onChange={(v) => update({ maxDot: v / 100 })}
              />
            </span>
            <input
              type="range" min={0.5} max={1} step={0.01}
              value={maxDot}
              onChange={(e) => update({ maxDot: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              {isStipple ? 'Dot Scale' : 'Dot Size'}{' '}
              <EditableValue
                value={Math.round(dotSize * 100)}
                min={isStipple ? 20 : 50}
                max={isStipple ? 400 : 150}
                step={5} suffix="%"
                onChange={(v) => update({ dotSize: v / 100 })}
              />
            </span>
            <input
              type="range"
              min={isStipple ? 0.2 : 0.5}
              max={isStipple ? 4.0 : 1.5}
              step={0.05}
              value={dotSize}
              onChange={(e) => update({ dotSize: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Dot Gain{' '}
              <EditableValue
                value={Math.round(dotGain * 100)}
                min={0} max={40} step={1} suffix="%"
                onChange={(v) => update({ dotGain: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={0.4} step={0.01}
              value={dotGain}
              onChange={(e) => update({ dotGain: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Gamma{' '}
              <EditableValue
                value={settings.halftoneGamma ?? 1}
                min={0.5} max={3} step={0.05} decimals={2}
                onChange={(v) => update({ halftoneGamma: v })}
              />
            </span>
            <input
              type="range" min={0.5} max={3} step={0.05}
              value={settings.halftoneGamma ?? 1}
              onChange={(e) => update({ halftoneGamma: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Shadows{' '}
              <EditableValue
                value={Math.round((settings.shadowBoost ?? 0) * 100)}
                min={0} max={100} step={5} suffix="%"
                onChange={(v) => update({ shadowBoost: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={settings.shadowBoost ?? 0}
              onChange={(e) => update({ shadowBoost: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
          <label className="control-row">
            <span>
              Highlights{' '}
              <EditableValue
                value={Math.round((settings.highlightBoost ?? 0) * 100)}
                min={0} max={100} step={5} suffix="%"
                onChange={(v) => update({ highlightBoost: v / 100 })}
              />
            </span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={settings.highlightBoost ?? 0}
              onChange={(e) => update({ highlightBoost: Number(e.target.value) })}
              disabled={disabled}
            />
          </label>
        </>
      )}

      <div className="subsection-title">Color</div>
      <label className="control-row">
        <span>Color Mode</span>
        <select
          value={settings.colorMode}
          onChange={(e) => update({ colorMode: e.target.value as ColorMode })}
          disabled={disabled}
        >
          <option value="grayscale">Grayscale</option>
          <option value="cmyk">CMYK</option>
          <option value="spot">Spot Color</option>
        </select>
      </label>

      {settings.colorMode !== 'cmyk' && settings.colorMode !== 'spot' && (
        <div className="control-row control-row--colors">
          <span>Colors</span>
          <div className="color-pair">
            <label className="color-swatch-label" title="Ink color">
              <span className="color-swatch-hint">Ink</span>
              <input
                type="color"
                value={settings.fgColor || '#000000'}
                onChange={(e) => update({ fgColor: e.target.value })}
                disabled={disabled}
              />
            </label>
            <label className="color-swatch-label" title="Paper color">
              <span className="color-swatch-hint">Paper</span>
              <input
                type="color"
                value={settings.bgColor || '#ffffff'}
                onChange={(e) => update({ bgColor: e.target.value })}
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      )}

      <label className="control-row control-row--toggle">
        <span>Invert <small style={{ color: 'var(--text-secondary)' }}>(swap ink/paper)</small></span>
        <input
          type="checkbox"
          checked={settings.invert}
          onChange={(e) => update({ invert: e.target.checked })}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
