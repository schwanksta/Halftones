import { useState, useEffect, useMemo } from 'react'
import { SpotColor, SpotSettings, KeyPlateSettings, DEFAULT_KEY_PLATE, SeparationMode, DEFAULT_UNDERBASE, SavedPalette } from '../types'
import { extractPalette, mergeSimilarColors, labToHex, rgbToLab, guessColorName, darkestSpotColor } from '../engine/spot-separation'
import { EditableValue } from './EditableValue'
import { PaletteBar } from './PaletteBar'

interface Props {
  settings: SpotSettings
  onChange: (settings: SpotSettings) => void
  /** ImageData to extract palette from (the source image). */
  sourceImageData: ImageData | null
  defaultLpi: number
  disabled: boolean
  /** LAB seed colors clicked by the user on the preview canvas. */
  seedColors: Array<[number, number, number]>
  onClearSeeds: () => void
  seedPickingActive: boolean
  onToggleSeedPicking: () => void
}

export function SpotColorEditor({
  settings, onChange, sourceImageData, defaultLpi, disabled,
  seedColors, onClearSeeds, seedPickingActive, onToggleSeedPicking,
}: Props) {
  const [extracting, setExtracting] = useState(false)

  const update = (partial: Partial<SpotSettings>) => onChange({ ...settings, ...partial })

  const updateKey = (partial: Partial<KeyPlateSettings>) => {
    const current = settings.key ?? { ...DEFAULT_KEY_PLATE, lpi: defaultLpi }
    update({ key: { ...current, ...partial } })
  }
  const keySettings = settings.key

  const updateColor = (id: string, partial: Partial<SpotColor>) => {
    onChange({
      ...settings,
      colors: settings.colors.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })
  }

  /** True when the source image has any transparent pixels. */
  const hasTransparency = useMemo(() => {
    if (!sourceImageData) return false
    const d = sourceImageData.data
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 128) return true
    }
    return false
  }, [sourceImageData])

  const hasBgLayer = settings.colors.some(c => c.type === 'background')

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
    const regularColors = settings.colors.filter(c => c.type !== 'background')
    const merged = mergeSimilarColors(regularColors, settings.mergeThreshold)
    update({ colors: [...bgColors, ...merged] })
  }

  const removeColor = (id: string) => {
    update({ colors: settings.colors.filter((c) => c.id !== id) })
  }

  const setAllRenderMode = (mode: 'flat' | 'halftone') => {
    update({ colors: settings.colors.map((c) => ({ ...c, renderMode: mode })) })
  }

  const darkest = darkestSpotColor(settings.colors)

  const currentInks = settings.colors.filter(c => c.type !== 'background').map(c => ({ hex: c.hex, name: c.name }))
  const bgLayer = settings.colors.find(c => c.type === 'background')
  const currentBackground = bgLayer ? { hex: bgLayer.hex, name: bgLayer.name } : undefined

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

  return (
    <div className="control-section">
      <h3 className="section-title">Spot Colors</h3>

      {/* Extract controls */}
      <div className="control-row">
        <span>Colors <EditableValue value={settings.numColors} min={2} max={12} step={1} onChange={(v) => update({ numColors: v })} /></span>
        <input
          type="range" min={2} max={12}
          value={settings.numColors}
          onChange={(e) => update({ numColors: Number(e.target.value) })}
          disabled={disabled}
        />
      </div>

      <div className="control-row" title="How aggressively visually similar colors are merged during Extract / Merge. Higher = more colors collapse into one ink (fewer plates). This is the similarity threshold — the 'Merge' button applies it on demand.">
        <span>Merge colors <EditableValue value={settings.mergeThreshold} min={0} max={50} step={1} onChange={(v) => update({ mergeThreshold: v })} /></span>
        <input
          type="range" min={0} max={50} step={1}
          value={settings.mergeThreshold}
          onChange={(e) => update({ mergeThreshold: Number(e.target.value) })}
          disabled={disabled}
        />
      </div>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
        title="Treat near-white as bare paper: every extracted color is a real ink (no wasted white plate), and white areas print with no ink. Turn off for white ink on colored stock.">
        <input
          type="checkbox"
          checked={settings.paperWhite ?? false}
          onChange={(e) => update({ paperWhite: e.target.checked })}
          disabled={disabled}
        />
        <span>Treat white as paper</span>
      </label>

      {(settings.paperWhite ?? false) && (
        <div className="control-row" title="Pixels at/above this lightness (and near-neutral) count as paper.">
          <span>Paper white pt <EditableValue value={settings.paperWhiteThreshold ?? 92} min={80} max={100} step={1} onChange={(v) => update({ paperWhiteThreshold: v })} /></span>
          <input
            type="range" min={80} max={100} step={1}
            value={settings.paperWhiteThreshold ?? 92}
            onChange={(e) => update({ paperWhiteThreshold: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      )}

      {/* Seed color picking */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
        <button
          onClick={onToggleSeedPicking}
          disabled={disabled || !sourceImageData}
          title="Click colors on the image to anchor palette slots"
          style={{
            padding: '3px 7px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: seedPickingActive ? 'var(--accent)' : 'var(--bg-primary)',
            color: seedPickingActive ? '#fff' : 'var(--text-primary)',
            cursor: disabled || !sourceImageData ? 'not-allowed' : 'pointer',
            fontWeight: seedPickingActive ? 600 : 400,
            opacity: disabled || !sourceImageData ? 0.5 : 1,
          }}
        >
          {seedPickingActive ? '● Picking…' : '＋ Seed Colors'}
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
          <button
            onClick={onClearSeeds}
            title="Clear all seed colors"
            style={{
              padding: '2px 5px', fontSize: 11, borderRadius: 3,
              border: '1px solid var(--border)',
              background: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', lineHeight: 1,
            }}
          >×</button>
        )}
      </div>

      <div className="control-row" style={{ gap: 6 }}>
        <button
          onClick={handleExtract}
          disabled={disabled || !sourceImageData || extracting}
          style={{
            flex: 1,
            padding: '5px 8px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: disabled || !sourceImageData ? 'not-allowed' : 'pointer',
            opacity: disabled || !sourceImageData ? 0.5 : 1,
          }}
        >
          {extracting ? 'Extracting…' : '⬇ Extract Palette'}
        </button>
        {settings.colors.filter(c => c.type !== 'background').length > 1 && (
          <button
            onClick={handleMerge}
            disabled={disabled}
            title="Merge visually similar colors"
            style={{ padding: '5px 8px', fontSize: 12, borderRadius: 4 }}
          >
            Merge
          </button>
        )}
      </div>

      <PaletteBar currentInks={currentInks} currentBackground={currentBackground} onApply={applyPalette} disabled={disabled} />

      {/* Background layer button — only when image has transparent pixels */}
      {hasTransparency && (
        <div className="control-row" style={{ marginTop: 2 }}>
          <button
            onClick={addBackground}
            disabled={disabled || hasBgLayer}
            title={hasBgLayer ? 'Background layer already added' : 'Add a color plate for the transparent background area'}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: hasBgLayer ? 'var(--text-secondary)' : 'var(--text-primary)',
              cursor: disabled || hasBgLayer ? 'not-allowed' : 'pointer',
              opacity: disabled || hasBgLayer ? 0.5 : 1,
            }}
          >
            {hasBgLayer ? '✓ Background Layer Added' : '+ Add Background Layer'}
          </button>
        </div>
      )}

      {settings.colors.length > 0 && (
        <div className="control-row" style={{ gap: 4 }}>
          <span style={{ flexShrink: 0 }}>All</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {(['flat', 'halftone'] as const).map((mode) => {
              const allMatch = settings.colors.every((c) => c.renderMode === mode)
              return (
                <button
                  key={mode}
                  onClick={() => setAllRenderMode(mode)}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: allMatch ? 'var(--accent)' : 'var(--bg-primary)',
                    color: allMatch ? '#fff' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontWeight: allMatch ? 600 : 400,
                  }}
                >
                  {mode === 'flat' ? 'Flat' : 'Halftone'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {settings.colors.length === 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '8px 0 0', lineHeight: 1.4 }}>
          Load an image and click "Extract Palette" to auto-detect colors.
        </p>
      )}

      {/* Color list */}
      {settings.colors.map((color, idx) => (
        <SpotColorRow
          key={color.id}
          color={color}
          index={idx}
          disabled={disabled}
          globalTrap={settings.trap ?? 0}
          globalSmooth={settings.smoothFlat ?? false}
          buildup={settings.separationMode === 'buildup'}
          isDarkest={darkest?.id === color.id}
          darkestName={darkest?.name}
          darkestHex={darkest?.hex}
          onChange={(partial) => updateColor(color.id, partial)}
          onRemove={() => removeColor(color.id)}
        />
      ))}

      {/* Separation — how the image is split into inks */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="subsection-title">Separation</div>

        <label className="control-row" title="Knockout: each pixel is one ink (exclusive regions). Build-up: nested overprint — each tone inks its plate plus every lighter plate beneath it, printed light→dark. Build-up is registration-forgiving and best for tonal/duotone palettes.">
          <span>Mode</span>
          <select
            value={settings.separationMode ?? 'knockout'}
            onChange={(e) => update({ separationMode: e.target.value as SeparationMode })}
            disabled={disabled}
          >
            <option value="knockout">Knockout</option>
            <option value="buildup">Build-up (overprint)</option>
          </select>
        </label>

        <div className="control-row" title="Clean up the color separation — jointly tidies which color owns each pixel so layers never erode apart and leave paper showing through. Low = remove stray specks; high = smooth ragged boundaries more.">
          <span>Despeckle <EditableValue value={settings.smoothing ?? 0} min={0} max={100} step={5} suffix="%" onChange={(v) => update({ smoothing: v })} /></span>
          <input
            type="range" min={0} max={100} step={5}
            value={settings.smoothing ?? 0}
            onChange={(e) => update({ smoothing: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Trapping & edges — global plate-rendering defaults (overridable per color) */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="subsection-title">Trapping & edges</div>

        <div className="control-row" title="Expand each color's ink region so layers bleed into each other, hiding visible seams between halftone and flat layers. Sets the default; override per-color in each color's controls.">
          <span>Trap <EditableValue value={settings.trap ?? 0} min={0} max={10} step={1} suffix="px" onChange={(v) => update({ trap: v })} /></span>
          <input
            type="range" min={0} max={10} step={1}
            value={settings.trap ?? 0}
            onChange={(e) => update({ trap: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>

        <label className="control-row control-row--toggle" title="Trace flat color plates into vector outlines so diagonal and curved edges aren't pixelated (staircased). Sets the default for all flat plates; override per-color in each color's controls (e.g. leave fine line/hatch art crisp). Halftone plates are unaffected.">
          <span>Vectorize flat edges</span>
          <input
            type="checkbox"
            checked={settings.smoothFlat ?? false}
            onChange={(e) => update({ smoothFlat: e.target.checked })}
            disabled={disabled}
          />
        </label>

        {settings.smoothFlat && (
          <div className="control-row" title="How much the traced outlines are rounded. 0 = straight/angular (just de-staircased); higher rounds corners and curves more.">
            <span>Rounding <EditableValue
              value={settings.smoothFlatStrength ?? 50}
              min={0} max={100} step={1}
              onChange={(v) => update({ smoothFlatStrength: v })}
            /></span>
            <input
              type="range" min={0} max={100} step={1}
              value={settings.smoothFlatStrength ?? 50}
              onChange={(e) => update({ smoothFlatStrength: Number(e.target.value) })}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      {/* Plates & stock — the physical output */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="subsection-title">Plates &amp; stock</div>

        <div className="control-row control-row--colors">
          <span>Substrate</span>
          <div className="color-pair">
            <label className="color-swatch-label" title="Paper / garment color the proof & preview composite onto">
              <span className="color-swatch-hint">Stock</span>
              <input
                type="color"
                value={settings.substrate ?? '#ffffff'}
                onChange={(e) => update({ substrate: e.target.value })}
                disabled={disabled}
              />
            </label>
          </div>
        </div>

        <label className="control-row control-row--toggle" title="Generate a base plate (union of all inked area, choked inward) printed first — e.g. white or silver under the whole design.">
          <span>Underbase</span>
          <input
            type="checkbox"
            checked={settings.underbase?.enabled ?? false}
            onChange={(e) => update({ underbase: { ...DEFAULT_UNDERBASE, ...settings.underbase, enabled: e.target.checked } })}
            disabled={disabled}
          />
        </label>

        {settings.underbase?.enabled && (
          <>
            <div className="control-row control-row--colors">
              <span>Base ink</span>
              <div className="color-pair">
                <label className="color-swatch-label">
                  <span className="color-swatch-hint">Base</span>
                  <input
                    type="color"
                    value={settings.underbase?.color ?? DEFAULT_UNDERBASE.color}
                    onChange={(e) => update({ underbase: { ...DEFAULT_UNDERBASE, ...settings.underbase, enabled: true, color: e.target.value } })}
                    disabled={disabled}
                  />
                </label>
              </div>
            </div>
            <div className="control-row" title="Pull the underbase inward from the print edge so it doesn't peek out past the colors.">
              <span>Choke <EditableValue
                value={Math.round((settings.underbase?.chokeInches ?? 0) * 100) / 100}
                min={0} max={0.2} step={0.01} suffix='"'
                onChange={(v) => update({ underbase: { ...DEFAULT_UNDERBASE, ...settings.underbase, enabled: true, chokeInches: v } })}
              /></span>
              <input
                type="range" min={0} max={0.2} step={0.01}
                value={settings.underbase?.chokeInches ?? 0}
                onChange={(e) => update({ underbase: { ...DEFAULT_UNDERBASE, ...settings.underbase, enabled: true, chokeInches: Number(e.target.value) } })}
                disabled={disabled}
              />
            </div>
          </>
        )}
      </div>

      {/* Key plate */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <label className="control-row control-row--toggle">
          <span style={{ fontWeight: 600 }}>
            Key Plate{' '}
            <small style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>halftone over all colors</small>
          </span>
          <input
            type="checkbox"
            checked={keySettings?.enabled ?? false}
            onChange={(e) => updateKey({ enabled: e.target.checked })}
            disabled={disabled}
          />
        </label>

        {keySettings?.enabled && (
          <>
            <label className="control-row control-row--toggle">
              <span>Halftone Dots</span>
              <input
                type="checkbox"
                checked={keySettings.dotsEnabled !== false}
                onChange={(e) => updateKey({ dotsEnabled: e.target.checked })}
                disabled={disabled}
              />
            </label>
            <label className="control-row control-row--toggle">
              <span title="Print the key plate's dots/strokes on the same screen as the darkest separation color, instead of as its own overprinted plate">
                Merge with Darkest Color
                {keySettings.mergeWithDarkest && (
                  <>
                    {' '}
                    <small style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                      {(() => {
                        const target = darkestSpotColor(settings.colors)
                        return target ? `→ ${target.name}` : '(no enabled color)'
                      })()}
                    </small>
                  </>
                )}
              </span>
              <input
                type="checkbox"
                checked={keySettings.mergeWithDarkest ?? false}
                onChange={(e) => updateKey({ mergeWithDarkest: e.target.checked })}
                disabled={disabled}
              />
            </label>
            <div className="control-row control-row--colors" style={{ opacity: keySettings.mergeWithDarkest ? 0.4 : 1 }}>
              <span>Ink</span>
              <div className="color-pair">
                <label className="color-swatch-label" title={keySettings.mergeWithDarkest ? 'Unused while merged — uses the darkest color\'s ink' : 'Key plate ink color'}>
                  <span className="color-swatch-hint">Key</span>
                  <input
                    type="color"
                    value={keySettings.color}
                    onChange={(e) => updateKey({ color: e.target.value })}
                    disabled={disabled || keySettings.mergeWithDarkest}
                  />
                </label>
              </div>
            </div>
            <label className="control-row" style={{ opacity: keySettings.dotsEnabled === false ? 0.4 : 1 }}>
              <span>
                LPI{' '}
                <EditableValue
                  value={keySettings.lpi}
                  min={1} max={100} step={1}
                  onChange={(v) => updateKey({ lpi: v })}
                />
              </span>
              <input
                type="range" min={1} max={100}
                value={keySettings.lpi}
                onChange={(e) => updateKey({ lpi: Number(e.target.value) })}
                disabled={disabled || keySettings.dotsEnabled === false}
              />
            </label>
            <label className="control-row" style={{ opacity: keySettings.dotsEnabled === false ? 0.4 : 1 }}>
              <span>
                Angle{' '}
                <EditableValue
                  value={keySettings.angle}
                  min={0} max={180} step={1} suffix="°"
                  onChange={(v) => updateKey({ angle: v })}
                />
              </span>
              <input
                type="range" min={0} max={180}
                value={keySettings.angle}
                onChange={(e) => updateKey({ angle: Number(e.target.value) })}
                disabled={disabled || keySettings.dotsEnabled === false}
              />
            </label>
            <label className="control-row" style={{ opacity: keySettings.dotsEnabled === false ? 0.4 : 1 }}>
              <span>
                Min Dot{' '}
                <EditableValue
                  value={Math.round(keySettings.minDot * 100)}
                  min={0} max={50} step={1} suffix="%"
                  onChange={(v) => updateKey({ minDot: v / 100 })}
                />
              </span>
              <input
                type="range" min={0} max={0.5} step={0.01}
                value={keySettings.minDot}
                onChange={(e) => updateKey({ minDot: Number(e.target.value) })}
                disabled={disabled || keySettings.dotsEnabled === false}
              />
            </label>

            {/* Edge stroke */}
            <label className="control-row control-row--toggle" style={{ marginTop: 4 }}>
              <span title="Overlay Sobel edge detection lines on the key plate halftone — adds hard drawn-looking contours at tonal transitions">
                Edge Stroke
              </span>
              <input
                type="checkbox"
                checked={keySettings.strokeEnabled ?? false}
                onChange={(e) => updateKey({ strokeEnabled: e.target.checked })}
                disabled={disabled}
              />
            </label>

            {keySettings.strokeEnabled && (
              <>
                <label className="control-row">
                  <span title="Gradient magnitude threshold — lower detects more/finer edges, higher detects only strong edges">
                    Threshold{' '}
                    <EditableValue
                      value={Math.round((keySettings.strokeThreshold ?? 0.3) * 100)}
                      min={1} max={100} step={1} suffix="%"
                      onChange={(v) => updateKey({ strokeThreshold: v / 100 })}
                    />
                  </span>
                  <input
                    type="range" min={0.01} max={1} step={0.01}
                    value={keySettings.strokeThreshold ?? 0.3}
                    onChange={(e) => updateKey({ strokeThreshold: Number(e.target.value) })}
                    disabled={disabled}
                  />
                </label>
                <label className="control-row">
                  <span title="Edge line width in output pixels">
                    Width{' '}
                    <EditableValue
                      value={keySettings.strokeWidth ?? 2}
                      min={1} max={10} step={1} suffix="px"
                      onChange={(v) => updateKey({ strokeWidth: v })}
                    />
                  </span>
                  <input
                    type="range" min={1} max={10} step={1}
                    value={keySettings.strokeWidth ?? 2}
                    onChange={(e) => updateKey({ strokeWidth: Number(e.target.value) })}
                    disabled={disabled}
                  />
                </label>
              </>
            )}

            {/* Silhouette outline (alpha boundary) */}
            <label className="control-row control-row--toggle" style={{ marginTop: 4 }}>
              <span title="Solid outline ring traced around the subject's alpha-channel silhouette — clean crisp border, no internal edges">
                Outline{hasTransparency ? '' : ' (needs transparency)'}
              </span>
              <input
                type="checkbox"
                checked={keySettings.outlineEnabled ?? false}
                onChange={(e) => updateKey({ outlineEnabled: e.target.checked })}
                disabled={disabled || !hasTransparency}
              />
            </label>

            {keySettings.outlineEnabled && hasTransparency && (
              <label className="control-row">
                <span title="Outline width in output pixels — how far the stroke extends from the silhouette edge">
                  Width{' '}
                  <EditableValue
                    value={keySettings.outlineWidth ?? 3}
                    min={1} max={20} step={1} suffix="px"
                    onChange={(v) => updateKey({ outlineWidth: v })}
                  />
                </span>
                <input
                  type="range" min={1} max={20} step={1}
                  value={keySettings.outlineWidth ?? 3}
                  onChange={(e) => updateKey({ outlineWidth: Number(e.target.value) })}
                  disabled={disabled}
                />
              </label>
            )}
          </>
        )}
      </div>

      {/* Preview — appearance only; does not change the separated plates */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="subsection-title">Preview</div>
        <div className="control-row" title="Boost each ink's saturation in the on-screen preview and the exported color proof. The separated plates are black-and-white, so this never changes the actual printed output.">
          <span>Vibrancy <EditableValue value={Math.round((settings.vibrancy ?? 0) * 100)} min={0} max={100} step={1} suffix="%" onChange={(v) => update({ vibrancy: v / 100 })} /></span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={settings.vibrancy ?? 0}
            onChange={(e) => update({ vibrancy: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Per-color row ─────────────────────────────────────────────────────────────

/** Simple RGB channel-sum distance between two #rrggbb hex colors (0–765). */
function hexDistance(a: string, b: string): number {
  const ra = parseInt(a.slice(1, 3), 16), ga = parseInt(a.slice(3, 5), 16), ba = parseInt(a.slice(5, 7), 16)
  const rb = parseInt(b.slice(1, 3), 16), gb = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16)
  return Math.abs(ra - rb) + Math.abs(ga - gb) + Math.abs(ba - bb)
}

interface RowProps {
  color: SpotColor
  index: number
  disabled: boolean
  globalTrap: number
  globalSmooth: boolean
  buildup: boolean
  isDarkest: boolean
  darkestName?: string
  darkestHex?: string
  onChange: (partial: Partial<SpotColor>) => void
  onRemove: () => void
}

function SpotColorRow({ color, index, disabled, globalTrap, globalSmooth, buildup, isDarkest, darkestName, darkestHex, onChange, onRemove }: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const [hexDraft, setHexDraft] = useState(color.hex)

  // Sync draft when parent changes hex externally (e.g. reset, merge)
  useEffect(() => { setHexDraft(color.hex) }, [color.hex])

  // The original extracted color (from LAB) — used for the reset button
  const originalHex = labToHex(color.lab)
  const isModified = color.hex.toLowerCase() !== originalHex.toLowerCase()

  const commitHex = (raw: string) => {
    const val = raw.startsWith('#') ? raw : `#${raw}`
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const hex = val.toLowerCase()
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const lab = rgbToLab(r, g, b)
      const name = guessColorName(lab[0], lab[1], lab[2])
      // Update hex and name only — lab stays anchored to the original extracted
      // color so separation boundaries don't shift when the display color changes.
      onChange({ hex, name })
      setHexDraft(hex)
    } else {
      setHexDraft(color.hex)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        marginTop: 6,
        overflow: 'hidden',
        opacity: color.enabled ? 1 : 0.55,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Swatch */}
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            background: color.hex,
            border: '1px solid rgba(255,255,255,0.15)',
            flexShrink: 0,
          }}
        />
        {/* Name */}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {index + 1}. {color.name}
        </span>
        {/* Background badge */}
        {color.type === 'background' && (
          <span style={{ fontSize: 9, background: 'rgba(120,160,255,0.2)', color: 'var(--text-secondary)', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
            BG
          </span>
        )}
        {/* Mode badge */}
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>
          {color.renderMode === 'flat' ? 'Flat' : 'Halftone'}
        </span>
        {/* Enable toggle */}
        <input
          type="checkbox"
          checked={color.enabled}
          onChange={(e) => { e.stopPropagation(); onChange({ enabled: e.target.checked }) }}
          disabled={disabled}
          title="Enable this color"
          style={{ flexShrink: 0 }}
        />
        {/* Expand chevron */}
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded controls */}
      {expanded && (
        <div style={{ padding: '6px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Hex color picker + editable hex input */}
          <div className="control-row" style={{ gap: 8 }}>
            <span>Color</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color"
                value={hexDraft}
                onChange={(e) => commitHex(e.target.value)}
                onBlur={(e) => commitHex(e.target.value)}
                disabled={disabled}
                style={{ width: 32, height: 24, padding: 1, cursor: 'pointer', flexShrink: 0 }}
              />
              {isModified && !disabled && !color.type && (
                <button
                  onClick={() => { onChange({ hex: originalHex }); setHexDraft(originalHex) }}
                  title="Reset to extracted color"
                  style={{
                    padding: '2px 5px',
                    fontSize: 13,
                    lineHeight: 1,
                    borderRadius: 3,
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: 'none',
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >↺</button>
              )}
              <input
                type="text"
                value={hexDraft}
                onChange={(e) => setHexDraft(e.target.value)}
                onBlur={(e) => commitHex(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { commitHex((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
                  if (e.key === 'Escape') { setHexDraft(color.hex); (e.target as HTMLInputElement).blur() }
                }}
                disabled={disabled}
                spellCheck={false}
                maxLength={7}
                placeholder="#000000"
                style={{
                  width: 76,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </div>

          {/* Render mode */}
          <div className="control-row" style={{ gap: 8 }}>
            <span>Render</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['flat', 'halftone'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onChange({ renderMode: mode })}
                  disabled={disabled}
                  style={{
                    padding: '3px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: color.renderMode === mode ? 'var(--accent)' : 'var(--bg-primary)',
                    color: color.renderMode === mode ? '#fff' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontWeight: color.renderMode === mode ? 600 : 400,
                  }}
                >
                  {mode === 'flat' ? 'Flat' : 'Halftone'}
                </button>
              ))}
            </div>
          </div>

          {/* Flat-specific: threshold */}
          {color.renderMode === 'flat' && (
            <div className="control-row">
              <span>Threshold <EditableValue value={Math.round(color.threshold * 100)} min={10} max={100} step={1} suffix="%" onChange={(v) => onChange({ threshold: v / 100 })} /></span>
              <input
                type="range" min={0.1} max={1} step={0.01}
                value={color.threshold}
                onChange={(e) => onChange({ threshold: Number(e.target.value) })}
                disabled={disabled}
              />
            </div>
          )}

          {/* Smooth edges override — flat plates only (incl. build-up). */}
          {(buildup || color.renderMode === 'flat') && (
            <label className="control-row control-row--toggle" title="Trace this plate's edges into vector outlines. Defaults to the global 'Vectorize flat edges' setting — toggle to override for this color (e.g. keep fine line/hatch art as crisp raster).">
              <span>Vectorize edges</span>
              <input
                type="checkbox"
                checked={color.smooth ?? globalSmooth}
                onChange={(e) => onChange({ smooth: e.target.checked })}
                disabled={disabled}
              />
            </label>
          )}

          {/* Halftone-specific: LPI + angle */}
          {color.renderMode === 'halftone' && (
            <>
              <div className="control-row">
                <span>LPI <EditableValue value={color.lpi} min={1} max={100} step={1} onChange={(v) => onChange({ lpi: v })} /></span>
                <input
                  type="range" min={1} max={100}
                  value={color.lpi}
                  onChange={(e) => onChange({ lpi: Number(e.target.value) })}
                  disabled={disabled}
                />
              </div>
              <div className="control-row">
                <span>Angle <EditableValue value={color.angle} min={0} max={180} step={1} suffix="°" onChange={(v) => onChange({ angle: v })} /></span>
                <input
                  type="range" min={0} max={180}
                  value={color.angle}
                  onChange={(e) => onChange({ angle: Number(e.target.value) })}
                  disabled={disabled}
                />
              </div>
            </>
          )}

          {/* Bleed — background layers only */}
          {color.type === 'background' && (
            <div className="control-row">
              <span title="How far the background plate extends into the margin, as a percentage of the (largest) margin. 100% = out to the trim edge.">
                Bleed{' '}
                <EditableValue
                  value={Math.round(color.bleedPct ?? 0)}
                  min={0} max={100} step={1}
                  suffix="%"
                  onChange={(v) => onChange({ bleedPct: v })}
                />
              </span>
              <input
                type="range" min={0} max={100} step={1}
                value={color.bleedPct ?? 0}
                onChange={(e) => onChange({ bleedPct: Number(e.target.value) })}
                disabled={disabled}
              />
            </div>
          )}

          {/* Per-color trap override.  color.trap == null → inherit global. */}
          <div className="control-row" title="Per-color trap override (px). Drag to override the global trap value for this color only.">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Trap
              {color.trap == null ? (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>(global: {globalTrap})</span>
              ) : (
                <>
                  <EditableValue
                    value={color.trap}
                    min={0}
                    max={10}
                    step={1}
                    suffix="px"
                    onChange={(v) => onChange({ trap: v })}
                  />
                  {!disabled && (
                    <button
                      onClick={() => onChange({ trap: null })}
                      title="Use global trap value"
                      style={{
                        padding: '1px 4px',
                        fontSize: 11,
                        lineHeight: 1,
                        borderRadius: 3,
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: 'none',
                        color: 'var(--text-secondary)',
                      }}
                    >↺</button>
                  )}
                </>
              )}
            </span>
            <input
              type="range" min={0} max={10} step={1}
              value={color.trap ?? globalTrap}
              onChange={(e) => onChange({ trap: Number(e.target.value) })}
              disabled={disabled}
            />
          </div>

          {/* Merge with darkest color — only offered when there's a separate, darker target */}
          {!isDarkest && darkestName && (
            <label className="control-row control-row--toggle" title="Print this plate on the darkest color's screen (one screen, that color's ink). Use for same-ink plates — e.g. a black background folded into your black layer.">
              <span>
                Merge with darkest color
                {color.mergeWithDarkest && (
                  <>
                    {' '}
                    <small style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                      → {darkestName}
                    </small>
                  </>
                )}
              </span>
              <input
                type="checkbox"
                checked={color.mergeWithDarkest ?? false}
                onChange={(e) => onChange({ mergeWithDarkest: e.target.checked })}
                disabled={disabled}
              />
            </label>
          )}
          {!isDarkest && darkestName && color.mergeWithDarkest && darkestHex && hexDistance(color.hex, darkestHex) > 150 && (
            <div style={{ fontSize: 10, color: 'var(--warning, #d99a2b)', marginTop: -2 }}>
              Will print in {darkestName}'s ink, not its own color
            </div>
          )}

          {/* Remove button */}
          <button
            onClick={onRemove}
            disabled={disabled}
            style={{
              marginTop: 4,
              padding: '3px 8px',
              fontSize: 11,
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            Remove color
          </button>
        </div>
      )}
    </div>
  )
}
