import { useEffect, useState } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface ActiveBeadCountdownProps {
  startedAt: string
  perIterationTimeoutMs: number
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function ActiveBeadCountdown({ startedAt, perIterationTimeoutMs }: ActiveBeadCountdownProps) {
  const [remainingMs, setRemainingMs] = useState(() => {
    const startMs = new Date(startedAt).getTime()
    const now = Date.now()
    return Math.max(0, perIterationTimeoutMs - (now - startMs))
  })

  useEffect(() => {
    const interval = setInterval(() => {
      const startMs = new Date(startedAt).getTime()
      const now = Date.now()
      setRemainingMs(Math.max(0, perIterationTimeoutMs - (now - startMs)))
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt, perIterationTimeoutMs])

  if (perIterationTimeoutMs <= 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="font-mono text-muted-foreground ml-1">
          - {formatTime(remainingMs)} / {formatTime(perIterationTimeoutMs)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Time remaining for the current bead iteration before it times out and is retried.
      </TooltipContent>
    </Tooltip>
  )
}
