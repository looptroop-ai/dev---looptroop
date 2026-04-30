import { useMemo } from 'react'
import { KanbanColumn } from './KanbanColumn'
import { useTickets } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { STATUS_TO_PHASE } from '@/lib/workflowMeta'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'

export interface KanbanColumnConfig {
  id: KanbanPhase
  title: string
  description: string
  tooltip: string
}

const columns: KanbanColumnConfig[] = [
  {
    id: 'todo',
    title: 'To Do',
    description: 'Backlog',
    tooltip: 'Tickets that have been created but have not started the workflow yet. Use this column for queued work that is ready to review, edit, or start when you are ready.',
  },
  {
    id: 'needs_input',
    title: 'Needs Input',
    description: 'Waiting for user',
    tooltip: 'Tickets paused because LoopTroop needs a human action before it can continue, such as interview answers, artifact approval, execution setup approval, PR review, or a retry/cancel decision after an error.',
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    description: 'Active workflow',
    tooltip: 'Tickets currently moving through automated workflow steps, including discovery, council drafting and voting, coverage checks, setup, coding, final tests, integration, pull request creation, and cleanup.',
  },
  {
    id: 'done',
    title: 'Done',
    description: 'Completed tickets',
    tooltip: 'Terminal tickets that no longer advance automatically. This includes completed work and canceled work, with the ticket history and generated artifacts kept available for review.',
  },
]

export function KanbanBoard() {
  const { data: tickets, isLoading: isLoadingTickets } = useTickets()
  const { data: projects = [] } = useProjects()

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  const ticketsByPhase = useMemo(() => columns.map(col => ({
    ...col,
    tickets: (tickets ?? []).filter(t => (STATUS_TO_PHASE[t.status] ?? 'todo') === col.id),
  })), [tickets])

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {isLoadingTickets && (
        <div
          className="border-b border-amber-200 bg-amber-50/90 px-4 py-2 dark:border-amber-900/60 dark:bg-amber-950/40 shrink-0"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col gap-1">
            <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                                    variant="outline"
                                    className="w-fit gap-1.5 border-amber-300 bg-amber-100/80 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                  >
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Loading tickets...
                                  </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-center text-balance">Waiting for ticket data from the server.</TooltipContent>
                      </Tooltip>
            <p className="text-xs leading-5 text-amber-900/75 dark:text-amber-200/80">
              LoopTroop is fetching the tickets. This might take a few seconds on initial load.
            </p>
          </div>
        </div>
      )}
      <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-[1fr_2fr_2fr_1fr] overflow-hidden">
        {ticketsByPhase.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            tickets={col.tickets}
            projectMap={projectMap}
          />
        ))}
      </div>
    </div>
  )
}
