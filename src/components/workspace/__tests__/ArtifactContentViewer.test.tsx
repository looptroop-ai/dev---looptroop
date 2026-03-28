import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArtifactContent, InterviewAnswersView } from '../ArtifactContentViewer'

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
    ticket_id: 'PROJ-42',
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

function openFoundationGroup() {
  fireEvent.click(screen.getByText('Foundation').closest('button')!)
}

function hasExactTextContent(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text
}

describe('ArtifactContentViewer', () => {
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

    // Expand the epic section to reveal user stories
    fireEvent.click(screen.getByText('Refine the winning PRD').closest('button')!)

    expect(screen.getByText('Inspect refined stories')).toBeInTheDocument()
    expect(screen.getByText('Keep the PRD viewer structured after refinement.')).toBeInTheDocument()
  })

  it('shows friendly labels for nested PRD technical requirement diffs', () => {
    render(
      <ArtifactContent
        artifactId="refined-prd"
        phase="WAITING_PRD_APPROVAL"
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
})
