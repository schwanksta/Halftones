import { useState, useEffect } from 'react'
import { SavedPalette } from '../types'
import { platform } from '../platform'

interface Props {
  /** Current non-background inks, for "Save current as palette". */
  currentInks: { hex: string; name: string }[]
  /** Current background-layer ink, if a background layer exists. */
  currentBackground?: { hex: string; name: string }
  /** Apply a saved palette (parent recolors the layers in order). */
  onApply: (palette: SavedPalette) => void
  disabled: boolean
}

export function PaletteBar({ currentInks, currentBackground, onApply, disabled }: Props) {
  const [palettes, setPalettes] = useState<SavedPalette[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')

  const canSave = currentInks.length > 0 || !!currentBackground

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

  const handleApply = (p: SavedPalette) => {
    onApply(p)
    setOpen(false)
  }

  const handleSave = () => {
    const next: SavedPalette = {
      id: `pal-${Date.now()}`,
      name: draftName.trim() || `Palette ${palettes.length + 1}`,
      colors: currentInks,
      ...(currentBackground ? { background: currentBackground } : {}),
    }
    persist([...palettes, next])
    setDraftName('')
    setSaving(false)
  }

  const handleDelete = (id: string) => {
    persist(palettes.filter((p) => p.id !== id))
  }

  const swatches = (colors: { hex: string }[]) => (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
      {colors.slice(0, 12).map((c, i) => (
        <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c.hex, border: '1px solid rgba(255,255,255,0.18)' }} />
      ))}
    </div>
  )

  return (
    <div style={{ marginBottom: 8 }}>
      {palettes.length > 0 && (
        <button
          className="btn--small btn--block"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          style={{ textAlign: 'left' }}
        >
          {open ? '▾' : '▸'} Saved palettes ({palettes.length})
        </button>
      )}

      {open && palettes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
          {palettes.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                onClick={() => !disabled && handleApply(p)}
                title="Apply this palette"
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 5px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
                }}
              >
                {swatches(p.background ? [p.background, ...p.colors] : p.colors)}
                {p.name && (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {p.name}
                  </span>
                )}
              </div>
              <button className="btn--icon" onClick={() => handleDelete(p.id)} disabled={disabled} title="Delete palette">×</button>
            </div>
          ))}
        </div>
      )}

      {!saving ? (
        <button
          className="btn--small btn--block"
          onClick={() => setSaving(true)}
          disabled={disabled || !canSave}
          style={{ marginTop: 4 }}
        >
          ＋ Save palette
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setSaving(false); setDraftName('') }
            }}
            placeholder="Name (optional)"
            autoFocus
            disabled={disabled}
            style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px' }}
          />
          <button className="btn--small btn--primary" onClick={handleSave} disabled={disabled || !canSave}>Save</button>
          <button className="btn--icon" onClick={() => { setSaving(false); setDraftName('') }} disabled={disabled} title="Cancel">×</button>
        </div>
      )}
    </div>
  )
}
