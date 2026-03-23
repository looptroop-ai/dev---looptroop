import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { DBartifact } from '@/hooks/useTicketArtifacts'
import { PhaseArtifactsPanel } from '../PhaseArtifactsPanel'

/** Find the innermost element whose full textContent (including children) matches exactly. */
function getByTextContent(text: string) {
  return screen.getByText((_content, element) => {
    return element?.textContent === text
      && Array.from(element?.children ?? []).every((child) => child.textContent !== text)
  })
}

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
            content: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Original winner question?"\n  - id: Q02\n    phase: structure\n    question: "Replacement source question?"\n  - id: Q05\n    phase: assembly\n    question: "Removed winner question?"',
            questionCount: 3,
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
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Refined winner question?"\n  - id: Q03\n    phase: structure\n    question: "Replacement target question?"\n  - id: Q04\n    phase: assembly\n    question: "Added question?"',
        questions: [
          { id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' },
          { id: 'Q03', phase: 'Structure', question: 'Replacement target question?' },
          { id: 'Q04', phase: 'Assembly', question: 'Added question?' },
        ],
        questionCount: 3,
        changes: [
          {
            type: 'modified',
            before: { id: 'Q01', phase: 'Foundation', question: 'Original winner question?' },
            after: { id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' },
          },
          {
            type: 'replaced',
            before: { id: 'Q02', phase: 'Structure', question: 'Replacement source question?' },
            after: { id: 'Q03', phase: 'Structure', question: 'Replacement target question?' },
          },
          {
            type: 'added',
            before: null,
            after: { id: 'Q04', phase: 'Assembly', question: 'Added question?' },
          },
          {
            type: 'removed',
            before: { id: 'Q05', phase: 'Assembly', question: 'Removed winner question?' },
            after: null,
          },
        ],
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
    expect(screen.getByText('proposed 3 questions')).toBeInTheDocument()
    expect(screen.getByText('Final Interview Results')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2 · 3 questions')).toBeInTheDocument()
    expect(screen.queryByText('Winner — refining draft')).not.toBeInTheDocument()
    expect(screen.queryByText('🔄 Refining')).not.toBeInTheDocument()
    expect(screen.queryByText('Interview Draft Diff')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Final Interview Results/i }))
    expect(screen.getByRole('button', { name: /Final Questions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Diff \(4\)/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Diff \(4\)/i }))
    expect(screen.getByText(/Comparing winning draft from gpt-5.2/i)).toBeInTheDocument()
    expect(getByTextContent('Original winner question?')).toBeInTheDocument()
    expect(getByTextContent('Refined winner question?')).toBeInTheDocument()
    expect(screen.getByText('Modified 1')).toBeInTheDocument()
    expect(screen.getByText('Replaced 1')).toBeInTheDocument()
    expect(screen.getByText('Added 1')).toBeInTheDocument()
    expect(screen.getByText('Removed 1')).toBeInTheDocument()
    expect(screen.getByText('Replaced')).toBeInTheDocument()
    expect(Array.from(document.querySelectorAll('mark')).map((element) => element.textContent)).toEqual(expect.arrayContaining(['Original', 'Refined']))
  })

  it('shows PRD drafting chips with epic and story metrics', () => {
    const draftArtifact: DBartifact = {
      id: 21,
      ticketId: 'ticket-1',
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      filePath: null,
      createdAt: '2026-03-23T10:12:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: [
              'schema_version: 1',
              'ticket_id: LOOP-1',
              'artifact: prd',
              'status: draft',
            ].join('\n'),
            draftMetrics: {
              epicCount: 3,
              userStoryCount: 9,
            },
          },
          {
            memberId: 'openai/gpt-5.1-codex',
            outcome: 'pending',
          },
        ],
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={2}
        councilMemberNames={['openai/gpt-5.2', 'openai/gpt-5.1-codex']}
        preloadedArtifacts={[draftArtifact]}
      />,
    )

    expect(screen.getByText('gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.1-codex')).toBeInTheDocument()
    expect(screen.getByText('3 epics · 9 user stories')).toBeInTheDocument()
    expect(screen.getByText('waiting for response')).toBeInTheDocument()
  })

  it('shows PRD draft chips with PRD-specific completion metrics', () => {
    const draftArtifact: DBartifact = {
      id: 10,
      ticketId: 'ticket-1',
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.1-codex',
            outcome: 'completed',
            content: 'schema_version: 1\nticket_id: LOOP-1\nartifact: prd\nstatus: draft\n',
            draftMetrics: {
              epicCount: 3,
              userStoryCount: 9,
            },
          },
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: 'schema_version: 1\nticket_id: LOOP-1\nartifact: prd\nstatus: draft\n',
            draftMetrics: {
              epicCount: 2,
              userStoryCount: 5,
            },
          },
        ],
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={2}
        councilMemberNames={['openai/gpt-5.1-codex', 'openai/gpt-5.2']}
        preloadedArtifacts={[draftArtifact]}
      />,
    )

    expect(screen.getByText('gpt-5.1-codex')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.2')).toBeInTheDocument()
    expect(screen.getByText('3 epics · 9 user stories')).toBeInTheDocument()
    expect(screen.getByText('2 epics · 5 user stories')).toBeInTheDocument()
    expect(screen.queryByText('proposed 3 questions')).not.toBeInTheDocument()
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
    expect(screen.getByText('gpt-5.2 · 48 questions')).toBeInTheDocument()
    expect(screen.queryByText('Interview Draft Diff')).not.toBeInTheDocument()
  })

  it('keeps the final interview diff tab available in later interview review phases', () => {
    const voteArtifact: DBartifact = {
      id: 4,
      ticketId: 'ticket-1',
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      filePath: null,
      createdAt: '2026-03-12T11:48:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Original winner question?"',
            questionCount: 1,
          },
        ],
      }),
    }

    const compiledArtifact: DBartifact = {
      id: 5,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Refined winner question?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' }],
        questionCount: 1,
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_INTERVIEW_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[voteArtifact, compiledArtifact]}
      />,
    )

    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.queryByText('Interview Answers')).not.toBeInTheDocument()
    expect(screen.queryByText('Final Interview Results')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Interview Results/i }))
    expect(screen.getByRole('button', { name: /Final Questions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Diff \(1\)/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Diff \(1\)/i }))
    expect(screen.getByText(/Comparing winning draft from gpt-5.2/i)).toBeInTheDocument()
    expect(screen.getByText('Modified 1')).toBeInTheDocument()
    expect(getByTextContent('Original winner question?')).toBeInTheDocument()
    expect(getByTextContent('Refined winner question?')).toBeInTheDocument()
  })

  it('prefers the canonical interview result in later interview phases when coverage input is available', () => {
    const compiledArtifact: DBartifact = {
      id: 6,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Old compiled question?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Old compiled question?' }],
        questionCount: 1,
      }),
    }

    const coverageInputArtifact: DBartifact = {
      id: 7,
      ticketId: 'ticket-1',
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage_input',
      filePath: null,
      createdAt: '2026-03-12T11:50:31.000Z',
      content: JSON.stringify({
        interview: [
          'schema_version: 1',
          'ticket_id: LOOP-1',
          'artifact: interview',
          'status: approved',
          'generated_by:',
          '  winner_model: openai/gpt-5.2',
          '  generated_at: 2026-03-12T11:50:31.000Z',
          'questions:',
          '  - id: Q01',
          '    phase: Foundation',
          '    prompt: "Canonical interview question?"',
          '    source: compiled',
          '    answer_type: free_text',
          '    options: []',
          '    answer:',
          '      skipped: false',
          '      selected_option_ids: []',
          '      free_text: "Canonical answer."',
          '      answered_by: user',
          '      answered_at: 2026-03-12T11:50:31.000Z',
          'follow_up_rounds: []',
          'summary:',
          '  goals: [Preserve canonical interview results]',
          '  constraints: [Keep answers visible]',
          '  non_goals: [Show compiled fallback]',
          '  final_free_form_answer: ""',
          'approval:',
          '  approved_by: ""',
          '  approved_at: ""',
        ].join('\n'),
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_INTERVIEW_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[compiledArtifact, coverageInputArtifact]}
      />,
    )

    expect(screen.getByText('1 question')).toBeInTheDocument()
    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.queryByText('Interview Answers')).not.toBeInTheDocument()
    expect(screen.queryByText('Final Interview Results')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Interview Results/i }))
    expect(screen.queryByRole('button', { name: /Final Questions/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Foundation/i }))
    expect(screen.getByText('Canonical interview question?')).toBeInTheDocument()
    expect(screen.getByText('Canonical answer.')).toBeInTheDocument()
    expect(screen.queryByText('Old compiled question?')).not.toBeInTheDocument()
  })

  it('shows a single interview results artifact during coverage verification', () => {
    const coverageInputArtifact: DBartifact = {
      id: 9,
      ticketId: 'ticket-1',
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage_input',
      filePath: null,
      createdAt: '2026-03-12T11:50:31.000Z',
      content: JSON.stringify({
        interview: [
          'schema_version: 1',
          'ticket_id: LOOP-1',
          'artifact: interview',
          'status: approved',
          'generated_by:',
          '  winner_model: openai/gpt-5.2',
          '  generated_at: 2026-03-12T11:50:31.000Z',
          'questions:',
          '  - id: Q01',
          '    phase: Foundation',
          '    prompt: "Coverage interview question?"',
          '    source: compiled',
          '    answer_type: free_text',
          '    options: []',
          '    answer:',
          '      skipped: false',
          '      selected_option_ids: []',
          '      free_text: "Coverage answer."',
          '      answered_by: user',
          '      answered_at: 2026-03-12T11:50:31.000Z',
          'follow_up_rounds: []',
          'summary:',
          '  goals: [Preserve coverage interview results]',
          '  constraints: [Keep answers visible]',
          '  non_goals: [Show raw compiled artifact]',
          '  final_free_form_answer: ""',
          'approval:',
          '  approved_by: ""',
          '  approved_at: ""',
        ].join('\n'),
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="VERIFYING_INTERVIEW_COVERAGE"
        isCompleted={false}
        preloadedArtifacts={[coverageInputArtifact]}
      />,
    )

    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.queryByText('Interview Answers')).not.toBeInTheDocument()
    expect(screen.queryByText('Final Interview Results')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Interview Results/i }))
    fireEvent.click(screen.getByRole('button', { name: /Foundation/i }))
    expect(screen.getByText('Coverage interview question?')).toBeInTheDocument()
    expect(screen.getByText('Coverage answer.')).toBeInTheDocument()
  })

  it('renders parsed interview coverage gaps and follow-up questions before raw audit output', () => {
    const coverageArtifact: DBartifact = {
      id: 8,
      ticketId: 'ticket-1',
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage',
      filePath: null,
      createdAt: '2026-03-12T11:51:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        response: 'status: gaps\nfollow_up_questions:\n  - id: FU01\n    question: "Which fallback should be used?"\n',
        hasGaps: true,
        coverageRunNumber: 2,
        maxCoveragePasses: 2,
        limitReached: true,
        terminationReason: 'coverage_pass_limit_reached',
        followUpBudgetPercent: 20,
        followUpBudgetTotal: 10,
        followUpBudgetUsed: 10,
        followUpBudgetRemaining: 0,
        parsed: {
          status: 'gaps',
          gaps: ['Missing fallback behavior for skipped answers.'],
          followUpQuestions: [
            {
              id: 'FU01',
              question: 'Which fallback should be used?',
              phase: 'Assembly',
              priority: 'high',
              rationale: 'Close the final interview gap before PRD generation.',
            },
          ],
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="VERIFYING_INTERVIEW_COVERAGE"
        isCompleted={false}
        preloadedArtifacts={[coverageArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.2/i }))
    expect(screen.getByText('Coverage gaps found')).toBeInTheDocument()
    expect(screen.getByText(/Winner-only coverage verification/i)).toBeInTheDocument()
    expect(screen.getByText('Retry cap reached; moving to approval with unresolved gaps.')).toBeInTheDocument()
    expect(screen.getByText('Follow-up budget: 10/10 used (20%) · 0 remaining')).toBeInTheDocument()
    expect(screen.getByText('Missing fallback behavior for skipped answers.')).toBeInTheDocument()
    expect(screen.getByText('Which fallback should be used?')).toBeInTheDocument()
    expect(screen.getByText('Close the final interview gap before PRD generation.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Audit Output/i })).toBeInTheDocument()
  })
})
