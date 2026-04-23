import { CircleHelp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ConfigurationDocsLinkProps {
  docsPath: string
  label: string
  className?: string
}

export function ConfigurationDocsLink({ docsPath, label, className }: ConfigurationDocsLinkProps) {
  const href = `${__LOOPTROOP_DOCS_ORIGIN__}${docsPath.startsWith('/') ? docsPath : `/${docsPath}`}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open documentation for ${label}`}
          className={cn(
            'inline-flex h-4 w-4 flex-none items-center justify-center text-muted-foreground transition-colors hover:text-foreground',
            className,
          )}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Open detailed documentation</TooltipContent>
    </Tooltip>
  )
}
