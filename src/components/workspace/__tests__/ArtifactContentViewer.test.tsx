import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TEST } from '@/test/factories'
import { ArtifactContent, CollapsibleSection, InterviewAnswersView } from '../ArtifactContentViewer'
import { buildArtifactProcessingNoticeCopy } from '../artifactProcessingNotice'

function buildCanonicalInterviewContent(questions: Array<Record<string, unknown>>) {
  return JSON.stringify({
    artifact: 'interview',
    questions,
  })
}

function buildInterviewDocumentContent({
  questions,
  summary,
}: {
  questions: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
}) {
  return JSON.stringify({
    schema_version: 1,
    ticket_id: TEST.externalId,
    artifact: 'interview',
    status: 'draft',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-25T09:00:00.000Z',
    },
    questions,
    follow_up_rounds: [],
    summary: summary ?? {
      goals: [],
      constraints: [],
      non_goals: [],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  })
}

function buildPrdDocumentContent({
  epicTitle = 'Restore rich PRD views',
  storyTitle = 'Review PRD drafts',
  acceptanceCriterion = 'Show epics and user stories in the structured view.',
  architectureConstraint = 'UI-only change',
}: {
  epicTitle?: string
  storyTitle?: string
  acceptanceCriterion?: string
  architectureConstraint?: string
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
    `    - "${architectureConstraint}"`,
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

function buildBeadsDraftContent({
  title = 'Render structured guidance safely',
  guidance = {
    patterns: ['Reuse the shared bead viewer for every artifact path.'],
    anti_patterns: ['Do not render structured guidance objects directly into JSX.'],
  },
}: {
  title?: string
  guidance?: string | {
    patterns?: string[]
    anti_patterns?: string[]
  }
} = {}) {
  return JSON.stringify([
    {
      id: 'bead-1',
      title,
      prdRefs: ['EPIC-1', 'US-1'],
      description: 'Keep bead guidance readable in artifact dialogs.',
      contextGuidance: guidance,
    },
  ])
}

function openFoundationGroup() {
  fireEvent.click(screen.getByText('Foundation').closest('button')!)
}

function hasExactTextContent(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text
}

function hasTextContent(text: string) {
  return (_content: string, element: Element | null) => element?.textContent?.includes(text) ?? false
}

function openNotice(title: string) {
  fireEvent.click(screen.getByText(title).closest('button')!)
}

describe('ArtifactContentViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls a section into view when it is expanded', () => {
    render(
      <CollapsibleSection title="Expandable">
        <div>Expanded body</div>
      </CollapsibleSection>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Expandable/i }))

    expect(screen.getByText('Expanded body')).toBeInTheDocument()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('uses the interview results header for approval-phase canonical interviews', () => {
    render(
      <ArtifactContent
        artifactId="final-interview"
        phase="WAITING_INTERVIEW_APPROVAL"
        content={JSON.stringify({
          interview: buildCanonicalInterviewContent([
            {
              id: 'Q01',
              prompt: 'Which constraints are fixed?',
              answer: { skipped: false, free_text: 'Keep imports idempotent.' },
            },
          ]),
        })}
      />,
    )

    expect(screen.getByText('Interview Results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Q&A' })).toBeInTheDocument()
  })

  it('renders interview answers without the interview summary section', () => {
    render(
      <ArtifactContent
        artifactId="interview-answers"
        phase="WAITING_INTERVIEW_APPROVAL"
        content={buildCanonicalInterviewContent([
          {
            id: 'Q01',
            prompt: 'Which constraints are fixed?',
            answer: { skipped: false, free_text: 'Keep imports idempotent.' },
          },
        ])}
      />,
    )

    expect(screen.getByText('Interview Answers')).toBeInTheDocument()
    expect(screen.queryByText('Interview Summary')).not.toBeInTheDocument()

    openFoundationGroup()
    expect(screen.getByText('Which constraints are fixed?')).toBeInTheDocument()
    expect(screen.getByText('Keep imports idempotent.')).toBeInTheDocument()
  })

  it('renders canonical free-text answers', () => {
    render(
      <InterviewAnswersView
        content={buildCanonicalInterviewContent([
          {
            id: 'Q01',
            prompt: 'What outcome matters most?',
            answer: { skipped: false, free_text: 'Keep imports idempotent.' },
          },
        ])}
      />,
    )

    openFoundationGroup()
    expect(screen.getByText('What outcome matters most?')).toBeInTheDocument()
    expect(screen.getByText('Keep imports idempotent.')).toBeInTheDocument()
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument()
  })

  it('emphasizes changed words inside execution commit diffs', () => {
    render(
      <ArtifactContent
        artifactId="bead-commits"
        content={[
          'diff --git a/src/feature.ts b/src/feature.ts',
          'index abc1234..def5678 100644',
          '--- a/src/feature.ts',
          '+++ b/src/feature.ts',
          '@@ -1,2 +1,2 @@',
          '-const status = "draft"',
          '+const status = "refined"',
          ' const untouched = true',
        ].join('\n')}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /src\/feature\.ts/i }))

    expect(Array.from(document.querySelectorAll('mark')).map((element) => element.textContent)).toEqual(
      expect.arrayContaining(['draft', 'refined']),
    )
    expect(screen.getByText(hasExactTextContent('+const status = "refined"'))).toHaveClass(
      'whitespace-pre-wrap',
      'break-all',
    )
  })

  it('hides the interview summary when the canonical interview summary is empty', () => {
    render(
      <InterviewAnswersView
        content={buildInterviewDocumentContent({
          questions: [
            {
              id: 'Q01',
              phase: 'Foundation',
              prompt: 'What outcome matters most?',
              source: 'compiled',
              answer_type: 'free_text',
              options: [],
              answer: { skipped: false, free_text: 'Keep imports idempotent.', selected_option_ids: [] },
            },
          ],
        })}
      />,
    )

    expect(screen.queryByText('Interview Summary')).not.toBeInTheDocument()

    openFoundationGroup()
    expect(screen.getByText('What outcome matters most?')).toBeInTheDocument()
  })

  it('renders single-choice selections without marking them skipped', () => {
    render(
      <InterviewAnswersView
        content={buildCanonicalInterviewContent([
          {
            id: 'Q02',
            prompt: 'Which database engine should we use?',
            answer_type: 'single_choice',
            options: [
              { id: 'pg', label: 'PostgreSQL' },
              { id: 'mysql', label: 'MySQL' },
            ],
            answer: { skipped: false, free_text: '', selected_option_ids: ['pg'] },
          },
        ])}
      />,
    )

    openFoundationGroup()
    expect(screen.getByText('Which database engine should we use?')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument()
  })

  it('renders multiple-choice selections with notes', () => {
    render(
      <InterviewAnswersView
        content={buildCanonicalInterviewContent([
          {
            id: 'Q03',
            prompt: 'Which platforms should we support?',
            answer_type: 'multiple_choice',
            options: [
              { id: 'web', label: 'Web' },
              { id: 'ios', label: 'iOS' },
              { id: 'android', label: 'Android' },
            ],
            answer: {
              skipped: false,
              free_text: 'Start with the first two only.',
              selected_option_ids: ['web', 'ios'],
            },
          },
        ])}
      />,
    )

    openFoundationGroup()
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(screen.getByText('iOS')).toBeInTheDocument()
    expect(screen.getByText('Start with the first two only.')).toBeInTheDocument()
  })

  it('renders skipped canonical answers as skipped', () => {
    render(
      <InterviewAnswersView
        content={buildCanonicalInterviewContent([
          {
            id: 'Q04',
            prompt: 'Do we need an admin panel?',
            answer: { skipped: true, free_text: '', selected_option_ids: [], answered_by: 'user', answered_at: '' },
          },
        ])}
      />,
    )

    openFoundationGroup()
    expect(screen.getByText('Do we need an admin panel?')).toBeInTheDocument()
    expect(screen.getByText(/This question was skipped/i)).toBeInTheDocument()
  })

  it('renders PRD full answers with the interview-style view and AI-answer badge', () => {
    render(
      <ArtifactContent
        artifactId="prd-fullanswers-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildInterviewDocumentContent({
                questions: [
                  {
                    id: 'Q01',
                    phase: 'Foundation',
                    prompt: 'What should happen for skipped interview answers?',
                    source: 'compiled',
                    answer_type: 'free_text',
                    options: [],
                    answer: {
                      skipped: false,
                      free_text: 'Fill them in with explicit AI-authored answers.',
                      selected_option_ids: [],
                      answered_by: 'ai_skip',
                      answered_at: '2026-03-25T09:00:00.000Z',
                    },
                  },
                ],
              }),
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
          memberOutcomes: {
            'openai/gpt-5.2': 'completed',
          },
        })}
      />,
    )

    openFoundationGroup()
    expect(screen.getByText('What should happen for skipped interview answers?')).toBeInTheDocument()
    expect(screen.getByText('Fill them in with explicit AI-authored answers.')).toBeInTheDocument()
    expect(screen.getByText(/Answered automatically by AI in Drafting specs status/i)).toBeInTheDocument()
    expect(screen.getByText('LoopTroop adjusted these Full Answers.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 3')).toBeInTheDocument()
  })

  it('explains when Full Answers were reused from the approved interview', () => {
    render(
      <ArtifactContent
        artifactId="prd-fullanswers-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildInterviewDocumentContent({
                questions: [
                  {
                    id: 'Q01',
                    phase: 'Foundation',
                    prompt: 'Do we need AI-filled follow-up answers?',
                    source: 'compiled',
                    answer_type: 'free_text',
                    options: [],
                    answer: {
                      skipped: false,
                      free_text: 'No, the approved interview was already complete.',
                      selected_option_ids: [],
                      answered_by: 'user',
                      answered_at: '2026-03-25T09:00:00.000Z',
                    },
                  },
                ],
              }),
              structuredOutput: {
                repairApplied: true,
                repairWarnings: [
                  'Canonicalized resolved interview status from "approved" to "draft".',
                  'Cleared approval fields for the AI-generated Full Answers artifact.',
                ],
              },
            },
          ],
          memberOutcomes: {
            'openai/gpt-5.2': 'completed',
          },
        })}
      />,
    )

    expect(screen.getByText('LoopTroop reused the approved interview for these answers.')).toBeInTheDocument()
    expect(screen.getByText('2 interventions recorded.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 2')).toBeInTheDocument()

    openNotice('LoopTroop reused the approved interview for these answers.')

    expect(screen.getByText(/This ticket had no skipped interview questions, so Part 1 did not need a model response/i)).toBeInTheDocument()
  })

  it('renders PRD draft member artifacts with structured epics and user stories', () => {
    render(
      <ArtifactContent
        artifactId="prd-draft-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
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
        })}
      />,
    )

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Restore rich PRD views')).toBeInTheDocument()

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Restore rich PRD views').closest('button')!)

    expect(screen.getByText('Review PRD drafts')).toBeInTheDocument()
    expect(screen.getByText('Show epics and user stories in the structured view.')).toBeInTheDocument()
  })

  it('renders refined PRD artifacts with the same structured PRD viewer', () => {
    render(
      <ArtifactContent
        artifactId="refined-prd"
        phase="WAITING_PRD_APPROVAL"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          winnerDraftContent: buildPrdDocumentContent({
            epicTitle: 'Original PRD candidate',
            storyTitle: 'Inspect original stories',
            acceptanceCriterion: 'Keep the older candidate available for coverage diffing.',
          }),
          refinedContent: buildPrdDocumentContent({
            epicTitle: 'Refine the winning PRD',
            storyTitle: 'Inspect refined stories',
            acceptanceCriterion: 'Keep the PRD viewer structured after refinement.',
          }),
        })}
      />,
    )

    expect(screen.getByText('Epics (1)')).toBeInTheDocument()
    expect(screen.getByText('Refine the winning PRD')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Diff(?: \(\d+\))?$/i })).not.toBeInTheDocument()

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Refine the winning PRD').closest('button')!)

    expect(screen.getByText('Inspect refined stories')).toBeInTheDocument()
    expect(screen.getByText('Keep the PRD viewer structured after refinement.')).toBeInTheDocument()
  })

  it('renders structured bead guidance for winner artifacts without crashing', () => {
    render(
      <ArtifactContent
        artifactId="winner-beads-draft"
        phase="COUNCIL_VOTING_BEADS"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildBeadsDraftContent({
                guidance: {
                  patterns: ['Reuse the shared bead viewer for every artifact path.'],
                  anti_patterns: ['Do not render structured guidance objects directly into JSX.'],
                },
              }),
            },
          ],
        })}
      />,
    )

    expect(screen.queryByText(/^pending$/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Render structured guidance safely').closest('button')!)

    expect(screen.getByText('Patterns')).toBeInTheDocument()
    expect(screen.getByText('Anti-patterns')).toBeInTheDocument()
    expect(screen.getByText('Reuse the shared bead viewer for every artifact path.')).toBeInTheDocument()
    expect(screen.getByText('Do not render structured guidance objects directly into JSX.')).toBeInTheDocument()
    expect(screen.queryByText(/^pending$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong rendering this content/i)).not.toBeInTheDocument()
  })

  it('renders Voting on Architecture results with shared vote rankings, presentation order, and processing notices', () => {
    render(
      <ArtifactContent
        artifactId="beads-votes"
        phase="COUNCIL_VOTING_BEADS"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          drafts: [
            {
              memberId: 'openai/gpt-5.1-codex',
              outcome: 'completed',
              content: buildBeadsDraftContent({
                title: 'Validate architecture votes',
              }),
            },
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildBeadsDraftContent({
                title: 'Surface vote ordering',
              }),
            },
          ],
          votes: [
            {
              voterId: 'openai/gpt-5.1-codex',
              draftId: 'openai/gpt-5.2',
              totalScore: 92,
              scores: [
                { category: 'Coverage of requirements', score: 19, justification: 'Strong coverage' },
                { category: 'Correctness / feasibility', score: 18, justification: 'Feasible' },
                { category: 'Testability', score: 19, justification: 'Testable' },
                { category: 'Minimal complexity / good decomposition', score: 18, justification: 'Well scoped' },
                { category: 'Risks / edge cases addressed', score: 18, justification: 'Good risk handling' },
              ],
            },
            {
              voterId: 'openai/gpt-5.2',
              draftId: 'openai/gpt-5.2',
              totalScore: 94,
              scores: [
                { category: 'Coverage of requirements', score: 19, justification: 'Strong coverage' },
                { category: 'Correctness / feasibility', score: 19, justification: 'Feasible' },
                { category: 'Testability', score: 19, justification: 'Testable' },
                { category: 'Minimal complexity / good decomposition', score: 18, justification: 'Well scoped' },
                { category: 'Risks / edge cases addressed', score: 19, justification: 'Good risk handling' },
              ],
            },
          ],
          voterOutcomes: {
            'openai/gpt-5.1-codex': 'completed',
            'openai/gpt-5.2': 'completed',
          },
          voterDetails: [
            {
              voterId: 'openai/gpt-5.1-codex',
              structuredOutput: {
                repairApplied: true,
                repairWarnings: ['Normalized vote scorecard indentation under the wrapper key.'],
              },
            },
            {
              voterId: 'openai/gpt-5.2',
              structuredOutput: {
                repairApplied: false,
                repairWarnings: [],
                autoRetryCount: 1,
                validationError: 'Malformed scorecard',
              },
            },
          ],
          presentationOrders: {
            'openai/gpt-5.1-codex': {
              seed: 'seed-alpha-1234',
              order: ['openai/gpt-5.1-codex', 'openai/gpt-5.2'],
            },
            'openai/gpt-5.2': {
              seed: 'seed-beta-5678',
              order: ['openai/gpt-5.2', 'openai/gpt-5.1-codex'],
            },
          },
          totalScore: 186,
          isFinal: true,
        })}
      />,
    )

    expect(screen.getByText('Voter Status')).toBeInTheDocument()
    expect(screen.getByText('Rankings')).toBeInTheDocument()
    expect(screen.getByText('Score Breakdown')).toBeInTheDocument()
    expect(screen.getByText('LoopTroop adjusted some vote scorecards.')).toBeInTheDocument()
    expect(screen.getByText('2 interventions across 2 categories.')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Voter Details/i).closest('button')!)
    expect(screen.getAllByText('Presentation Order')).toHaveLength(2)
    expect(screen.getByText(/seed seed-alp/i)).toBeInTheDocument()
    expect(screen.getByText(/seed seed-bet/i)).toBeInTheDocument()
    expect(screen.getByText(hasExactTextContent('Draft 1: gpt-5.1-codex'))).toBeInTheDocument()
    expect(screen.getByText(hasExactTextContent('Draft 2: gpt-5.2'))).toBeInTheDocument()
    expect(screen.getAllByText('LoopTroop adjusted this vote scorecard.')).toHaveLength(2)
  })

  it('keeps legacy string bead guidance working for final bead drafts', () => {
    render(
      <ArtifactContent
        artifactId="final-beads-draft"
        phase="WAITING_BEADS_APPROVAL"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          refinedContent: buildBeadsDraftContent({
            title: 'Keep legacy guidance readable',
            guidance: 'Preserve the old single-block guidance rendering for legacy bead artifacts.',
          }),
        })}
      />,
    )

    fireEvent.click(screen.getByText('Keep legacy guidance readable').closest('button')!)

    expect(screen.getByText('Preserve the old single-block guidance rendering for legacy bead artifacts.')).toBeInTheDocument()
    expect(screen.queryByText('Patterns')).not.toBeInTheDocument()
    expect(screen.queryByText('Anti-patterns')).not.toBeInTheDocument()
  })

  it('uses the same safe bead guidance renderer in coverage review sections', () => {
    render(
      <ArtifactContent
        artifactId="refined-beads"
        phase="WAITING_BEADS_APPROVAL"
        content={JSON.stringify({
          beads: buildBeadsDraftContent({
            title: 'Review prior bead guidance',
            guidance: {
              patterns: ['Carry forward the prior patterns list in review mode.'],
              anti_patterns: ['Do not lose structured guidance in the prior-context section.'],
            },
          }),
          refinedContent: buildBeadsDraftContent({
            title: 'Review refined bead guidance',
            guidance: {
              patterns: ['Render refined guidance with explicit list headings.'],
              anti_patterns: ['Do not special-case the review view with a different renderer.'],
            },
          }),
        })}
      />
    )

    // Merged into a single "Beads" section showing refinedContent (diff tab shows differences)
    expect(screen.getByText('Beads')).toBeInTheDocument()
    expect(screen.queryByText('Prior Context (Beads)')).not.toBeInTheDocument()
    expect(screen.queryByText('Under Verification (Beads)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Review refined bead guidance').closest('button')!)

    expect(screen.getByText('Render refined guidance with explicit list headings.')).toBeInTheDocument()
    expect(screen.getByText('Do not special-case the review view with a different renderer.')).toBeInTheDocument()
  })

  it('hides persisted no-op beads ui diff entries in rendered bead diffs', () => {
    const beadsContent = buildBeadsDraftContent({
      title: 'Keep the switcher bead unchanged',
    })

    render(
      <ArtifactContent
        artifactId="final-beads-draft"
        phase="REFINING_BEADS"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          winnerDraftContent: beadsContent,
          refinedContent: beadsContent,
          uiRefinementDiff: {
            domain: 'beads',
            winnerId: 'openai/gpt-5.2',
            generatedAt: '2026-04-06T11:38:37.016Z',
            entries: [
              {
                key: 'bead:bead-1',
                changeType: 'modified',
                itemKind: 'bead',
                label: 'Keep the switcher bead unchanged',
                beforeId: 'bead-1',
                afterId: 'bead-1',
                beforeText: 'Title: Keep the switcher bead unchanged',
                afterText: '  Title: Keep the switcher bead unchanged  ',
                attributionStatus: 'synthesized_unattributed',
              },
            ],
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    expect(screen.getByText('No refinement changes recorded.')).toBeInTheDocument()
  })

  it('hides persisted no-op PRD ui diff entries in rendered PRD diffs', () => {
    const prdContent = buildPrdDocumentContent({
      storyTitle: 'Keep the switcher bead unchanged',
    })

    render(
      <ArtifactContent
        artifactId="final-prd-draft"
        phase="REFINING_PRD"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          winnerDraftContent: prdContent,
          refinedContent: prdContent,
          uiRefinementDiff: {
            domain: 'prd',
            winnerId: 'openai/gpt-5.2',
            generatedAt: '2026-04-06T11:38:37.016Z',
            entries: [
              {
                key: 'user_story:US-1',
                changeType: 'modified',
                itemKind: 'user_story',
                label: 'Keep the switcher bead unchanged',
                beforeId: 'US-1',
                afterId: 'US-1',
                beforeText: 'Title: Keep the switcher bead unchanged',
                afterText: 'Title: Keep the switcher bead unchanged',
                attributionStatus: 'model_unattributed',
              },
            ],
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    expect(screen.getByText('No refinement changes recorded.')).toBeInTheDocument()
  })

  it('renders coverage report with changes tab when only revision content is provided', () => {
    const revisionContent = JSON.stringify({
      winnerId: 'openai/gpt-5.2',
      candidateVersion: 2,
      winnerDraftContent: buildPrdDocumentContent({
        epicTitle: 'Audit input candidate',
        storyTitle: 'Inspect the audit input',
        acceptanceCriterion: 'Keep the original audit candidate visible.',
      }),
      refinedContent: buildPrdDocumentContent({
        epicTitle: 'Coverage revised candidate',
        storyTitle: 'Inspect the revised candidate',
        acceptanceCriterion: 'Show the coverage revised candidate by default.',
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
    })
    render(
      <ArtifactContent
        artifactId="coverage-report"
        phase="WAITING_PRD_APPROVAL"
        content={JSON.stringify({
          coverageReviewContent: null,
          revisionContent,
        })}
      />,
    )

    // With no audit content, the Changes tab is selected by default
    expect(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i })).toBeInTheDocument()
    expect(screen.getAllByText(hasTextContent('Audit input candidate')).length).toBeGreaterThan(0)
    expect(screen.getByText('Coverage revised candidate')).toBeInTheDocument()
  })

  it('renders coverage report with resolution notes tab', () => {
    const revisionContent = JSON.stringify({
      winnerId: 'openai/gpt-5.2',
      candidateVersion: 2,
      refinedContent: buildPrdDocumentContent({
        epicTitle: 'Coverage revised candidate',
        storyTitle: 'Inspect the revised candidate',
      }),
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
    })
    render(
      <ArtifactContent
        artifactId="coverage-report"
        phase="WAITING_PRD_APPROVAL"
        content={JSON.stringify({
          coverageReviewContent: null,
          revisionContent,
        })}
      />,
    )

    // With no audit content, Resolution Notes tab is selected by default (no changes tab either)
    expect(screen.getByText('Missing retry-cap approval behavior.')).toBeInTheDocument()
    expect(screen.getByText(/Added explicit approval handling when unresolved gaps remain after the retry cap/i)).toBeInTheDocument()
    expect(screen.getByText('Epic EPIC-1: Coverage revised candidate')).toBeInTheDocument()
  })

  it('uses simpler PRD coverage resolution note copy during verification', () => {
    const revisionContent = JSON.stringify({
      winnerId: 'openai/gpt-5.2',
      candidateVersion: 2,
      refinedContent: buildPrdDocumentContent({
        epicTitle: 'Coverage revised candidate',
        storyTitle: 'Inspect the revised candidate',
      }),
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
    })

    render(
      <ArtifactContent
        artifactId="coverage-report"
        phase="VERIFYING_PRD_COVERAGE"
        content={JSON.stringify({
          coverageReviewContent: null,
          revisionContent,
        })}
      />,
    )

    expect(
      screen.getByText('Latest notes about how coverage gaps were handled for PRD Candidate v2.'),
    ).toBeInTheDocument()
  })

  it('hides PRD coverage follow-up questions while preserving gap and termination summaries', () => {
    render(
      <ArtifactContent
        artifactId="prd-coverage-result"
        phase="VERIFYING_PRD_COVERAGE"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          response: [
            'status: gaps',
            'gaps:',
            '  - "Missing PRD approval sequencing."',
            'follow_up_questions:',
            '  - id: FU01',
            '    question: "Which approval step should trigger Beads?"',
            '    phase: PRD',
          ].join('\n'),
          hasGaps: true,
          coverageRunNumber: 2,
          maxCoveragePasses: 2,
          limitReached: true,
          terminationReason: 'coverage_pass_limit_reached',
          parsed: {
            status: 'gaps',
            gaps: ['Missing PRD approval sequencing.'],
            followUpQuestions: [
              {
                id: 'FU01',
                question: 'Which approval step should trigger Beads?',
                phase: 'PRD',
                priority: 'high',
                rationale: 'PRD coverage should stay diagnostic-only.',
              },
            ],
          },
        })}
      />,
    )

    expect(screen.getByText('Coverage review found gaps')).toBeInTheDocument()
    expect(screen.getByText('This check found 1 gap between the current PRD candidate and the approved interview.')).toBeInTheDocument()
    expect(screen.getByText('Retry cap reached; moving to approval with unresolved gaps.')).toBeInTheDocument()
    expect(screen.getByText('Missing PRD approval sequencing.')).toBeInTheDocument()
    expect(screen.queryByText('Follow-up Questions')).not.toBeInTheDocument()
    expect(screen.queryByText('Which approval step should trigger Beads?')).not.toBeInTheDocument()
  })

  it('shows a friendly clean summary for PRD coverage results', () => {
    render(
      <ArtifactContent
        artifactId="prd-coverage-result"
        phase="VERIFYING_PRD_COVERAGE"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.4',
          response: 'status: clean\ngaps: []\nfollow_up_questions: []',
          hasGaps: false,
          coverageRunNumber: 1,
          maxCoveragePasses: 2,
          limitReached: false,
          terminationReason: 'clean',
          parsed: {
            status: 'clean',
            gaps: [],
            followUpQuestions: [],
          },
        })}
      />,
    )

    expect(screen.getByText('No coverage gaps found')).toBeInTheDocument()
    expect(screen.getByText('The current PRD candidate covers the approved interview. No gaps were found in this check.')).toBeInTheDocument()
    expect(screen.getByText(/Coverage review of the current PRD candidate · pass 1 of 2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Technical Details/i })).toBeInTheDocument()
  })

  it('shows friendly labels for nested PRD technical requirement diffs', () => {
    render(
      <ArtifactContent
        artifactId="refined-prd"
        phase="REFINING_PRD"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          winnerDraftContent: buildPrdDocumentContent({
            architectureConstraint: 'Keep the old pipeline intact.',
          }),
          refinedContent: buildPrdDocumentContent({
            architectureConstraint: 'Keep the diff UI aligned with the final PRD labels.',
          }),
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Diff(?: \(\d+\))?$/i }))

    expect(screen.getByText('Technical Requirements')).toBeInTheDocument()
    expect(screen.getByText('Architecture Constraints')).toBeInTheDocument()
    expect(screen.queryByText('technical_requirements.architecture_constraints')).not.toBeInTheDocument()
    expect(screen.getByText(hasExactTextContent('- Keep the old pipeline intact.'))).toBeInTheDocument()
    expect(screen.getByText(hasExactTextContent('- Keep the diff UI aligned with the final PRD labels.'))).toBeInTheDocument()
  })

  it('falls back to raw content for unparseable PRD drafts', () => {
    render(
      <ArtifactContent
        artifactId="prd-draft-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: 'plain draft text without PRD structure',
            },
          ],
          memberOutcomes: {
            'openai/gpt-5.2': 'completed',
          },
        })}
      />,
    )

    expect(screen.getByText('plain draft text without PRD structure')).toBeInTheDocument()
    expect(screen.queryByText(/Epics \(/)).not.toBeInTheDocument()
  })

  it('renders PRD vote details with voter progress, rankings, and presentation order', () => {
    render(
      <ArtifactContent
        artifactId="prd-votes"
        phase="COUNCIL_VOTING_PRD"
        content={JSON.stringify({
          drafts: [
            { memberId: 'vendor/draft-a', outcome: 'completed', content: 'draft-a' },
            { memberId: 'vendor/draft-b', outcome: 'completed', content: 'draft-b' },
          ],
          votes: [
            {
              voterId: 'vendor/voter-a',
              draftId: 'vendor/draft-a',
              totalScore: 91,
              scores: [
                { category: 'Coverage of requirements', score: 18, justification: 'Strong coverage' },
                { category: 'Correctness / feasibility', score: 19, justification: 'Feasible' },
                { category: 'Testability', score: 18, justification: 'Testable' },
                { category: 'Minimal complexity / good decomposition', score: 18, justification: 'Well scoped' },
                { category: 'Risks / edge cases addressed', score: 18, justification: 'Good risk handling' },
              ],
            },
          ],
          voterOutcomes: {
            'vendor/voter-a': 'completed',
            'vendor/voter-b': 'pending',
          },
          presentationOrders: {
            'vendor/voter-a': {
              seed: 'seed-alpha-1234',
              order: ['vendor/draft-b', 'vendor/draft-a'],
            },
          },
          winnerId: 'vendor/draft-a',
          totalScore: 91,
          isFinal: true,
        })}
      />,
    )

    expect(screen.getByText('Voter Status')).toBeInTheDocument()
    expect(screen.getAllByText('draft-a').length).toBeGreaterThan(0)
    expect(screen.getByText('Rankings')).toBeInTheDocument()
    expect(screen.getByText('Score Breakdown')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Voter Details/i).closest('button')!)
    expect(screen.getByText('Presentation Order')).toBeInTheDocument()
    expect(screen.getByText(/seed seed-alp/i)).toBeInTheDocument()
    expect(screen.getByText('Draft 1: draft-b')).toBeInTheDocument()
    expect(screen.getByText('Draft 2: draft-a')).toBeInTheDocument()
  })

  it('classifies no-op diff cleanup in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [
        'Dropped no-op interview refinement modified at index 0 because the question is unchanged across the winning and final drafts.',
      ],
      autoRetryCount: 0,
    }, 'diff')

    expect(copy).toMatchObject({
      title: 'LoopTroop adjusted this diff.',
      summary: '1 intervention recorded.',
    })
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'dropped', code: 'dropped_no_op_change' }),
    ])
  })

  it('classifies normalization repairs in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Inferred missing PRD refinement item_type at index 0 as epic.'],
      autoRetryCount: 0,
    }, 'diff')

    expect(copy?.title).toBe('LoopTroop adjusted this diff.')
    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'synthesized', code: 'synthesized_inferred_detail' }),
    ])
  })

  it('classifies formatting cleanup in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Removed surrounding markdown code fence before parsing the final test commands.'],
      autoRetryCount: 0,
    }, 'final-test')

    expect(copy?.title).toBe('LoopTroop adjusted this final test plan.')
    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'parser_fix', code: 'parser_markdown_fence' }),
    ])
  })

  it('derives exact correction details for canonicalized metadata warnings', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }, 'full-answers')

    expect(copy?.interventions).toEqual([
      expect.objectContaining({
        code: 'cleanup_winner_model',
        exactCorrection: 'Changed generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
        rule: {
          id: 'cleanup_winner_model',
          label: 'Winner Model',
        },
        examples: [
          {
            scope: 'generated_by.winner_model',
            before: 'openai/gpt-5.4',
            after: 'github-copilot/gpt-4.1',
          },
        ],
      }),
    ])
  })

  it('classifies synthesized change repairs in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Synthesized missing PRD refinement change at index 0 from the validated records.'],
      autoRetryCount: 0,
    }, 'diff')

    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'synthesized', code: 'synthesized_missing_detail' }),
    ])
  })

  it('describes retry-only parser interventions in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: false,
      repairWarnings: [],
      autoRetryCount: 1,
      validationError: 'Coverage parser rejected the first pass.',
    }, 'coverage')

    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.body).toMatch(/validated this coverage review/i)
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'retry', code: 'retry_after_validation_failure' }),
    ])
  })

  it('keeps reserved-scalar parser fixes separate from retry interventions in parser notices', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Quoted plain YAML scalars that began with reserved indicator characters (` or @) before reparsing.'],
      autoRetryCount: 1,
      validationError: 'PRD parser rejected the first pass.',
    }, 'prd-draft')

    expect(copy?.summary).toBe('2 interventions across 2 categories.')
    expect(copy?.badges).toEqual([
      expect.objectContaining({ label: 'Parser Fix', count: 1 }),
      expect.objectContaining({ label: 'Retried', count: 1 }),
    ])
    expect(copy?.interventions).toEqual([
      expect.objectContaining({
        category: 'parser_fix',
        code: 'parser_reserved_indicator_scalar',
        exactCorrection: 'Quoted the plain YAML scalar that began with a reserved indicator character before reparsing the payload.',
      }),
      expect.objectContaining({ category: 'retry', code: 'retry_after_validation_failure' }),
    ])
  })

  it('shows retry diagnostics with the failing excerpt in the expanded warning notice', () => {
    render(
      <ArtifactContent
        artifactId="relevant-files-scan"
        content={JSON.stringify({
          fileCount: 1,
          files: [
            {
              path: 'src/app.ts',
              rationale: 'Entry point',
              relevance: 'high',
              likely_action: 'modify',
              contentPreview: 'export const app = true',
              contentLength: 24,
            },
          ],
          structuredOutput: {
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 1,
            validationError: 'Relevant files output was empty.',
            retryDiagnostics: [
              {
                attempt: 1,
                validationError: 'Relevant files output was empty.',
                target: 'files',
                line: 4,
                column: 3,
                excerpt: '  4 | files:\n  5 |   - path: src/app.ts',
              },
            ],
          },
        })}
      />,
    )

    const noticeButton = screen.getByText('LoopTroop adjusted this relevant files scan.').closest('button')
    expect(noticeButton).toBeInTheDocument()
    expect(screen.queryByText(/Retry Attempts/i)).not.toBeInTheDocument()

    fireEvent.click(noticeButton!)

    expect(screen.getByText(/Retry Attempts/i)).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getAllByText('Relevant files output was empty.').length).toBeGreaterThan(0)
    expect(screen.getByText(/files · line 4, column 3/i)).toBeInTheDocument()
    expect(screen.getByText(/4 \| files:/i)).toBeInTheDocument()
  })

  it('falls back to generic parser wording for unknown warnings', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Validator repair step completed.'],
      autoRetryCount: 0,
    }, 'artifact')

    expect(copy?.title).toBe('LoopTroop adjusted this artifact.')
    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'cleanup', code: 'cleanup_generic' }),
    ])
  })

  it('uses output-specific wording for Full Answers metadata cleanup', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized resolved interview status from "approved" to "draft".',
        'Cleared approval fields for the AI-generated Full Answers artifact.',
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }, 'full-answers')

    expect(copy?.title).toBe('LoopTroop adjusted these Full Answers.')
    expect(copy?.summary).toBe('3 interventions recorded.')
    expect(copy?.badges).toEqual([
      expect.objectContaining({ label: 'Cleanup', count: 3 }),
    ])
  })

  it('shows specific cleanup copy for selected option id repairs in Full Answers notices', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [
        'Mapped selected option ids to canonical option ids for AI-filled question Q01.',
      ],
      autoRetryCount: 0,
    }, 'full-answers')

    expect(copy?.title).toBe('LoopTroop adjusted these Full Answers.')
    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({
        category: 'cleanup',
        code: 'cleanup_mapped_free_text',
        exactCorrection: 'Mapped the answer content to canonical option IDs for question Q01.',
      }),
    ])
  })

  it('uses reused-approved-interview wording for synthetic Full Answers artifacts', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized resolved interview status from "approved" to "draft".',
        'Cleared approval fields for the AI-generated Full Answers artifact.',
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }, 'full-answers', { fullAnswersOrigin: 'reused-approved-interview' })

    expect(copy?.title).toBe('LoopTroop reused the approved interview for these answers.')
    expect(copy?.summary).toBe('3 interventions recorded.')
    expect(copy?.body).toMatch(/copied the approved interview/i)
  })

  it('suppresses parser notices when a bare repair flag has no details', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: [],
      autoRetryCount: 0,
    }, 'relevant-files')

    expect(copy).toBeNull()
  })

  it('deduplicates identical explicit interventions in parser notices', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Recovered the structured artifact from surrounding transcript or wrapper text before validation.'],
      autoRetryCount: 0,
      interventions: [
        {
          code: 'parser_transcript_recovery',
          stage: 'parse',
          category: 'parser_fix',
          title: 'Extracted payload from surrounding prose or transcript',
          summary: 'The structured payload was embedded inside conversational text, preamble, or transcript output.',
          why: 'The model included explanatory prose or transcript text alongside the structured data instead of returning only the raw YAML/JSON payload.',
          how: 'LoopTroop isolated the structured data block from the surrounding text, discarded the prose, and reparsed the extracted payload.',
          technicalDetail: 'Recovered the structured artifact from surrounding transcript or wrapper text before validation.',
        },
        {
          code: 'parser_transcript_recovery',
          stage: 'parse',
          category: 'parser_fix',
          title: 'Extracted payload from surrounding prose or transcript',
          summary: 'The structured payload was embedded inside conversational text, preamble, or transcript output.',
          why: 'The model included explanatory prose or transcript text alongside the structured data instead of returning only the raw YAML/JSON payload.',
          how: 'LoopTroop isolated the structured data block from the surrounding text, discarded the prose, and reparsed the extracted payload.',
          technicalDetail: 'Recovered the structured artifact from surrounding transcript or wrapper text before validation.',
        },
      ],
    }, 'relevant-files')

    expect(copy?.summary).toBe('1 intervention recorded.')
    expect(copy?.badges).toEqual([
      expect.objectContaining({ label: 'Parser Fix', count: 1 }),
    ])
    expect(copy?.interventions).toHaveLength(1)
  })

  it('shows a collapsed parser notice for council draft artifacts', () => {
    render(
      <ArtifactContent
        artifactId="prd-draft-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildPrdDocumentContent(),
              structuredOutput: {
                repairApplied: true,
                repairWarnings: ['Inferred missing PRD refinement item_type at index 0 as epic.'],
              },
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this PRD draft.')).toBeInTheDocument()
    expect(screen.getByText('Synthesized 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this PRD draft and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this PRD draft.')

    expect(screen.getByText(/LoopTroop validated this PRD draft and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getByText(/Exact correction:/i)).toBeInTheDocument()
    expect(screen.getByText(/Rule:/i)).toBeInTheDocument()
    expect(screen.getByText(/Before:/i)).toBeInTheDocument()
    expect(screen.getByText(/\[missing\]/i)).toBeInTheDocument()
    expect(screen.getByText(/After:/i)).toBeInTheDocument()
    expect(screen.getByText(/^epic$/i)).toBeInTheDocument()
    expect(screen.getByText(/What:/i)).toBeInTheDocument()
    expect(screen.getByText(/Inferred missing PRD refinement item_type at index 0 as epic/i)).toBeInTheDocument()
  })

  it('renders exact correction, rule, and before/after blocks for explicit interventions', () => {
    render(
      <ArtifactContent
        artifactId="prd-draft-member-openai%2Fgpt-5.2"
        phase="DRAFTING_PRD"
        content={JSON.stringify({
          drafts: [
            {
              memberId: 'openai/gpt-5.2',
              outcome: 'completed',
              content: buildPrdDocumentContent(),
              structuredOutput: {
                repairApplied: true,
                interventions: [
                  {
                    code: 'cleanup_ticket_id',
                    stage: 'normalize',
                    category: 'cleanup',
                    title: 'Corrected the ticket_id field',
                    summary: 'The ticket_id did not match the current ticket.',
                    why: 'The model produced a ticket_id that does not match the current ticket.',
                    how: 'LoopTroop replaced ticket_id with the runtime value.',
                    exactCorrection: 'Changed ticket_id from "PROJ-OLD" to "PROJ-123".',
                    rule: { id: 'cleanup_ticket_id', label: 'Ticket ID' },
                    examples: [
                      {
                        scope: 'ticket_id',
                        before: 'PROJ-OLD',
                        after: 'PROJ-123',
                      },
                    ],
                    technicalDetail: 'Canonicalized ticket_id from "PROJ-OLD" to "PROJ-123".',
                  },
                ],
              },
            },
          ],
        })}
      />,
    )

    openNotice('LoopTroop adjusted this PRD draft.')

    expect(screen.getByText('Exact correction:')).toBeInTheDocument()
    expect(screen.getByText('Changed ticket_id from "PROJ-OLD" to "PROJ-123".')).toBeInTheDocument()
    expect(screen.getByText('Rule:')).toBeInTheDocument()
    expect(screen.getByText('Ticket ID')).toBeInTheDocument()
    expect(screen.getByText('cleanup_ticket_id')).toBeInTheDocument()
    expect(screen.getByText('Before:')).toBeInTheDocument()
    expect(screen.getByText('PROJ-OLD')).toBeInTheDocument()
    expect(screen.getByText('After:')).toBeInTheDocument()
    expect(screen.getByText('PROJ-123')).toBeInTheDocument()
  })

  it('shows a collapsed parser notice for coverage review artifacts', () => {
    render(
      <ArtifactContent
        artifactId="prd-coverage-result"
        phase="VERIFYING_PRD_COVERAGE"
        content={JSON.stringify({
          winnerId: 'openai/gpt-5.2',
          response: 'status: gaps\ngaps:\n  - "Missing approval sequencing."',
          hasGaps: true,
          coverageRunNumber: 1,
          maxCoveragePasses: 2,
          parsed: {
            status: 'gaps',
            gaps: ['Missing approval sequencing.'],
            followUpQuestions: [],
          },
          structuredOutput: {
            repairApplied: true,
            repairWarnings: ['Trimmed empty PRD coverage gap strings before persisting the normalized result.'],
          },
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this coverage review.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this coverage review and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this coverage review.')

    expect(screen.getByText(/LoopTroop validated this coverage review and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getByText(/Trimmed empty PRD coverage gap strings before persisting the normalized result/i)).toBeInTheDocument()
  })

  it('shows a collapsed parser notice for relevant files scans', () => {
    render(
      <ArtifactContent
        artifactId="relevant-files-scan"
        phase="PREPARING_CONTEXT"
        content={JSON.stringify({
          fileCount: 1,
          files: [
            {
              path: 'src/app.ts',
              rationale: 'Main app entry point.',
              relevance: 'high',
              likely_action: 'modify',
              contentPreview: 'export function app() {}',
              contentLength: 25,
            },
          ],
          structuredOutput: {
            repairApplied: true,
            repairWarnings: ['Removed surrounding markdown code fence before parsing the relevant files result.'],
          },
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this relevant files scan.')).toBeInTheDocument()
    expect(screen.getByText('Parser Fix 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this relevant files scan and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this relevant files scan.')

    expect(screen.getByText(/LoopTroop validated this relevant files scan and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getByText(/Removed surrounding markdown code fence before parsing the relevant files result/i)).toBeInTheDocument()
  })

  it('hides the relevant-files parser notice when there are no warnings or retries to explain', () => {
    render(
      <ArtifactContent
        artifactId="relevant-files-scan"
        phase="PREPARING_CONTEXT"
        content={JSON.stringify({
          fileCount: 1,
          files: [
            {
              path: 'src/app.ts',
              rationale: 'Main app entry point.',
              relevance: 'high',
              likely_action: 'modify',
              contentPreview: 'export function app() {}',
              contentLength: 25,
            },
          ],
          structuredOutput: {
            repairApplied: true,
            repairWarnings: [],
            autoRetryCount: 0,
          },
        })}
      />,
    )

    expect(screen.queryByText('LoopTroop adjusted this relevant files scan.')).not.toBeInTheDocument()
  })

  it('shows aggregate and per-voter parser notices for voting results', () => {
    render(
      <ArtifactContent
        artifactId="prd-votes"
        phase="COUNCIL_VOTING_PRD"
        content={JSON.stringify({
          drafts: [
            { memberId: 'vendor/draft-a', outcome: 'completed', content: 'draft-a' },
            { memberId: 'vendor/draft-b', outcome: 'completed', content: 'draft-b' },
          ],
          votes: [
            {
              voterId: 'vendor/voter-a',
              draftId: 'vendor/draft-a',
              totalScore: 91,
              scores: [{ category: 'Coverage of requirements', score: 18, justification: 'Strong coverage' }],
            },
          ],
          voterOutcomes: {
            'vendor/voter-a': 'completed',
            'vendor/voter-b': 'invalid_output',
          },
          voterDetails: [
            {
              voterId: 'vendor/voter-a',
              structuredOutput: {
                repairApplied: true,
                repairWarnings: ['Normalized vote scorecard ordering before persistence.'],
              },
            },
            {
              voterId: 'vendor/voter-b',
              structuredOutput: {
                repairApplied: false,
                repairWarnings: [],
                autoRetryCount: 1,
                validationError: 'Malformed scorecard',
                retryDiagnostics: [
                  {
                    attempt: 1,
                    validationError: 'Malformed scorecard',
                    target: 'Draft 2',
                    excerpt: 'Draft 2: score: pending',
                  },
                ],
              },
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted some vote scorecards.')).toBeInTheDocument()
    expect(screen.getByText('2 interventions across 2 categories.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
    expect(screen.getByText('Retried 1')).toBeInTheDocument()

    openNotice('LoopTroop adjusted some vote scorecards.')
    expect(screen.queryByText(/Retry Attempts/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Draft 2: score: pending')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Voter Details/i).closest('button')!)
    expect(screen.getAllByText('LoopTroop adjusted this vote scorecard.')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('LoopTroop adjusted this vote scorecard.')[1]!.closest('button')!)
    expect(screen.getByText(/Retry Attempts/i)).toBeInTheDocument()
    expect(screen.getByText('Draft 2: score: pending')).toBeInTheDocument()
  })

  it('shows a collapsed parser notice for final test results', () => {
    render(
      <ArtifactContent
        artifactId="test-results"
        phase="RUNNING_FINAL_TEST"
        content={JSON.stringify({
          status: 'failed',
          passed: false,
          checkedAt: '2026-03-30T12:00:00.000Z',
          plannedBy: 'openai/gpt-5.2',
          attempt: 2,
          maxIterations: 3,
          modelOutput: '<FINAL_TEST_COMMANDS>commands: []</FINAL_TEST_COMMANDS>',
          commands: [],
          errors: ['No final test commands were executed'],
          retryNotes: ['Retry note: keep the contrast assertion limited to destructive tokens.'],
          attemptHistory: [
            {
              attempt: 1,
              status: 'failed',
              checkedAt: '2026-03-30T11:58:00.000Z',
              commands: ['npm run test:client -- src/theme/__tests__/pinkTheme.test.ts'],
              testFiles: ['src/theme/__tests__/pinkTheme.test.ts'],
              errors: ['Command failed (1): npm run test:client -- src/theme/__tests__/pinkTheme.test.ts'],
              noteAppended: 'Retry note: keep the contrast assertion limited to destructive tokens.',
            },
          ],
          planStructuredOutput: {
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 1,
            validationError: 'Missing final test marker on first pass.',
          },
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this final test plan.')).toBeInTheDocument()
    expect(screen.getByText('Retried 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this final test plan and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this final test plan.')

    expect(screen.getByText(/LoopTroop validated this final test plan and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getByText(/Missing final test marker on first pass/i)).toBeInTheDocument()
    expect(screen.getByText('Retried after validation failed and recorded the resulting artifact state.')).toBeInTheDocument()
    expect(screen.getByText('LoopTroop issued a structured retry attempt after the earlier validation failure and recorded the resulting artifact state.')).toBeInTheDocument()
    expect(screen.queryByText(/successful validated result/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/successful pass/i)).not.toBeInTheDocument()
  })
})
