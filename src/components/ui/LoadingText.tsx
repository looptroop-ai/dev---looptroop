import { cn } from '@/lib/utils'

interface LoadingTextProps {
    text: string
    className?: string
}

export function LoadingText({ text, className }: LoadingTextProps) {
    return (
        <span className={cn('inline-flex items-center', className)}>
            {text}
            <span className="inline-flex ml-0.5">
                <span className="animate-loading-dot" style={{ animationDelay: '0s' }}>.</span>
                <span className="animate-loading-dot" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-loading-dot" style={{ animationDelay: '0.4s' }}>.</span>
            </span>
        </span>
    )
}
