import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TicketCard } from './TicketCard'
import type { KanbanColumnConfig } from './KanbanBoard'
import type { Ticket } from '@/hooks/useTickets'
import type { Project } from '@/hooks/useProjects'

const PAGE_SIZE = 15

interface KanbanColumnProps {
  column: KanbanColumnConfig
  tickets: Ticket[]
  projectMap: Map<number, Project>
}

export function KanbanColumn({ column, tickets, projectMap }: KanbanColumnProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [prevLength, setPrevLength] = useState(tickets.length)
  if (prevLength !== tickets.length) {
    setPrevLength(tickets.length)
    setCurrentPage(1)
  }

  const totalPages = Math.ceil(tickets.length / PAGE_SIZE)
  const sortedTickets = [...tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const paginatedTickets = sortedTickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0 pb-3" title={column.description}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium" title={column.title}>{column.title}</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {tickets.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{column.description}</p>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden px-3 pb-3">
        <ScrollArea className="h-full">
          {tickets.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-sm text-muted-foreground">No tickets</p>
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedTickets.map((ticket) => {
                const project = projectMap.get(ticket.projectId)
                return (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    projectColor={project?.color}
                    projectIcon={project?.icon}
                    projectName={project?.name}
                  />
                )
              })}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
