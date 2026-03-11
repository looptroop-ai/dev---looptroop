import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApprovalView } from '@/components/workspace/ApprovalView'
import type { Ticket } from '@/hooks/useTickets'

const baseRuntime: Ticket['runtime'] = {
  baseBranch: 'main',
  currentBead: 0,
  completedBeads: 0,
  totalBeads: 0,
  percentComplete: 0,
  iterationCount: 0,
  maxIterations: null,
  artifactRoot: '/tmp/looptroop',
  beads: [],
  candidateCommitSha: null,
  preSquashHead: null,
  finalTestStatus: 'pending',
}

vi.mock('@/components/workspace/PhaseLogPanel', () => ({
  PhaseLogPanel: () => <div>Log Panel</div>,
}))

vi.mock('@/components/workspace/PhaseArtifactsPanel', () => ({
  PhaseArtifactsPanel: ({ prefixElement }: { prefixElement?: React.ReactNode }) => (
    <div>{prefixElement}</div>
  ),
  InterviewAnswersView: ({ content }: { content: string }) => <div>{content}</div>,
  PrdDraftView: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/components/editor/YamlEditor', () => ({
  YamlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="yaml-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const baseTicket: Ticket = {
  id: '7:LOOP-42',
  externalId: 'LOOP-42',
  projectId: 7,
  title: 'Test ticket',
  description: 'Test description',
  priority: 3,
  status: 'WAITING_INTERVIEW_APPROVAL',
  xstateSnapshot: null,
  branchName: null,
  currentBead: null,
  totalBeads: null,
  percentComplete: null,
  errorMessage: null,
  lockedMainImplementer: null,
  lockedCouncilMembers: [],
  availableActions: ['approve', 'cancel'],
  previousStatus: null,
  runtime: baseRuntime,
  startedAt: null,
  plannedDate: null,
  createdAt: '2026-03-06T10:00:00.000Z',
  updatedAt: '2026-03-06T10:00:00.000Z',
}

function createJsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response
}

function renderApprovalView(ticketOverrides: Partial<Ticket> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ApprovalView
        ticket={{ ...baseTicket, ...ticketOverrides }}
        artifactType="interview"
      />
    </QueryClientProvider>,
  )
}

describe('ApprovalView cascade warnings', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.includes('/ui-state')) {
        if (init?.method === 'PUT') {
          return createJsonResponse({
            success: true,
            scope: 'approval_interview',
            updatedAt: '2026-03-06T10:00:00.000Z',
          })
        }
        return createJsonResponse({
          scope: 'approval_interview',
          exists: false,
          data: null,
          updatedAt: null,
        })
      }

      if (url.includes('/api/files/7:LOOP-42/interview')) {
        return createJsonResponse({
          content: 'artifact: interview\nquestions: []\n',
          exists: true,
        })
      }

      throw new Error(`Unhandled fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enters edit mode directly when downstream phases have not started', async () => {
    renderApprovalView({ status: 'WAITING_INTERVIEW_APPROVAL' })

    await screen.findByText(/artifact: interview/i)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    expect(screen.queryByText('Cascading Edit Warning')).not.toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: 'yaml-editor' })).toBeInTheDocument()
  })

  it('shows a tailored warning when editing interview after PRD has started', async () => {
    renderApprovalView({ status: 'WAITING_PRD_APPROVAL' })

    await screen.findByText(/artifact: interview/i)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    expect(await screen.findByText('Cascading Edit Warning')).toBeInTheDocument()
    expect(screen.getByText('Editing Interview Results will restart the PRD phase. All previous PRD data will be lost.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'yaml-editor' })).not.toBeInTheDocument()
  })
})
