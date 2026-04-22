import { useEffect } from 'react'
import './Toast.css'

interface Props { message: string; onDismiss: () => void }

export function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="toast" onClick={onDismiss}>{message}</div>
  )
}
