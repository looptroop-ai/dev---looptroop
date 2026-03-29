import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildPrdDocumentYaml, getPrdUserStoryAnchorId, type PrdDocument } from '@/lib/prdDocument'
import { PrdApprovalNavigator } from '../PrdApprovalNavigator'

function buildPrdDocument(): PrdDocument {
  return {
    schema_version: 1,
    ticket_id: 'PROJ-42',
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'abc123',
    },
    product: {
      problem_statement: 'Protect imports from duplicate processing.',
      target_users: ['Operators'],
    },
    scope: {
      in_scope: ['Dedupe webhook retries'],
      out_of_scope: ['Bulk reprocessing'],
    },
    technical_requirements: {
      architecture_constraints: ['Use the existing sync worker.'],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: [],
      error_handling_rules: [],
      tooling_assumptions: [],
    },
    epics: [
      {
        id: 'EPIC-1',
        title: 'Retry orchestration',
        objective: 'Coordinate the retry flow.',
        implementation_steps: ['Add retry scheduling'],
        user_stories: [
          {
            id: 'US-1-1',
            title: 'As an operator, I can inspect retry state.',
            acceptance_criteria: ['Retry state is visible.'],
            implementation_steps: ['Render the retry state panel.'],
            verification: { required_commands: ['npm test'] },
          },
        ],
      },
    ],
    risks: ['Retries may amplify traffic.'],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }
}

function renderWithProviders(ui: React.ReactElement, content: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
  queryClient.setQueryData(['artifact', '1:PROJ-42', 'prd'], content)

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('PrdApprovalNavigator', () => {
  it('renders the PRD outline, removes interview shortcuts, and dispatches PRD focus events', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const content = buildPrdDocumentYaml(buildPrdDocument())

    renderWithProviders(<PrdApprovalNavigator ticketId="1:PROJ-42" />, content)

    await waitFor(() => {
      expect(screen.getByText('Product')).toBeInTheDocument()
    })

    expect(screen.getByText('EPIC-1 · Retry orchestration')).toBeInTheDocument()
    expect(screen.getByText('US-1-1 · As an operator, I can inspect retry state.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Interview summary/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Foundation$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Structure$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Product').closest('button')!)

    const prdFocusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:prd-approval-focus') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(prdFocusEvent?.detail).toEqual({
      ticketId: '1:PROJ-42',
      anchorId: 'prd-product',
    })

    fireEvent.click(screen.getByText('US-1-1 · As an operator, I can inspect retry state.').closest('button')!)

    const prdStoryFocusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:prd-approval-focus' && (event as CustomEvent<{ ticketId: string; anchorId: string }>).detail.anchorId !== 'prd-product') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(prdStoryFocusEvent?.detail).toEqual({
      ticketId: '1:PROJ-42',
      anchorId: getPrdUserStoryAnchorId('EPIC-1', 'US-1-1'),
    })
  })
})
