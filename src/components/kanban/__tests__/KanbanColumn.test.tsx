import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UIProvider } from '@/context/UIContext'
import type { Project } from '@/hooks/useProjects'
import { makeTicket } from '@/test/factories'
import { KanbanColumn } from '../KanbanColumn'

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
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
  it('shows a detailed tooltip for the column header', async () => {
    render(
      <TooltipProvider>
        <UIProvider>
          <KanbanColumn
            column={{
              id: 'needs_input',
              title: 'Needs Input',
              description: 'Waiting for user',
              tooltip: 'Tickets paused because LoopTroop needs a human action before it can continue.',
            }}
            tickets={[]}
            projectMap={new Map<number, Project>()}
          />
        </UIProvider>
      </TooltipProvider>,
    )

    fireEvent.focus(screen.getByText('Needs Input'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Tickets paused because LoopTroop needs a human action before it can continue.',
    )
  })

  it('lets you jump to a page by editing the current page number', () => {
    render(
      <TooltipProvider>
        <UIProvider>
          <KanbanColumn
            column={{
              id: 'done',
              title: 'Done',
              description: 'Completed tickets',
              tooltip: 'Terminal tickets that no longer advance automatically.',
            }}
            tickets={makeCompletedTickets(31)}
            projectMap={new Map<number, Project>()}
          />
        </UIProvider>
      </TooltipProvider>,
    )

    const pageInput = screen.getByRole('textbox', { name: /done current page/i })

    expect(pageInput).toHaveValue('1')
    expect(screen.getByLabelText('Open ticket TEST-31')).toBeInTheDocument()

    fireEvent.change(pageInput, { target: { value: '3abc' } })

    expect(pageInput).toHaveValue('3')

    fireEvent.blur(pageInput)

    expect(pageInput).toHaveValue('3')
    expect(screen.getByLabelText('Open ticket TEST-1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Open ticket TEST-31')).not.toBeInTheDocument()
    expect(screen.getByText('of 3')).toBeInTheDocument()
  })
})
