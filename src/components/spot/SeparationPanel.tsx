import { SpotSettings, SeparationMode } from '../../types'
import {
  DEFAULT_MOSAIC_TILE_INCHES, DEFAULT_MOSAIC_GROUT_PCT, MOSAIC_TILE_MIN_INCHES, MOSAIC_TILE_MAX_INCHES,
  MOSAIC_GROUT_MAX_PCT, tileInchesToSlider, sliderToTileInches,
} from '../../engine/mosaic'
import { Group } from '../ui/Section'
import { SliderRow, ToggleRow, SelectRow, Note } from '../ui/rows'

interface Props {
  settings: SpotSettings
  update: (partial: Partial<SpotSettings>) => void
  onSortLightToDark: () => void
  disabled: boolean
}

const MODES: { value: SeparationMode; label: string }[] = [
  { value: 'knockout', label: 'Knockout' },
  { value: 'buildup', label: 'Build-up (overprint)' },
]

/** Settings that apply to every plate: how the image is split, and how plate edges are treated. */
export function SeparationPanel({ settings, update, onSortLightToDark, disabled }: Props) {
  const mode = settings.separationMode ?? 'knockout'
  const isBuildup = mode === 'buildup'
  const mosaic = settings.mosaic ?? false
  const tile = settings.mosaicTileInches ?? DEFAULT_MOSAIC_TILE_INCHES
  const reach = settings.buildupReachInches ?? 0
  const trap = settings.trap ?? 0

  const sepSummary = `${isBuildup ? 'Build-up' : 'Knockout'}${mosaic ? ' · Mosaic' : ''}`
  const edgeSummary = `Trap ${trap}px${settings.smoothFlat && !mosaic ? ' · Vector' : ''}`

  return (
    <>
      {/* Separation — how the image is split into inks */}
      <Group id="spot.separation" title="Separation" summary={sepSummary}>
        <SelectRow
          label="Mode"
          title="Knockout: each pixel is one ink (exclusive regions). Build-up: nested overprint — each tone inks its plate plus every lighter plate beneath it, printed light→dark. Build-up is registration-forgiving and best for tonal/duotone palettes."
          value={mode}
          options={MODES}
          onChange={(separationMode) => update({ separationMode })}
          disabled={disabled}
        />

        {isBuildup && (
          <div className="control-row control-row--inline">
            <small style={{ color: 'var(--text-secondary)' }}>
              {settings.manualOrder ? 'Manual layer order' : 'Auto order: light→dark'}
            </small>
            {settings.manualOrder && (
              <button className="btn--small btn--ghost" onClick={onSortLightToDark} disabled={disabled}>
                Sort light→dark
              </button>
            )}
          </div>
        )}

        {isBuildup && (
          <>
            <ToggleRow
              label="Limit overprint reach"
              title="Classic build-up prints every lighter plate under ALL darker ink. Limiting the reach extends each lighter plate only a set distance past its own region — same misregistration protection at boundaries, without flooding ink under the whole design."
              checked={reach > 0}
              onChange={(on) => update({ buildupReachInches: on ? 0.1 : 0 })}
              disabled={disabled}
            />
            {reach > 0 && (
              <SliderRow
                label="Reach"
                title="How far a lighter plate extends under darker inks beyond its own region."
                value={reach}
                min={0.02} max={0.5} step={0.01} suffix={'"'}
                onChange={(v) => update({ buildupReachInches: v })}
                disabled={disabled}
              />
            )}
          </>
        )}

        <SliderRow
          label="Despeckle"
          title={mosaic
            ? 'Not used while Mosaic is on — each tile already takes its majority color.'
            : 'Clean up the color separation — jointly tidies which color owns each pixel so layers never erode apart and leave paper showing through. Low = remove stray specks; high = smooth ragged boundaries more.'}
          value={settings.smoothing ?? 0}
          min={0} max={100} step={5} suffix="%"
          onChange={(v) => update({ smoothing: v })}
          disabled={disabled || mosaic}
          dimmed={mosaic}
        />

        <ToggleRow
          label="Mosaic"
          title="Break the separation into square tiles: each tile takes the color that covers most of it, with an optional paper gap (grout) between tiles. Applies to every plate, the underbase and key knockouts."
          checked={mosaic}
          onChange={(on) => update({ mosaic: on })}
          disabled={disabled}
        />
        {mosaic && (
          <>
            <SliderRow
              label="Tile"
              title="Tile size, in inches on the print. The slider is logarithmic — most of its travel is in the fine range."
              value={tile}
              min={MOSAIC_TILE_MIN_INCHES} max={MOSAIC_TILE_MAX_INCHES} step={0.001} decimals={3} suffix={'"'}
              onChange={(v) => update({ mosaicTileInches: v })}
              slider={{
                min: 0, max: 1, step: 0.001,
                value: tileInchesToSlider(tile),
                onChange: (s) => update({ mosaicTileInches: sliderToTileInches(s) }),
              }}
              disabled={disabled}
            />
            <SliderRow
              label="Grout"
              title="Bare-paper gap between tiles, as a percentage of tile size, so it scales with the tiles. 0 = tiles touch. A background layer shows through the grout."
              value={settings.mosaicGroutPct ?? DEFAULT_MOSAIC_GROUT_PCT}
              min={0} max={MOSAIC_GROUT_MAX_PCT} step={1} suffix="%"
              onChange={(v) => update({ mosaicGroutPct: v })}
              disabled={disabled}
            />
          </>
        )}
      </Group>

      {/* Trapping & edges — global plate-rendering defaults (overridable per color) */}
      <Group id="spot.edges" title="Edges" summary={edgeSummary}>
        <SliderRow
          label="Trap"
          title="Expand each color's ink region so layers bleed into each other, hiding visible seams between halftone and flat layers. Sets the default; override per-color in each color's controls."
          value={trap}
          min={0} max={10} step={1} suffix="px"
          onChange={(v) => update({ trap: v })}
          disabled={disabled}
        />
        <ToggleRow
          label="Vectorize flat edges"
          title={mosaic
            ? 'Not used while Mosaic is on — tile edges are already straight.'
            : "Trace flat color plates into vector outlines so diagonal and curved edges aren't pixelated (staircased). Sets the default for all flat plates; override per-color in each color's controls (e.g. leave fine line/hatch art crisp). Halftone plates are unaffected."}
          checked={settings.smoothFlat ?? false}
          onChange={(smoothFlat) => update({ smoothFlat })}
          disabled={disabled || mosaic}
          dimmed={mosaic}
        />
        {settings.smoothFlat && (
          <SliderRow
            label="Rounding"
            title="How much the traced outlines are rounded. 0 = straight/angular (just de-staircased); higher rounds corners and curves more."
            value={settings.smoothFlatStrength ?? 50}
            min={0} max={100} step={1}
            onChange={(v) => update({ smoothFlatStrength: v })}
            disabled={disabled}
          />
        )}
        <Note>These are defaults for every plate. Each ink can override trap and vectorizing in its own row.</Note>
      </Group>
    </>
  )
}
