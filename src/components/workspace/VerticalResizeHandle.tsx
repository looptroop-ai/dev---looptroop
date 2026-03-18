import { useCallback, useEffect, useRef } from 'react'

interface VerticalResizeHandleProps {
  onResize: (height: number) => void
  containerRef: React.RefObject<HTMLElement | null>
}

export function VerticalResizeHandle({ onResize, containerRef }: VerticalResizeHandleProps) {
  const isDragging = useRef(false)
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null)

  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        document.removeEventListener('mousemove', listenersRef.current.move)
        document.removeEventListener('mouseup', listenersRef.current.up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

  const handleMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const height = Math.max(60, Math.min(rect.bottom - e.clientY, rect.height * 0.7))
      onResize(height)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      listenersRef.current = null
    }

    listenersRef.current = { move: handleMouseMove, up: handleMouseUp }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onResize, containerRef])

  return (
    <div
      className="h-1 cursor-row-resize bg-border hover:bg-primary/50 transition-colors flex-shrink-0"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="horizontal"
    />
  )
}
