import type { ReactNode } from 'react'

interface Props {
  /** CSS color for the swatch. */
  swatch: string
  name: ReactNode
  /** Small status text at the right of the name (e.g. "Flat", "55 LPI"). */
  badge?: ReactNode
  /** Small pill before the badge (e.g. "BG"). */
  tag?: ReactNode
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  enableTitle?: string
  disabled?: boolean
  expanded: boolean
  onToggleExpanded: () => void
  /**
   * 'grip' = draggable (reports pointer-down to the list, which owns the drag);
   * 'spacer' = fixed position but aligned with draggable rows; 'none' = no column.
   */
  grip?: 'grip' | 'spacer' | 'none'
  onGripDown?: (clientY: number) => void
  /** Index among the draggable rows — the list resolves drop targets from it. */
  rowIdx?: number
  isDropTarget?: boolean
  isDragging?: boolean
  children: ReactNode
}

/**
 * One plate in a plate list: a header (swatch, name, status, enable checkbox)
 * that expands to that plate's settings. Shared by CMYK channels, spot inks,
 * the underbase and the key plate so every plate looks and behaves the same.
 */
export function PlateRowShell({
  swatch, name, badge, tag, enabled, onEnabledChange, enableTitle, disabled,
  expanded, onToggleExpanded, grip = 'none', onGripDown, rowIdx, isDropTarget, isDragging,
  children,
}: Props) {
  const headerClass = `plate-row__header${isDropTarget ? ' is-drop-target' : ''}${isDragging ? ' is-dragging' : ''}`
  return (
    <div className={`plate-row${enabled ? '' : ' is-off'}`}>
      <div className={headerClass} data-row-idx={rowIdx} onClick={onToggleExpanded}>
        {/* Drag handle — pointer-based, not HTML5 drag-and-drop: Tauri's native
            file-drop handler intercepts OS drag events, so HTML5 DnD never
            reaches the webview (and disabling it would break drag-to-open). */}
        {grip === 'grip' && (
          <span
            className="plate-row__grip"
            title="Drag to reorder — this is the print order"
            style={disabled ? { cursor: 'default' } : undefined}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (disabled) return
              e.preventDefault()
              e.stopPropagation()
              onGripDown?.(e.clientY)
            }}
          >
            ⠿
          </span>
        )}
        {grip === 'spacer' && <span className="plate-row__grip" style={{ cursor: 'default' }} />}
        <div className="plate-row__swatch" style={{ background: swatch }} />
        <span className="plate-row__name">{name}</span>
        {tag && <span className="plate-row__tag">{tag}</span>}
        {badge && <span className="plate-row__badge">{badge}</span>}
        <input
          type="checkbox"
          checked={enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onEnabledChange(e.target.checked)}
          disabled={disabled}
          title={enableTitle}
          style={{ flexShrink: 0 }}
        />
        <span className="chev">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && <div className="plate-row__body">{children}</div>}
    </div>
  )
}
