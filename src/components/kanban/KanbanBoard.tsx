import { KanbanColumn } from './KanbanColumn'
import { useTickets } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { STATUS_TO_PHASE } from './TicketCard'

export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'

export interface KanbanColumnConfig {
  id: KanbanPhase
  title: string
  description: string
}

const columns: KanbanColumnConfig[] = [
  { id: 'todo', title: 'To Do', description: 'Draft tickets' },
  { id: 'in_progress', title: 'In Progress', description: 'Active workflow' },
  { id: 'needs_input', title: 'Needs Input', description: 'Waiting for user' },
  { id: 'done', title: 'Done', description: 'Completed tickets' },
]

export function KanbanBoard() {
  const { data: tickets = [] } = useTickets()
  const { data: projects = [] } = useProjects()

  const projectMap = new Map(projects.map(p => [p.id, p]))

  const ticketsByPhase = columns.map(col => ({
    ...col,
    tickets: tickets.filter(t => (STATUS_TO_PHASE[t.status] ?? 'todo') === col.id),
  }))

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-[1fr_2fr_2fr_1fr]">
      {ticketsByPhase.map((col) => (
        <KanbanColumn
          key={col.id}
          column={col}
          tickets={col.tickets}
          projectMap={projectMap}
        />
      ))}
    </div>
  )
}
