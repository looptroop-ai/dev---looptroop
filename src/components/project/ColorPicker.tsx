import { cn } from '@/lib/utils'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
}

const COLORS = [
  { name: 'Ocean Blue', value: '#0ea5e9' },
  { name: 'Royal Blue', value: '#3b82f6' },
  { name: 'Sapphire', value: '#2563eb' },
  { name: 'Navy', value: '#1e40af' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Periwinkle', value: '#818cf8' },
  { name: 'Lavender', value: '#a78bfa' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orchid', value: '#c084fc' },
  { name: 'Mauve', value: '#d8b4fe' },
  { name: 'Plum', value: '#9333ea' },
  { name: 'Fuchsia', value: '#d946ef' },
  { name: 'Magenta', value: '#e879f9' },
  { name: 'Charcoal', value: '#374151' },
  { name: 'Midnight', value: '#1e293b' },
  { name: 'Forest', value: '#166534' },
  { name: 'Sage', value: '#86efac' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Aqua', value: '#22d3ee' },
  { name: 'Sky', value: '#38bdf8' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Mint', value: '#34d399' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Seafoam', value: '#6ee7b7' },
  { name: 'Turquoise', value: '#2dd4bf' },
  { name: 'Slate', value: '#64748b' },
  { name: 'Steel', value: '#475569' },
  { name: 'Zinc', value: '#71717a' },
  { name: 'Stone', value: '#78716c' },
]

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const selected = COLORS.find(color => color.value === value)

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">
        Selected color:{' '}
        <span className="font-semibold">{selected?.name ?? 'Custom'}</span>
      </div>
      <div className="grid grid-cols-8 gap-3">
        {COLORS.map(color => (
          <button
            key={color.value}
            type="button"
            className="group flex flex-col items-center gap-1 rounded-lg p-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => onChange(color.value)}
            aria-label={color.name}
            title={color.name}
          >
            <span
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-full border border-background shadow-sm transition-transform duration-200 group-hover:scale-110',
                value === color.value && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: color.value }}
            >
              {value === color.value && <span className="text-sm font-bold text-white">✓</span>}
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">{color.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
