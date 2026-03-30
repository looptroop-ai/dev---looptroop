import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DBartifact } from '@/hooks/useTicketArtifacts'
import { TEST } from '@/test/factories'
import { PhaseArtifactsPanel } from '../PhaseArtifactsPanel'

/** Find the innermost element whose full textContent (including children) matches exactly. */
function hasExactTextContent(text: string) {
  return (_content: string, element: Element | null) => {
    return element?.textContent === text
      && Array.from(element?.children ?? []).every((child) => child.textContent !== text)
  }
}

function getByTextContent(text: string) {
  return screen.getByText(hasExactTextContent(text))
}

async function expectFirstInspirationTooltip(bodyText: string) {
  const trigger = document.querySelector('.lucide-lightbulb')?.parentElement as HTMLElement | null
  expect(trigger).not.toBeNull()
  if (!trigger) throw new Error('Expected inspiration tooltip trigger')

  fireEvent.pointerMove(trigger)
  fireEvent.mouseEnter(trigger)

  expect((await screen.findAllByText(/Inspired by /i)).length).toBeGreaterThan(0)
  expect((await screen.findAllByText(hasExactTextContent(bodyText))).length).toBeGreaterThan(0)
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
    `ticket_id: ${TEST.externalId}`,
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
    `ticket_id: ${TEST.externalId}`,
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

function buildBeadsDocumentContent(
  beads: Array<{ id: string; title: string; description?: string }> = [
    { id: 'bead-1', title: 'Validate refinement attribution' },
  ],
) {
  return [
    'beads:',
    ...beads.flatMap((bead) => [
      `  - id: "${bead.id}"`,
      `    title: "${bead.title}"`,
      '    prdRefs: ["EPIC-1 / US-1"]',
      `    description: "${bead.description ?? `Deliver ${bead.title.toLowerCase()}.`}"`,
      '    contextGuidance: "Keep attribution deterministic."',
      '    acceptanceCriteria:',
      `      - "Validate ${bead.title.toLowerCase()}"`,
      '    tests:',
      `      - "Test ${bead.title.toLowerCase()}"`,
      '    testCommands:',
      '      - "npm run test:server"',
    ]),
  ].join('\n')
}

function buildBeadsDraftCompanionContent() {
  return JSON.stringify({
    baseArtifactType: 'beads_drafts',
    generatedAt: '2026-03-12T11:49:31.000Z',
    payload: {
      draftDetails: [
        {
          memberId: 'openai/gpt-5.2',
          duration: 42,
          draftMetrics: {
            beadCount: 2,
            totalTestCount: 5,
            totalAcceptanceCriteriaCount: 6,
          },
        },
      ],
    },
  })
}

let nextArtifactId = 1
function makeArtifact(overrides: Partial<DBartifact> & Pick<DBartifact, 'phase' | 'artifactType' | 'content'>): DBartifact {
  return {
    id: nextArtifactId++,
    ticketId: TEST.ticketId,
    filePath: null,
    createdAt: TEST.timestamp,
    ...overrides,
  }
}

describe('PhaseArtifactsPanel', () => {
  beforeEach(() => {
    nextArtifactId = 1
  })

  it('collapses interview voting artifacts into a winning draft card plus shared voting details', () => {
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
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
    })

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
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
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
    })

    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
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
    })

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

  it.each([
    {
      scenario: 'shows chips with pending and completed members',
      drafts: [
        {
          memberId: 'openai/gpt-5.2',
          outcome: 'completed',
          content: [
            'schema_version: 1',
            `ticket_id: ${TEST.externalId}`,
            'artifact: prd',
            'status: draft',
          ].join('\n'),
          draftMetrics: { epicCount: 3, userStoryCount: 9 },
        },
        { memberId: 'openai/gpt-5.1-codex', outcome: 'pending' },
      ],
      councilMemberNames: ['openai/gpt-5.2', 'openai/gpt-5.1-codex'],
      expectedMetrics: ['3 epics · 9 user stories'],
      expectedPending: true,
      expectedParts: true,
      notExpected: [] as string[],
    },
    {
      scenario: 'shows chips with PRD-specific completion metrics',
      drafts: [
        {
          memberId: 'openai/gpt-5.1-codex',
          outcome: 'completed',
          content: `schema_version: 1\nticket_id: ${TEST.externalId}\nartifact: prd\nstatus: draft\n`,
          draftMetrics: { epicCount: 3, userStoryCount: 9 },
        },
        {
          memberId: 'openai/gpt-5.2',
          outcome: 'completed',
          content: `schema_version: 1\nticket_id: ${TEST.externalId}\nartifact: prd\nstatus: draft\n`,
          draftMetrics: { epicCount: 2, userStoryCount: 5 },
        },
      ],
      councilMemberNames: ['openai/gpt-5.1-codex', 'openai/gpt-5.2'],
      expectedMetrics: ['3 epics · 9 user stories', '2 epics · 5 user stories'],
      expectedPending: false,
      expectedParts: false,
      notExpected: ['proposed 3 questions'],
    },
  ])('$scenario', ({ drafts, councilMemberNames, expectedMetrics, expectedPending, expectedParts, notExpected }) => {
    const draftArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      content: JSON.stringify({ drafts }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={2}
        councilMemberNames={councilMemberNames}
        preloadedArtifacts={[draftArtifact]}
      />,
    )

    for (const name of councilMemberNames) {
      const shortName = name.split('/').pop()!
      expect(screen.queryAllByText(shortName).length).toBeGreaterThan(0)
    }
    for (const metric of expectedMetrics) {
      expect(screen.getByText(metric)).toBeInTheDocument()
    }
    if (expectedPending) {
      expect(screen.queryAllByText('waiting for response').length).toBeGreaterThan(0)
    }
    if (expectedParts) {
      expect(screen.getByText('Part 1')).toBeInTheDocument()
      expect(screen.getByText('Part 2')).toBeInTheDocument()
    }
    for (const text of notExpected) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
  })

  it('opens Drafting PRD part 1 artifacts with the interview-style full answers viewer', () => {
    const fullAnswersArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
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
    })

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
    const fullAnswersArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: [
              'schema_version: 1',
              `ticket_id: ${TEST.externalId}`,
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
    })

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
    const draftArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
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
    })

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

    fireEvent.click(screen.getByText('Restore rich PRD views').closest('button')!)

    expect(screen.getByText('Review PRD drafts')).toBeInTheDocument()
  })

  it('shows Full Answers and PRD draft notices separately during Drafting PRD', () => {
    const fullAnswersArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildInterviewDocumentContent(),
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
      }),
    })

    const fullAnswersCompanion = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'ui_artifact_companion:prd_full_answers',
      content: JSON.stringify({
        baseArtifactType: 'prd_full_answers',
        generatedAt: '2026-03-30T09:33:08.154Z',
        payload: {
          draftDetails: [
            {
              memberId: 'openai/gpt-5.2',
              structuredOutput: {
                repairApplied: true,
                repairWarnings: [
                  'Canonicalized resolved interview status from "approved" to "draft".',
                  'Cleared approval fields for the AI-generated Full Answers artifact.',
                  'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "openai/gpt-5.2".',
                ],
              },
            },
          ],
        },
      }),
    })

    const draftArtifact = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_drafts',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildPrdDocumentContent(),
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
      }),
    })

    const draftCompanion = makeArtifact({
      phase: 'DRAFTING_PRD',
      artifactType: 'ui_artifact_companion:prd_drafts',
      content: JSON.stringify({
        baseArtifactType: 'prd_drafts',
        generatedAt: '2026-03-30T09:33:08.166Z',
        payload: {
          draftDetails: [
            {
              memberId: 'openai/gpt-5.2',
              structuredOutput: {
                repairApplied: true,
                repairWarnings: [
                  'Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.',
                ],
              },
            },
          ],
        },
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[fullAnswersArtifact, fullAnswersCompanion, draftArtifact, draftCompanion]}
      />,
    )

    const modelButtons = screen.getAllByRole('button', { name: /gpt-5\.2/i })
    fireEvent.click(modelButtons[0]!)

    expect(screen.getByText('LoopTroop adjusted these Full Answers.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 3')).toBeInTheDocument()
    expect(screen.queryByText('LoopTroop adjusted this PRD draft.')).not.toBeInTheDocument()

    fireEvent.click(modelButtons[1]!)

    expect(screen.getByText('LoopTroop adjusted this PRD draft.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
    expect(screen.queryByText('LoopTroop adjusted these Full Answers.')).not.toBeInTheDocument()
  })

  it('keeps Voting on Specs winner artifacts on the winning draft view', () => {
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
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
        voterOutcomes: { 'openai/gpt-5.2': 'completed' },
        winnerId: 'openai/gpt-5.2',
      }),
    })

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
    fireEvent.click(screen.getByText('Winning PRD draft').closest('button')!)
    expect(screen.getByText('Inspect the winning PRD')).toBeInTheDocument()
  })

  it('keeps Voting on Specs details on the voting results view', () => {
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_PRD',
      artifactType: 'prd_votes',
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
        voterOutcomes: { 'openai/gpt-5.2': 'completed' },
        winnerId: 'openai/gpt-5.2',
      }),
    })

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
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate/i }))

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Refined PRD review')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Refined PRD review').closest('button')!)

    expect(screen.getByText('Inspect refined PRD sections')).toBeInTheDocument()
  })

  it.each([
    {
      scenario: 'prefers refinedContent when present',
      coverageInputContent: {
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
      },
      refinedEpic: 'Refined artifact PRD',
      refinedStory: 'Inspect refined artifact sections',
      expectedEpic: 'Coverage input under verification',
      expectedStory: 'Inspect the exact PRD sent to coverage',
      notExpected: ['Coverage input PRD', 'Refined artifact PRD', 'Inspect refined artifact sections'],
    },
    {
      scenario: 'falls back to prd when refinedContent is absent',
      coverageInputContent: {
        interview: buildInterviewDocumentContent(),
        fullAnswers: buildInterviewDocumentContent(),
        prd: buildPrdDocumentContent({
          epicTitle: 'Coverage input PRD only',
          storyTitle: 'Inspect the exact saved PRD',
        }),
      },
      refinedEpic: 'Artifact fallback PRD',
      refinedStory: 'Inspect artifact fallback sections',
      expectedEpic: 'Coverage input PRD only',
      expectedStory: 'Inspect the exact saved PRD',
      notExpected: ['Artifact fallback PRD', 'Inspect artifact fallback sections'],
    },
  ])('$scenario', ({ coverageInputContent, refinedEpic, refinedStory, expectedEpic, expectedStory, notExpected }) => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: refinedEpic,
          storyTitle: refinedStory,
        }),
      }),
    })

    const coverageInputArtifact = makeArtifact({
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'prd_coverage_input',
      content: JSON.stringify(coverageInputContent),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact, coverageInputArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate/i }))

    fireEvent.click(screen.getByText(expectedEpic).closest('button')!)
    expect(screen.getByText(expectedStory)).toBeInTheDocument()
    for (const text of notExpected) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
  })

  it('prefers the latest coverage revision and exposes review, diff, and resolution artifacts in approval', async () => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Initial refined PRD',
          storyTitle: 'Inspect the initial candidate',
        }),
      }),
    })

    const coverageInputArtifact = makeArtifact({
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'ui_artifact_companion:prd_coverage_input',
      content: JSON.stringify({
        baseArtifactType: 'prd_coverage_input',
        generatedAt: '2026-03-25T10:16:31.000Z',
        payload: {
          interview: buildInterviewDocumentContent(),
          fullAnswers: buildInterviewDocumentContent(),
          prd: buildPrdDocumentContent({
            epicTitle: 'Audit input candidate',
            storyTitle: 'Inspect the audit input',
          }),
          refinedContent: buildPrdDocumentContent({
            epicTitle: 'Audit input candidate',
            storyTitle: 'Inspect the audit input',
          }),
          candidateVersion: 1,
        },
      }),
    })

    const coverageArtifact = makeArtifact({
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'prd_coverage',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        hasGaps: false,
        coverageRunNumber: 2,
        maxCoveragePasses: 3,
        limitReached: false,
      }),
    })

    const coverageRevisionArtifact = makeArtifact({
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'prd_coverage_revision',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Coverage revised candidate',
          storyTitle: 'Inspect the revised candidate',
        }),
        candidateVersion: 2,
      }),
    })

    const coverageRevisionCompanionArtifact = makeArtifact({
      phase: 'VERIFYING_PRD_COVERAGE',
      artifactType: 'ui_artifact_companion:prd_coverage_revision',
      content: JSON.stringify({
        baseArtifactType: 'prd_coverage_revision',
        generatedAt: '2026-03-25T10:18:32.000Z',
        payload: {
          winnerId: 'openai/gpt-5.2',
          candidateVersion: 2,
          winnerDraftContent: buildPrdDocumentContent({
            epicTitle: 'Audit input candidate',
            storyTitle: 'Inspect the audit input',
          }),
          refinedContent: buildPrdDocumentContent({
            epicTitle: 'Coverage revised candidate',
            storyTitle: 'Inspect the revised candidate',
          }),
          changes: [
            {
              type: 'modified',
              itemType: 'epic',
              before: { id: 'EPIC-1', label: 'Audit input candidate' },
              after: { id: 'EPIC-1', label: 'Coverage revised candidate' },
              inspiration: null,
              attributionStatus: 'model_unattributed',
            },
          ],
          gapResolutions: [
            {
              gap: 'Missing retry-cap approval behavior.',
              action: 'updated_prd',
              rationale: 'Added explicit approval handling when unresolved gaps remain after the retry cap.',
              affectedItems: [
                { itemType: 'epic', id: 'EPIC-1', label: 'Coverage revised candidate' },
              ],
            },
          ],
        },
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[
          refinedArtifact,
          coverageInputArtifact,
          coverageArtifact,
          coverageRevisionArtifact,
          coverageRevisionCompanionArtifact,
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /PRD Candidate v2/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Coverage Report/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Coverage Review/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Coverage Changes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Coverage Resolution Notes/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate v2/i }))
    expect(screen.getByText('Coverage revised candidate')).toBeInTheDocument()
    expect(screen.queryByText('Audit input candidate')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Coverage Report/i }))
    // Audit tab is shown by default
    expect(screen.getByText('Audit')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Resolution Notes')).toBeInTheDocument()
    // Switch to Resolution Notes tab to see gap details
    fireEvent.click(screen.getByText('Resolution Notes'))
    expect(screen.getByText('Missing retry-cap approval behavior.')).toBeInTheDocument()
    expect(screen.getByText(/Added explicit approval handling when unresolved gaps remain after the retry cap/i)).toBeInTheDocument()
  })

  it('shows no-source badges in generic refinement diff views', () => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
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
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

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

  it.each([
    {
      scenario: 'shows cleanup notice for no-op refinement warnings',
      repairWarnings: [
        'Dropped no-op PRD refinement modified change at index 0 because the winning and final records are identical.',
        'Dropped no-op PRD refinement modified change at index 1 because the winning and final records are identical.',
      ],
      expectedText: 'LoopTroop adjusted this diff.',
      expectedDetail: /Dropped no-op PRD refinement modified change at index 0/i,
      expectedCount: 'Dropped 2',
      notExpected: 'Synthesized 1',
    },
    {
      scenario: 'shows cleanup notice for no-op interview warnings',
      repairWarnings: [
        'Dropped no-op interview refinement modified at index 0 because the question is unchanged across the winning and final drafts.',
      ],
      expectedText: 'LoopTroop adjusted this diff.',
      expectedDetail: /Dropped no-op interview refinement modified at index 0/i,
      expectedCount: 'Dropped 1',
      notExpected: 'Synthesized 1',
    },
    {
      scenario: 'keeps the broader repair notice for non-no-op repairs',
      repairWarnings: [
        'Inferred missing PRD refinement item_type at index 0 as epic.',
      ],
      expectedText: 'LoopTroop adjusted this diff.',
      expectedDetail: /Inferred missing PRD refinement item_type at index 0 as epic/i,
      expectedCount: 'Synthesized 1',
      notExpected: 'Dropped 1',
    },
  ])('$scenario', ({ repairWarnings, expectedText, expectedDetail, expectedCount, notExpected }) => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
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
          repairWarnings,
        },
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    const noticeButton = screen.getByText(expectedText).closest('button')!
    expect(noticeButton).toBeInTheDocument()
    expect(screen.queryByText(expectedDetail)).not.toBeInTheDocument()
    expect(screen.getByText(expectedCount)).toBeInTheDocument()

    fireEvent.click(noticeButton)

    expect(screen.getByText(expectedDetail)).toBeInTheDocument()
    expect(screen.getByText(expectedCount)).toBeInTheDocument()
    expect(screen.queryByText(notExpected)).not.toBeInTheDocument()
  })

  it('uses category counts for mixed repair warnings and shows raw technical detail on expand', () => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
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
            'Dropped no-op interview refinement modified at index 0 because the question is unchanged across the winning and final drafts.',
            'Inferred missing PRD refinement item_type at index 0 as epic.',
          ],
        },
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_PRD_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /PRD Candidate/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    const noticeButton = screen.getByText('LoopTroop adjusted this diff.').closest('button')!
    expect(noticeButton).toBeInTheDocument()
    expect(screen.getByText('2 interventions across 2 categories.')).toBeInTheDocument()
    expect(screen.getByText('Synthesized 1')).toBeInTheDocument()
    expect(screen.getByText('Dropped 1')).toBeInTheDocument()

    fireEvent.click(noticeButton)

    expect(screen.getByText('2 interventions across 2 categories.')).toBeInTheDocument()
    expect(screen.getByText('Synthesized 1')).toBeInTheDocument()
    expect(screen.getByText('Dropped 1')).toBeInTheDocument()
    expect(screen.getByText(/Dropped no-op interview refinement modified at index 0/i)).toBeInTheDocument()
    expect(screen.getByText(/Inferred missing PRD refinement item_type at index 0 as epic/i)).toBeInTheDocument()
  })

  it('hides the interview diff repair notice when only a bare repair flag is present', () => {
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Original winner question?"',
          },
        ],
      }),
    })

    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Refined winner question?"',
      }),
    })

    const compiledCompanionArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'ui_artifact_companion:interview_compiled',
      content: JSON.stringify({
        baseArtifactType: 'interview_compiled',
        generatedAt: '2026-03-12T11:49:32.000Z',
        payload: {
          winnerId: 'openai/gpt-5.2',
          questions: [{ id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' }],
          questionCount: 1,
          structuredOutput: {
            repairApplied: true,
            repairWarnings: [],
          },
        },
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="WAITING_INTERVIEW_APPROVAL"
        isCompleted={false}
        preloadedArtifacts={[voteArtifact, compiledArtifact, compiledCompanionArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Interview Results/i }))
    fireEvent.click(screen.getByRole('button', { name: /Diff \(1\)/i }))

    expect(screen.queryByText('LoopTroop adjusted this diff.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Some saved diff details did not line up with the validated artifact/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Comparing winning draft from gpt-5.2/i)).toBeInTheDocument()
    expect(screen.getByText('Modified 1')).toBeInTheDocument()
  })

  it('keeps the final interview artifact available while waiting for interview answers', () => {
    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    question: "Final?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Final?' }],
        questionCount: 48,
      }),
    })

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
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
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
    })

    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Refined winner question?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Refined winner question?' }],
        questionCount: 1,
      }),
    })

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

  it('restores interview inspiration indicators from the separate ui diff artifact', async () => {
    const voteArtifact = makeArtifact({
      phase: 'COUNCIL_VOTING_INTERVIEW',
      artifactType: 'interview_votes',
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
    })

    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        refinedContent: [
          'questions:',
          '  - id: Q03',
          '    phase: structure',
          '    question: "Replacement target question?"',
        ].join('\n'),
      }),
    })

    const compiledCompanionArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'ui_artifact_companion:interview_compiled',
      content: JSON.stringify({
        baseArtifactType: 'interview_compiled',
        generatedAt: '2026-03-12T11:49:32.000Z',
        payload: {
          winnerId: 'openai/gpt-5.2',
          questions: [{ id: 'Q03', phase: 'Structure', question: 'Replacement target question?' }],
          questionCount: 1,
        },
      }),
    })

    const winnerArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_winner',
      content: JSON.stringify({ winnerId: 'openai/gpt-5.2' }),
    })

    const uiDiffArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'ui_refinement_diff:interview',
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
    })

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
    await expectFirstInspirationTooltip('Alternative draft replacement question?')
  })

  it.each([
    { phase: 'WAITING_PRD_APPROVAL' as const, buttonName: /PRD Candidate/i, sourceLabel: 'Expose retry telemetry' },
    { phase: 'REFINING_PRD' as const, buttonName: /PRD Candidate v1/i, sourceLabel: '' },
  ])('shows PRD inspiration tooltip text in $phase', async ({ phase, buttonName, sourceLabel }) => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify({
        refinedContent: buildPrdDocumentContent({
          epicTitle: 'Refined PRD review',
          storyTitle: 'Inspect refined PRD sections',
        }),
      }),
    })

    const uiDiffArtifact = makeArtifact({
      phase: 'REFINING_PRD',
      artifactType: 'ui_refinement_diff:prd',
      content: JSON.stringify({
        domain: 'prd',
        winnerId: 'openai/gpt-5.2',
        generatedAt: '2026-03-12T11:49:34.000Z',
        entries: [
          {
            key: 'user_story:US-3',
            changeType: 'added',
            itemKind: 'user_story',
            label: 'Surface retry metadata',
            afterId: 'US-3',
            afterText: 'Title: Surface retry metadata',
            inspiration: {
              memberId: 'openai/gpt-5-mini',
              sourceId: 'US-8',
              sourceLabel,
              sourceText: 'Title: Expose retry telemetry',
            },
            attributionStatus: 'inspired',
          },
        ],
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase={phase}
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact, uiDiffArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: buttonName }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    expect(screen.queryByText('No source recorded')).not.toBeInTheDocument()
    expect(screen.getByText('Surface retry metadata')).toBeInTheDocument()
    await expectFirstInspirationTooltip('US-8: Title: Expose retry telemetry')
  })

  it.each([
    { phase: 'WAITING_BEADS_APPROVAL' as const, buttonName: /Refined Beads/i },
    { phase: 'REFINING_BEADS' as const, buttonName: /Final Blueprint Draft/i },
  ])('shows Beads inspiration tooltip text in $phase', async ({ phase, buttonName }) => {
    const refinedArtifact = makeArtifact({
      phase: 'REFINING_BEADS',
      artifactType: 'beads_refined',
      content: JSON.stringify({
        refinedContent: buildBeadsDocumentContent([
          { id: 'bead-1', title: 'Validate refinement attribution' },
          { id: 'bead-2', title: 'Surface retry metadata' },
        ]),
      }),
    })

    const uiDiffArtifact = makeArtifact({
      phase: 'REFINING_BEADS',
      artifactType: 'ui_refinement_diff:beads',
      content: JSON.stringify({
        domain: 'beads',
        winnerId: 'openai/gpt-5.2',
        generatedAt: '2026-03-12T11:49:34.000Z',
        entries: [
          {
            key: 'bead:bead-2',
            changeType: 'added',
            itemKind: 'bead',
            label: 'Surface retry metadata',
            afterId: 'bead-2',
            afterText: 'Title: Surface retry metadata',
            inspiration: {
              memberId: 'openai/gpt-5-mini',
              sourceId: 'bead-9',
              sourceLabel: 'Adopt losing-draft telemetry',
              sourceText: 'Title: Adopt losing-draft telemetry',
            },
            attributionStatus: 'inspired',
          },
        ],
      }),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase={phase}
        isCompleted={false}
        preloadedArtifacts={[refinedArtifact, uiDiffArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: buttonName }))
    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    expect(screen.queryByText('No source recorded')).not.toBeInTheDocument()
    expect(screen.getByText('Surface retry metadata')).toBeInTheDocument()
    await expectFirstInspirationTooltip('bead-9: Title: Adopt losing-draft telemetry')
  })

  it('shows beads draft metrics on the council cards during DRAFTING_BEADS', () => {
    const draftArtifact = makeArtifact({
      phase: 'DRAFTING_BEADS',
      artifactType: 'beads_drafts',
      content: JSON.stringify({
        drafts: [
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: buildBeadsDocumentContent([
              { id: 'bead-1', title: 'Validate refinement attribution' },
              { id: 'bead-2', title: 'Surface retry metadata' },
            ]),
          },
        ],
        memberOutcomes: {
          'openai/gpt-5.2': 'completed',
        },
        isFinal: true,
      }),
    })

    const companionArtifact = makeArtifact({
      phase: 'DRAFTING_BEADS',
      artifactType: 'ui_artifact_companion:beads_drafts',
      content: buildBeadsDraftCompanionContent(),
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_BEADS"
        isCompleted={false}
        councilMemberCount={1}
        councilMemberNames={['openai/gpt-5.2']}
        preloadedArtifacts={[draftArtifact, companionArtifact]}
      />,
    )

    expect(screen.getByText('2 beads · 5 tests · 6 criteria')).toBeInTheDocument()
    expect(screen.getByText(/Finished/)).toBeInTheDocument()
  })

  it('prefers the canonical interview result in later interview phases when coverage input is available', () => {
    const compiledArtifact = makeArtifact({
      phase: 'COMPILING_INTERVIEW',
      artifactType: 'interview_compiled',
      content: JSON.stringify({
        winnerId: 'openai/gpt-5.2',
        refinedContent: 'questions:\n  - id: Q01\n    phase: foundation\n    question: "Old compiled question?"',
        questions: [{ id: 'Q01', phase: 'Foundation', question: 'Old compiled question?' }],
        questionCount: 1,
      }),
    })

    const coverageInputArtifact = makeArtifact({
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage_input',
      content: JSON.stringify({
        interview: [
          'schema_version: 1',
          `ticket_id: ${TEST.externalId}`,
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
    })

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
    const coverageInputArtifact = makeArtifact({
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage_input',
      content: JSON.stringify({
        interview: [
          'schema_version: 1',
          `ticket_id: ${TEST.externalId}`,
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
    })

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
    const coverageArtifact = makeArtifact({
      phase: 'VERIFYING_INTERVIEW_COVERAGE',
      artifactType: 'interview_coverage',
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
    })

    renderWithProviders(
      <PhaseArtifactsPanel
        phase="VERIFYING_INTERVIEW_COVERAGE"
        isCompleted={false}
        preloadedArtifacts={[coverageArtifact]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.2/i }))
    expect(screen.getByText('Coverage review found gaps')).toBeInTheDocument()
    expect(screen.getByText(/Coverage review of the compiled interview/i)).toBeInTheDocument()
    expect(screen.getByText('This pass found 1 gap between the compiled interview and the submitted answers.')).toBeInTheDocument()
    expect(screen.getByText('Retry cap reached; moving to approval with unresolved gaps.')).toBeInTheDocument()
    expect(screen.getByText('Follow-up budget: 10/10 used (20%) · 0 remaining')).toBeInTheDocument()
    expect(screen.getByText('Missing fallback behavior for skipped answers.')).toBeInTheDocument()
    expect(screen.getByText('Which fallback should be used?')).toBeInTheDocument()
    expect(screen.getByText('Close the final interview gap before PRD generation.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Technical Details/i })).toBeInTheDocument()
  })
})
