import type { ReactNode } from 'react'
import { EditableValue } from '../EditableValue'

interface SliderRowProps {
  label: ReactNode
  /** Current value, in the setting's own units. */
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  disabled?: boolean
  title?: string
  suffix?: string
  decimals?: number
  /**
   * The setting is a 0–1 fraction but reads as a percentage: the readout shows
   * `round(value × 100)%` and typed values are divided by 100. The slider keeps
   * working in fraction units.
   */
  percent?: boolean
  /** Grey the row out (control has no effect right now) without disabling the readout. */
  dimmed?: boolean
  /**
   * Give the range input its own scale, independent of the readout — for
   * non-linear sliders (mosaic tile) or finer slider steps than the readout.
   */
  slider?: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }
  /** Rendered after the readout (e.g. a reset button). */
  extra?: ReactNode
}

/** Label + click-to-type readout over a full-width slider. */
export function SliderRow({
  label, value, min, max, step = 1, onChange, disabled, title, suffix, decimals,
  percent, dimmed, slider, extra,
}: SliderRowProps) {
  const range = slider ?? { min, max, step, value, onChange }
  return (
    <div className={`control-row${dimmed ? ' is-dimmed' : ''}`} title={title}>
      <span>
        <span className="control-row__label">{label}</span>
        <span className="control-row__value">
          {percent ? (
            <EditableValue
              value={Math.round(value * 100)}
              min={Math.round(min * 100)}
              max={Math.round(max * 100)}
              step={Math.max(1, Math.round(step * 100))}
              suffix="%"
              onChange={(v) => onChange(v / 100)}
            />
          ) : (
            <EditableValue
              value={value} min={min} max={max} step={step}
              suffix={suffix} decimals={decimals}
              onChange={onChange}
            />
          )}
          {extra}
        </span>
      </span>
      <input
        type="range"
        min={range.min} max={range.max} step={range.step}
        value={range.value}
        onChange={(e) => range.onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  )
}

interface ToggleRowProps {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  title?: string
  dimmed?: boolean
}

/** Label on the left, checkbox on the right. */
export function ToggleRow({ label, checked, onChange, disabled, title, dimmed }: ToggleRowProps) {
  return (
    <label className={`control-row control-row--inline control-row--toggle${dimmed ? ' is-dimmed' : ''}`} title={title}>
      <span className="control-row__label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  )
}

interface SelectRowProps<T extends string> {
  label: ReactNode
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
  title?: string
}

/** Label above a full-width select. */
export function SelectRow<T extends string>({ label, value, options, onChange, disabled, title }: SelectRowProps<T>) {
  return (
    <label className="control-row" title={title}>
      <span className="control-row__label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} disabled={disabled}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

interface ColorRowProps {
  label: ReactNode
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
  title?: string
  dimmed?: boolean
}

/** Label on the left, color swatch picker on the right. */
export function ColorRow({ label, value, onChange, disabled, title, dimmed }: ColorRowProps) {
  return (
    <label className={`control-row control-row--inline${dimmed ? ' is-dimmed' : ''}`} title={title}>
      <span className="control-row__label">{label}</span>
      <input
        type="color"
        className="swatch-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  )
}

/** Small explanatory or warning text between rows. */
export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warn'; children: ReactNode }) {
  return <div className={`row-note${tone === 'warn' ? ' row-note--warn' : ''}`}>{children}</div>
}
