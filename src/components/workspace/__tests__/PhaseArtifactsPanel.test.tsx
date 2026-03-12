import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { DBartifact } from '@/hooks/useTicketArtifacts'
import { PhaseArtifactsPanel } from '../PhaseArtifactsPanel'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('PhaseArtifactsPanel', () => {
  it('collapses interview voting artifacts into a winning draft card plus shared voting details', () => {
    const voteArtifact: DBartifact = {
      id: 1,
      ticketId: 'ticket-1',
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      filePath: null,
      createdAt: '2026-03-12T11:48:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        drafts: [
          { memberId: 'openai/gpt-5.1-codex', outcome: 'completed', content: 'Draft 1' },
          { memberId: 'openai/gpt-5.1-codex-mini', outcome: 'completed', content: 'Draft 2' },
          { memberId: 'openai/gpt-5.2', outcome: 'completed', content: 'Draft 3' },
          { memberId: 'opencode/big-pickle', outcome: 'completed', content: 'Draft 4' },
        ],
        votes: [
          { voterId: 'openai/gpt-5.1-codex', draftId: 'openai/gpt-5.1-codex', totalScore: 80, scores: [] },
          { voterId: 'openai/gpt-5.1-codex', draftId: 'openai/gpt-5.1-codex-mini', totalScore: 82, scores: [] },
          { voterId: 'openai/gpt-5.1-codex', draftId: 'openai/gpt-5.2', totalScore: 89, scores: [] },
          { voterId: 'openai/gpt-5.1-codex', draftId: 'opencode/big-pickle', totalScore: 78, scores: [] },
          { voterId: 'openai/gpt-5.1-codex-mini', draftId: 'openai/gpt-5.1-codex', totalScore: 81, scores: [] },
          { voterId: 'openai/gpt-5.1-codex-mini', draftId: 'openai/gpt-5.1-codex-mini', totalScore: 83, scores: [] },
          { voterId: 'openai/gpt-5.1-codex-mini', draftId: 'openai/gpt-5.2', totalScore: 90, scores: [] },
          { voterId: 'openai/gpt-5.1-codex-mini', draftId: 'opencode/big-pickle', totalScore: 79, scores: [] },
          { voterId: 'openai/gpt-5.2', draftId: 'openai/gpt-5.1-codex', totalScore: 82, scores: [] },
          { voterId: 'openai/gpt-5.2', draftId: 'openai/gpt-5.1-codex-mini', totalScore: 84, scores: [] },
          { voterId: 'openai/gpt-5.2', draftId: 'openai/gpt-5.2', totalScore: 91, scores: [] },
          { voterId: 'openai/gpt-5.2', draftId: 'opencode/big-pickle', totalScore: 80, scores: [] },
          { voterId: 'opencode/big-pickle', draftId: 'openai/gpt-5.1-codex', totalScore: 79, scores: [] },
          { voterId: 'opencode/big-pickle', draftId: 'openai/gpt-5.1-codex-mini', totalScore: 81, scores: [] },
          { voterId: 'opencode/big-pickle', draftId: 'openai/gpt-5.2', totalScore: 88, scores: [] },
          { voterId: 'opencode/big-pickle', draftId: 'opencode/big-pickle', totalScore: 77, scores: [] },
        ],
        voterOutcomes: {
          'openai/gpt-5.1-codex': 'completed',
          'openai/gpt-5.1-codex-mini': 'completed',
          'openai/gpt-5.2': 'completed',
          'opencode/big-pickle': 'completed',
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_VOTING_INTERVIEW"
        isCompleted={false}
        councilMemberCount={4}
        councilMemberNames={[
          'openai/gpt-5.1-codex',
          'openai/gpt-5.1-codex-mini',
          'openai/gpt-5.2',
          'opencode/big-pickle',
        ]}
        preloadedArtifacts={[voteArtifact]}
      />,
    )

    expect(screen.getByText('Voting Details')).toBeInTheDocument()
    expect(screen.getByText('Winning Draft')).toBeInTheDocument()
    expect(screen.getByText('winner: gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText('4 voters · 4 drafts')).toBeInTheDocument()
    expect(screen.queryByText('gpt-5.1-codex-mini')).not.toBeInTheDocument()
    expect(screen.queryByText('big-pickle')).not.toBeInTheDocument()

    const [votingButton, winningButton] = screen.getAllByRole('button')
    expect(votingButton).toHaveTextContent('Voting Details')
    expect(winningButton).toHaveTextContent('Winning Draft')
  })

  it('shows compact compiling interview draft chips and a separate final interview artifact', () => {
    const voteArtifact: DBartifact = {
      id: 1,
      ticketId: 'ticket-1',
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      filePath: null,
      createdAt: '2026-03-12T11:48:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        drafts: [
          { memberId: 'openai/gpt-5.1-codex', outcome: 'completed', content: 'questions:\n  - id: Q01\n    question: "Draft A?"', questionCount: 21 },
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Original winner question?"\n  - id: Q02\n    phase: structure\n    question: "Unchanged question?"',
            questionCount: 48,
          },
        ],
      }),
    }

    const compiledArtifact: DBartifact = {
      id: 2,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Refined winner question?"\n  - id: Q02\n    phase: structure\n    question: "Unchanged question?"',
        questions: [
          { id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' },
          { id: 'Q02', phase: 'Structure', question: 'Unchanged question?' },
        ],
        questionCount: 48,
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COMPILING_INTERVIEW"
        isCompleted={false}
        councilMemberCount={2}
        councilMemberNames={['openai/gpt-5.1-codex', 'openai/gpt-5.2']}
        preloadedArtifacts={[voteArtifact, compiledArtifact]}
      />,
    )

    expect(screen.getByText('gpt-5.1-codex')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText('proposed 21 questions')).toBeInTheDocument()
    expect(screen.getByText('proposed 48 questions')).toBeInTheDocument()
    expect(screen.getByText('Final Interview Results')).toBeInTheDocument()
    expect(screen.getByText('Interview Draft Diff')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2 · 48 questions')).toBeInTheDocument()
    expect(screen.getByText('1 change')).toBeInTheDocument()
    expect(screen.queryByText('Winner — refining draft')).not.toBeInTheDocument()
    expect(screen.queryByText('🔄 Refining')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Interview Draft Diff/i }))
    expect(screen.getByText(/Comparing winning draft from gpt-5.2/i)).toBeInTheDocument()
    expect(screen.getByText('Original winner question?')).toBeInTheDocument()
    expect(screen.getByText('Refined winner question?')).toBeInTheDocument()
  })

  it('keeps the final interview artifact available while waiting for interview answers', () => {
    const compiledArtifact: DBartifact = {
      id: 3,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    question: "Final?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Final?' }],
        questionCount: 48,
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_INTERVIEW_ANSWERS"
        isCompleted={false}
        preloadedArtifacts={[compiledArtifact]}
      />,
    )

    expect(screen.getByText('Interview Answers')).toBeInTheDocument()
    expect(screen.getByText('Final Interview Results')).toBeInTheDocument()
    expect(screen.getByText('Interview Draft Diff')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2 · 48 questions')).toBeInTheDocument()
  })
})
