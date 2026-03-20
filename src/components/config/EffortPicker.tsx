import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { EFFORT_META } from '@/lib/effortMeta'
import { Zap } from 'lucide-react'

interface EffortPickerProps {
  variants: Record<string, Record<string, unknown>> | undefined
  value: string | undefined
  onChange: (variant: string | undefined) => void
  disabled?: boolean
}

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function intensityColor(intensity: number, selected: boolean): string {
  if (!selected) return 'bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground'
  const colors: Record<number, string> = {
    0: 'bg-slate-100 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
    1: 'bg-sky-100 text-sky-800 ring-1 ring-sky-300 dark:bg-sky-900/60 dark:text-sky-200 dark:ring-sky-700',
    2: 'bg-blue-100 text-blue-800 ring-1 ring-blue-300 dark:bg-blue-900/60 dark:text-blue-200 dark:ring-blue-700',
    3: 'bg-violet-100 text-violet-800 ring-1 ring-violet-300 dark:bg-violet-900/60 dark:text-violet-200 dark:ring-violet-700',
    4: 'bg-amber-100 text-amber-800 ring-1 ring-amber-400 dark:bg-amber-900/60 dark:text-amber-200 dark:ring-amber-600',
    5: 'bg-orange-100 text-orange-800 ring-1 ring-orange-400 dark:bg-orange-900/60 dark:text-orange-200 dark:ring-orange-600',
  }
  return colors[intensity] ?? colors[3]!
}

export function EffortPicker({ variants, value, onChange, disabled }: EffortPickerProps) {
  const sortedVariants = useMemo(() => {
    if (!variants || Object.keys(variants).length === 0) return []
    return EFFORT_ORDER.filter(k => k in variants)
  }, [variants])

  if (sortedVariants.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      <Zap className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/30 p-0.5">
        {sortedVariants.map(variant => {
          const meta = EFFORT_META[variant] ?? { label: variant, shortLabel: variant, icon: '●', description: variant, intensity: 3 }
          const selected = value === variant
          return (
            <button
              key={variant}
              type="button"
              disabled={disabled}
              title={meta.description}
              onClick={() => onChange(selected ? undefined : variant)}
              className={cn(
                'relative px-2 py-0.5 text-xs font-medium rounded-md transition-all duration-200 cursor-pointer select-none',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                intensityColor(meta.intensity, selected),
                selected && 'shadow-sm scale-[1.02]',
              )}
            >
              <span className="flex items-center gap-1">
                <span className="text-[10px] leading-none">{meta.icon}</span>
                <span>{meta.shortLabel}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
