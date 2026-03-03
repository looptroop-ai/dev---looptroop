import { cn } from '@/lib/utils'
import { Check, Loader2, Circle, AlertTriangle, Minus } from 'lucide-react'

type IndicatorStatus = 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled'

interface StatusIndicatorProps {
  status: IndicatorStatus
  className?: string
}

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  switch (status) {
    case 'completed':
      return <Check className={cn('h-3.5 w-3.5 text-green-500', className)} />
    case 'completed-final':
      return <Check className={cn('h-3.5 w-3.5 text-blue-500', className)} />
    case 'active':
      return <Loader2 className={cn('h-3.5 w-3.5 text-blue-500 animate-spin', className)} />
    case 'canceled':
      return <Minus className={cn('h-3.5 w-3.5 text-muted-foreground', className)} />
    case 'error':
      return <AlertTriangle className={cn('h-3.5 w-3.5 text-red-500', className)} />
    case 'pending':
    default:
      return <Circle className={cn('h-3.5 w-3.5 text-muted-foreground/40', className)} />
  }
}
