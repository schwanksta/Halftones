import { useState } from 'react'
import { SpotColor, SpotSettings, SavedPalette } from '../../types'
import { extractPalette, mergeSimilarColors, labToHex } from '../../engine/spot-separation'
import { Group } from '../ui/Section'
import { SliderRow, ToggleRow } from '../ui/rows'
import { PaletteBar } from '../PaletteBar'

interface Props {
  settings: SpotSettings
  update: (partial: Partial<SpotSettings>) => void
  /** ImageData to extract the palette from (the transformed source image). */
  sourceImageData: ImageData | null
  defaultLpi: number
  hasTransparency: boolean
  disabled: boolean
  /** LAB seed colors clicked by the user on the preview canvas. */
  seedColors: Array<[number, number, number]>
  onClearSeeds: () => void
  seedPickingActive: boolean
  onToggleSeedPicking: () => void
}

/** Where the inks come from: extraction settings, seeds, saved palettes. */
export function PalettePanel({
  settings, update, sourceImageData, defaultLpi, hasTransparency, disabled,
  seedColors, onClearSeeds, seedPickingActive, onToggleSeedPicking,
}: Props) {
  const [extracting, setExtracting] = useState(false)

  const inks = settings.colors.filter(c => c.type !== 'background')
  const bgLayer = settings.colors.find(c => c.type === 'background')
  const hasBgLayer = !!bgLayer
  const noSource = disabled || !sourceImageData

  const handleExtract = () => {
    if (!sourceImageData) return
    setExtracting(true)
    setTimeout(() => {
      try {
        const seeds = seedColors.length ? seedColors : undefined
        const paper = settings.paperWhite
          ? { enabled: true, threshold: settings.paperWhiteThreshold ?? 92 }
          : undefined
        const newColors = extractPalette(sourceImageData, settings.numColors, defaultLpi, seeds, paper)
        // Preserve any background layers — keep them at the front
        const bgColors = settings.colors.filter(c => c.type === 'background')
        update({ colors: [...bgColors, ...newColors] })
      } finally {
        setExtracting(false)
      }
    }, 0)
  }

  const handleMerge = () => {
    if (!settings.colors.length) return
    // Background colors don't participate in LAB-distance merging
    const bgColors = settings.colors.filter(c => c.type === 'background')
    const merged = mergeSimilarColors(inks, settings.mergeThreshold)
    update({ colors: [...bgColors, ...merged] })
  }

  const addBackground = () => {
    const bgColor: SpotColor = {
      id: `bg-${Date.now()}`,
      name: 'Background',
      hex: '#ffffff',
      lab: [100, 0, 0],   // white — separation ignores lab for background type
      angle: 45,
      lpi: defaultLpi,
      renderMode: 'flat',
      threshold: 0.5,
      enabled: true,
      type: 'background',
    }
    // Insert at index 0 so it renders first (underneath all subject colors)
    update({ colors: [bgColor, ...settings.colors] })
  }

  const applyPalette = (palette: SavedPalette) => {
    // Recolor the existing layers in order — exactly like changing each layer's
    // color swatch by hand: only the display ink (hex + name) changes. The
    // separation seed (lab), threshold, render mode, angle, etc. stay put, so
    // the print structure is identical. The background is recolored by role (not
    // position), and only when both this print and the palette have one; a
    // shorter/longer palette recolors as many regular layers as line up.
    let i = 0
    const colors = settings.colors.map((c) => {
      if (c.type === 'background') {
        return palette.background ? { ...c, hex: palette.background.hex, name: palette.background.name } : c
      }
      const ink = palette.colors[i++]
      return ink ? { ...c, hex: ink.hex, name: ink.name } : c
    })
    update({ colors })
  }

  const summary = inks.length > 0 ? `${inks.length} ink${inks.length === 1 ? '' : 's'}` : 'Not extracted'

  return (
    <Group id="spot.palette" title="Palette" summary={summary} defaultOpen>
      <SliderRow
        label="Colors" value={settings.numColors}
        min={2} max={12} step={1}
        onChange={(v) => update({ numColors: v })}
        disabled={disabled}
      />
      <SliderRow
        label="Merge colors"
        title="How aggressively visually similar colors are merged during Extract / Merge. Higher = more colors collapse into one ink (fewer plates). This is the similarity threshold — the 'Merge' button applies it on demand."
        value={settings.mergeThreshold}
        min={0} max={50} step={1}
        onChange={(v) => update({ mergeThreshold: v })}
        disabled={disabled}
      />
      <ToggleRow
        label="Treat white as paper"
        title="Treat near-white as bare paper: every extracted color is a real ink (no wasted white plate), and white areas print with no ink. Turn off for white ink on colored stock."
        checked={settings.paperWhite ?? false}
        onChange={(paperWhite) => update({ paperWhite })}
        disabled={disabled}
      />
      {(settings.paperWhite ?? false) && (
        <SliderRow
          label="Paper white pt"
          title="Pixels at/above this lightness (and near-neutral) count as paper."
          value={settings.paperWhiteThreshold ?? 92}
          min={80} max={100} step={1}
          onChange={(v) => update({ paperWhiteThreshold: v })}
          disabled={disabled}
        />
      )}

      {/* Seed color picking */}
      <div className="btn-row" style={{ flexWrap: 'wrap', gap: 5 }}>
        <button
          className={`btn btn--small${seedPickingActive ? ' is-active' : ''}`}
          onClick={onToggleSeedPicking}
          disabled={noSource}
          title="Click colors on the image to anchor palette slots"
        >
          {seedPickingActive ? '● Picking…' : '＋ Seed colors'}
        </button>
        {seedColors.map((lab, i) => {
          const hex = labToHex(lab)
          return (
            <div
              key={i}
              title={hex}
              style={{
                width: 16, height: 16, borderRadius: 3,
                background: hex,
                border: '1px solid rgba(255,255,255,0.2)',
                flexShrink: 0,
              }}
            />
          )
        })}
        {seedColors.length > 0 && (
          <button className="btn--icon" onClick={onClearSeeds} title="Clear all seed colors">×</button>
        )}
      </div>

      <div className="btn-row">
        <button
          className="btn--primary btn--small"
          onClick={handleExtract}
          disabled={noSource || extracting}
          style={{ flex: 1 }}
        >
          {extracting ? 'Extracting…' : inks.length > 0 ? 'Re-extract palette' : 'Extract palette'}
        </button>
        {inks.length > 1 && (
          <button className="btn--small" onClick={handleMerge} disabled={disabled} title="Merge visually similar colors">
            Merge
          </button>
        )}
      </div>

      <PaletteBar
        currentInks={inks.map(c => ({ hex: c.hex, name: c.name }))}
        currentBackground={bgLayer ? { hex: bgLayer.hex, name: bgLayer.name } : undefined}
        onApply={applyPalette}
        disabled={disabled}
      />

      {/* Background layer — only when the image has transparent pixels */}
      {hasTransparency && (
        <div className="btn-row">
          <button
            className="btn--small btn--block"
            onClick={addBackground}
            disabled={disabled || hasBgLayer}
            title={hasBgLayer ? 'Background layer already added' : 'Add a color plate for the transparent background area'}
          >
            {hasBgLayer ? '✓ Background layer added' : '+ Add background layer'}
          </button>
        </div>
      )}
    </Group>
  )
}
