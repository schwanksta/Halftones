import { useRef, useMemo } from 'react'
import { MaskSettings, MaskImage, MaskSourceMode, DEFAULT_MASK_SETTINGS } from '../types'
import { loadMaskFromBytes } from '../engine/mask'
import { SliderRow, ToggleRow, SelectRow, ColorRow, Note } from './ui/rows'

interface Props {
  maskSettings: MaskSettings
  mask: MaskImage | null
  outputSettings: { widthInches: number; heightInches: number; dpi: number }
  onMaskSettingsChange: (s: MaskSettings) => void
  onMaskLoad: (m: MaskImage) => void
  onMaskClear: () => void
  disabled: boolean
}

const SOURCE_MODE_LABELS: Record<MaskSourceMode, string> = {
  auto:       'Auto',
  alpha:      'Alpha',
  luminance:  'Luminance',
}

export function MaskControls({
  maskSettings,
  mask,
  outputSettings,
  onMaskSettingsChange,
  onMaskLoad,
  onMaskClear,
  disabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const recW = Math.round(outputSettings.widthInches  * outputSettings.dpi)
  const recH = Math.round(outputSettings.heightInches * outputSettings.dpi)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      const loaded = await loadMaskFromBytes(bytes, file.name)
      onMaskLoad(loaded)
      // Auto-enable the mask when a file is loaded
      onMaskSettingsChange({ ...maskSettings, enabled: true })
    } catch (err) {
      console.error('Failed to load mask:', err)
    }
    // Reset the input so the same file can be re-loaded
    e.target.value = ''
  }

  const handleClear = () => {
    onMaskClear()
    onMaskSettingsChange({ ...DEFAULT_MASK_SETTINGS })
  }

  const maskOff = disabled || !mask || !maskSettings.enabled
  const set = (partial: Partial<MaskSettings>) => onMaskSettingsChange({ ...maskSettings, ...partial })

  return (
    <>
      {/* Load / Clear buttons */}
      <div className="btn-row">
        <button
          className="btn--small"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{ flex: 1 }}
          title="Load an SVG (preferred, resolution-independent) or raster PNG/JPG/WebP mask"
        >
          {mask ? 'Replace mask' : 'Load mask…'}
        </button>
        {mask && (
          <button className="btn--small btn--ghost" onClick={handleClear} title="Remove the loaded mask">
            Clear
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {/* Thumbnail + filename */}
      {mask && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <MaskThumbnail mask={mask} />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all', flex: 1 }}>
            {mask.fileName}
            {mask.isSvg && (
              <span style={{ color: 'var(--accent)', marginLeft: 4 }}>SVG</span>
            )}
          </div>
        </div>
      )}

      <ToggleRow
        label="Enable mask"
        checked={maskSettings.enabled}
        onChange={(v) => set({ enabled: v })}
        disabled={disabled || !mask}
      />
      <ToggleRow
        label="Invert"
        checked={maskSettings.invert}
        onChange={(v) => set({ invert: v })}
        disabled={maskOff}
      />
      <SelectRow
        label="Source"
        value={maskSettings.source}
        options={(Object.keys(SOURCE_MODE_LABELS) as MaskSourceMode[]).map((mode) => ({ value: mode, label: SOURCE_MODE_LABELS[mode] }))}
        onChange={(v) => set({ source: v })}
        disabled={maskOff}
      />
      <ToggleRow
        label="Stroke (keyline)"
        checked={maskSettings.strokeEnabled ?? false}
        onChange={(v) => set({ strokeEnabled: v })}
        disabled={maskOff}
      />

      {maskSettings.strokeEnabled && (
        <>
          <SliderRow
            label="Stroke width"
            value={maskSettings.strokeWidthInches ?? 0.05}
            min={0.01} max={0.25} step={0.01} decimals={2} suffix={'"'}
            onChange={(v) => set({ strokeWidthInches: v })}
            disabled={maskOff}
          />
          <ColorRow
            label="Stroke color"
            value={maskSettings.strokeColor ?? '#000000'}
            onChange={(v) => set({ strokeColor: v })}
            disabled={maskOff}
          />
        </>
      )}

      <Note>
        Recommended raster size: {recW} × {recH} px. SVG is preferred — it scales to any DPI.
        <br />
        White = keep, black = cut.
        {maskSettings.source !== 'luminance' && ' Alpha: opaque = keep.'}
      </Note>
    </>
  )
}

/** Small thumbnail preview of the loaded mask image. */
function MaskThumbnail({ mask }: { mask: MaskImage }) {
  const thumbStyle: React.CSSProperties = {
    width: 48, height: 48,
    objectFit: 'contain',
    border: '1px solid var(--border)',
    borderRadius: 3,
    background: '#fff',
    flexShrink: 0,
  }

  // Memoize the thumbnail src so we don't re-encode on every parent re-render.
  const src = useMemo(() => {
    if (mask.isSvg && mask.svgText) {
      return `data:image/svg+xml,${encodeURIComponent(mask.svgText)}`
    }
    if (mask.rawBytes?.length) {
      const ext = mask.fileName.toLowerCase().split('.').pop() ?? 'png'
      const mimeTypes: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      }
      const mime = mimeTypes[ext] ?? 'image/png'
      // Encode raw bytes as base64 data URL for the thumbnail.
      // rawBytes is typically a modest-sized mask file; for very large rasters
      // the user is encouraged to use SVG instead (per the size hint in the UI).
      const binary = Array.from(mask.rawBytes).map(b => String.fromCharCode(b)).join('')
      return `data:${mime};base64,${btoa(binary)}`
    }
    if (mask.element) {
      const c = document.createElement('canvas')
      c.width = 48; c.height = 48
      c.getContext('2d')!.drawImage(mask.element, 0, 0, 48, 48)
      return c.toDataURL()
    }
    return null
  // mask reference changes when a new mask is loaded, so rawBytes identity is stable
  }, [mask])

  if (!src) return null
  return <img src={src} alt="mask preview" style={thumbStyle} />
}
