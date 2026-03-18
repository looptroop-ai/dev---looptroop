import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '@/hooks/useTickets'
import type { InterviewSessionView, PersistedInterviewBatch } from '@shared/interviewSession'
import { InterviewQAView } from '../InterviewQAView'

let submittedBody: { answers?: Record<string, string> } | null = null
let skippedBody: { answers?: Record<string, string> } | null = null
let savedUiState: { scope?: string; data?: unknown } | null = null
let preSeededDrafts: { draftAnswers: Record<string, Record<string, string>>; skippedQuestions: Record<string, string[]> } | null = null
let interviewData: InterviewSessionView = {
  winnerId: 'openai/gpt-5',
  raw: 'questions:\n  - id: Q01',
  session: null,
  questions: [],
}

function createJsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function emptyUiState() {
  return { scope: 'interview-drafts', exists: false, data: null, updatedAt: null }
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  queryClient.setQueryData(['interview', '1:PROJ-42'], interviewData)
  queryClient.setQueryData(
    ['ticket-ui-state', '1:PROJ-42', 'interview-drafts'],
    preSeededDrafts
      ? { scope: 'interview-drafts', exists: true, data: preSeededDrafts, updatedAt: '2026-03-12T10:10:00.000Z' }
      : emptyUiState(),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

function makeTicket(): Ticket {
  return {
    id: '1:PROJ-42',
    externalId: 'PROJ-42',
    projectId: 1,
    title: 'Retry strategy',
    description: 'Clarify webhook retry behavior.',
    priority: 3,
    status: 'WAITING_INTERVIEW_ANSWERS',
    xstateSnapshot: null,
    branchName: null,
    currentBead: null,
    totalBeads: null,
    percentComplete: null,
    errorMessage: null,
    errorSeenSignature: null,
    lockedMainImplementer: null,
    lockedCouncilMembers: ['openai/gpt-5'],
    availableActions: [],
    previousStatus: null,
    runtime: {
      baseBranch: 'main',
      currentBead: 0,
      completedBeads: 0,
      totalBeads: 0,
      percentComplete: 0,
      iterationCount: 0,
      maxIterations: null,
      artifactRoot: '/tmp/ticket',
      beads: [],
      candidateCommitSha: null,
      preSquashHead: null,
      finalTestStatus: 'pending',
    },
    startedAt: null,
    plannedDate: null,
    createdAt: '2026-03-12T10:00:00.000Z',
    updatedAt: '2026-03-12T10:00:00.000Z',
  }
}

function makeBatch(overrides: Partial<PersistedInterviewBatch> = {}): PersistedInterviewBatch {
  return {
    questions: [],
    progress: { current: 3, total: 4 },
    isComplete: false,
    isFinalFreeForm: false,
    aiCommentary: 'Need the remaining implementation details.',
    batchNumber: 2,
    source: 'prom4',
    ...overrides,
  }
}

describe('InterviewQAView', () => {
  beforeEach(() => {
    submittedBody = null
    skippedBody = null
    savedUiState = null
    preSeededDrafts = null
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    interviewData = {
      winnerId: 'openai/gpt-5',
      raw: 'questions:\n  - id: Q01',
      questions: [
        {
          id: 'Q01',
          phase: 'Foundation',
          question: 'What outcome matters most?',
          source: 'compiled',
          status: 'answered',
          answer: 'Keep imports idempotent.',
        },
        {
          id: 'Q02',
          phase: 'Structure',
          question: 'Which constraints are fixed?',
          source: 'compiled',
          status: 'skipped',
          answer: '',
        },
        {
          id: 'QF01',
          phase: 'Assembly',
          question: 'How will retries be tested?',
          source: 'prompt_follow_up',
          roundNumber: 1,
          status: 'current',
          answer: null,
        },
        {
          id: 'Q03',
          phase: 'Assembly',
          question: 'What retry budget is acceptable?',
          source: 'compiled',
          status: 'current',
          answer: null,
        },
      ],
      session: {
        schemaVersion: 1,
        winnerId: 'openai/gpt-5',
        maxInitialQuestions: 12,
        maxFollowUps: 2,
        userBackground: 'Platform engineer',
        disableAnalogies: true,
        questions: [
          {
            id: 'Q01',
            phase: 'Foundation',
            question: 'What outcome matters most?',
            source: 'compiled',
          },
          {
            id: 'Q02',
            phase: 'Structure',
            question: 'Which constraints are fixed?',
            source: 'compiled',
          },
          {
            id: 'QF01',
            phase: 'Assembly',
            question: 'How will retries be tested?',
            source: 'prompt_follow_up',
            roundNumber: 1,
          },
          {
            id: 'Q03',
            phase: 'Assembly',
            question: 'What retry budget is acceptable?',
            source: 'compiled',
          },
        ],
        answers: {
          Q01: {
            answer: 'Keep imports idempotent.',
            skipped: false,
            answeredAt: '2026-03-12T10:10:00.000Z',
            batchNumber: 1,
          },
          Q02: {
            answer: '',
            skipped: true,
            answeredAt: null,
            batchNumber: 1,
          },
        },
        currentBatch: makeBatch({
          questions: [
            {
              id: 'QF01',
              phase: 'Assembly',
              question: 'How will retries be tested?',
              source: 'prompt_follow_up',
              roundNumber: 1,
            },
            {
              id: 'Q03',
              phase: 'Assembly',
              question: 'What retry budget is acceptable?',
              source: 'compiled',
            },
          ],
        }),
        batchHistory: [
          {
            batchNumber: 1,
            source: 'prom4',
            questionIds: ['Q01', 'Q02'],
            isFinalFreeForm: false,
            submittedAt: '2026-03-12T10:10:00.000Z',
          },
        ],
        followUpRounds: [
          {
            roundNumber: 1,
            source: 'prom4',
            questionIds: ['QF01'],
          },
        ],
        rawFinalYaml: null,
        completedAt: null,
        updatedAt: '2026-03-12T10:10:00.000Z',
      },
    }

    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/tickets/1:PROJ-42/answer-batch')) {
        submittedBody = init?.body ? JSON.parse(String(init.body)) as { answers?: Record<string, string> } : null
        return createJsonResponse(makeBatch())
      }
      if (url.endsWith('/api/tickets/1:PROJ-42/skip')) {
        skippedBody = init?.body ? JSON.parse(String(init.body)) as { answers?: Record<string, string> } : null
        return createJsonResponse({
          message: 'Remaining interview questions skipped',
          ticketId: '1:PROJ-42',
          status: 'WAITING_INTERVIEW_APPROVAL',
          state: 'WAITING_INTERVIEW_APPROVAL',
          ticket: {
            ...makeTicket(),
            status: 'WAITING_INTERVIEW_APPROVAL',
          },
        })
      }
      if (url.endsWith('/api/tickets/1:PROJ-42/interview')) {
        return createJsonResponse(interviewData)
      }
      if (url.includes('/api/tickets/1:PROJ-42/ui-state')) {
        if (init?.method === 'PUT') {
          savedUiState = init.body ? JSON.parse(String(init.body)) as { scope?: string; data?: unknown } : null
          return createJsonResponse({ success: true, scope: 'interview-drafts', updatedAt: new Date().toISOString() })
        }
        return createJsonResponse(emptyUiState())
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders interview history, restores skip-all actions, and submits batch answers', async () => {
    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    // Wait for data to load and history toggle to appear
    await waitFor(() => {
      expect(screen.getByText(/Interview History/i)).toBeInTheDocument()
    })

    // History is collapsed by default — expand it
    fireEvent.click(screen.getByText(/Interview History/i))

    await waitFor(() => {
      expect(screen.getByText('Keep imports idempotent.')).toBeInTheDocument()
    })

    expect(screen.getByText('What outcome matters most?')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('PROM4 Follow-up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip all questions/i })).toBeInTheDocument()

    const textareas = screen.getAllByRole('textbox')
    fireEvent.change(textareas[0]!, { target: { value: 'Exercise retries against a flaky upstream fake.' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit batch/i }))
    })

    expect(submittedBody).toEqual({
      answers: {
        QF01: 'Exercise retries against a flaky upstream fake.',
      },
    })
  })

  it('confirms and skips all remaining interview questions while preserving drafted answers', async () => {
    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('How will retries be tested?')).toBeInTheDocument()
    })

    const textareas = screen.getAllByRole('textbox')
    fireEvent.change(textareas[0]!, { target: { value: 'Exercise retries against a flaky upstream fake.' } })

    fireEvent.click(screen.getByRole('button', { name: /skip all questions/i }))

    expect(screen.getByRole('heading', { name: /skip remaining interview questions/i })).toBeInTheDocument()
    expect(screen.getByText(/preserves anything currently typed in this batch/i)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /skip to approval/i }))
    })

    expect(skippedBody).toEqual({
      answers: {
        QF01: 'Exercise retries against a flaky upstream fake.',
      },
    })
  })

  it('responds to navigator focus events by revealing and focusing the target question', async () => {
    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('How will retries be tested?')).toBeInTheDocument()
    })

    const textareas = screen.getAllByRole('textbox')
    const targetTextarea = textareas[0] as HTMLTextAreaElement

    await act(async () => {
      window.dispatchEvent(new CustomEvent('looptroop:interview-focus', {
        detail: { ticketId: '1:PROJ-42', questionId: 'QF01' },
      }))
    })

    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
      expect(targetTextarea).toHaveFocus()
    })
  })

  it('restores persisted draft answers on mount', async () => {
    const batchKey = 'prom4:0:2'
    preSeededDrafts = {
      draftAnswers: { [batchKey]: { QF01: 'Restored draft answer' } },
      skippedQuestions: {},
    }

    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('How will retries be tested?')).toBeInTheDocument()
    })

    const textareas = screen.getAllByRole('textbox')
    expect((textareas[0] as HTMLTextAreaElement).value).toBe('Restored draft answer')
  })

  it('auto-saves drafts after debounce', async () => {
    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    await waitFor(() => {
      expect(screen.getByText('How will retries be tested?')).toBeInTheDocument()
    })

    const textareas = screen.getAllByRole('textbox')
    fireEvent.change(textareas[0]!, { target: { value: 'My draft answer' } })

    // Should not have saved immediately
    expect(savedUiState).toBeNull()

    // Wait for debounce to fire (350ms + margin)
    await waitFor(() => {
      expect(savedUiState).not.toBeNull()
    }, { timeout: 2000 })

    const data = savedUiState!.data as { draftAnswers: Record<string, Record<string, string>> }
    expect(data.draftAnswers['prom4:0:2']).toEqual({ QF01: 'My draft answer' })
  })

  it('clears persisted drafts after batch submission', async () => {
    const batchKey = 'prom4:0:2'
    preSeededDrafts = {
      draftAnswers: { [batchKey]: { QF01: 'Pre-filled answer' } },
      skippedQuestions: {},
    }

    renderWithProviders(<InterviewQAView ticket={makeTicket()} />)

    await waitFor(() => {
      expect((screen.getAllByRole('textbox')[0] as HTMLTextAreaElement).value).toBe('Pre-filled answer')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit batch/i }))
    })

    expect(submittedBody).toEqual({ answers: { QF01: 'Pre-filled answer' } })

    // Wait for debounce to fire auto-save of cleaned state
    await waitFor(() => {
      expect(savedUiState).not.toBeNull()
    }, { timeout: 2000 })

    const data = savedUiState!.data as { draftAnswers: Record<string, Record<string, string>> }
    expect(data.draftAnswers[batchKey]).toBeUndefined()
  })
})
