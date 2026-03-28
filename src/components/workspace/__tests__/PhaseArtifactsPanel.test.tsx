import { fireEvent, render, screen, within } from '@testing-library/react'
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

function buildInterviewDocumentContent() {
  return [
    'schema_version: 1',
    'ticket_id: PROJ-42',
    'artifact: interview',
    'status: draft',
    'generated_by:',
    '  winner_model: openai/gpt-5.2',
    '  generated_at: 2026-03-25T09:00:00.000Z',
    'questions:',
    '  - id: Q01',
    '    phase: Foundation',
    '    prompt: "How should skipped answers be completed?"',
    '    source: compiled',
    '    answer_type: free_text',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    '      free_text: "Use AI-authored answers and label them clearly."',
    '      answered_by: ai_skip',
    '      answered_at: 2026-03-25T09:00:00.000Z',
    'follow_up_rounds: []',
    'summary:',
    '  goals: []',
    '  constraints: []',
    '  non_goals: []',
    '  final_free_form_answer: ""',
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

function buildPrdDocumentContent({
  epicTitle = 'Restore rich PRD views',
  storyTitle = 'Review PRD drafts',
  acceptanceCriterion = 'Show epics and user stories in the structured view.',
}: {
  epicTitle?: string
  storyTitle?: string
  acceptanceCriterion?: string
} = {}) {
  return [
    'schema_version: 1',
    'ticket_id: PROJ-42',
    'artifact: prd',
    'status: draft',
    'source_interview:',
    '  content_sha256: mock-sha',
    'product:',
    '  problem_statement: "Restore the richer PRD artifact viewer."',
    '  target_users:',
    '    - "LoopTroop maintainers"',
    'scope:',
    '  in_scope:',
    '    - "PRD artifact dialogs"',
    '  out_of_scope:',
    '    - "Workflow logic"',
    'technical_requirements:',
    '  architecture_constraints:',
    '    - "UI-only change"',
    '  data_model: []',
    '  api_contracts: []',
    '  security_constraints: []',
    '  performance_constraints: []',
    '  reliability_constraints: []',
    '  error_handling_rules: []',
    '  tooling_assumptions: []',
    'epics:',
    '  - id: "EPIC-1"',
    `    title: "${epicTitle}"`,
    '    objective: "Make PRD artifacts easy to inspect."',
    '    user_stories:',
    '      - id: "US-1"',
    `        title: "${storyTitle}"`,
    '        acceptance_criteria:',
    `          - "${acceptanceCriterion}"`,
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
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
            inspiration: {
              draftIndex: 0,
              memberId: 'openai/gpt-5.1-codex',
              question: { id: 'Q07', phase: 'Structure', question: 'Alternative draft replacement question?' },
            },
            attributionStatus: 'inspired',
          },
          {
            type: 'added',
            before: null,
            after: { id: 'Q04', phase: 'Assembly', question: 'Added question?' },
            inspiration: null,
            attributionStatus: 'model_unattributed',
          },
          {
            type: 'removed',
            before: { id: 'Q05', phase: 'Assembly', question: 'Removed winner question?' },
            after: null,
            inspiration: null,
            attributionStatus: 'model_unattributed',
          },
        ],
        structuredOutput: {
          repairApplied: true,
          repairWarnings: [
            'Synthesized omitted interview refinement modified change for Q01 by matching id and phase across the winning and final drafts.',
          ],
        },
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
    expect(screen.getByText('Auto-detected diff')).toBeInTheDocument()
    expect(screen.getAllByText('No source recorded').length).toBeGreaterThan(0)
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

    // Model names appear in both Part 1 (full answers) and Part 2 (drafts)
    expect(screen.queryAllByText('gpt-5.2').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('gpt-5.1-codex').length).toBeGreaterThan(0)
    expect(screen.getByText('3 epics · 9 user stories')).toBeInTheDocument()
    expect(screen.queryAllByText('waiting for response').length).toBeGreaterThan(0)
    expect(screen.getByText('Part 1')).toBeInTheDocument()
    expect(screen.getByText('Part 2')).toBeInTheDocument()
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

    // Model names appear in both Part 1 (full answers) and Part 2 (drafts)
    expect(screen.queryAllByText('gpt-5.1-codex').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('gpt-5.2').length).toBeGreaterThan(0)
    expect(screen.getByText('3 epics · 9 user stories')).toBeInTheDocument()
    expect(screen.getByText('2 epics · 5 user stories')).toBeInTheDocument()
    expect(screen.queryByText('proposed 3 questions')).not.toBeInTheDocument()
  })

  it('opens Drafting PRD part 1 artifacts with the interview-style full answers viewer', () => {
    const fullAnswersArtifact: DBartifact = {
      id: 30,
      ticketId: 'ticket-1',
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      filePath: null,
      createdAt: '2026-03-25T10:12:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildInterviewDocumentContent(),
            questionCount: 1,
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[fullAnswersArtifact]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /gpt-5\.2/i })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /Foundation/i }))

    expect(screen.getByText('How should skipped answers be completed?')).toBeInTheDocument()
    expect(screen.getByText('Use AI-authored answers and label them clearly.')).toBeInTheDocument()
    expect(screen.getByText(/Answered automatically by AI in Drafting specs status/i)).toBeInTheDocument()
  })

  it('shows the stored full-answer count in the Drafting PRD ticket chips', () => {
    const fullAnswersArtifact: DBartifact = {
      id: 35,
      ticketId: 'ticket-1',
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      filePath: null,
      createdAt: '2026-03-25T10:17:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: [
              'schema_version: 1',
              'ticket_id: PROJ-42',
              'artifact: interview',
              'questions:',
              '  - id: Q01',
              '    prompt: "First preserved question?"',
              '    answer:',
              '      skipped: false',
              '      free_text: "First answer."',
              '  - id: Q02',
              '    prompt: "Second preserved question?"',
              '    answer:',
              '      skipped: false',
              '      free_text: "Second answer."',
            ].join('\n'),
            questionCount: 1,
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[fullAnswersArtifact]}
      />,
    )

    expect(screen.getByText('1 answers')).toBeInTheDocument()
    expect(screen.queryByText('2 answers')).not.toBeInTheDocument()
  })

  it('opens Drafting PRD part 2 artifacts with the structured PRD viewer', () => {
    const draftArtifact: DBartifact = {
      id: 31,
      ticketId: 'ticket-1',
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      filePath: null,
      createdAt: '2026-03-25T10:13:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildPrdDocumentContent(),
            draftMetrics: {
              epicCount: 1,
              userStoryCount: 1,
            },
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[draftArtifact]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /gpt-5\.2/i })[1]!)

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Restore rich PRD views')).toBeInTheDocument()

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Restore rich PRD views').closest('button')!)

    expect(screen.getByText('Review PRD drafts')).toBeInTheDocument()
  })

  it('keeps Voting on Specs winner artifacts on the structured PRD viewer', () => {
    const voteArtifact: DBartifact = {
      id: 32,
      ticketId: 'ticket-1',
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
      filePath: null,
      createdAt: '2026-03-25T10:14:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildPrdDocumentContent({
              epicTitle: 'Winning PRD draft',
              storyTitle: 'Inspect the winning PRD',
            }),
          },
        ],
        votes: [
          {
            voterId: 'openai/gpt-5.2',
            draftId: 'openai/gpt-5.2',
            totalScore: 95,
            scores: [
              { category: 'Coverage of requirements', score: 19 },
              { category: 'Correctness / feasibility', score: 19 },
              { category: 'Testability', score: 19 },
              { category: 'Minimal complexity / good decomposition', score: 19 },
              { category: 'Risks / edge cases addressed', score: 19 },
            ],
          },
        ],
        voterOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
        winnerId: 'openai/gpt-5.2',
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_VOTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[voteArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Winning PRD Draft/i }))

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Winning PRD draft')).toBeInTheDocument()

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Winning PRD draft').closest('button')!)

    expect(screen.getByText('Inspect the winning PRD')).toBeInTheDocument()
  })

  it('keeps Voting on Specs details on the voting results view', () => {
    const voteArtifact: DBartifact = {
      id: 34,
      ticketId: 'ticket-1',
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
      filePath: null,
      createdAt: '2026-03-25T10:16:31.000Z',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildPrdDocumentContent(),
          },
        ],
        votes: [
          {
            voterId: 'openai/gpt-5.2',
            draftId: 'openai/gpt-5.2',
            totalScore: 95,
            scores: [
              { category: 'Coverage of requirements', score: 19 },
              { category: 'Correctness / feasibility', score: 19 },
              { category: 'Testability', score: 19 },
              { category: 'Minimal complexity / good decomposition', score: 19 },
              { category: 'Risks / edge cases addressed', score: 19 },
            ],
          },
        ],
        voterOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
        winnerId: 'openai/gpt-5.2',
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_VOTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[voteArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Voting Details/i }))

    expect(screen.getByText('Rankings')).toBeInTheDocument()
    expect(screen.getByText('Score Breakdown')).toBeInTheDocument()
  })

  it('keeps later PRD review phases on the structured refined PRD viewer', () => {
    const refinedArtifact: DBartifact = {
      id: 33,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Refined PRD review')).toBeInTheDocument()

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Refined PRD review').closest('button')!)

    expect(screen.getByText('Inspect refined PRD sections')).toBeInTheDocument()
  })

  it('prefers the effective PRD coverage input when rendering the refined PRD view', () => {
    const refinedArtifact: DBartifact = {
      id: 34,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined artifact PRD',
          storyTitle: 'Inspect refined artifact sections',
        }),
      }),
    }

    const coverageInputArtifact: DBartifact = {
      id: 35,
      ticketId: 'ticket-1',
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'prd_coverage_input',
      filePath: null,
      createdAt: '2026-03-25T10:16:31.000Z',
      content: JSON.stringify({
        interview: buildInterviewDocumentContent(),
        fullAnswers: buildInterviewDocumentContent(),
        prd: buildPrdDocumentContent({
          epicTitle: 'Coverage input PRD',
          storyTitle: 'Inspect coverage input sections',
        }),
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Coverage input under verification',
          storyTitle: 'Inspect the exact PRD sent to coverage',
        }),
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact, coverageInputArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))

    expect(screen.getByText('Coverage input PRD')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Coverage input PRD').closest('button')!)
    expect(screen.getByText('Inspect coverage input sections')).toBeInTheDocument()
    expect(screen.getByText('Coverage input under verification')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Coverage input under verification').closest('button')!)
    expect(screen.getByText('Inspect the exact PRD sent to coverage')).toBeInTheDocument()
    expect(screen.queryByText('Refined artifact PRD')).not.toBeInTheDocument()
    expect(screen.queryByText('Inspect refined artifact sections')).not.toBeInTheDocument()
  })

  it('falls back to the effective PRD coverage input when refinedContent is absent', () => {
    const refinedArtifact: DBartifact = {
      id: 36,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Artifact fallback PRD',
          storyTitle: 'Inspect artifact fallback sections',
        }),
      }),
    }

    const coverageInputArtifact: DBartifact = {
      id: 37,
      ticketId: 'ticket-1',
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'prd_coverage_input',
      filePath: null,
      createdAt: '2026-03-25T10:16:31.000Z',
      content: JSON.stringify({
        interview: buildInterviewDocumentContent(),
        fullAnswers: buildInterviewDocumentContent(),
        prd: buildPrdDocumentContent({
          epicTitle: 'Coverage input PRD only',
          storyTitle: 'Inspect the exact saved PRD',
        }),
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact, coverageInputArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))

    const dialog = screen.getByRole('dialog')
    const [coverageInputPrdButton] = within(dialog).getAllByRole('button', { name: /Coverage input PRD only/i })
    if (!coverageInputPrdButton) {
      throw new Error('Expected PRD coverage input button to exist')
    }
    fireEvent.click(coverageInputPrdButton)
    expect(screen.getByText('Inspect the exact saved PRD')).toBeInTheDocument()
    expect(screen.queryByText('Artifact fallback PRD')).not.toBeInTheDocument()
    expect(screen.queryByText('Inspect artifact fallback sections')).not.toBeInTheDocument()
  })

  it('shows no-source badges in generic refinement diff views', () => {
    const refinedArtifact: DBartifact = {
      id: 330,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        winnerDraftContent: buildPrdDocumentContent({
          epicTitle: 'Original PRD review',
          storyTitle: 'Inspect original PRD sections',
        }),
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
        changes: [
          {
            type: 'modified',
            itemType: 'epic',
            before: { id: 'EPIC-1', label: 'Original PRD review' },
            after: { id: 'EPIC-1', label: 'Refined PRD review' },
            inspiration: null,
            attributionStatus: 'model_unattributed',
          },
        ],
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff$/i }))

    const leafTextMatcher = (text: string) => (_content: string, node: Element | null) => {
      const hasText = (candidate: Element | null) => candidate?.textContent?.includes(text) ?? false
      if (!hasText(node)) return false
      return Array.from(node?.children ?? []).every((child) => !hasText(child))
    }

    expect(screen.getByText('Modified 2')).toBeInTheDocument()
    expect(screen.getAllByText('No source recorded')).toHaveLength(2)
    expect(screen.getByText(leafTextMatcher('Original PRD review'))).toBeInTheDocument()
    expect(screen.getAllByText(leafTextMatcher('Refined PRD review')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(leafTextMatcher('Inspect refined PRD sections')).length).toBeGreaterThan(0)
  })

  it('shows a friendly cleanup notice when only no-op refinement warnings were repaired', () => {
    const refinedArtifact: DBartifact = {
      id: 331,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        winnerDraftContent: buildPrdDocumentContent({
          epicTitle: 'Original PRD review',
          storyTitle: 'Inspect original PRD sections',
        }),
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
        structuredOutput: {
          repairApplied: true,
          repairWarnings: [
            'Dropped no-op PRD refinement modified change at index 0 because the winning and final records are identical.',
            'Dropped no-op PRD refinement modified change at index 1 because the winning and final records are identical.',
          ],
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff$/i }))

    expect(screen.getByText('We cleaned up the AI\'s change list.')).toBeInTheDocument()
    expect(screen.getByText(/Some items the AI marked as changed were actually unchanged/i)).toBeInTheDocument()
    expect(screen.getByText('Ignored 2 invalid change notes that turned out to be no-ops.')).toBeInTheDocument()
    expect(screen.queryByText('This artifact needed repair.')).not.toBeInTheDocument()
  })

  it('keeps the broader repair notice for non-no-op refinement repairs', () => {
    const refinedArtifact: DBartifact = {
      id: 332,
      ticketId: 'ticket-1',
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      filePath: null,
      createdAt: '2026-03-25T10:15:31.000Z',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        winnerDraftContent: buildPrdDocumentContent({
          epicTitle: 'Original PRD review',
          storyTitle: 'Inspect original PRD sections',
        }),
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
        structuredOutput: {
          repairApplied: true,
          repairWarnings: [
            'Inferred missing PRD refinement item_type at index 0 as epic.',
          ],
        },
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Refined PRD/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff$/i }))

    expect(screen.getByText('This artifact needed repair.')).toBeInTheDocument()
    expect(screen.getByText(/Some diff entries may be auto-detected or may have corrected attribution/i)).toBeInTheDocument()
    expect(screen.getByText('Inferred missing PRD refinement item_type at index 0 as epic.')).toBeInTheDocument()
    expect(screen.queryByText('We cleaned up the AI\'s change list.')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: /Final Interview Results/i }))
    expect(screen.getByRole('button', { name: /Final Questions/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Diff(?: \(\d+\))?$/i })).not.toBeInTheDocument()
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

  it('restores interview inspiration indicators from the separate ui diff artifact', () => {
    const voteArtifact: DBartifact = {
      id: 41,
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
            content: [
              'questions:',
              '  - id: Q02',
              '    phase: structure',
              '    question: "Replacement source question?"',
            ].join('\n'),
          },
        ],
      }),
    }

    const compiledArtifact: DBartifact = {
      id: 42,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:31.000Z',
      content: JSON.stringify({
        refinedContent: [
          'questions:',
          '  - id: Q03',
          '    phase: structure',
          '    question: "Replacement target question?"',
        ].join('\n'),
      }),
    }

    const compiledCompanionArtifact: DBartifact = {
      id: 43,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'ui_artifact_companion:interview_compiled',
      filePath: null,
      createdAt: '2026-03-12T11:49:32.000Z',
      content: JSON.stringify({
        baseArtifactType: 'interview_compiled',
        generatedAt: '2026-03-12T11:49:32.000Z',
        payload: {
          winnerId: 'openai/gpt-5.2',
          questions: [{ id: 'Q03', phase: 'Structure', question: 'Replacement target question?' }],
          questionCount: 1,
        },
      }),
    }

    const winnerArtifact: DBartifact = {
      id: 44,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_winner',
      filePath: null,
      createdAt: '2026-03-12T11:49:33.000Z',
      content: JSON.stringify({ winnerId: 'openai/gpt-5.2' }),
    }

    const uiDiffArtifact: DBartifact = {
      id: 45,
      ticketId: 'ticket-1',
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'ui_refinement_diff:interview',
      filePath: null,
      createdAt: '2026-03-12T11:49:34.000Z',
      content: JSON.stringify({
        domain: 'interview',
        winnerId: 'openai/gpt-5.2',
        generatedAt: '2026-03-12T11:49:34.000Z',
        entries: [
          {
            key: 'Q03:replaced:0',
            changeType: 'replaced',
            itemKind: 'question',
            label: 'Q03',
            beforeId: 'Q02',
            afterId: 'Q03',
            beforeText: 'Replacement source question?',
            afterText: 'Replacement target question?',
            inspiration: {
              memberId: 'openai/gpt-5.1-codex',
              sourceId: 'Q07',
              sourceLabel: 'Q07',
              sourceText: 'Alternative draft replacement question?',
            },
            attributionStatus: 'inspired',
          },
        ],
      }),
    }

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_INTERVIEW_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[voteArtifact, compiledArtifact, compiledCompanionArtifact, winnerArtifact, uiDiffArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Interview Results/i }))
    fireEvent.click(screen.getByRole('button', { name: /Diff \(1\)/i }))

    expect(screen.queryByText('No source recorded')).not.toBeInTheDocument()
    expect(document.querySelector('.lucide-lightbulb')).not.toBeNull()
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
