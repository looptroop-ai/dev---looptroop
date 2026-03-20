import { cn } from '@/lib/utils'
import { getModelDisplayName, getModelIcon } from './modelBadgeUtils'

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
