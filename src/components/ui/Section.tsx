import type { ReactNode } from 'react'
import { usePersistedOpen } from './ui-state'

interface SectionProps {
  /** Stable key for remembering open/closed state. */
  id: string
  title: string
  defaultOpen?: boolean
  /** Optional control shown at the right of the header (e.g. Reset). */
  action?: ReactNode
  children: ReactNode
}

/** Top-level collapsible sidebar section. */
export function Section({ id, title, defaultOpen = true, action, children }: SectionProps) {
  const [open, toggle] = usePersistedOpen(`section:${id}`, defaultOpen)
  return (
    <section className="section">
      <div className="section__header">
        <button type="button" className="section__toggle" onClick={toggle} aria-expanded={open}>
          <span className="chev">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        {action}
      </div>
      {open && <div className="section__body">{children}</div>}
    </section>
  )
}

interface GroupProps {
  id: string
  title: string
  /** Short status shown at the right of the header, e.g. "5 inks" or "On". */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/** Collapsible sub-group inside a Section. */
export function Group({ id, title, summary, defaultOpen = false, children }: GroupProps) {
  const [open, toggle] = usePersistedOpen(`group:${id}`, defaultOpen)
  return (
    <div className="group">
      <button type="button" className="group__toggle" onClick={toggle} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        {title}
        {summary != null && <span className="group__summary">{summary}</span>}
      </button>
      {open && <div className="group__body">{children}</div>}
    </div>
  )
}
