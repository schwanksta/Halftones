import { useState, useEffect } from 'react'
import {
  OutputSettings, HalftoneSettings, SpotSettings, CMYKSettings, MaskSettings, resolveMargins,
} from '../types'
import { Section, Group } from './ui/Section'
import { ToggleRow } from './ui/rows'
import { Segmented } from './ui/Segmented'
import { PrintPlan } from './PrintPlan'

interface Props {
  settings: OutputSettings
  onChange: (settings: OutputSettings) => void
  halftoneSettings: HalftoneSettings
  spotSettings: SpotSettings
  cmykSettings: CMYKSettings
  maskSettings: MaskSettings
  disabled: boolean
}

const DPI_PRESETS = [150, 300, 600]

// Round to 2 decimals, dropping trailing zeros (e.g. 13, 18.5, 12.34).
const fmtIn = (n: number) => String(Math.round(n * 100) / 100)

/** The physical output: size, resolution, margins and the screen-room plan. */
export function PrintSection({
  settings, onChange, halftoneSettings, spotSettings, cmykSettings, maskSettings, disabled,
}: Props) {
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

  const linked = settings.marginLinked !== false

  /** A margin number field bound to one or two per-side keys. */
  const marginField = (
    label: string,
    value: number,
    apply: (v: number) => Partial<OutputSettings>,
    fallback: number,
  ) => (
    <label className="control-row control-row--inline">
      <span className="control-row__label">{label}</span>
      <input
        type="number" min={0} max={4} step={0.25}
        value={value}
        style={{ width: 80 }}
        onBlur={(e) => {
          const v = parseFloat(e.target.value)
          onChange({ ...settings, ...apply(isNaN(v) ? fallback : Math.max(0, v)) })
        }}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange({ ...settings, ...apply(v) })
        }}
        disabled={disabled}
      />
    </label>
  )

  const base = settings.marginInches ?? 1
  const topBottom = settings.marginTop ?? base
  const sides = settings.marginLeft ?? base

  return (
    <Section id="print" title="Print" defaultOpen={false}>
      <label className="control-row control-row--inline">
        <span className="control-row__label">Width (in)</span>
        <input
          type="number" min={1} max={60} step={0.5}
          value={widthDraft}
          style={{ width: 80 }}
          onChange={(e) => {
            setWidthDraft(e.target.value)
            const w = parseFloat(e.target.value)
            if (w > 0 && isFinite(w)) commitWidth(e.target.value)
          }}
          onBlur={(e) => commitWidth(e.target.value)}
          disabled={disabled}
        />
      </label>

      <label className="control-row control-row--inline">
        <span className="control-row__label">Height (in)</span>
        <input
          type="number" min={1} max={60} step={0.5}
          value={heightDraft}
          style={{ width: 80 }}
          onChange={(e) => {
            setHeightDraft(e.target.value)
            const h = parseFloat(e.target.value)
            if (h > 0 && isFinite(h)) commitHeight(e.target.value)
          }}
          onBlur={(e) => commitHeight(e.target.value)}
          disabled={disabled}
        />
      </label>

      <ToggleRow
        label="Lock aspect ratio"
        checked={settings.lockAspectRatio}
        onChange={(v) => onChange({ ...settings, lockAspectRatio: v })}
        disabled={disabled}
      />

      <div className="control-row">
        <span className="control-row__label">DPI</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <Segmented
              options={DPI_PRESETS.map((dpi) => ({ value: dpi, label: String(dpi) }))}
              value={DPI_PRESETS.includes(settings.dpi) ? settings.dpi : null}
              onChange={(dpi) => onChange({ ...settings, dpi })}
              disabled={disabled}
            />
          </div>
          <input
            type="number" min={72} max={1200}
            value={settings.dpi}
            title="Custom DPI"
            style={{ width: 72 }}
            onChange={(e) => onChange({ ...settings, dpi: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>

      <Group id="print.margins" title="Margins" summary={linked ? `${fmtIn(base)}"` : 'Per side'} defaultOpen>
        <ToggleRow
          label="Link margins"
          checked={linked}
          onChange={(checked) => {
            if (checked) {
              onChange({ ...settings, marginLinked: true })
            } else {
              onChange({ ...settings, marginLinked: false, marginTop: base, marginBottom: base, marginLeft: base, marginRight: base })
            }
          }}
          disabled={disabled}
        />
        {linked ? (
          marginField('Margin (in)', base, (v) => ({ marginInches: v }), 1)
        ) : (
          <>
            {marginField('Top / Bottom (in)', topBottom, (v) => ({ marginTop: v, marginBottom: v }), topBottom)}
            {marginField('Sides (in)', sides, (v) => ({ marginLeft: v, marginRight: v }), sides)}
          </>
        )}
      </Group>

      <div
        className="row-note"
        title={'Full printed page: image + margin + 0.5" crop-mark waste strip (when enabled in Export → PDF)'}
      >
        Sheet: {fmtIn(totalW)} × {fmtIn(totalH)} in
        <span style={{ opacity: 0.7 }}> (image {fmtIn(settings.widthInches)} × {fmtIn(settings.heightInches)})</span>
      </div>

      <Group id="print.plan" title="Print plan" defaultOpen>
        <PrintPlan
          halftoneSettings={halftoneSettings}
          spotSettings={spotSettings}
          cmykSettings={cmykSettings}
          outputSettings={settings}
          maskSettings={maskSettings}
          disabled={disabled}
        />
      </Group>
    </Section>
  )
}
