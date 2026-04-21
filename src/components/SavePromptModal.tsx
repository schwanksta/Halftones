import { useEffect } from 'react'
import './SavePromptModal.css'

type Choice = 'save' | 'discard' | 'cancel'
interface Props { projectName: string; onChoose: (c: Choice) => void }

export function SavePromptModal({ projectName, onChoose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChoose('cancel')
      else if (e.key === 'Enter') onChoose('save')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChoose])

  return (
    <div className="modal-backdrop" onClick={() => onChoose('cancel')}>
      <div className="save-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="save-prompt-title">Save changes to "{projectName}"?</div>
        <div className="save-prompt-body">Your changes will be lost if you don't save them.</div>
        <div className="save-prompt-buttons">
          <button onClick={() => onChoose('discard')}>Don't Save</button>
          <button onClick={() => onChoose('cancel')}>Cancel</button>
          <button className="primary" onClick={() => onChoose('save')} autoFocus>Save</button>
        </div>
      </div>
    </div>
  )
}
