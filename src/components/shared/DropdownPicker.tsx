import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DropdownPickerProps {
  trigger: React.ReactNode
  children: React.ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DropdownPicker({ trigger, children, open, onOpenChange }: DropdownPickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [positioned, setPositioned] = useState(false)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const margin = 8
    // Always open downward, clamped to stay within viewport
    const top = Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - 420 - margin))
    setPos({
      top,
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - 340)),
    })
  }, [])

  useEffect(() => {
    if (!open) { setPositioned(false); return } // eslint-disable-line react-hooks/set-state-in-effect
    updatePosition()
    setPositioned(true)
    const handler = (e: MouseEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange, updatePosition])

  return (
    <div ref={ref} className="relative inline-block">
      <div ref={triggerRef} onClick={() => onOpenChange(!open)}>{trigger}</div>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] rounded-lg border border-border bg-popover shadow-xl p-3 animate-in fade-in-0 zoom-in-95"
          style={{
            top: pos.top,
            left: pos.left,
            maxHeight: `calc(100vh - ${pos.top}px - 8px)`,
            overflowY: 'auto',
            visibility: positioned ? 'visible' : 'hidden',
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

// Reusable icon picker trigger button
export function PickerTrigger({
  label,
  value,
  className,
}: {
  label?: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      <span className="text-xl leading-none">{value}</span>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  )
}
