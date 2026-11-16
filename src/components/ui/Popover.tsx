import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Button content. */
  label: ReactNode
  title?: string
  /** Which edge of the button the panel lines up with. */
  align?: 'left' | 'right'
  buttonClassName?: string
  disabled?: boolean
  /** Panel content, or a function that receives `close` (for menus that close on pick). */
  children: ReactNode | ((close: () => void) => ReactNode)
}

/** A button that opens a small floating panel. Closes on outside click or Esc. */
export function Popover({ label, title, align = 'left', buttonClassName, disabled, children }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Let a focused field handle its own Esc (cancel typing) first.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) return
      // Capture phase + stop: Esc closes the menu without also leaving edit mode.
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="popover" ref={rootRef}>
      <button
        type="button"
        className={buttonClassName}
        title={title}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className={`popover__panel popover__panel--${align}`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}
