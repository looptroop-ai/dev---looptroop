import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface CenteredModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
}

export function CenteredModal({ open, onClose, title, children, maxWidth = 'max-w-2xl' }: CenteredModalProps) {
  const [isSessionDirty, setIsSessionDirty] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSessionDirty(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSessionDirty) {
          const shouldClose = window.confirm('You have unsaved changes. Close this window anyway?')
          if (!shouldClose) return
        }
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose, isSessionDirty])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        if (isSessionDirty) return
        onClose()
      }}
      onChangeCapture={(e) => {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
          setIsSessionDirty(true)
        }
      }}
      onInputCapture={(e) => {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          setIsSessionDirty(true)
        }
      }}
      onSubmitCapture={() => {
        setIsSessionDirty(false)
      }}
    >
      <div className={`${maxWidth} w-full mx-4 bg-background rounded-xl shadow-xl border border-border flex flex-col max-h-[85vh] relative`}>
        <button
          type="button"
          onClick={() => {
            if (isSessionDirty) {
              const shouldClose = window.confirm('You have unsaved changes. Close this window anyway?')
              if (!shouldClose) return
            }
            onClose()
          }}
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
      </div>
    </div>
  )
}
