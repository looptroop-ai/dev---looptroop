import { useRef, useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowDown } from 'lucide-react'

interface AutoScrollProps {
  children: React.ReactNode
  className?: string
  enabled?: boolean
}

export function AutoScroll({ children, className, enabled = true }: AutoScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(enabled)
  const [showButton, setShowButton] = useState(false)

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    if (autoScroll) scrollToBottom()
  }, [children, autoScroll, scrollToBottom])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
    setShowButton(!isAtBottom)
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={className}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {showButton && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-2 right-2 shadow-md"
          onClick={() => { setAutoScroll(true); scrollToBottom() }}
        >
          <ArrowDown className="h-3 w-3 mr-1" /> Resume auto-scroll
        </Button>
      )}
    </div>
  )
}
