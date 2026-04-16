import { useState, useEffect, useRef } from 'react'

interface Props {
  /** The value to display and edit (already in display units, e.g. 45 for degrees). */
  value: number
  min: number
  max: number
  step?: number
  /** Decimal places shown in display mode. Edit mode always allows typing freely. */
  decimals?: number
  suffix?: string
  onChange: (v: number) => void
}

/**
 * Displays a numeric value as a styled <strong>.
 * Click to edit inline; Enter/Tab commits, Escape reverts.
 * Value is clamped to [min, max] on commit.
 */
export function EditableValue({ value, min, max, step = 1, decimals = 0, suffix = '', onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // When edit mode opens, pre-fill with current value
  useEffect(() => {
    if (editing) {
      setDraft(decimals > 0 ? value.toFixed(decimals) : String(value))
      // Select all on next tick so the user can just type
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
    setEditing(false)
  }

  const displayVal = decimals > 0 ? value.toFixed(decimals) : String(value)

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          width: Math.max(36, displayVal.length * 8 + (suffix.length * 7) + 16),
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'inherit',
          background: 'var(--bg-primary)',
          border: '1px solid var(--accent)',
          borderRadius: 3,
          padding: '0 3px',
          color: 'var(--text-primary)',
          textAlign: 'right',
          // hide the browser spin buttons — we're using the slider for that
          MozAppearance: 'textfield' as React.CSSProperties['MozAppearance'],
        }}
      />
    )
  }

  return (
    <strong
      onClick={() => setEditing(true)}
      title="Click to type a value"
      style={{
        cursor: 'text',
        borderBottom: '1px dotted color-mix(in srgb, var(--text-secondary) 60%, transparent)',
        paddingBottom: 1,
        userSelect: 'none',
      }}
    >
      {displayVal}{suffix}
    </strong>
  )
}
