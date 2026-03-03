import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RerunControlsProps {
  phase: 'interview' | 'prd' | 'beads'
  onRerun: (phase: string) => void
  disabled?: boolean
}

export function RerunControls({ phase, onRerun, disabled }: RerunControlsProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onRerun(phase)}
      disabled={disabled}
      className="flex items-center gap-1.5"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      Re-run {phase}
    </Button>
  )
}
