import type { ReactNode } from 'react'

interface Option<T> {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
}

interface Props<T> {
  options: Option<T>[]
  /** The selected value, or null when nothing (or a mix) is selected. */
  value: T | null
  onChange: (v: T) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  /** Stretch to the full row width with equal-width buttons (default true). */
  fill?: boolean
}

/** A row of mutually exclusive buttons. */
export function Segmented<T extends string | number | boolean>({
  options, value, onChange, disabled, size = 'md', fill = true,
}: Props<T>) {
  return (
    <div className={`seg seg--${size}${fill ? ' seg--fill' : ''}`} role="group">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          className={`seg__btn${o.value === value ? ' is-active' : ''}`}
          title={o.title}
          disabled={disabled || o.disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
