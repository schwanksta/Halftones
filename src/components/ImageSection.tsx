import { ImageTransformSettings, MaskSettings, MaskImage, OutputSettings, DEFAULT_TRANSFORM_SETTINGS } from '../types'
import { Section, Group } from './ui/Section'
import { SliderRow, Note } from './ui/rows'
import { MaskControls } from './MaskControls'

interface Props {
  settings: ImageTransformSettings
  onChange: (settings: ImageTransformSettings) => void
  maskSettings: MaskSettings
  mask: MaskImage | null
  outputSettings: OutputSettings
  onMaskSettingsChange: (s: MaskSettings) => void
  onMaskLoad: (m: MaskImage) => void
  onMaskClear: () => void
  disabled: boolean
}

const CROP_SIDES = [
  ['Left', 'cropLeft', 'cropRight'],
  ['Right', 'cropRight', 'cropLeft'],
  ['Top', 'cropTop', 'cropBottom'],
  ['Bottom', 'cropBottom', 'cropTop'],
] as const

/** Everything that changes the picture before it is screened. */
export function ImageSection({
  settings, onChange, maskSettings, mask, outputSettings,
  onMaskSettingsChange, onMaskLoad, onMaskClear, disabled,
}: Props) {
  const update = (partial: Partial<ImageTransformSettings>) => onChange({ ...settings, ...partial })

  const reset = () => onChange({ ...DEFAULT_TRANSFORM_SETTINGS })

  const blur = settings.blur ?? 0
  const sharpen = settings.sharpen ?? 0
  const sharpenRadius = settings.sharpenRadius ?? 1.5
  const noise = settings.noise ?? 0

  const hasCrop = settings.cropLeft > 0 || settings.cropRight > 0 || settings.cropTop > 0 || settings.cropBottom > 0
  const hasRotation = settings.rotation !== 0
  const hasLevels = settings.blackPoint !== 0 || settings.whitePoint !== 255 || settings.gamma !== 1.0
  const hasProcessing = blur > 0 || sharpen > 0 || noise > 0
  const hasAny = hasCrop || hasRotation || hasLevels || hasProcessing

  const pct = (frac: number) => `${Math.round(frac * 100)}%`
  const cropSummary = hasCrop
    ? `L ${pct(settings.cropLeft)} · R ${pct(settings.cropRight)} · T ${pct(settings.cropTop)} · B ${pct(settings.cropBottom)}`
    : 'None'

  return (
    <Section
      id="image"
      title="Image"
      defaultOpen={false}
      action={hasAny && (
        <button className="reset-btn" onClick={reset} disabled={disabled} title="Reset rotation, crop, levels and clean-up">
          Reset
        </button>
      )}
    >
      <SliderRow
        label="Rotation" value={settings.rotation}
        min={-180} max={180} step={0.5} decimals={1} suffix="°"
        onChange={(v) => update({ rotation: v })}
        disabled={disabled}
      />

      <Group id="image.crop" title="Crop" summary={cropSummary}>
        <Note>Drag the handles on the image edges, or set exact values here.</Note>
        {CROP_SIDES.map(([label, key, opposite]) => {
          const maxFrac = 1 - settings[opposite] - 0.01
          return (
            <SliderRow
              key={key}
              label={label}
              value={Math.round(settings[key] * 100)}
              min={0} max={Math.floor(maxFrac * 100)} step={1} suffix="%"
              onChange={(v) => update({ [key]: Math.min(v / 100, maxFrac) } as Partial<ImageTransformSettings>)}
              slider={{
                min: 0, max: maxFrac, step: 0.005,
                value: settings[key],
                onChange: (v) => update({ [key]: v } as Partial<ImageTransformSettings>),
              }}
              disabled={disabled}
            />
          )
        })}
      </Group>

      <Group id="image.levels" title="Levels" summary={hasLevels ? 'Adjusted' : undefined} defaultOpen>
        <SliderRow
          label="Black pt" value={settings.blackPoint}
          min={0} max={254} step={1}
          onChange={(v) => update({ blackPoint: Math.min(v, settings.whitePoint - 1) })}
          disabled={disabled}
        />
        <SliderRow
          label="White pt" value={settings.whitePoint}
          min={1} max={255} step={1}
          onChange={(v) => update({ whitePoint: Math.max(v, settings.blackPoint + 1) })}
          disabled={disabled}
        />
        <SliderRow
          label="Midtones" value={settings.gamma}
          min={0.25} max={4.0} step={0.01} decimals={2}
          onChange={(v) => update({ gamma: v })}
          disabled={disabled}
        />
      </Group>

      <Group id="image.cleanup" title="Clean-up" summary={hasProcessing ? 'On' : undefined}>
        <SliderRow
          label="Blur" value={blur}
          min={0} max={10} step={0.5} decimals={1}
          onChange={(v) => update({ blur: v })}
          disabled={disabled}
        />
        <SliderRow
          label="Sharpen" value={sharpen}
          min={0} max={2} step={0.05} decimals={2}
          onChange={(v) => update({ sharpen: v })}
          disabled={disabled}
        />
        {sharpen > 0 && (
          <SliderRow
            label="Sharpen radius" value={sharpenRadius}
            min={0.5} max={5} step={0.5} decimals={1}
            onChange={(v) => update({ sharpenRadius: v })}
            disabled={disabled}
          />
        )}
        <SliderRow
          label="Noise" value={noise}
          min={0} max={50} step={1}
          onChange={(v) => update({ noise: v })}
          disabled={disabled}
        />
      </Group>

      <Group
        id="image.mask"
        title="Mask"
        summary={mask ? (maskSettings.enabled ? 'On' : 'Off') : undefined}
      >
        <MaskControls
          maskSettings={maskSettings}
          mask={mask}
          outputSettings={outputSettings}
          onMaskSettingsChange={onMaskSettingsChange}
          onMaskLoad={onMaskLoad}
          onMaskClear={onMaskClear}
          disabled={disabled}
        />
      </Group>
    </Section>
  )
}
