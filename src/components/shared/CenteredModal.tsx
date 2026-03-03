import { useEffect } from 'react'
import { X } from 'lucide-react'

interface CenteredModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
}

export function CenteredModal({ open, onClose, title, children, maxWidth = 'max-w-2xl' }: CenteredModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`${maxWidth} w-full mx-4 bg-background rounded-xl shadow-xl border border-border flex flex-col max-h-[85vh] relative`}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 z-10 flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center border-b border-border px-6 py-4 pr-10">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </div>
    </div>
  )
}
