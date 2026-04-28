import { useState, useEffect } from 'react'
import { SpotColor, SpotSettings } from '../types'
import { extractPalette, mergeSimilarColors, labToHex } from '../engine/spot-separation'
import { EditableValue } from './EditableValue'

interface Props {
  settings: SpotSettings
  onChange: (settings: SpotSettings) => void
  /** ImageData to extract palette from (the source image). */
  sourceImageData: ImageData | null
  defaultLpi: number
  disabled: boolean
}

export function SpotColorEditor({ settings, onChange, sourceImageData, defaultLpi, disabled }: Props) {
  const [extracting, setExtracting] = useState(false)

  const update = (partial: Partial<SpotSettings>) => onChange({ ...settings, ...partial })

  const updateColor = (id: string, partial: Partial<SpotColor>) => {
    onChange({
      ...settings,
      colors: settings.colors.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })
  }

  const handleExtract = () => {
    if (!sourceImageData) return
    setExtracting(true)
    // Run in next tick so the UI can update the button state first
    setTimeout(() => {
      try {
        const colors = extractPalette(sourceImageData, settings.numColors, defaultLpi)
        update({ colors })
      } finally {
        setExtracting(false)
      }
    }, 0)
  }

  const handleMerge = () => {
    if (!settings.colors.length) return
    update({ colors: mergeSimilarColors(settings.colors, settings.mergeThreshold) })
  }

  const removeColor = (id: string) => {
    update({ colors: settings.colors.filter((c) => c.id !== id) })
  }

  const setAllRenderMode = (mode: 'flat' | 'halftone') => {
    update({ colors: settings.colors.map((c) => ({ ...c, renderMode: mode })) })
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

      <div className="control-row">
        <span>Vibrancy <EditableValue value={Math.round((settings.vibrancy ?? 0) * 100)} min={0} max={100} step={1} suffix="%" onChange={(v) => update({ vibrancy: v / 100 })} /></span>
        <input
          type="range" min={0} max={1} step={0.01}
          value={settings.vibrancy ?? 0}
          onChange={(e) => update({ vibrancy: Number(e.target.value) })}
          disabled={disabled}
        />
      </div>

      <div className="control-row" title="Expand each color's ink region so layers bleed into each other, hiding visible seams between halftone and flat layers. Per-color overrides this global value.">
        <span>Trap <EditableValue value={settings.trap ?? 0} min={0} max={10} step={1} suffix="px" onChange={(v) => update({ trap: v })} /></span>
        <input
          type="range" min={0} max={10} step={1}
          value={settings.trap ?? 0}
          onChange={(e) => update({ trap: Number(e.target.value) })}
          disabled={disabled}
        />
      </div>

      <div className="control-row">
        <span>Merge ΔE <EditableValue value={settings.mergeThreshold} min={0} max={50} step={1} onChange={(v) => update({ mergeThreshold: v })} /></span>
        <input
          type="range" min={0} max={50} step={1}
          value={settings.mergeThreshold}
          onChange={(e) => update({ mergeThreshold: Number(e.target.value) })}
          disabled={disabled}
        />
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
        {settings.colors.length > 1 && (
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
          onChange={(partial) => updateColor(color.id, partial)}
          onRemove={() => removeColor(color.id)}
        />
      ))}
    </div>
  )
}

// ─── Per-color row ─────────────────────────────────────────────────────────────

interface RowProps {
  color: SpotColor
  index: number
  disabled: boolean
  globalTrap: number
  onChange: (partial: Partial<SpotColor>) => void
  onRemove: () => void
}

function SpotColorRow({ color, index, disabled, globalTrap, onChange, onRemove }: RowProps) {
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
      onChange({ hex: val.toLowerCase() })
      setHexDraft(val.toLowerCase())
    } else {
      // Revert to current valid value
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
                onChange={(e) => setHexDraft(e.target.value)}
                onBlur={(e) => commitHex(e.target.value)}
                disabled={disabled}
                style={{ width: 32, height: 24, padding: 1, cursor: 'pointer', flexShrink: 0 }}
              />
              {isModified && !disabled && (
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
