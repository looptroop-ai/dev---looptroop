import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'


interface FullScreenModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function FullScreenModal({ open, onClose, title, children }: FullScreenModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 z-10 flex items-center justify-center h-8 w-8 rounded-md border border-border bg-muted text-foreground hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
        title="Close window (Esc)"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <div className="flex items-center border-b border-border px-6 py-4 pr-10">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>,
    document.body
  )
}
