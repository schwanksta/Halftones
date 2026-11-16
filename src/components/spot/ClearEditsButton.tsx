import { useState, useEffect } from 'react'

/**
 * "Clear edits" with an inline two-step confirm: the first click arms it, a
 * second click on "Yes, clear" discards the edits, and it disarms itself after
 * a few seconds. Hand-painted edits have no undo, so this must never fire from
 * a single stray click. (Inline rather than window.confirm, which the Tauri
 * webview doesn't reliably support.)
 */
export function ClearEditsButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <div className="plate-row__footer">
      {armed ? (
        <>
          <span className="row-note row-note--warn" style={{ margin: 0 }}>{label} — can't be undone.</span>
          <button className="btn--small btn--ghost" onClick={() => setArmed(false)} disabled={disabled}>Cancel</button>
          <button
            className="btn--small btn--danger"
            onClick={() => { setArmed(false); onConfirm() }}
            disabled={disabled}
          >
            Yes, clear
          </button>
        </>
      ) : (
        <button className="btn--small btn--ghost" onClick={() => setArmed(true)} disabled={disabled} title={label}>
          Clear edits…
        </button>
      )}
    </div>
  )
}
