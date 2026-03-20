import { cn } from '@/lib/utils'
import { EFFORT_META, intensityColorClass } from '@/lib/effortMeta'

interface EffortBadgeProps {
  variant: string
  className?: string
}

export function EffortBadge({ variant, className }: EffortBadgeProps) {
  const meta = EFFORT_META[variant]
  if (!meta) return <span className={cn('text-xs font-mono', className)}>{variant}</span>

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        intensityColorClass(meta.intensity),
        className,
      )}
      title={meta.description}
    >
      <span className="text-[10px] leading-none">{meta.icon}</span>
      <span>{meta.shortLabel}</span>
    </span>
  )
}
