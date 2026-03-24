import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { InterviewDocument } from '@shared/interviewArtifact'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { buildInterviewDocumentYaml } from '../../structuredOutput'
import type { TicketContext as MachineTicketContext } from '../../machines/types'
import { phaseIntermediate } from '../phases/state'

const { draftPRDMock } = vi.hoisted(() => ({
  draftPRDMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../../phases/prd/draft', async () => {
  const actual = await vi.importActual<typeof import('../../phases/prd/draft')>('../../phases/prd/draft')
  return {
    ...actual,
    draftPRD: draftPRDMock,
  }
})

import { handlePrdDraft } from '../phases/prdPhase'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-prd-draft-',
  files: {
    'README.md': '# PRD Draft Phase Test\n',
    'src/main.ts': 'export const main = true\n',
  },
})

function buildInterviewYaml(ticketId: string): string {
  const document: InterviewDocument = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'approved',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-23T09:00:00.000Z',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'Which workflow guardrails are mandatory?',
        source: 'compiled',
        follow_up_round: null,
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
    follow_up_rounds: [],
    summary: {
      goals: ['Harden DRAFTING_PRD'],
      constraints: ['Preserve council mechanics'],
      non_goals: ['Touch PRD approval'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  return buildInterviewDocumentYaml(document)
}

function buildTicketContext(ticket: ReturnType<typeof createTicket>, overrides: Partial<MachineTicketContext> = {}): MachineTicketContext {
  return {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    externalId: ticket.externalId,
    title: ticket.title,
    status: ticket.status,
    lockedMainImplementer: 'openai/gpt-5-codex',
    lockedMainImplementerVariant: null,
    lockedCouncilMembers: ['openai/gpt-5-mini', 'openai/gpt-5.2'],
    lockedCouncilMemberVariants: null,
    lockedInterviewQuestions: null,
    lockedCoverageFollowUpBudgetPercent: null,
    lockedMaxCoveragePasses: null,
    previousStatus: null,
    error: null,
    errorCodes: [],
    beadProgress: { total: 0, completed: 0, current: null },
    iterationCount: 0,
    maxIterations: 5,
    councilResults: null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...overrides,
  }
}

function createInitializedTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Harden PRD drafting',
    description: 'Bring PRD drafting in line with interview council rigor.',
  })

  initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) throw new Error('Expected ticket paths after initialization')

  return {
    ticket,
    context: buildTicketContext(ticket),
    paths,
  }
}

describe('handlePrdDraft', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    phaseIntermediate.clear()
    draftPRDMock.mockReset()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('fails fast before drafting when the canonical interview artifact is missing', async () => {
    const { ticket, context } = createInitializedTicket()
    const sendEvent = vi.fn()

    await expect(handlePrdDraft(ticket.id, context, sendEvent, new AbortController().signal))
      .rejects
      .toThrow('Canonical interview artifact is required before PRD drafting')

    expect(draftPRDMock).not.toHaveBeenCalled()
    expect(getLatestPhaseArtifact(ticket.id, 'prd_drafts', 'DRAFTING_PRD')).toBeUndefined()
  })

  it('persists normalized draft metadata and logs PRD-specific metrics', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()

    writeFileSync(`${paths.ticketDir}/interview.yaml`, buildInterviewYaml(ticket.externalId), 'utf-8')
    writeFileSync(`${paths.ticketDir}/relevant-files.yaml`, 'files:\n  - path: src/main.ts\n', 'utf-8')
    draftPRDMock.mockImplementationOnce(async (
      _adapter: unknown,
      _members: unknown,
      ticketState: { ticketId?: string; interview?: string; relevantFiles?: string },
      _projectPath: string,
      options: { ticketId?: string; ticketExternalId?: string },
      _signal: AbortSignal,
      _onOpenCodeSessionLog: unknown,
      _onOpenCodeStreamEvent: unknown,
      _onOpenCodePromptDispatched: unknown,
      onFullAnswersProgress?: (entry: {
        memberId: string
        status: 'session_created' | 'finished'
        outcome?: 'completed'
        sessionId?: string
        duration?: number
        content?: string
        questionCount?: number
        structuredOutput?: { repairApplied?: boolean; repairWarnings?: string[]; autoRetryCount?: number; validationError?: string }
      }) => void,
      onDraftProgress?: (entry: {
        memberId: string
        status: 'session_created' | 'finished'
        sessionId?: string
        outcome?: 'completed'
        duration?: number
        content?: string
        draftMetrics?: { epicCount?: number; userStoryCount?: number }
        structuredOutput?: { repairApplied?: boolean; repairWarnings?: string[]; autoRetryCount?: number; validationError?: string }
      }) => void,
    ) => {
      expect(ticketState.ticketId).toBe(ticket.externalId)
      expect(ticketState.relevantFiles).toContain('src/main.ts')
      expect(ticketState.interview).toContain('artifact: interview')
      expect(options.ticketId).toBe(ticket.id)
      expect(options.ticketExternalId).toBe(ticket.externalId)

      const fullAnswersContent = [
        'schema_version: 1',
        `ticket_id: ${ticket.externalId}`,
        'artifact: interview',
        'status: draft',
        'generated_by:',
        '  winner_model: openai/gpt-5-mini',
        '  generated_at: 2026-03-23T09:10:00.000Z',
        '  canonicalization: server_normalized',
        'questions:',
        '  - id: Q01',
        '    phase: Foundation',
        '    prompt: Which workflow guardrails are mandatory?',
        '    source: compiled',
        '    follow_up_round: null',
        '    answer_type: free_text',
        '    options: []',
        '    answer:',
        '      skipped: false',
        '      selected_option_ids: []',
        '      free_text: Preserve council retry behavior and strict validation.',
        '      answered_by: ai_skip',
        '      answered_at: 2026-03-23T09:11:00.000Z',
        'follow_up_rounds: []',
        'summary:',
        '  goals: [Harden DRAFTING_PRD]',
        '  constraints: [Preserve council mechanics]',
        '  non_goals: [Touch PRD approval]',
        '  final_free_form_answer: ""',
        'approval:',
        '  approved_by: ""',
        '  approved_at: ""',
      ].join('\n')

      const content = [
        'schema_version: 1',
        `ticket_id: ${ticket.externalId}`,
        'artifact: prd',
        'status: draft',
        'source_interview:',
        '  content_sha256: normalized',
        'product:',
        '  problem_statement: Keep PRD drafting resilient.',
        '  target_users: [LoopTroop maintainers]',
        'scope:',
        '  in_scope: [Normalize council PRD drafts]',
        '  out_of_scope: [PRD approval workflow]',
        'technical_requirements:',
        '  architecture_constraints: [Reuse council retry behavior]',
        '  data_model: []',
        '  api_contracts: []',
        '  security_constraints: []',
        '  performance_constraints: []',
        '  reliability_constraints: [Fail fast without canonical interview]',
        '  error_handling_rules: [Persist only normalized YAML]',
        '  tooling_assumptions: [Vitest remains the test runner]',
        'epics:',
        '  - id: EPIC-1',
        '    title: Draft parsing parity',
        '    objective: Match interview council draft rigor.',
        '    implementation_steps: [Normalize PRD drafts before persistence]',
        '    user_stories:',
        '      - id: US-1-1',
        '        title: Repair ids deterministically',
        '        acceptance_criteria: [Missing ids are repaired deterministically]',
        '        implementation_steps: [Fill stable fallback ids]',
        '        verification:',
        '          required_commands: [npm run test:server]',
        '      - id: US-1-2',
        '        title: Preserve parser metadata',
        '        acceptance_criteria: [Structured retry metadata is saved]',
        '        implementation_steps: [Store repair warnings alongside the draft]',
        '        verification:',
        '          required_commands: [npm run test:server]',
        'risks: []',
        'approval:',
        '  approved_by: ""',
        '  approved_at: ""',
      ].join('\n')

      onFullAnswersProgress?.({
        memberId: 'openai/gpt-5-mini',
        status: 'session_created',
        sessionId: 'session-full-answers-mini',
      })
      onFullAnswersProgress?.({
        memberId: 'openai/gpt-5-mini',
        status: 'finished',
        sessionId: 'session-full-answers-mini',
        outcome: 'completed',
        duration: 95,
        content: fullAnswersContent,
        questionCount: 1,
        structuredOutput: {
          repairApplied: true,
          repairWarnings: ['Canonicalized generated_by.winner_model from "wrong-model" to "openai/gpt-5-mini".'],
          autoRetryCount: 0,
        },
      })
      onFullAnswersProgress?.({
        memberId: 'openai/gpt-5.2',
        status: 'finished',
        outcome: 'completed',
        duration: 91,
        content: fullAnswersContent.replace('openai/gpt-5-mini', 'openai/gpt-5.2'),
        questionCount: 1,
        structuredOutput: {
          repairApplied: false,
          repairWarnings: [],
          autoRetryCount: 0,
        },
      })
      onDraftProgress?.({
        memberId: 'openai/gpt-5-mini',
        status: 'session_created',
        sessionId: 'session-prd-mini',
      })
      onDraftProgress?.({
        memberId: 'openai/gpt-5-mini',
        status: 'finished',
        sessionId: 'session-prd-mini',
        outcome: 'completed',
        duration: 125,
        content,
        draftMetrics: {
          epicCount: 1,
          userStoryCount: 2,
        },
        structuredOutput: {
          repairApplied: true,
          repairWarnings: ['Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.'],
          autoRetryCount: 1,
          validationError: 'PRD output is not a YAML/JSON object',
        },
      })
      onDraftProgress?.({
        memberId: 'openai/gpt-5.2',
        status: 'finished',
        outcome: 'completed',
        duration: 118,
        content,
        draftMetrics: {
          epicCount: 1,
          userStoryCount: 2,
        },
        structuredOutput: {
          repairApplied: false,
          repairWarnings: [],
          autoRetryCount: 0,
        },
      })

      return {
        phase: 'prd_draft',
        fullAnswers: [
          {
            memberId: 'openai/gpt-5-mini',
            outcome: 'completed',
            content: fullAnswersContent,
            duration: 95,
            questionCount: 1,
            structuredOutput: {
              repairApplied: true,
              repairWarnings: ['Canonicalized generated_by.winner_model from "wrong-model" to "openai/gpt-5-mini".'],
              autoRetryCount: 0,
            },
          },
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content: fullAnswersContent.replace('openai/gpt-5-mini', 'openai/gpt-5.2'),
            duration: 91,
            questionCount: 1,
            structuredOutput: {
              repairApplied: false,
              repairWarnings: [],
              autoRetryCount: 0,
            },
          },
        ],
        drafts: [
          {
            memberId: 'openai/gpt-5-mini',
            outcome: 'completed',
            content,
            duration: 125,
            draftMetrics: {
              epicCount: 1,
              userStoryCount: 2,
            },
            structuredOutput: {
              repairApplied: true,
              repairWarnings: ['Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.'],
              autoRetryCount: 1,
              validationError: 'PRD output is not a YAML/JSON object',
            },
          },
          {
            memberId: 'openai/gpt-5.2',
            outcome: 'completed',
            content,
            duration: 118,
            draftMetrics: {
              epicCount: 1,
              userStoryCount: 2,
            },
            structuredOutput: {
              repairApplied: false,
              repairWarnings: [],
              autoRetryCount: 0,
            },
          },
        ],
        memberOutcomes: {
          'openai/gpt-5-mini': 'completed',
          'openai/gpt-5.2': 'completed',
        },
        fullAnswerOutcomes: {
          'openai/gpt-5-mini': 'completed',
          'openai/gpt-5.2': 'completed',
        },
        deadlineReached: false,
      }
    })

    await handlePrdDraft(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'DRAFTS_READY' })
    const fullAnswersRow = getLatestPhaseArtifact(ticket.id, 'prd_full_answers', 'DRAFTING_PRD')
    const artifactRow = getLatestPhaseArtifact(ticket.id, 'prd_drafts', 'DRAFTING_PRD')
    expect(fullAnswersRow).toBeDefined()
    expect(artifactRow).toBeDefined()
    const fullAnswersArtifact = JSON.parse(fullAnswersRow!.content) as {
      drafts?: Array<{
        content?: string
        questionCount?: number
      }>
    }
    const artifact = JSON.parse(artifactRow!.content) as {
      drafts?: Array<{
        content?: string
        draftMetrics?: { epicCount?: number; userStoryCount?: number }
        structuredOutput?: { repairApplied?: boolean; repairWarnings?: string[]; autoRetryCount?: number; validationError?: string }
      }>
    }

    expect(fullAnswersArtifact.drafts?.[0]?.content).toContain('answered_by: ai_skip')
    expect(fullAnswersArtifact.drafts?.[0]?.questionCount).toBe(1)
    expect(artifact.drafts?.[0]?.draftMetrics).toEqual({
      epicCount: 1,
      userStoryCount: 2,
    })
    expect(artifact.drafts?.[0]?.structuredOutput).toEqual({
      repairApplied: true,
      repairWarnings: ['Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.'],
      autoRetryCount: 1,
      validationError: 'PRD output is not a YAML/JSON object',
    })
    expect(existsSync(paths.executionLogPath)).toBe(true)
    const executionLog = readFileSync(paths.executionLogPath, 'utf-8')
    expect(executionLog).toContain('PRD draft session created for openai/gpt-5-mini: session-prd-mini.')
    expect(executionLog).toContain('produced Full Answers (1 answered questions).')
    expect(executionLog).toContain('drafted PRD (1 epics · 2 user stories).')
    expect(executionLog).toContain('PRD draft normalization applied repairs')
    expect(executionLog).toContain('PRD draft required 1 structured retry attempt(s)')
  })
})
