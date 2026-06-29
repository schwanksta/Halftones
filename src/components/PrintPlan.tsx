import { useState, useEffect, useMemo } from 'react'
import {
  HalftoneSettings, SpotSettings, CMYKSettings, MaskSettings, OutputSettings,
  ShopProfile, ShopFrame, DEFAULT_SHOP_PROFILE,
} from '../types'
import { platform } from '../platform'
import { derivePlates, planScreens } from '../engine/print-plan'

interface Props {
  halftoneSettings: HalftoneSettings
  spotSettings: SpotSettings
  cmykSettings: CMYKSettings
  outputSettings: OutputSettings
  maskSettings: MaskSettings
  disabled: boolean
}

const fmtIn = (n: number) => String(Math.round(n * 100) / 100)

export function PrintPlan({
  halftoneSettings, spotSettings, cmykSettings, outputSettings, maskSettings, disabled,
}: Props) {
  const [profile, setProfile] = useState<ShopProfile>(DEFAULT_SHOP_PROFILE)
  const [editing, setEditing] = useState(false)
  // Per-frame mesh text drafts so the comma list can be typed freely.
  const [meshDrafts, setMeshDrafts] = useState<string[]>(() => DEFAULT_SHOP_PROFILE.frames.map(f => f.meshes.join(', ')))

  // Load persisted profile once on mount.
  useEffect(() => {
    let cancelled = false
    platform.getShopProfile().then((p) => {
      if (cancelled || !p) return
      setProfile(p)
      setMeshDrafts(p.frames.map(f => f.meshes.join(', ')))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Persist + update state together.
  const update = (next: ShopProfile) => {
    setProfile(next)
    platform.setShopProfile(next).catch(() => {})
  }

  const plan = useMemo(() => {
    const plates = derivePlates(halftoneSettings.colorMode, halftoneSettings, spotSettings, cmykSettings, maskSettings)
    return planScreens(plates, outputSettings, profile)
  }, [halftoneSettings, spotSettings, cmykSettings, maskSettings, outputSettings, profile])

  // ── Editor mutations ──────────────────────────────────────────────────────
  const setFrame = (i: number, patch: Partial<ShopFrame>) => {
    const frames = profile.frames.map((f, idx) => (idx === i ? { ...f, ...patch } : f))
    update({ ...profile, frames })
  }
  const commitMesh = (i: number, text: string) => {
    const meshes = text.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
    setFrame(i, { meshes })
    setMeshDrafts(d => d.map((t, idx) => (idx === i ? meshes.join(', ') : t)))
  }
  const addFrame = () => {
    update({ ...profile, frames: [...profile.frames, { widthIn: 20, heightIn: 24, meshes: [110, 156, 230] }] })
    setMeshDrafts(d => [...d, '110, 156, 230'])
  }
  const removeFrame = (i: number) => {
    update({ ...profile, frames: profile.frames.filter((_, idx) => idx !== i) })
    setMeshDrafts(d => d.filter((_, idx) => idx !== i))
  }

  return (
    <div className="control-section">
      <div className="subsection-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Print Plan</span>
        <button
          onClick={() => setEditing(e => !e)}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          {editing ? 'Done' : 'Edit screens'}
        </button>
      </div>

      {disabled ? (
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0', lineHeight: 1.4 }}>
          Load an image to see the recommended screens and mesh.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <strong>{plan.plateCount}</strong> screen{plan.plateCount === 1 ? '' : 's'}
            {plan.frame && (
              <> · recommend <strong>{fmtIn(plan.frame.widthIn)}×{fmtIn(plan.frame.heightIn)}″</strong></>
            )}
          </div>

          {plan.plates.map((pp, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.4, marginBottom: pp.warning ? 3 : 0 }}>
              <div className="control-row" style={{ padding: 0 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {pp.plate.name} <span style={{ opacity: 0.6 }}>· {pp.plate.kind}{pp.plate.lpi != null ? ` ${pp.plate.lpi} LPI` : ''}</span>
                </span>
                <strong>{pp.mesh ? `${pp.mesh} mesh` : '—'}</strong>
              </div>
              {pp.warning && (
                <div style={{ color: 'var(--warning, #d99a2b)', fontSize: 10, paddingLeft: 2 }}>⚠ {pp.warning}</div>
              )}
            </div>
          ))}

          {plan.twoUpFrame && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              Two-up: fits on <strong>{fmtIn(plan.twoUpFrame.widthIn)}×{fmtIn(plan.twoUpFrame.heightIn)}″</strong> (double output per pull)
            </div>
          )}

          {plan.notes.map((n, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--warning, #d99a2b)', marginTop: 4 }}>⚠ {n}</div>
          ))}
        </>
      )}

      {editing && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Your screens — size (in) and the mesh counts each comes in:
          </div>
          {profile.frames.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
              <input type="number" min={1} max={60} step={1} value={f.widthIn}
                onChange={(e) => setFrame(i, { widthIn: Number(e.target.value) })}
                style={{ width: 38 }} title="Width (in)" />
              <span style={{ fontSize: 11, opacity: 0.6 }}>×</span>
              <input type="number" min={1} max={60} step={1} value={f.heightIn}
                onChange={(e) => setFrame(i, { heightIn: Number(e.target.value) })}
                style={{ width: 38 }} title="Height (in)" />
              <input type="text" value={meshDrafts[i] ?? ''}
                onChange={(e) => setMeshDrafts(d => d.map((t, idx) => (idx === i ? e.target.value : t)))}
                onBlur={(e) => commitMesh(i, e.target.value)}
                placeholder="110, 156, 230"
                style={{ flex: 1, minWidth: 0 }} title="Mesh counts (comma-separated)" />
              <button onClick={() => removeFrame(i)} title="Remove"
                style={{ fontSize: 11, padding: '2px 5px', border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', borderRadius: 3, cursor: 'pointer' }}>×</button>
            </div>
          ))}
          <button onClick={addFrame}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 6 }}>
            + Add frame
          </button>
          <label className="control-row" title="Rails + squeegee/flood buffer reserved on each side. Usable image area ≈ frame − 2× this.">
            <span>Edge clearance (in)</span>
            <input type="number" min={0} max={8} step={0.25} value={profile.edgeClearanceIn}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) update({ ...profile, edgeClearanceIn: Math.max(0, v) }) }}
              style={{ width: 60 }} />
          </label>
        </div>
      )}
    </div>
  )
}
