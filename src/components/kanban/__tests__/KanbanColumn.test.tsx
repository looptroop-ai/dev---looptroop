import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@/hooks/useProjects'
import { makeTicket } from '@/test/factories'
import { KanbanColumn } from '../KanbanColumn'

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('../TicketCard', () => ({
  TicketCard: ({ ticket }: { ticket: { externalId: string; title: string } }) => (
    <div>{ticket.externalId} {ticket.title}</div>
  ),
}))

function makeCompletedTickets(count: number) {
  return Array.from({ length: count }, (_, index) => makeTicket({
    id: `1:TEST-${index + 1}`,
    externalId: `TEST-${index + 1}`,
    title: `Ticket ${index + 1}`,
    status: 'COMPLETED',
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString(),
  }))
}

describe('KanbanColumn', () => {
  it('lets you jump to a page by editing the current page number', () => {
    render(
      <KanbanColumn
        column={{ id: 'done', title: 'Done', description: 'Completed tickets' }}
        tickets={makeCompletedTickets(31)}
        projectMap={new Map<number, Project>()}
      />,
    )

    const pageInput = screen.getByRole('textbox', { name: /done current page/i })

    expect(pageInput).toHaveValue('1')
    expect(screen.getByText('TEST-31 Ticket 31')).toBeInTheDocument()

    fireEvent.change(pageInput, { target: { value: '3abc' } })

    expect(pageInput).toHaveValue('3')

    fireEvent.blur(pageInput)

    expect(pageInput).toHaveValue('3')
    expect(screen.getByText('TEST-1 Ticket 1')).toBeInTheDocument()
    expect(screen.queryByText('TEST-31 Ticket 31')).not.toBeInTheDocument()
    expect(screen.getByText('of 3')).toBeInTheDocument()
  })
})
