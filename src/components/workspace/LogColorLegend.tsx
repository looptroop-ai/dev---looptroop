import { cn } from '@/lib/utils'

interface LegendItem {
  label: string
  colorClass: string
  children?: LegendItem[]
}

interface LegendGroup {
  label: string
  items: LegendItem[]
}

const LOG_COLOR_LEGEND_GROUPS: LegendGroup[] = [
  {
    label: 'AI',
    items: [
      { label: 'Prompt', colorClass: 'bg-blue-500' },
      { label: 'Final output', colorClass: 'bg-emerald-600' },
      { label: 'Thinking', colorClass: 'bg-purple-400' },
      { label: 'Other event', colorClass: 'bg-green-500' },
      {
        label: 'Tool call',
        colorClass: 'bg-cyan-500',
        children: [
          { label: 'Input', colorClass: 'bg-sky-300' },
          { label: 'Output', colorClass: 'bg-sky-700 dark:bg-sky-500' },
          { label: 'Error', colorClass: 'bg-rose-950 dark:bg-rose-300' },
        ],
      },
    ],
  },
  {
    label: 'Runtime',
    items: [
      { label: 'System', colorClass: 'bg-foreground' },
      { label: 'Command', colorClass: 'bg-zinc-500' },
      { label: 'Debug', colorClass: 'bg-amber-600' },
      { label: 'Error', colorClass: 'bg-red-500' },
    ],
  },
]

function LegendSwatch({ colorClass }: { colorClass: string }) {
  return (
    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm shadow-sm ring-1 ring-border/30', colorClass)} />
  )
}

function LegendRow({ item, depth = 0 }: { item: LegendItem; depth?: number }) {
  return (
    <div className={cn('flex items-center gap-2 text-[11px]', depth > 0 ? 'text-muted-foreground' : 'text-popover-foreground')}>
      <LegendSwatch colorClass={item.colorClass} />
      <span>{item.label}</span>
    </div>
  )
}

function LegendItemTree({ item, depth = 0 }: { item: LegendItem; depth?: number }) {
  return (
    <div>
      <LegendRow item={item} depth={depth} />
      {item.children ? (
        <div className="ml-1.5 mt-1 space-y-1 border-l border-border/70 pl-3">
          {item.children.map((child) => (
            <LegendItemTree key={child.label} item={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function LogColorLegend() {
  return (
    <div className="w-max max-w-[160px] space-y-2.5">
      <div className="font-semibold text-xs border-b border-border pb-1">Log Colors Legend</div>
      {LOG_COLOR_LEGEND_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">{group.label}</div>
          <div className="space-y-1">
            {group.items.map((item) => (
              <LegendItemTree key={item.label} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
