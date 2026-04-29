import { OutputSettings } from '../types'

interface Props {
  settings: OutputSettings
  sourceAspect: number | null   // kept for API compatibility; no longer used internally
  onChange: (settings: OutputSettings) => void
  disabled: boolean
}

const DPI_PRESETS = [150, 300, 600]

export function OutputControls({ settings, onChange, disabled }: Props) {
  const pixelWidth = Math.round(settings.widthInches * settings.dpi)
  const pixelHeight = Math.round(settings.heightInches * settings.dpi)

  // Aspect-ratio lock maintains the *current output ratio*, not the image's
  // natural ratio.  Using the image AR caused wild jumps whenever the saved
  // project dimensions didn't exactly match the image's native proportions.
  const currentAR = settings.heightInches > 0
    ? settings.widthInches / settings.heightInches
    : null

  const updateWidth = (w: number) => {
    const next = { ...settings, widthInches: w }
    if (settings.lockAspectRatio && currentAR) {
      next.heightInches = Math.round((w / currentAR) * 100) / 100
    }
    onChange(next)
  }

  const updateHeight = (h: number) => {
    const next = { ...settings, heightInches: h }
    if (settings.lockAspectRatio && currentAR) {
      next.widthInches = Math.round(h * currentAR * 100) / 100
    }
    onChange(next)
  }

  return (
    <div className="control-section">
      <h3 className="section-title">Output</h3>

      <label className="control-row">
        <span>Width (inches)</span>
        <input
          type="number"
          min={1}
          max={60}
          step={0.5}
          value={settings.widthInches}
          onChange={(e) => updateWidth(Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label className="control-row">
        <span>Height (inches)</span>
        <input
          type="number"
          min={1}
          max={60}
          step={0.5}
          value={settings.heightInches}
          onChange={(e) => updateHeight(Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.lockAspectRatio}
          onChange={(e) => onChange({ ...settings, lockAspectRatio: e.target.checked })}
          disabled={disabled}
        />
        <span>Lock aspect ratio</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.cropMarks !== false}
          onChange={(e) => onChange({ ...settings, cropMarks: e.target.checked })}
          disabled={disabled}
        />
        <span>Crop marks (PDF)</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.showMargin !== false}
          onChange={(e) => onChange({ ...settings, showMargin: e.target.checked })}
          disabled={disabled}
        />
        <span>Margin (PDF)</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.vectorPDF !== false}
          onChange={(e) => onChange({ ...settings, vectorPDF: e.target.checked })}
          disabled={disabled}
        />
        <span>Vector PDF (dots/lines)</span>
      </label>

      <label className="control-row">
        <span>DPI</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {DPI_PRESETS.map((dpi) => (
            <button
              key={dpi}
              className={settings.dpi === dpi ? 'active' : ''}
              onClick={() => onChange({ ...settings, dpi })}
              disabled={disabled}
              style={{
                flex: 1,
                background: settings.dpi === dpi ? 'var(--accent)' : undefined,
                color: settings.dpi === dpi ? '#fff' : undefined,
              }}
            >
              {dpi}
            </button>
          ))}
        </div>
      </label>

      <label className="control-row">
        <span>Custom DPI</span>
        <input
          type="number"
          min={72}
          max={1200}
          value={settings.dpi}
          onChange={(e) => onChange({ ...settings, dpi: Number(e.target.value) })}
          disabled={disabled}
        />
      </label>

      <label className="control-row">
        <span>Margin (inches)</span>
        <input
          type="number"
          min={0}
          max={4}
          step={0.25}
          value={settings.marginInches ?? 1}
          onBlur={(e) => {
            const v = parseFloat(e.target.value)
            onChange({ ...settings, marginInches: isNaN(v) ? 1 : Math.max(0, v) })
          }}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) onChange({ ...settings, marginInches: v })
          }}
          disabled={disabled}
        />
      </label>

      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
        Output: {pixelWidth} x {pixelHeight} px
      </div>
    </div>
  )
}
