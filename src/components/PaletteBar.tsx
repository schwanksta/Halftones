import { useState, useEffect } from 'react'
import { SavedPalette } from '../types'
import { platform } from '../platform'

interface Props {
  /** Current non-background inks, for "Save current as palette". */
  currentInks: { hex: string; name: string }[]
  /** Apply a saved palette's inks (parent rebuilds the spot colors). */
  onApply: (inks: { hex: string; name: string }[]) => void
  disabled: boolean
}

const PLACEHOLDER = '__placeholder__'

export function PaletteBar({ currentInks, onApply, disabled }: Props) {
  const [palettes, setPalettes] = useState<SavedPalette[]>([])
  const [selectValue, setSelectValue] = useState(PLACEHOLDER)
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [managing, setManaging] = useState(false)

  // Load persisted palettes once on mount.
  useEffect(() => {
    let cancelled = false
    platform.getPalettes().then((p) => {
      if (cancelled) return
      setPalettes(p ?? [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const persist = (next: SavedPalette[]) => {
    setPalettes(next)
    platform.setPalettes(next).catch(() => {})
  }

  const handleSelect = (id: string) => {
    setSelectValue(id)
    if (id === PLACEHOLDER) return
    const palette = palettes.find((p) => p.id === id)
    if (palette) onApply(palette.colors)
    // Reset back to placeholder so the same palette can be re-applied later.
    setSelectValue(PLACEHOLDER)
  }

  const handleSave = () => {
    const next: SavedPalette = {
      id: `pal-${Date.now()}`,
      name: draftName.trim() || 'Palette',
      colors: currentInks,
    }
    persist([...palettes, next])
    setDraftName('')
    setSaving(false)
  }

  const handleDelete = (id: string) => {
    persist(palettes.filter((p) => p.id !== id))
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div className="control-row" style={{ gap: 6 }}>
        <select
          value={selectValue}
          onChange={(e) => handleSelect(e.target.value)}
          disabled={disabled || palettes.length === 0}
          style={{ flex: 1, fontSize: 11 }}
        >
          <option value={PLACEHOLDER} disabled>Saved palettes…</option>
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {palettes.length > 0 && (
          <button
            onClick={() => setManaging((v) => !v)}
            disabled={disabled}
            title="Manage saved palettes"
            style={{
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: managing ? 'var(--accent)' : 'var(--bg-primary)',
              color: managing ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            🗑
          </button>
        )}
      </div>

      {managing && palettes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
          {palettes.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {p.colors.slice(0, 6).map((c, i) => (
                  <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c.hex, border: '1px solid rgba(255,255,255,0.15)' }} />
                ))}
              </div>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                {p.name}
              </span>
              <button
                onClick={() => handleDelete(p.id)}
                disabled={disabled}
                title="Delete palette"
                style={{
                  padding: '1px 5px',
                  fontSize: 11,
                  lineHeight: 1,
                  borderRadius: 3,
                  border: '1px solid var(--border)',
                  background: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {!saving ? (
        <button
          onClick={() => setSaving(true)}
          disabled={disabled || currentInks.length === 0}
          style={{
            width: '100%',
            marginTop: 4,
            padding: '4px 8px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            cursor: disabled || currentInks.length === 0 ? 'not-allowed' : 'pointer',
            opacity: disabled || currentInks.length === 0 ? 0.5 : 1,
          }}
        >
          ＋ Save palette
        </button>
      ) : (
        <div className="control-row" style={{ gap: 4, marginTop: 4 }}>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setSaving(false); setDraftName('') }
            }}
            placeholder="Palette name"
            autoFocus
            disabled={disabled}
            style={{
              flex: 1,
              fontSize: 11,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 6px',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleSave}
            disabled={disabled || currentInks.length === 0}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--accent)',
              color: '#fff',
              cursor: disabled || currentInks.length === 0 ? 'not-allowed' : 'pointer',
              opacity: disabled || currentInks.length === 0 ? 0.5 : 1,
            }}
          >
            Save
          </button>
          <button
            onClick={() => { setSaving(false); setDraftName('') }}
            disabled={disabled}
            title="Cancel"
            style={{
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >×</button>
        </div>
      )}
    </div>
  )
}
