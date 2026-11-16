import { HalftoneSettings, PatternType } from '../types'
import { Section, Group } from './ui/Section'
import { SliderRow, ToggleRow, SelectRow, Note } from './ui/rows'

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

const NO_ANGLE = new Set<PatternType>(['stochastic', 'stipple', 'concentric', 'brick', 'radial', 'radial-lines'])

/** The halftone itself: pattern, frequency, dot shape and tone curve. */
export function ScreenSection({ settings, onChange, disabled }: Props) {
  const update = (partial: Partial<HalftoneSettings>) => onChange({ ...settings, ...partial })

  const mode = settings.colorMode
  const isStochastic = settings.pattern === 'stochastic'
  const isStipple = settings.pattern === 'stipple'
  const isRadial = settings.pattern === 'radial' || settings.pattern === 'radial-lines'
  const patternHasLpi = !isStochastic
  const patternHasAngle = !NO_ANGLE.has(settings.pattern)

  // CMYK channels and spot inks each carry their own LPI and angle, which
  // override these — so only show what actually does something in this mode.
  // In spot mode the LPI still seeds newly extracted inks and the key plate.
  const showLpi = patternHasLpi && mode !== 'cmyk'
  const showAngle = patternHasLpi && patternHasAngle && mode === 'grayscale'

  const minDot = settings.minDot ?? 0
  const maxDot = settings.maxDot ?? 1
  const dotGain = settings.dotGain ?? 0
  const dotSize = settings.dotSize ?? 1
  const gamma = settings.halftoneGamma ?? 1
  const shadows = settings.shadowBoost ?? 0
  const highlights = settings.highlightBoost ?? 0
  const curveTouched = gamma !== 1 || shadows > 0 || highlights > 0

  const lpiLabel = mode === 'spot'
    ? (isStipple ? 'Default density' : 'Default LPI')
    : (isStipple ? 'Density' : 'LPI')

  return (
    <Section id="screen" title="Screen">
      <SelectRow
        label="Pattern"
        value={settings.pattern}
        options={PATTERNS}
        onChange={(v) => update({ pattern: v })}
        disabled={disabled}
      />

      {showLpi && (
        <SliderRow
          label={lpiLabel}
          title={mode === 'spot' ? 'Starting LPI for newly extracted inks and the key plate. Each plate has its own LPI in Plates.' : undefined}
          value={settings.lpi}
          min={isStipple ? 5 : 1} max={isStipple ? 80 : 100} step={1}
          suffix={isStipple ? ' dpi' : ''}
          onChange={(v) => update({ lpi: v })}
          disabled={disabled}
        />
      )}

      {showAngle && (
        <SliderRow
          label="Angle" value={settings.angle}
          min={0} max={180} step={1} suffix="°"
          onChange={(v) => update({ angle: v })}
          disabled={disabled}
        />
      )}

      {patternHasLpi && mode === 'cmyk' && (
        <Note>LPI and angle are set per channel in Plates.</Note>
      )}
      {patternHasLpi && patternHasAngle && mode === 'spot' && (
        <Note>Each ink has its own LPI and angle in Plates.</Note>
      )}

      {isRadial && (
        <>
          <SliderRow
            label="Origin X" value={settings.radialOriginX ?? 0.5}
            min={0} max={1} step={0.01} percent
            onChange={(v) => update({ radialOriginX: v })}
            disabled={disabled}
          />
          <SliderRow
            label="Origin Y" value={settings.radialOriginY ?? 0.5}
            min={0} max={1} step={0.01} percent
            onChange={(v) => update({ radialOriginY: v })}
            disabled={disabled}
          />
        </>
      )}

      {!isStochastic && (
        <>
          <Group id="screen.dots" title="Dot shape" defaultOpen>
            <SliderRow
              label="Min Dot" value={minDot}
              min={0} max={0.5} step={0.01} percent
              onChange={(v) => update({ minDot: v })}
              disabled={disabled}
            />
            <SliderRow
              label="Max Dot" value={maxDot}
              min={0.5} max={1} step={0.01} percent
              onChange={(v) => update({ maxDot: v })}
              disabled={disabled}
            />
            <SliderRow
              label={isStipple ? 'Dot Scale' : 'Dot Size'} value={dotSize}
              min={isStipple ? 0.2 : 0.5} max={isStipple ? 4.0 : 1.5} step={0.05} percent
              onChange={(v) => update({ dotSize: v })}
              disabled={disabled}
            />
            <SliderRow
              label="Dot Gain" value={dotGain}
              min={0} max={0.4} step={0.01} percent
              onChange={(v) => update({ dotGain: v })}
              disabled={disabled}
            />
          </Group>

          <Group id="screen.curve" title="Tone curve" summary={curveTouched ? 'Adjusted' : undefined}>
            <SliderRow
              label="Gamma" value={gamma}
              min={0.5} max={3} step={0.05} decimals={2}
              onChange={(v) => update({ halftoneGamma: v })}
              disabled={disabled}
            />
            <SliderRow
              label="Shadows" value={shadows}
              min={0} max={1} step={0.05} percent
              onChange={(v) => update({ shadowBoost: v })}
              disabled={disabled}
            />
            <SliderRow
              label="Highlights" value={highlights}
              min={0} max={1} step={0.05} percent
              onChange={(v) => update({ highlightBoost: v })}
              disabled={disabled}
            />
          </Group>
        </>
      )}

      <ToggleRow
        label={<>Invert <small>(swap ink/paper)</small></>}
        checked={settings.invert}
        onChange={(v) => update({ invert: v })}
        disabled={disabled}
      />
    </Section>
  )
}
