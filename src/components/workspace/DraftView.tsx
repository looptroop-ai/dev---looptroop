import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTicketAction } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { CalendarDays } from 'lucide-react'

const PRIORITY_LABELS: Record<number, string> = { 1: 'Very High', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Very Low' }
const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  3: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  4: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  5: 'bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-300',
}

interface DraftViewProps {
  ticket: Ticket
}

export function DraftView({ ticket }: DraftViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === ticket.projectId)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <div className="flex flex-col items-center gap-4 max-w-lg mx-auto">
          <div className="text-center">
            <h3 className="text-lg font-semibold">Ready to Start</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Click Start to begin the AI-driven interview process. This may take hours — LoopTroop optimizes for correctness.
            </p>
          </div>

          {/* Ticket metadata: priority, creation date, project */}
          <div className="w-full flex flex-wrap items-center justify-center gap-3 text-xs">
            <Badge variant="outline" className={PRIORITY_COLORS[ticket.priority] ?? PRIORITY_COLORS[3]}>
              P{ticket.priority} — {PRIORITY_LABELS[ticket.priority] ?? 'Normal'}
            </Badge>
            <span className="flex items-center gap-1 text-muted-foreground" title={new Date(ticket.createdAt).toLocaleString()}>
              <CalendarDays className="h-3.5 w-3.5" />
              Created {new Date(ticket.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {project && (
              <span className="flex items-center gap-1 text-muted-foreground">
                {project.icon && (project.icon.startsWith('data:') ? <img src={project.icon} className="h-3.5 w-3.5 rounded" alt="" /> : <span>{project.icon}</span>)}
                {project.name}
              </span>
            )}
          </div>

          {ticket.description && (
            <div className="w-full rounded-md border border-border p-3 max-h-96 overflow-y-auto overflow-x-hidden">
              <h4 className="text-xs font-medium mb-1">Description</h4>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{ticket.description}</p>
            </div>
          )}

          <Button
            size="lg"
            onClick={() => performAction({ id: ticket.id, action: 'start' })}
            disabled={isPending}
          >
            {isPending ? 'Starting…' : '🚀 Start Ticket'}
          </Button>
        </div>
      </div>
    </div>
  )
}
