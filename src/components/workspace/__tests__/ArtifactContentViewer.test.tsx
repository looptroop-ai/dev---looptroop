import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { encode } from 'gpt-tokenizer'
import { deriveStructuredInterventions } from '@shared/structuredInterventions'
import { ArtifactContent, CollapsibleSection, InterviewAnswersView } from '../ArtifactContentViewer'
import { buildArtifactProcessingNoticeCopy } from '../artifactProcessingNotice'
import type { ArtifactStructuredOutputData } from '../phaseArtifactTypes'
import { LogContext } from '@/context/logContextDef'
import type { LogContextValue, LogEntry } from '@/context/logUtils'
import { TEST } from '@/test/factories'
import {
  buildBeadsDraftContent,
  buildCanonicalInterviewContent,
  buildExecutionSetupPlanContent,
  buildExecutionSetupPlanReportContent,
  buildExecutionSetupProfileContent,
  buildExecutionSetupRuntimeReportContent,
  buildInterviewDocumentContent,
  buildPrdDocumentContent,
} from '@/test/workspaceArtifactBuilders'

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

function futureStructuredOutput(output: ArtifactStructuredOutputData): ArtifactStructuredOutputData {
  const repairWarnings = output.repairWarnings ?? []
  const autoRetryCount = output.autoRetryCount ?? 0
  const validationError = output.validationError
  const interventions = output.interventions ?? deriveStructuredInterventions({
    repairWarnings,
    autoRetryCount,
    validationError,
  })

  return {
    ...output,
    repairApplied: output.repairApplied ?? (repairWarnings.length > 0 || autoRetryCount > 0 || Boolean(validationError)),
    repairWarnings,
    autoRetryCount,
    interventions,
  }
}

function makeLogEntry(line: string, options: Partial<LogEntry> = {}): LogEntry {
  return {
    id: options.id ?? line,
    entryId: options.entryId ?? options.id ?? line,
    line,
    source: options.source ?? 'system',
    status: options.status ?? 'DRAFTING_PRD',
    audience: options.audience ?? 'all',
    kind: options.kind ?? 'milestone',
    streaming: options.streaming ?? false,
    op: options.op ?? 'append',
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
    ...(options.modelId ? { modelId: options.modelId } : {}),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  }
}

function renderWithLogContext(ui: ReactElement, logsByPhase: Record<string, LogEntry[]>) {
  const value: LogContextValue = {
    logsByPhase,
    activePhase: null,
    isLoadingLogs: false,
    addLog: vi.fn(),
    addLogRecord: vi.fn(),
    getLogsForPhase: (phase) => logsByPhase[phase] ?? [],
    getAllLogs: () => Object.values(logsByPhase).flat(),
    setActivePhase: vi.fn(),
    clearLogs: vi.fn(),
  }
  return render(<LogContext.Provider value={value}>{ui}</LogContext.Provider>)
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

  it('merges execution setup plan diagnostics into the setup plan artifact view', () => {
    render(
      <ArtifactContent
        artifactId="execution-setup-plan"
        content={buildExecutionSetupPlanContent()}
        reportContent={buildExecutionSetupPlanReportContent()}
      />,
    )

    expect(screen.getByText('Prepare workspace runtime assets safely.')).toBeInTheDocument()
    expect(screen.getByText('Observed Evidence')).toBeInTheDocument()
    expect(screen.getByText('Workspace bootstrap outputs are still missing.')).toBeInTheDocument()
    expect(screen.getByText('Project Command Families')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Generation Details/i }))
    expect(screen.getByText('Regenerate Commentary')).toBeInTheDocument()
    expect(screen.getByText('Switch to the project-native bootstrap command.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(screen.getByTitle('Copy raw output')).toBeInTheDocument()
    expect(screen.getByText(/project bootstrap/)).toBeInTheDocument()
  })

  it('renders execution setup profiles with structured sections and raw access', () => {
    render(
      <ArtifactContent
        artifactId="execution-setup-profile"
        phase="PREPARING_EXECUTION_ENV"
        content={buildExecutionSetupProfileContent()}
      />,
    )

    expect(screen.getByText('Execution Setup Profile')).toBeInTheDocument()
    expect(screen.getByText('Runtime cache and command policy are ready.')).toBeInTheDocument()
    expect(screen.getByText('Reusable Artifacts')).toBeInTheDocument()
    expect(screen.getByText('.ticket/runtime/execution-setup/cache.json')).toBeInTheDocument()
    expect(screen.getByText('Quality Gate Policy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(screen.getByTitle('Copy raw output')).toBeInTheDocument()
    expect(screen.getByText(/execution_setup_profile/)).toBeInTheDocument()
  })

  it('renders execution setup reports with checks, attempts, commands, and raw access', () => {
    render(
      <ArtifactContent
        artifactId="execution-setup-report"
        phase="PREPARING_EXECUTION_ENV"
        content={buildExecutionSetupRuntimeReportContent()}
      />,
    )

    expect(screen.getAllByText('Runtime profile is ready for coding beads.').length).toBeGreaterThan(0)
    expect(screen.getByText('Checks')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Attempt History')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getByText('Command Audit')).toBeInTheDocument()
    expect(screen.getByText('project cache verify')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(screen.getByTitle('Copy raw output')).toBeInTheDocument()
    expect(screen.getByText(/executionAddedCommands/)).toBeInTheDocument()
  })

  it('renders the combined execution setup runtime artifact with one structured runtime tab', () => {
    render(
      <ArtifactContent
        artifactId="execution-setup-runtime"
        phase="PREPARING_EXECUTION_ENV"
        content={buildExecutionSetupRuntimeReportContent()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Runtime' })).toBeInTheDocument()
    expect(screen.getAllByText('Runtime profile is ready for coding beads.').length).toBeGreaterThan(0)
    expect(screen.getByText('Profile Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Command Audit')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    expect(screen.getByTitle('Copy raw output')).toBeInTheDocument()
    expect(screen.getByText(/executionAddedCommands/)).toBeInTheDocument()
  })

  it('falls back to raw output for malformed execution setup runtime artifacts', () => {
    render(
      <div>
        <ArtifactContent
          artifactId="execution-setup-profile"
          phase="PREPARING_EXECUTION_ENV"
          content="not a profile"
        />
        <ArtifactContent
          artifactId="execution-setup-report"
          phase="PREPARING_EXECUTION_ENV"
          content="not a report"
        />
        <ArtifactContent
          artifactId="execution-setup-runtime"
          phase="PREPARING_EXECUTION_ENV"
          content="not runtime"
        />
      </div>,
    )

    expect(screen.getByText('not a profile')).toBeInTheDocument()
    expect(screen.getByText('not a report')).toBeInTheDocument()
    expect(screen.getByText('not runtime')).toBeInTheDocument()
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
              structuredOutput: futureStructuredOutput({
                repairApplied: true,
                repairWarnings: [
                  'Canonicalized resolved interview status from "approved" to "draft".',
                  'Cleared approval fields for the AI-generated Full Answers artifact.',
                  'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "openai/gpt-5.2".',
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
              structuredOutput: futureStructuredOutput({
                repairApplied: true,
                repairWarnings: [
                  'Canonicalized resolved interview status from "approved" to "draft".',
                  'Cleared approval fields for the AI-generated Full Answers artifact.',
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

    expect(screen.getByText('LoopTroop reused the approved interview for these answers.')).toBeInTheDocument()
    expect(screen.getByText('2 interventions: Interview Status, Approval Fields.')).toBeInTheDocument()
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
              structuredOutput: futureStructuredOutput({
                repairApplied: true,
                repairWarnings: ['Normalized vote scorecard indentation under the wrapper key.'],
              }),
            },
            {
              voterId: 'openai/gpt-5.2',
              structuredOutput: futureStructuredOutput({
                repairApplied: false,
                repairWarnings: [],
                autoRetryCount: 1,
                validationError: 'Malformed scorecard',
              }),
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
    expect(screen.getByText('2 interventions across 2 categories: Wrapper Key, Validation Retry.')).toBeInTheDocument()

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

  it('switches vote raw tabs between all models, exact voter raw, and validated voter output', () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })

    const firstRawResponse = '<think>Scoring each draft.</think>\n\ndraft_scores:\n  Draft 1:\n    total_score: 91'
    const firstNormalizedResponse = 'draft_scores:\n  Draft 1:\n    total_score: 91\n'
    const secondRawResponse = 'draft_scores:\n  Draft 1:\n    total_score: 89\n  Draft 2:\n    total_score: 86'
    const content = JSON.stringify({
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
            { category: 'Coverage of requirements', score: 19 },
            { category: 'Correctness / feasibility', score: 18 },
          ],
        },
      ],
      voterOutcomes: {
        'vendor/voter-a': 'completed',
        'vendor/voter-b': 'completed',
      },
      voterDetails: [
        {
          voterId: 'vendor/voter-a',
          rawResponse: firstRawResponse,
          normalizedResponse: firstNormalizedResponse,
          structuredOutput: { repairApplied: true, repairWarnings: ['Recovered structured scorecard.'], autoRetryCount: 0 },
        },
        { voterId: 'vendor/voter-b', rawResponse: secondRawResponse },
      ],
      winnerId: 'vendor/draft-a',
      isFinal: true,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const allModelsButton = screen.getByRole('button', { name: 'All Models' })
    expect(allModelsButton).toHaveAttribute('aria-pressed', 'true')
    const voterAGroup = screen.getByRole('group', { name: /voter-a raw output/i })
    expect(within(voterAGroup).getByRole('button', { name: /voter-a$/ })).toBeInTheDocument()
    expect(within(voterAGroup).getByRole('button', { name: /voter-a Validated/ })).toBeInTheDocument()
    const allModelsPre = screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes('<think>Scoring each draft.</think>')
      && !element.textContent.includes('\\n  Draft 1'),
    )
    expect(allModelsPre).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(content)

    fireEvent.click(within(voterAGroup).getByRole('button', { name: /voter-a$/ }))

    expect(within(voterAGroup).getByRole('button', { name: /voter-a$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(`${firstRawResponse.split('\n').length.toLocaleString()} Lines`)).toBeInTheDocument()
    expect(screen.getByText(`${firstRawResponse.length.toLocaleString()} Characters`)).toBeInTheDocument()
    expect(screen.getByText(`${encode(firstRawResponse).length.toLocaleString()} Tokens (GPT-5 tokenizer)`)).toBeInTheDocument()
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === firstRawResponse)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Copy raw output'))

    expect(writeTextMock).toHaveBeenLastCalledWith(firstRawResponse)

    fireEvent.click(within(voterAGroup).getByRole('button', { name: /voter-a Validated/ }))

    expect(within(voterAGroup).getByRole('button', { name: /voter-a Validated/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === firstNormalizedResponse)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(firstNormalizedResponse)
  })

  it('reconstructs a validated vote raw source for legacy repaired vote artifacts', () => {
    const messyRawResponse = '<think>I compared the drafts.</think>\n\ndraft_scores:\nDraft 1:\n  total_score: 91'
    const content = JSON.stringify({
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
            { category: 'Coverage of requirements', score: 19 },
            { category: 'Correctness / feasibility', score: 18 },
          ],
        },
        {
          voterId: 'vendor/voter-a',
          draftId: 'vendor/draft-b',
          totalScore: 86,
          scores: [
            { category: 'Coverage of requirements', score: 17 },
            { category: 'Correctness / feasibility', score: 16 },
          ],
        },
      ],
      voterOutcomes: {
        'vendor/voter-a': 'completed',
      },
      presentationOrders: {
        'vendor/voter-a': {
          seed: 'seed-alpha',
          order: ['vendor/draft-a', 'vendor/draft-b'],
        },
      },
      voterDetails: [
        {
          voterId: 'vendor/voter-a',
          rawResponse: messyRawResponse,
          structuredOutput: { repairApplied: true, repairWarnings: ['Recovered structured scorecard.'], autoRetryCount: 0 },
        },
      ],
      winnerId: 'vendor/draft-a',
      isFinal: true,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))
    fireEvent.click(screen.getByRole('button', { name: /voter-a Validated/ }))

    expect(screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes('draft_scores:')
      && element.textContent.includes('Draft 2:')
      && element.textContent.includes('total_score: 86')
      && !element.textContent.includes('<think>'),
    )).toBeInTheDocument()
  })

  it('does not fabricate a validated vote raw source for invalid prompt-echo output without votes', () => {
    const content = JSON.stringify({
      votes: [],
      voterOutcomes: {
        'vendor/voter-a': 'invalid_output',
      },
      voterDetails: [
        {
          voterId: 'vendor/voter-a',
          rawResponse: 'CRITICAL OUTPUT RULE:\nReturn only YAML.',
          error: 'Vote scorecard output echoed the prompt instead of returning a structured scorecard',
          structuredOutput: { repairApplied: false, repairWarnings: [], autoRetryCount: 1 },
        },
      ],
      isFinal: false,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    expect(screen.getByRole('button', { name: /voter-a$/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /voter-a Validated/ })).not.toBeInTheDocument()
  })

  it('keeps legacy vote raw details on all models when exact voter raw responses are missing', () => {
    const content = JSON.stringify({
      drafts: [
        { memberId: 'vendor/draft-a', outcome: 'completed', content: 'draft-a' },
        { memberId: 'vendor/draft-b', outcome: 'completed', content: 'draft-b' },
      ],
      votes: [
        {
          voterId: 'vendor/voter-a',
          draftId: 'vendor/draft-a',
          totalScore: 91,
          scores: [{ category: 'Coverage of requirements', score: 19 }],
        },
      ],
      voterOutcomes: {
        'vendor/voter-a': 'completed',
        'vendor/voter-b': 'pending',
      },
      winnerId: 'vendor/draft-a',
      isFinal: true,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    expect(screen.getByRole('button', { name: 'All Models' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /voter-a/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /voter-b/ })).toBeDisabled()
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === content)).toBeInTheDocument()
  })

  it('switches draft raw tabs between raw output and validated version when both exist', () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })

    const rawDraftResponse = '<think>Building interview questions.</think>\n\nquestions:\n  - text: What is the scope?'
    const validatedDraftResponse = 'questions:\n  - text: What is the scope?\n'
    const content = JSON.stringify({
      drafts: [
        {
          memberId: 'vendor/draft-a',
          outcome: 'completed',
          content: validatedDraftResponse,
          rawResponse: rawDraftResponse,
          normalizedResponse: validatedDraftResponse,
          structuredOutput: { repairApplied: true, repairWarnings: ['Stripped thinking block.'], autoRetryCount: 0 },
        },
      ],
      memberOutcomes: { 'vendor/draft-a': 'completed' },
      isFinal: true,
    })

    render(<ArtifactContent artifactId="draft-member-vendor%2Fdraft-a" phase="COUNCIL_DRAFTING_INTERVIEW" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const draftGroup = screen.getByRole('group', { name: /draft-a raw output/i })
    expect(within(draftGroup).getByRole('button', { name: /draft-a Raw Output/ })).toBeInTheDocument()
    expect(within(draftGroup).getByRole('button', { name: /draft-a Validated/ })).toBeInTheDocument()

    fireEvent.click(within(draftGroup).getByRole('button', { name: /draft-a Raw Output/ }))
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === rawDraftResponse)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(rawDraftResponse)

    fireEvent.click(within(draftGroup).getByRole('button', { name: /draft-a Validated/ }))
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === validatedDraftResponse)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(validatedDraftResponse)
  })

  it('shows a draft adjustment notice when raw and validated output differ without parser warnings', () => {
    const rawDraftResponse = 'questions:\n  - id: Q1\n    question: What is the scope?'
    const validatedDraftResponse = 'questions:\n  - id: Q01\n    question: What is the scope?\n'
    const content = JSON.stringify({
      drafts: [
        {
          memberId: 'vendor/draft-a',
          outcome: 'completed',
          content: validatedDraftResponse,
          rawResponse: rawDraftResponse,
          normalizedResponse: validatedDraftResponse,
          structuredOutput: { repairApplied: false, repairWarnings: [], autoRetryCount: 0 },
        },
      ],
      memberOutcomes: { 'vendor/draft-a': 'completed' },
      isFinal: true,
    })

    render(<ArtifactContent artifactId="draft-member-vendor%2Fdraft-a" phase="COUNCIL_DELIBERATING" content={content} />)

    expect(screen.getByText('LoopTroop adjusted this interview draft.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()

    openNotice('LoopTroop adjusted this interview draft.')
    expect(screen.getAllByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent === 'Normalized saved artifact details from raw model output before saving the validated artifact.',
    )).toHaveLength(1)
    expect(screen.queryByText(/Raw Source Messages/i)).not.toBeInTheDocument()
  })

  it('shows a vote adjustment notice when raw and validated scorecards differ without parser warnings', () => {
    const rawVoteResponse = 'draft_scores:\n  Draft 1:\n    total_score: 91'
    const validatedVoteResponse = 'draft_scores:\n  Draft 1:\n    total_score: 91\n'
    const content = JSON.stringify({
      drafts: [
        { memberId: 'vendor/draft-a', outcome: 'completed', content: 'draft-a' },
      ],
      votes: [
        {
          voterId: 'vendor/voter-a',
          draftId: 'vendor/draft-a',
          totalScore: 91,
          scores: [{ category: 'Coverage of requirements', score: 19 }],
        },
      ],
      voterOutcomes: { 'vendor/voter-a': 'completed' },
      voterDetails: [
        {
          voterId: 'vendor/voter-a',
          rawResponse: rawVoteResponse,
          normalizedResponse: validatedVoteResponse,
          structuredOutput: { repairApplied: false, repairWarnings: [], autoRetryCount: 0 },
        },
      ],
      winnerId: 'vendor/draft-a',
      isFinal: true,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    expect(screen.getByText('LoopTroop adjusted some vote scorecards.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
  })

  it('recovers missing PRD Full Answers raw output from phase logs', () => {
    const modelId = 'opencode/hy3-preview-free'
    const rawFullAnswers = 'schema_version: 1\nticket_id: TEST\nartifact: interview\ngenerated_by:\n  winner_model: wrong-model'
    const validatedFullAnswers = 'schema_version: 1\nticket_id: TEST\nartifact: interview\ngenerated_by:\n  winner_model: opencode/hy3-preview-free\n'
    const rawPrdDraft = 'schema_version: 1\nartifact: prd\nstatus: draft'
    const content = JSON.stringify({
      drafts: [
        {
          memberId: modelId,
          outcome: 'completed',
          content: validatedFullAnswers,
          structuredOutput: { repairApplied: true, repairWarnings: ['Canonicalized generated_by.winner_model.'], autoRetryCount: 0 },
        },
      ],
      memberOutcomes: { [modelId]: 'completed' },
      isFinal: true,
    })
    const logs = [
      makeLogEntry(`[SYS] ${modelId} Full Answers started.`, { modelId, source: 'system' }),
      makeLogEntry(`[MODEL] ${rawFullAnswers}`, { modelId, source: `model:${modelId}`, audience: 'ai', kind: 'text' }),
      makeLogEntry(`[SYS] ${modelId} Full Answers completed.`, { modelId, source: 'system' }),
      makeLogEntry(`[SYS] ${modelId} PRD draft started.`, { modelId, source: 'system' }),
      makeLogEntry(`[MODEL] ${rawPrdDraft}`, { modelId, source: `model:${modelId}`, audience: 'ai', kind: 'text' }),
    ]

    renderWithLogContext(
      <ArtifactContent artifactId={`prd-fullanswers-member-${encodeURIComponent(modelId)}`} phase="DRAFTING_PRD" content={content} />,
      { DRAFTING_PRD: logs },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const draftGroup = screen.getByRole('group', { name: /hy3-preview-free raw output/i })
    const rawButton = within(draftGroup).getByRole('button', { name: /hy3-preview-free Raw Output/ })
    expect(rawButton).toBeEnabled()
    fireEvent.click(rawButton)
    expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === rawFullAnswers)).toBeInTheDocument()
    expect(screen.queryByText((_text, element) => element?.tagName === 'PRE' && element.textContent === rawPrdDraft)).not.toBeInTheDocument()
    expect(within(draftGroup).getByRole('button', { name: /hy3-preview-free Validated/ })).toBeInTheDocument()
  })

  it('does not show raw/validated variant buttons for drafts without rawResponse', () => {
    const content = JSON.stringify({
      drafts: [
        {
          memberId: 'vendor/draft-a',
          outcome: 'completed',
          content: 'questions:\n  - text: What is the scope?\n',
        },
      ],
      memberOutcomes: { 'vendor/draft-a': 'completed' },
      isFinal: true,
    })

    render(<ArtifactContent artifactId="draft-member-vendor%2Fdraft-a" phase="COUNCIL_DRAFTING_INTERVIEW" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    expect(screen.queryByRole('group', { name: /draft-a raw output/i })).not.toBeInTheDocument()
  })

  it('classifies no-op diff cleanup in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: [
        'Dropped no-op interview refinement modified at index 0 because the question is unchanged across the winning and final drafts.',
      ],
      autoRetryCount: 0,
    }), 'diff')

    expect(copy).toMatchObject({
      title: 'LoopTroop adjusted this diff.',
      summary: '1 intervention: No Op Change.',
    })
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'dropped', code: 'dropped_no_op_change' }),
    ])
  })

  it('classifies normalization repairs in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: ['Inferred missing PRD refinement item_type at index 0 as epic.'],
      autoRetryCount: 0,
    }), 'diff')

    expect(copy?.title).toBe('LoopTroop adjusted this diff.')
    expect(copy?.summary).toBe('1 intervention: Missing Field Inference.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'synthesized', code: 'synthesized_inferred_detail' }),
    ])
  })

  it('classifies formatting cleanup in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: ['Removed surrounding markdown code fence before parsing the final test commands.'],
      autoRetryCount: 0,
    }), 'final-test')

    expect(copy?.title).toBe('LoopTroop adjusted this final test plan.')
    expect(copy?.summary).toBe('1 intervention: Markdown Fence Unwrap.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'parser_fix', code: 'parser_markdown_fence' }),
    ])
  })

  it('derives exact correction details for canonicalized metadata warnings', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }), 'full-answers')

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
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: ['Synthesized missing PRD refinement change at index 0 from the validated records.'],
      autoRetryCount: 0,
    }), 'diff')

    expect(copy?.summary).toBe('1 intervention: Missing Detail.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'synthesized', code: 'synthesized_missing_detail' }),
    ])
  })

  it('describes retry-only parser interventions in the parser notice copy', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: false,
      repairWarnings: [],
      autoRetryCount: 1,
      validationError: 'Coverage parser rejected the first pass.',
    }), 'coverage')

    expect(copy?.summary).toBe('1 intervention: Validation Retry.')
    expect(copy?.body).toMatch(/validated this coverage review/i)
    expect(copy?.interventions).toEqual([
      expect.objectContaining({ category: 'retry', code: 'retry_after_validation_failure' }),
    ])
  })

  it('keeps reserved-scalar parser fixes separate from retry interventions in parser notices', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: ['Quoted plain YAML scalars that began with reserved indicator characters (` or @) before reparsing.'],
      autoRetryCount: 1,
      validationError: 'PRD parser rejected the first pass.',
    }), 'prd-draft')

    expect(copy?.summary).toBe('2 interventions across 2 categories: Reserved Scalar Repair, Validation Retry.')
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
          structuredOutput: futureStructuredOutput({
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
          }),
        })}
      />,
    )

    const noticeButton = screen.getByText('LoopTroop adjusted this relevant files scan.').closest('button')
    expect(noticeButton).toBeInTheDocument()
    expect(screen.queryByText(/Retry Attempts/i)).not.toBeInTheDocument()

    fireEvent.click(noticeButton!)

    expect(screen.queryByText(/Raw Source Messages/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Retry Attempts/i)).toBeInTheDocument()
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getAllByText('Relevant files output was empty.').length).toBeGreaterThan(0)
    expect(screen.getByText(/files · line 4, column 3/i)).toBeInTheDocument()
    expect(screen.getAllByText(/4 \| files:/i).length).toBeGreaterThan(0)
  })

  it('does not derive parser notices from bare legacy repair warnings', () => {
    const copy = buildArtifactProcessingNoticeCopy({
      repairApplied: true,
      repairWarnings: ['Validator repair step completed.'],
      autoRetryCount: 0,
    }, 'artifact')

    expect(copy).toBeNull()
  })

  it('uses output-specific wording for Full Answers metadata cleanup', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized resolved interview status from "approved" to "draft".',
        'Cleared approval fields for the AI-generated Full Answers artifact.',
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }), 'full-answers')

    expect(copy?.title).toBe('LoopTroop adjusted these Full Answers.')
    expect(copy?.summary).toBe('3 interventions: Interview Status, Approval Fields, Winner Model.')
    expect(copy?.badges).toEqual([
      expect.objectContaining({ label: 'Cleanup', count: 3 }),
    ])
  })

  it('shows specific cleanup copy for selected option id repairs in Full Answers notices', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: [
        'Mapped selected option ids to canonical option ids for AI-filled question Q01.',
      ],
      autoRetryCount: 0,
    }), 'full-answers')

    expect(copy?.title).toBe('LoopTroop adjusted these Full Answers.')
    expect(copy?.summary).toBe('1 intervention: Mapped Free Text.')
    expect(copy?.interventions).toEqual([
      expect.objectContaining({
        category: 'cleanup',
        code: 'cleanup_mapped_free_text',
        exactCorrection: 'Mapped the answer content to canonical option IDs for question Q01.',
      }),
    ])
  })

  it('uses reused-approved-interview wording for synthetic Full Answers artifacts', () => {
    const copy = buildArtifactProcessingNoticeCopy(futureStructuredOutput({
      repairApplied: true,
      repairWarnings: [
        'Canonicalized resolved interview status from "approved" to "draft".',
        'Cleared approval fields for the AI-generated Full Answers artifact.',
        'Canonicalized generated_by.winner_model from "openai/gpt-5.4" to "github-copilot/gpt-4.1".',
      ],
      autoRetryCount: 0,
    }), 'full-answers', { fullAnswersOrigin: 'reused-approved-interview' })

    expect(copy?.title).toBe('LoopTroop reused the approved interview for these answers.')
    expect(copy?.summary).toBe('3 interventions: Interview Status, Approval Fields, Winner Model.')
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

    expect(copy?.summary).toBe('1 intervention: Transcript Recovery.')
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
              structuredOutput: futureStructuredOutput({
                repairApplied: true,
                repairWarnings: ['Inferred missing PRD refinement item_type at index 0 as epic.'],
              }),
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
    expect(screen.getAllByText(/Inferred missing PRD refinement item_type at index 0 as epic/i).length).toBeGreaterThan(0)
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
                    exactCorrection: `Changed ticket_id from "${TEST.shortname}-OLD" to "${TEST.shortname}-123".`,
                    rule: { id: 'cleanup_ticket_id', label: 'Ticket ID' },
                    examples: [
                      {
                        scope: 'ticket_id',
                        before: `${TEST.shortname}-OLD`,
                        after: `${TEST.shortname}-123`,
                      },
                    ],
                    technicalDetail: `Canonicalized ticket_id from "${TEST.shortname}-OLD" to "${TEST.shortname}-123".`,
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
    expect(screen.getByText(`Changed ticket_id from "${TEST.shortname}-OLD" to "${TEST.shortname}-123".`)).toBeInTheDocument()
    expect(screen.getByText('Rule:')).toBeInTheDocument()
    expect(screen.getByText('Ticket ID')).toBeInTheDocument()
    expect(screen.getByText('cleanup_ticket_id')).toBeInTheDocument()
    expect(screen.getByText('Before:')).toBeInTheDocument()
    expect(screen.getByText(`${TEST.shortname}-OLD`)).toBeInTheDocument()
    expect(screen.getByText('After:')).toBeInTheDocument()
    expect(screen.getByText(`${TEST.shortname}-123`)).toBeInTheDocument()
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
          structuredOutput: futureStructuredOutput({
            repairApplied: true,
            repairWarnings: ['Trimmed empty PRD coverage gap strings before persisting the normalized result.'],
          }),
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this coverage review.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this coverage review and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this coverage review.')

    expect(screen.getByText(/LoopTroop validated this coverage review and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Trimmed empty PRD coverage gap strings before persisting the normalized result/i).length).toBeGreaterThan(0)
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
          structuredOutput: futureStructuredOutput({
            repairApplied: true,
            repairWarnings: ['Removed surrounding markdown code fence before parsing the relevant files result.'],
          }),
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this relevant files scan.')).toBeInTheDocument()
    expect(screen.getByText('Parser Fix 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this relevant files scan and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this relevant files scan.')

    expect(screen.getByText(/LoopTroop validated this relevant files scan and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Removed surrounding markdown code fence before parsing the relevant files result/i).length).toBeGreaterThan(0)
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

  it('renders relevant files raw JSON strings with real line breaks and wrapped display text', () => {
    const longQuestion = 'For this test ticket, is the goal simply to replace the current default global theme with a pink-based one for all users, with no runtime theme switching?'
    render(
      <ArtifactContent
        artifactId="relevant-files-scan"
        phase="SCANNING_RELEVANT_FILES"
        content={JSON.stringify({
          fileCount: 1,
          question: longQuestion,
          files: [
            {
              path: 'src/theme.ts',
              rationale: 'Defines the default global theme.',
              relevance: 'high',
              likely_action: 'modify',
              contentPreview: 'export const primary = "blue"\nexport const accent = "slate"',
              contentLength: 58,
            },
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const rawPre = screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes('contentPreview: |-')
      && element.textContent.includes('export const primary = "blue"'),
    )
    expect(rawPre.textContent).toMatch(/export const primary = "blue"\n\s+export const accent = "slate"/)
    expect(rawPre.textContent).toContain(`question: "${longQuestion}"`)
    expect(rawPre.textContent).toContain('  - path: "src/theme.ts"')
    expect(rawPre.textContent).not.toContain('\\n')
    expect(rawPre.textContent).not.toContain('  -\n    path')
    expect(rawPre.textContent).not.toContain('all\n      users')
    expect(rawPre).toHaveClass('whitespace-pre-wrap', 'overflow-x-hidden')
  })

  it('renders simple folded YAML scalars in raw tabs as quoted single-line values', () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })

    const prompt = 'For this test ticket, is the goal simply to replace the current default app palette with a single pink palette (no theme switcher), and is that the full definition of done?'
    const content = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    prompt: >-',
      '      For this test ticket, is the goal simply to replace the current default app palette with a single pink palette (no',
      '      theme switcher), and is that the full definition of done?',
      '    source: compiled',
      '    answer_type: single_choice',
    ].join('\n')

    render(
      <ArtifactContent
        artifactId="interview-answers"
        content={content}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const rawPre = screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes(`prompt: "${prompt}"`),
    )
    expect(rawPre.textContent).not.toContain('prompt: >-')
    expect(rawPre.textContent).not.toContain('no\n      theme switcher')
    expect(rawPre.textContent).toContain('    source: compiled')

    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(content)
  })

  it('renders folded YAML scalars inside JSON artifact content fields without altering copy content', () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })

    const prompt = 'Should every PRD draft keep long interview prompts readable when viewing aggregate raw artifacts?'
    const draftContent = [
      'schema_version: 1',
      'artifact: interview',
      'questions:',
      '  - id: Q01',
      '    prompt: >-',
      '      Should every PRD draft keep long interview prompts readable',
      '      when viewing aggregate raw artifacts?',
    ].join('\n')
    const content = JSON.stringify({
      drafts: [
        { memberId: 'vendor/draft-a', outcome: 'completed', content: draftContent },
      ],
      votes: [],
      voterOutcomes: {},
      winnerId: 'vendor/draft-a',
      isFinal: false,
    })

    render(<ArtifactContent artifactId="prd-votes" phase="COUNCIL_VOTING_PRD" content={content} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const rawPre = screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes('content: |-')
      && element.textContent.includes(`prompt: "${prompt}"`),
    )
    expect(rawPre.textContent).not.toContain('prompt: >-')
    expect(rawPre.textContent).not.toContain('readable\n        when viewing')

    fireEvent.click(screen.getByTitle('Copy raw output'))
    expect(writeTextMock).toHaveBeenLastCalledWith(content)
  })

  it('renders final interview raw JSON wrappers with real line breaks', () => {
    const longPrompt = 'For this test ticket, is the goal simply to replace the current default global theme with a pink-based one for all users, with no runtime theme switching?'
    const refinedContent = [
      'artifact: interview',
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    prompt: >-',
      '      For this test ticket, is the goal simply to replace the current default global theme with a pink-based one',
      '      for all users, with no runtime theme switching?',
      '    source: compiled',
      '    answer_type: free_text',
      '    options: []',
    ].join('\n')
    const content = JSON.stringify({
      originalContent: 'questions:\n  - id: Q01\n    prompt: Old prompt',
      refinedContent,
      structuredOutput: futureStructuredOutput({
        repairApplied: true,
        repairWarnings: ['Recovered the structured interview from wrapper JSON.'],
      }),
    })

    render(
      <ArtifactContent
        artifactId="final-interview"
        phase="REFINING_INTERVIEW"
        content={content}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    const rawPre = screen.getByText((_text, element) =>
      element?.tagName === 'PRE'
      && element.textContent?.includes('refinedContent: |-')
      && element.textContent.includes('questions:'),
    )
    expect(rawPre.textContent).toMatch(/originalContent: \|-\n\s+questions:/)
    expect(rawPre.textContent).toContain(`prompt: "${longPrompt}"`)
    expect(rawPre.textContent).not.toContain('prompt: >-')
    expect(rawPre.textContent).not.toContain('\\n')
    expect(rawPre.textContent).not.toContain('all\n      users')
    expect(rawPre).toHaveClass('whitespace-pre-wrap', 'overflow-x-hidden')
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
              structuredOutput: futureStructuredOutput({
                repairApplied: true,
                repairWarnings: ['Reordered vote scorecards before persistence.'],
              }),
            },
            {
              voterId: 'vendor/voter-b',
              structuredOutput: futureStructuredOutput({
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
              }),
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted some vote scorecards.')).toBeInTheDocument()
    expect(screen.getByText('2 interventions across 2 categories: Reordering, Validation Retry.')).toBeInTheDocument()
    expect(screen.getByText('Cleanup 1')).toBeInTheDocument()
    expect(screen.getByText('Retried 1')).toBeInTheDocument()

    openNotice('LoopTroop adjusted some vote scorecards.')
    expect(screen.getByText('Affected Voters')).toBeInTheDocument()
    expect(screen.getAllByText('voter-a').length).toBeGreaterThan(0)
    expect(screen.getAllByText('voter-b').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Raw Source Messages/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Retry Attempts/i)).toBeInTheDocument()
    expect(screen.getAllByText('Draft 2: score: pending').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText(/Voter Details/i).closest('button')!)
    expect(screen.getAllByText('LoopTroop adjusted this vote scorecard.')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('LoopTroop adjusted this vote scorecard.')[1]!.closest('button')!)
    expect(screen.getAllByText(/Retry Attempts/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Draft 2: score: pending').length).toBeGreaterThan(0)
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
          planStructuredOutput: futureStructuredOutput({
            repairApplied: false,
            repairWarnings: [],
            autoRetryCount: 1,
            validationError: 'Missing final test marker on first pass.',
          }),
        })}
      />,
    )

    expect(screen.getByText('LoopTroop adjusted this final test plan.')).toBeInTheDocument()
    expect(screen.getByText('Retried 1')).toBeInTheDocument()
    expect(screen.queryByText(/LoopTroop validated this final test plan and recorded the intervention details below/i)).not.toBeInTheDocument()

    openNotice('LoopTroop adjusted this final test plan.')

    expect(screen.getByText(/LoopTroop validated this final test plan and recorded the intervention details below/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Missing final test marker on first pass/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Retried after validation failed and recorded the resulting artifact state.')).toBeInTheDocument()
    expect(screen.getByText('LoopTroop issued a structured retry attempt after the earlier validation failure and recorded the resulting artifact state.')).toBeInTheDocument()
    expect(screen.queryByText(/successful validated result/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/successful pass/i)).not.toBeInTheDocument()
  })

  it('renders integration reports with structured metadata and deferred push guidance', () => {
    render(
      <ArtifactContent
        artifactId="commit-summary"
        phase="WAITING_PR_REVIEW"
        content={JSON.stringify({
          status: 'passed',
          completedAt: '2026-04-10T15:54:47.116Z',
          baseBranch: 'master',
          preSquashHead: 'ed7609abd7c99ad8f0bfae28442f69b24aff7871',
          candidateCommitSha: 'c2708197a117389f594e4f6f8cc4262bf9d3bd6d',
          mergeBase: '010cd33773494fcbaba0af86e9d84dd3c3548206',
          commitCount: 2,
          pushed: false,
          pushDeferred: true,
          pushError: null,
          message: 'Integration phase completed. Manual verification is required before cleanup.',
        })}
      />,
    )

    expect(screen.getByText('Integration Report')).toBeInTheDocument()
    expect(screen.getByText('Integration candidate prepared')).toBeInTheDocument()
    expect(screen.getByText('Integration phase completed. Manual verification is required before cleanup.')).toBeInTheDocument()
    expect(screen.getByText('Base Branch')).toBeInTheDocument()
    expect(screen.getByText('master')).toBeInTheDocument()
    expect(screen.getByText('Candidate Commit')).toBeInTheDocument()
    expect(screen.getByText('c2708197a117389f594e4f6f8cc4262bf9d3bd6d')).toBeInTheDocument()
    expect(screen.getByText('Squashed Commits')).toBeInTheDocument()
    expect(screen.getByText(/remote ticket branch stays on the last bead backup until manual verification/i)).toBeInTheDocument()
  })

  it('renders failed integration reports with the remote push error callout', () => {
    render(
      <ArtifactContent
        artifactId="commit-summary"
        phase="INTEGRATING_CHANGES"
        content={JSON.stringify({
          status: 'failed',
          completedAt: '2026-04-10T15:54:47.116Z',
          baseBranch: 'master',
          candidateCommitSha: null,
          commitCount: null,
          pushed: false,
          pushDeferred: false,
          pushError: 'git push failed after 3 attempts: permission denied',
          message: 'git merge-base failed',
        })}
      />,
    )

    expect(screen.getByText('Integration failed')).toBeInTheDocument()
    expect(screen.getByText('git merge-base failed')).toBeInTheDocument()
    expect(screen.getByText('Remote update failed')).toBeInTheDocument()
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument()
  })

  it('renders pull request reports with a prominent GitHub link and generated description', () => {
    render(
      <ArtifactContent
        artifactId="pull-request-report"
        phase="CREATING_PULL_REQUEST"
        content={JSON.stringify({
          status: 'passed',
          completedAt: '2026-04-10T15:58:47.116Z',
          baseBranch: 'master',
          headBranch: 'POBA-9',
          candidateCommitSha: 'c2708197a117389f594e4f6f8cc4262bf9d3bd6d',
          prNumber: 42,
          prUrl: 'https://github.com/looptroop-ai/pocketbase-master/pull/42',
          prState: 'draft',
          prHeadSha: 'c2708197a117389f594e4f6f8cc4262bf9d3bd6d',
          title: 'POBA-9: t13',
          body: [
            '## Summary',
            '- Adds the scoped theme regression test.',
            '',
            '## Validation',
            '- npm test -- src/theme-scope.test.js',
          ].join('\n'),
          createdAt: '2026-04-10T15:58:40.116Z',
          updatedAt: '2026-04-10T15:58:47.116Z',
          message: 'Draft pull request ready at https://github.com/looptroop-ai/pocketbase-master/pull/42.',
        })}
      />,
    )

    expect(screen.getByText('Pull Request Report')).toBeInTheDocument()
    expect(screen.getByText('Draft pull request ready')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open draft pr in github/i })).toHaveAttribute(
      'href',
      'https://github.com/looptroop-ai/pocketbase-master/pull/42',
    )
    expect(screen.getByText('PR Number')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('Head Branch')).toBeInTheDocument()
    expect(screen.getByText('POBA-9')).toBeInTheDocument()
    expect(screen.getByText('Generated PR Description')).toBeInTheDocument()
    expect(screen.getByText('Adds the scoped theme regression test.')).toBeInTheDocument()
    expect(screen.getByText('npm test -- src/theme-scope.test.js')).toBeInTheDocument()
  })

  it('renders cleanup reports with counts and categorized path sections', () => {
    render(
      <ArtifactContent
        artifactId="cleanup-report"
        phase="CLEANING_ENV"
        content={JSON.stringify({
          removedDirs: ['/tmp/ticket/.ticket/runtime/locks'],
          removedFiles: ['/tmp/ticket/.ticket/runtime/state.yaml'],
          preservedPaths: [
            '/tmp/ticket/.ticket/interview.yaml',
            '/tmp/ticket/.ticket/runtime/execution-log.jsonl',
          ],
          errors: ['Failed to remove /tmp/ticket/.ticket/runtime/tmp: EBUSY'],
        })}
      />,
    )

    expect(screen.getByText('Cleanup Report')).toBeInTheDocument()
    expect(screen.getByText('Cleanup completed with errors')).toBeInTheDocument()
    expect(screen.getByText('Removed Dirs')).toBeInTheDocument()
    expect(screen.getAllByText('Removed Files').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Preserved Paths').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Errors').length).toBeGreaterThan(0)
    expect(screen.getByText('/tmp/ticket/.ticket/runtime/locks')).toBeInTheDocument()
    expect(screen.getByText('/tmp/ticket/.ticket/runtime/state.yaml')).toBeInTheDocument()
    expect(screen.getByText('/tmp/ticket/.ticket/interview.yaml')).toBeInTheDocument()
    expect(screen.getByText(/EBUSY/i)).toBeInTheDocument()
  })

  it('falls back to the raw viewer for malformed integration reports', () => {
    render(
      <ArtifactContent
        artifactId="commit-summary"
        phase="WAITING_PR_REVIEW"
        content="not valid integration json"
      />,
    )

    expect(screen.getByText('not valid integration json')).toBeInTheDocument()
  })

  it('falls back to the raw viewer for malformed pull request reports', () => {
    render(
      <ArtifactContent
        artifactId="pull-request-report"
        phase="CREATING_PULL_REQUEST"
        content="not valid pull request json"
      />,
    )

    expect(screen.getByText('not valid pull request json')).toBeInTheDocument()
  })

  it('falls back to the raw viewer for malformed cleanup reports', () => {
    render(
      <ArtifactContent
        artifactId="cleanup-report"
        phase="CLEANING_ENV"
        content="not valid cleanup json"
      />,
    )

    expect(screen.getByText('not valid cleanup json')).toBeInTheDocument()
  })
})
