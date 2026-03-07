import { cn } from '@/lib/utils'

export function getModelIcon(name: string): string {
    const n = name.toLowerCase()
    if (n.includes('claude')) return '🟣'
    if (n.includes('gpt')) return '🟢'
    if (n.includes('gemini')) return '🔵'
    if (n.includes('codex')) return '🟢'
    if (n.includes('opencode')) return '🟠'
    if (n.includes('pickle')) return '🟠'
    if (n.includes('deepseek')) return '🔴'
    if (n.includes('llama') || n.includes('meta')) return '🟤'
    return '⚪'
}

export function getModelDisplayName(id: string): string {
    if (!id) return ''
    // Handle model:prefix if present
    const cleanId = id.startsWith('model:') ? id.slice(6) : id
    return cleanId.split('/').pop() ?? cleanId
}

interface ModelBadgeProps {
    modelId: string
    active?: boolean
    onClick?: () => void
    className?: string
    showIcon?: boolean
    children?: React.ReactNode
}

export function ModelBadge({ modelId, active, onClick, className, showIcon = true, children }: ModelBadgeProps) {
    const name = getModelDisplayName(modelId)
    const icon = showIcon ? getModelIcon(name) : null

    const Component = onClick ? 'button' : 'div'

    return (
        <Component
            onClick={onClick}
            className={cn(
                'px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold shrink-0 max-w-fit truncate border transition-colors shadow-sm inline-flex items-center gap-1.5',
                active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border-border/50',
                className
            )}
            title={modelId}
        >
            {icon && <span className="text-[1.1em] leading-none opacity-90">{icon}</span>}
            {children || <span className="truncate">{name}</span>}
        </Component>
    )
}
