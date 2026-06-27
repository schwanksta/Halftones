import { useState, useEffect } from 'react'
import { OutputSettings, resolveMargins } from '../types'

interface Props {
  settings: OutputSettings
  sourceAspect: number | null   // kept for API compatibility; no longer used internally
  onChange: (settings: OutputSettings) => void
  disabled: boolean
}

const DPI_PRESETS = [150, 300, 600]

export function OutputControls({ settings, onChange, disabled }: Props) {
  // Round to 2 decimals, dropping trailing zeros (e.g. 13, 18.5, 12.34).
  const fmtIn = (n: number) => String(Math.round(n * 100) / 100)

  // Full printed page size, matching exportPDF's geometry: the image plus the
  // margin on all sides (when enabled) plus the 0.5" crop-mark waste strip
  // (when enabled). This is the actual sheet that comes out of the printer.
  const m = resolveMargins(settings)
  const showM = settings.showMargin !== false
  const cropIn = settings.cropMarks !== false ? 0.5 : 0
  const totalW = settings.widthInches + (showM ? m.left + m.right : 0) + 2 * cropIn
  const totalH = settings.heightInches + (showM ? m.top + m.bottom : 0) + 2 * cropIn

  // Local draft strings so the user can backspace freely while typing.
  // onChange is only called when the typed value is a valid positive number.
  const [widthDraft, setWidthDraft] = useState(String(settings.widthInches))
  const [heightDraft, setHeightDraft] = useState(String(settings.heightInches))

  // Keep drafts in sync when settings change externally (project load, aspect lock, etc.)
  useEffect(() => { setWidthDraft(String(settings.widthInches)) }, [settings.widthInches])
  useEffect(() => { setHeightDraft(String(settings.heightInches)) }, [settings.heightInches])

  // Aspect-ratio lock maintains the *current output ratio*, not the image's
  // natural ratio.  Using the image AR caused wild jumps whenever the saved
  // project dimensions didn't exactly match the image's native proportions.
  const currentAR = settings.heightInches > 0
    ? settings.widthInches / settings.heightInches
    : null

  const commitWidth = (raw: string) => {
    const w = parseFloat(raw)
    if (!w || !isFinite(w) || w <= 0) { setWidthDraft(String(settings.widthInches)); return }
    const next = { ...settings, widthInches: w }
    if (settings.lockAspectRatio && currentAR) {
      next.heightInches = Math.round((w / currentAR) * 100) / 100
    }
    onChange(next)
  }

  const commitHeight = (raw: string) => {
    const h = parseFloat(raw)
    if (!h || !isFinite(h) || h <= 0) { setHeightDraft(String(settings.heightInches)); return }
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
          value={widthDraft}
          onChange={(e) => {
            setWidthDraft(e.target.value)
            const w = parseFloat(e.target.value)
            if (w > 0 && isFinite(w)) commitWidth(e.target.value)
          }}
          onBlur={(e) => commitWidth(e.target.value)}
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
          value={heightDraft}
          onChange={(e) => {
            setHeightDraft(e.target.value)
            const h = parseFloat(e.target.value)
            if (h > 0 && isFinite(h)) commitHeight(e.target.value)
          }}
          onBlur={(e) => commitHeight(e.target.value)}
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

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.marginLinked !== false}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({ ...settings, marginLinked: true })
            } else {
              const m = settings.marginInches ?? 1
              onChange({ ...settings, marginLinked: false, marginTop: m, marginBottom: m, marginLeft: m, marginRight: m })
            }
          }}
          disabled={disabled}
        />
        <span>Link margins</span>
      </label>

      {settings.marginLinked !== false ? (
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
      ) : (
        <>
          <label className="control-row">
            <span>Top / Bottom (in)</span>
            <input
              type="number"
              min={0}
              max={4}
              step={0.25}
              value={settings.marginTop ?? settings.marginInches ?? 1}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                const fallback = settings.marginTop ?? settings.marginInches ?? 1
                const next = isNaN(v) ? fallback : Math.max(0, v)
                onChange({ ...settings, marginTop: next, marginBottom: next })
              }}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) onChange({ ...settings, marginTop: v, marginBottom: v })
              }}
              disabled={disabled}
            />
          </label>

          <label className="control-row">
            <span>Sides (in)</span>
            <input
              type="number"
              min={0}
              max={4}
              step={0.25}
              value={settings.marginLeft ?? settings.marginInches ?? 1}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                const fallback = settings.marginLeft ?? settings.marginInches ?? 1
                const next = isNaN(v) ? fallback : Math.max(0, v)
                onChange({ ...settings, marginLeft: next, marginRight: next })
              }}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) onChange({ ...settings, marginLeft: v, marginRight: v })
              }}
              disabled={disabled}
            />
          </label>
        </>
      )}

      <div
        style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}
        title="Full printed page: image + margin + 0.5&quot; crop-mark waste strip (when enabled)"
      >
        Output: {fmtIn(totalW)} x {fmtIn(totalH)} in
        <span style={{ opacity: 0.7 }}> (image {fmtIn(settings.widthInches)} x {fmtIn(settings.heightInches)})</span>
      </div>

      <div className="subsection-title">PDF Export</div>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.cropMarks !== false}
          onChange={(e) => onChange({ ...settings, cropMarks: e.target.checked })}
          disabled={disabled}
        />
        <span>Crop marks</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.showMargin !== false}
          onChange={(e) => onChange({ ...settings, showMargin: e.target.checked })}
          disabled={disabled}
        />
        <span>Margin</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={!!settings.alignmentMarks}
          onChange={(e) => onChange({ ...settings, alignmentMarks: e.target.checked })}
          disabled={disabled}
        />
        <span>Alignment marks</span>
      </label>

      <label className="control-row" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.vectorPDF !== false}
          onChange={(e) => onChange({ ...settings, vectorPDF: e.target.checked })}
          disabled={disabled}
        />
        <span>Vector dots/lines</span>
      </label>
    </div>
  )
}
