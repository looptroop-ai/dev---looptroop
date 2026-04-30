import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  const [pageInput, setPageInput] = useState('1')

  useEffect(() => {
    setCurrentPage(1)
    setPageInput('1')
  }, [tickets.length])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE))
  const sortedTickets = useMemo(() => [...tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [tickets])
  const paginatedTickets = sortedTickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const setPage = (nextPage: number) => {
    const clampedPage = Math.min(totalPages, Math.max(1, nextPage))
    setCurrentPage(clampedPage)
    setPageInput(String(clampedPage))
  }

  const commitPageInput = (value: string) => {
    if (!value) {
      setPageInput(String(currentPage))
      return
    }

    setPage(Number.parseInt(value, 10))
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0 pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              tabIndex={0}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{column.title}</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {tickets.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{column.description}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-center text-balance">{column.tooltip}</TooltipContent>
        </Tooltip>
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
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Page</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`${column.title} current page`}
                  value={pageInput}
                  onChange={(event) => {
                    setPageInput(event.target.value.replace(/\D/g, ''))
                  }}
                  onBlur={() => commitPageInput(pageInput)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setPageInput(String(currentPage))
                      event.currentTarget.blur()
                    }
                  }}
                  className="h-6 rounded border border-input bg-background px-1 text-center text-xs text-foreground tabular-nums"
                  style={{ width: `${Math.max(2, String(totalPages).length) + 1}ch` }}
                />
                <span>of {totalPages}</span>
              </div>
              <button
                onClick={() => setPage(currentPage + 1)}
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
