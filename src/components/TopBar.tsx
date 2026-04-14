import { ReactNode, useRef, useState } from 'react'
import { ImageLoader } from './ImageLoader'
import { SourceImage } from '../types'

interface Props {
  onImageLoad: (image: SourceImage) => void
  fileName?: string
  projectName: string
  projectNames: string[]
  onProjectNameChange: (name: string) => void
  onLoadProject: (name: string) => void
  onDeleteProject: (name: string) => void
  children?: ReactNode
}

export function TopBar({
  onImageLoad,
  fileName,
  projectName,
  projectNames,
  onProjectNameChange,
  onLoadProject,
  onDeleteProject,
  children,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showProjects, setShowProjects] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    setDraft(projectName)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = () => {
    const name = draft.trim() || 'untitled'
    onProjectNameChange(name)
    setEditing(false)
  }

  const isSaved = projectNames.includes(projectName)

  return (
    <div className="top-bar">
      {/* Project name — click to rename */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent)',
              borderRadius: 4,
              padding: '2px 6px',
              color: 'var(--text-primary)',
              width: 160,
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={startEdit}
            title="Click to rename project"
            style={{
              background: 'none',
              border: 'none',
              padding: '2px 4px',
              cursor: 'text',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              borderRadius: 4,
            }}
          >
            {projectName}
          </button>
        )}

        {/* Saved indicator */}
        <span
          title={isSaved ? 'Project saved' : 'Not yet saved'}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isSaved ? 'var(--accent)' : 'var(--text-secondary)',
            opacity: isSaved ? 0.9 : 0.4,
            flexShrink: 0,
          }}
        />

        {/* Projects dropdown — always visible */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowProjects((v) => !v)}
            title="All projects"
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            ▾ Projects
          </button>
          {showProjects && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 100,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 4,
                minWidth: 200,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              {projectNames.length === 0 && (
                <div style={{ padding: '6px 8px', color: 'var(--text-secondary)', fontSize: 12 }}>
                  No saved projects yet
                </div>
              )}
              {projectNames.map((name) => {
                const isActive = name === projectName
                return (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 4px',
                      borderRadius: 4,
                      background: isActive ? 'var(--bg-tertiary, rgba(255,255,255,0.06))' : undefined,
                    }}
                  >
                    <span style={{ width: 14, textAlign: 'center', fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
                      {isActive ? '✓' : ''}
                    </span>
                    <button
                      onClick={() => { if (!isActive) onLoadProject(name); setShowProjects(false) }}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                        cursor: isActive ? 'default' : 'pointer',
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        padding: '2px 4px',
                      }}
                    >
                      {name}
                    </button>
                    <button
                      onClick={() => { onDeleteProject(name); setShowProjects(false) }}
                      title="Delete project"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '2px 4px',
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <ImageLoader onImageLoad={onImageLoad} />
      {fileName && <span style={{ color: 'var(--text-secondary)', fontSize: 12, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        {children}
      </div>
    </div>
  )
}
