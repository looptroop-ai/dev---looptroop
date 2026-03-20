import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterviewSessionView } from '@shared/interviewSession'
import { InterviewNavigator } from '../InterviewNavigator'

let interviewData: InterviewSessionView = {
  winnerId: 'openai/gpt-5',
  raw: null,
  session: null,
  questions: [],
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(['interview', '1:PROJ-42'], interviewData)

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('InterviewNavigator', () => {
  beforeEach(() => {
    interviewData = {
      winnerId: 'openai/gpt-5',
      raw: null,
      questions: [
        {
          id: 'Q01',
          phase: 'Foundation',
          question: 'What outcome matters most?',
          source: 'compiled',
          status: 'answered',
          answer: 'Protect the import pipeline.',
        },
        {
          id: 'Q02',
          phase: 'Structure',
          question: 'Which constraint is fixed?',
          source: 'compiled',
          status: 'skipped',
          answer: '',
        },
        {
          id: 'QF01',
          phase: 'Assembly',
          question: 'How should retries be tested?',
          source: 'prompt_follow_up',
          roundNumber: 1,
          status: 'pending',
          answer: null,
        },
        {
          id: 'CF01',
          phase: 'Assembly',
          question: 'What alerting path is required?',
          source: 'coverage_follow_up',
          roundNumber: 1,
          status: 'current',
          answer: null,
        },
        {
          id: 'FINAL',
          phase: 'Assembly',
          question: 'Anything else the team should know?',
          source: 'final_free_form',
          status: 'answered',
          answer: '',
        },
      ],
      session: {
        schemaVersion: 1,
        winnerId: 'openai/gpt-5',
        maxInitialQuestions: 10,
        maxFollowUps: 2,
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
            question: 'Which constraint is fixed?',
            source: 'compiled',
          },
          {
            id: 'QF01',
            phase: 'Assembly',
            question: 'How should retries be tested?',
            source: 'prompt_follow_up',
            roundNumber: 1,
          },
          {
            id: 'CF01',
            phase: 'Assembly',
            question: 'What alerting path is required?',
            source: 'coverage_follow_up',
            roundNumber: 1,
          },
          {
            id: 'FINAL',
            phase: 'Assembly',
            question: 'Anything else the team should know?',
            source: 'final_free_form',
          },
        ],
        answers: {
          Q01: {
            answer: 'Protect the import pipeline.',
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
          FINAL: {
            answer: '',
            skipped: false,
            answeredAt: '2026-03-12T10:15:00.000Z',
            batchNumber: 3,
          },
        },
        currentBatch: {
          questions: [
            {
              id: 'CF01',
              phase: 'Assembly',
              question: 'What alerting path is required?',
              source: 'coverage_follow_up',
              roundNumber: 1,
            },
          ],
          progress: { current: 3, total: 4 },
          isComplete: false,
          isFinalFreeForm: false,
          aiCommentary: 'One last coverage gap remains.',
          batchNumber: 3,
          source: 'coverage',
          roundNumber: 1,
        },
        batchHistory: [],
        followUpRounds: [
          {
            roundNumber: 1,
            source: 'prom4',
            questionIds: ['QF01'],
          },
          {
            roundNumber: 1,
            source: 'coverage',
            questionIds: ['CF01'],
          },
        ],
        rawFinalYaml: null,
        completedAt: null,
        updatedAt: '2026-03-12T10:15:00.000Z',
      },
    }

  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('groups interview questions by stage and dispatches focus events with status labels', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    renderWithProviders(<InterviewNavigator ticketId="1:PROJ-42" />)

    await waitFor(() => {
      expect(screen.getByText('Foundation')).toBeInTheDocument()
    })

    expect(screen.getByText('Structure')).toBeInTheDocument()
    expect(screen.getByText('PROM4 Follow-ups · Round 1')).toBeInTheDocument()
    expect(screen.getByText('Coverage Follow-ups · Round 1')).toBeInTheDocument()
    expect(screen.getByText('Final Free-Form')).toBeInTheDocument()
    expect(screen.getAllByText('done')).toHaveLength(2)
    expect(screen.getByText('skip')).toBeInTheDocument()
    expect(screen.getByText('now')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()

    fireEvent.click(screen.getByText('How should retries be tested?').closest('button')!)

    const focusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:interview-focus') as CustomEvent<{ ticketId: string; questionId: string }> | undefined

    expect(focusEvent?.detail).toEqual({
      ticketId: '1:PROJ-42',
      questionId: 'QF01',
    })
  })
})
