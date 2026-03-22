import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InterviewSessionView } from '@shared/interviewSession'
import { InterviewApprovalNavigator } from '../InterviewApprovalNavigator'

function buildInterviewData(): InterviewSessionView {
  return {
    winnerId: 'openai/gpt-5',
    raw: null,
    document: {
      schema_version: 1,
      ticket_id: 'PROJ-42',
      artifact: 'interview',
      status: 'draft',
      generated_by: {
        winner_model: 'openai/gpt-5',
        generated_at: '2026-03-17T10:00:00.000Z',
      },
      questions: [
        {
          id: 'Q01',
          phase: 'Foundation',
          prompt: 'What outcome matters most?',
          source: 'compiled',
          follow_up_round: null,
          answer_type: 'free_text',
          options: [],
          answer: {
            skipped: false,
            selected_option_ids: [],
            free_text: 'Protect imports.',
            answered_by: 'user',
            answered_at: '2026-03-17T10:05:00.000Z',
          },
        },
        {
          id: 'CF01',
          phase: 'Assembly',
          prompt: 'How should retries be tested?',
          source: 'coverage_follow_up',
          follow_up_round: 1,
          answer_type: 'free_text',
          options: [],
          answer: {
            skipped: true,
            selected_option_ids: [],
            free_text: '',
            answered_by: 'ai_skip',
            answered_at: '',
          },
        },
      ],
      follow_up_rounds: [
        {
          round_number: 1,
          source: 'coverage',
          question_ids: ['CF01'],
        },
      ],
      summary: {
        goals: ['Protect imports'],
        constraints: ['No duplicate records'],
        non_goals: ['Bulk reprocessing'],
        final_free_form_answer: '',
      },
      approval: {
        approved_by: '',
        approved_at: '',
      },
    },
    session: null,
    questions: [],
  }
}

function renderWithProviders(ui: React.ReactElement, data: InterviewSessionView) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
  queryClient.setQueryData(['interview', '1:PROJ-42'], data)

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('InterviewApprovalNavigator', () => {
  it('renders interview result sections and dispatches approval focus events', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    renderWithProviders(<InterviewApprovalNavigator ticketId="1:PROJ-42" />, buildInterviewData())

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument()
    })

    expect(screen.getByText('Foundation')).toBeInTheDocument()
    expect(screen.getByText('Coverage Follow-ups · Round 1')).toBeInTheDocument()
    expect(screen.getByText('Follow-up Rounds')).toBeInTheDocument()
    expect(screen.getByText('Approval')).toBeInTheDocument()

    fireEvent.click(screen.getByText('How should retries be tested?').closest('button')!)

    const focusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:interview-approval-focus') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(focusEvent?.detail).toEqual({
      ticketId: '1:PROJ-42',
      anchorId: 'interview-question-cf01',
    })
  })
})
