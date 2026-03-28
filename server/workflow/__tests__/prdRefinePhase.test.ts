import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import jsYaml from 'js-yaml'
import type { InterviewDocument } from '@shared/interviewArtifact'
import { parseUiArtifactCompanionArtifact } from '@shared/artifactCompanions'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import { buildInterviewDocumentYaml } from '../../structuredOutput'
import type { TicketContext as MachineTicketContext } from '../../machines/types'
import {
  buildPrdRefinedArtifact,
  parsePrdRefinedArtifact,
  validatePrdRefinementOutput,
} from '../../phases/prd/refined'
import { phaseIntermediate, phaseResults } from '../phases/state'

const {
  refineDraftMock,
  runOpenCodePromptMock,
  runOpenCodeSessionPromptMock,
} = vi.hoisted(() => ({
  refineDraftMock: vi.fn(),
  runOpenCodePromptMock: vi.fn(),
  runOpenCodeSessionPromptMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../../council/refiner', () => ({
  refineDraft: refineDraftMock,
}))

vi.mock('../runOpenCodePrompt', () => ({
  runOpenCodePrompt: runOpenCodePromptMock,
  runOpenCodeSessionPrompt: runOpenCodeSessionPromptMock,
}))

import { handlePrdRefine } from '../phases/prdPhase'
import { handleCoverageVerification } from '../phases/verificationPhase'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-prd-refine-',
  files: {
    'README.md': '# PRD Refine Phase Test\n',
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
      winner_model: 'openai/gpt-5.2',
      generated_at: '2026-03-26T10:00:00.000Z',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'Which prompt hardening rules are required?',
        source: 'compiled',
        follow_up_round: null,
        answer_type: 'free_text',
        options: [],
        answer: {
          skipped: false,
          selected_option_ids: [],
          free_text: 'Require strict output validation and exact retry handling.',
          answered_by: 'user',
          answered_at: '2026-03-26T10:01:00.000Z',
        },
      },
    ],
    follow_up_rounds: [],
    summary: {
      goals: ['Harden REFINING_PRD'],
      constraints: ['Preserve winner-only refinement'],
      non_goals: ['Change execution'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: 'user',
      approved_at: '2026-03-26T10:02:00.000Z',
    },
  }

  return buildInterviewDocumentYaml(document)
}

function buildPrdContent(
  ticketId: string,
  options: {
    epicTitle?: string
    storyOneTitle?: string
    includeStoryTwo?: boolean
    includeStoryThree?: boolean
    changes?: unknown[]
  } = {},
): string {
  const document: Record<string, unknown> = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'stale-hash',
    },
    product: {
      problem_statement: 'Keep PRD refinement strict and restart-safe.',
      target_users: ['LoopTroop maintainers'],
    },
    scope: {
      in_scope: ['PRD refinement validation', 'artifact parsing'],
      out_of_scope: ['Execution pipeline changes'],
    },
    technical_requirements: {
      architecture_constraints: ['Preserve the winner-only refinement flow.'],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: ['Validated artifacts must survive restarts.'],
      error_handling_rules: ['Retry once on structured-output failures.'],
      tooling_assumptions: [],
    },
    epics: [
      {
        id: 'EPIC-1',
        title: options.epicTitle ?? 'Prompt hardening',
        objective: 'Make PRD refinement exact and auditable.',
        implementation_steps: ['Compare the winner draft against the final refined PRD.'],
        user_stories: [
          {
            id: 'US-1',
            title: options.storyOneTitle ?? 'Validate PRD refinement',
            acceptance_criteria: ['Every winner-to-final diff is represented exactly once.'],
            implementation_steps: ['Validate change coverage before persisting the artifact.'],
            verification: {
              required_commands: ['npm run test'],
            },
          },
          ...(options.includeStoryTwo === false
            ? []
            : [{
                id: 'US-2',
                title: 'Record change attribution',
                acceptance_criteria: ['Every adopted improvement records its source.'],
                implementation_steps: ['Persist attribution status alongside each change.'],
                verification: {
                  required_commands: ['npm run test'],
                },
              }]),
          ...(options.includeStoryThree
            ? [{
                id: 'US-3',
                title: 'Surface retry metadata',
                acceptance_criteria: ['Structured retry metadata is preserved for review.'],
                implementation_steps: ['Expose retry metadata in the final artifact.'],
                verification: {
                  required_commands: ['npm run test'],
                },
              }]
            : []),
        ],
      },
    ],
    risks: ['Loose parsing could hide real refinement mistakes.'],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  if (options.changes !== undefined) {
    document.changes = options.changes
  }

  return jsYaml.dump(document, { lineWidth: 120, noRefs: true }) as string
}

function buildValidRefinementOutput(ticketId: string, options: { omitStoryItemType?: boolean } = {}): string {
  return buildPrdContent(ticketId, {
    epicTitle: 'Prompt hardening and refinement safety',
    storyOneTitle: 'Validate PRD refinement exactly',
    includeStoryTwo: false,
    includeStoryThree: true,
    changes: [
      {
        type: 'modified',
        item_type: 'epic',
        before: { id: 'EPIC-1', title: 'Prompt hardening' },
        after: { id: 'EPIC-1', title: 'Prompt hardening and refinement safety' },
        inspiration: null,
      },
      {
        type: 'modified',
        ...(options.omitStoryItemType ? {} : { item_type: 'user_story' }),
        before: { id: 'US-1', title: 'Validate PRD refinement' },
        after: { id: 'US-1', title: 'Validate PRD refinement exactly' },
        inspiration: null,
      },
      {
        type: 'removed',
        item_type: 'user_story',
        before: { id: 'US-2', title: 'Record change attribution' },
        after: null,
        inspiration: null,
      },
      {
        type: 'added',
        item_type: 'user_story',
        before: null,
        after: { id: 'US-3', title: 'Surface retry metadata' },
        inspiration: {
          alternative_draft: 1,
          item: { id: 'US-8', title: 'Expose retry telemetry' },
        },
      },
    ],
  })
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
    lockedCouncilMembers: ['openai/gpt-5.2', 'openai/gpt-5-mini'],
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
    title: 'Harden PRD refinement',
    description: 'Make REFINING_PRD strict, typed, and restart-safe.',
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

describe('handlePrdRefine', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    phaseIntermediate.clear()
    phaseResults.clear()
    refineDraftMock.mockReset()
    runOpenCodePromptMock.mockReset()
    runOpenCodeSessionPromptMock.mockReset()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('persists a typed prd_refined artifact and captures retry/repair metadata', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const validOutput = buildValidRefinementOutput(ticket.externalId, { omitStoryItemType: true })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')

    phaseIntermediate.set(`${ticket.id}:prd`, {
      phase: 'prd',
      worktreePath: paths.worktreePath,
      winnerId,
      drafts: [
        { memberId: winnerId, outcome: 'completed', content: winnerDraftContent, duration: 1 },
        { memberId: 'openai/gpt-5-mini', outcome: 'completed', content: buildPrdContent(ticket.externalId, { includeStoryThree: true }), duration: 1 },
      ],
      fullAnswers: [
        { memberId: winnerId, outcome: 'completed', content: interviewContent, duration: 1, questionCount: 1 },
        { memberId: 'openai/gpt-5-mini', outcome: 'completed', content: interviewContent, duration: 1, questionCount: 1 },
      ],
      memberOutcomes: {
        [winnerId]: 'completed',
        'openai/gpt-5-mini': 'completed',
      },
      ticketState: {
        ticketId: ticket.externalId,
        title: context.title,
        description: ticket.description ?? '',
        relevantFiles: 'file_count: 1\nfiles:\n  - path: src/main.ts\n',
      },
    })

    refineDraftMock.mockImplementationOnce(async (
      _adapter: unknown,
      _winnerDraft: unknown,
      _losingDrafts: unknown,
      _contextParts: unknown,
      _projectPath: unknown,
      _timeoutMs: unknown,
      _signal: unknown,
      _onOpenCodeSessionLog: unknown,
      _onOpenCodeStreamEvent: unknown,
      _onOpenCodePromptDispatched: unknown,
      _sessionOwnership: unknown,
      _buildPrompt: unknown,
      validateResponse?: (content: string) => { normalizedContent?: string },
      _schemaReminder?: string,
      buildRetryPrompt?: (params: {
        baseParts: Array<{ type: 'text'; content: string }>
        validationError: string
        rawResponse: string
      }) => Array<{ type: 'text'; content: string }>,
    ) => {
      const invalidOutput = validOutput.replace(/\nchanges:[\s\S]*$/, '')
      expect(validateResponse?.(invalidOutput)?.normalizedContent).toContain('artifact: prd')

      const retryPrompt = buildRetryPrompt?.({
        baseParts: [{ type: 'text', content: 'original prompt' }],
        validationError: 'unexpected wrapper',
        rawResponse: invalidOutput,
      }) ?? []
      const retryPromptText = retryPrompt.map((part) => part.content).join('\n')
      expect(retryPromptText).toContain('PRD Refinement Structured Output Retry')
      expect(retryPromptText).toContain('Do not use tools.')
      expect(retryPromptText).not.toContain('\nchanges:')

      return validateResponse?.(validOutput).normalizedContent ?? validOutput
    })

    await handlePrdRefine(ticket.id, context, sendEvent, new AbortController().signal)

    const refinedArtifact = getLatestPhaseArtifact(ticket.id, 'prd_refined', 'REFINING_PRD')
    expect(refinedArtifact).toBeDefined()
    expect(JSON.parse(refinedArtifact!.content)).toEqual({
      refinedContent: expect.any(String),
    })
    const parsed = parsePrdRefinedArtifact(refinedArtifact!.content)
    expect(parsed.draftMetrics).toEqual({ epicCount: 1, userStoryCount: 2 })
    expect(parsed.changes).toEqual([])
    expect(parsed.winnerDraftContent).toBe('')
    expect(parsed.structuredOutput).toBeUndefined()

    const refinedCompanionArtifact = getLatestPhaseArtifact(ticket.id, 'ui_artifact_companion:prd_refined', 'REFINING_PRD')
    expect(refinedCompanionArtifact).toBeDefined()
    const refinedCompanion = parseUiArtifactCompanionArtifact(refinedCompanionArtifact!.content)?.payload as {
      winnerDraftContent?: string
      draftMetrics?: { epicCount?: number; userStoryCount?: number }
      structuredOutput?: {
        autoRetryCount?: number
        repairApplied?: boolean
        repairWarnings?: string[]
        validationError?: string
      }
    } | undefined
    expect(refinedCompanion).toBeDefined()
    expect(refinedCompanion?.draftMetrics).toEqual({ epicCount: 1, userStoryCount: 2 })
    expect(refinedCompanion?.winnerDraftContent).toContain('title: Prompt hardening')
    expect(refinedCompanion?.structuredOutput).toMatchObject({
      autoRetryCount: 0,
      repairApplied: true,
    })
    expect(refinedCompanion?.structuredOutput?.validationError).toBeUndefined()
    expect(refinedCompanion?.structuredOutput?.repairWarnings?.join('\n')).toContain('Inferred missing PRD refinement item_type')
    expect(getLatestPhaseArtifact(ticket.id, 'ui_refinement_diff:prd', 'REFINING_PRD')).toBeDefined()

    expect(readFileSync(`${paths.ticketDir}/prd.yaml`, 'utf-8').trim()).toBe(parsed.refinedContent.trim())
    expect(getLatestPhaseArtifact(ticket.id, 'prd_winner', 'REFINING_PRD')).toBeDefined()
    expect(phaseIntermediate.get(`${ticket.id}:prd`)).toBeUndefined()
    expect(sendEvent).toHaveBeenCalledWith({ type: 'REFINED' })
  })

  it('uses prd_winner + prd_refined artifacts during PRD coverage verification', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticket.externalId), {
      ticketId: ticket.externalId,
      interviewContent,
      winnerDraftContent,
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')
    writeFileSync(`${paths.ticketDir}/prd.yaml`, refinement.refinedContent, 'utf-8')

    insertPhaseArtifact(ticket.id, {
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          { memberId: winnerId, outcome: 'completed', content: interviewContent },
        ],
      }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_winner',
      content: JSON.stringify({ winnerId }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify(buildPrdRefinedArtifact(
        winnerId,
        refinement.winnerDraftContent,
        refinement,
        {
          repairApplied: refinement.repairApplied,
          repairWarnings: refinement.repairWarnings,
          autoRetryCount: 0,
        },
      )),
    })

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'coverage-session-1', projectPath: paths.worktreePath },
      response: [
        'status: clean',
        'gaps: []',
        'follow_up_questions: []',
      ].join('\n'),
      messages: [],
    })

    await handleCoverageVerification(ticket.id, context, sendEvent, 'prd', new AbortController().signal)

    const coverageInput = getLatestPhaseArtifact(ticket.id, 'ui_artifact_companion:prd_coverage_input', 'VERIFYING_PRD_COVERAGE')
    expect(coverageInput).toBeDefined()
    const parsedCoverageInput = parseUiArtifactCompanionArtifact(coverageInput!.content)?.payload as {
      prd?: string
      refinedContent?: string
      changes?: unknown[]
    } | undefined
    if (!parsedCoverageInput) throw new Error('Expected PRD coverage-input companion payload')
    expect(parsedCoverageInput.prd?.trim()).toBe(refinement.refinedContent.trim())
    expect(parsedCoverageInput.refinedContent?.trim()).toBe(refinement.refinedContent.trim())
    expect(parsedCoverageInput.changes).toBeUndefined()
    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(1)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'COVERAGE_CLEAN' })
  })

  it('restores a missing prd.yaml from the refined PRD artifact before PRD coverage runs', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticket.externalId), {
      ticketId: ticket.externalId,
      interviewContent,
      winnerDraftContent,
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')

    insertPhaseArtifact(ticket.id, {
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          { memberId: winnerId, outcome: 'completed', content: interviewContent },
        ],
      }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_winner',
      content: JSON.stringify({ winnerId }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify(buildPrdRefinedArtifact(
        winnerId,
        refinement.winnerDraftContent,
        refinement,
        {
          repairApplied: refinement.repairApplied,
          repairWarnings: refinement.repairWarnings,
          autoRetryCount: 0,
        },
      )),
    })

    runOpenCodePromptMock.mockImplementationOnce(async ({ parts }: { parts: Array<{ content: string }> }) => {
      const promptText = parts.map((part) => part.content).join('\n')
      expect(promptText).toContain('Prompt hardening and refinement safety')
      expect(promptText).toContain('Validate PRD refinement exactly')
      return {
        session: { id: 'coverage-session-1', projectPath: paths.worktreePath },
        response: [
          'status: clean',
          'gaps: []',
          'follow_up_questions: []',
        ].join('\n'),
        messages: [],
      }
    })

    await handleCoverageVerification(ticket.id, context, sendEvent, 'prd', new AbortController().signal)

    const coverageInput = getLatestPhaseArtifact(ticket.id, 'ui_artifact_companion:prd_coverage_input', 'VERIFYING_PRD_COVERAGE')
    expect(coverageInput).toBeDefined()
    const parsedCoverageInput = parseUiArtifactCompanionArtifact(coverageInput!.content)?.payload as {
      prd?: string
      refinedContent?: string
    } | undefined
    if (!parsedCoverageInput) throw new Error('Expected PRD coverage-input companion payload')
    expect(parsedCoverageInput.prd?.trim()).toBe(refinement.refinedContent.trim())
    expect(parsedCoverageInput.refinedContent?.trim()).toBe(refinement.refinedContent.trim())
    expect(existsSync(`${paths.ticketDir}/prd.yaml`)).toBe(true)
    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(1)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'COVERAGE_CLEAN' })
  })

  it('uses the on-disk PRD as the effective PRD coverage input when it differs from the refined artifact', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticket.externalId), {
      ticketId: ticket.externalId,
      interviewContent,
      winnerDraftContent,
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })
    const diskPrdContent = buildPrdContent(ticket.externalId, {
      epicTitle: 'Disk PRD source of truth',
      storyOneTitle: 'Inspect the saved PRD exactly',
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')
    writeFileSync(`${paths.ticketDir}/prd.yaml`, diskPrdContent, 'utf-8')

    insertPhaseArtifact(ticket.id, {
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          { memberId: winnerId, outcome: 'completed', content: interviewContent },
        ],
      }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_winner',
      content: JSON.stringify({ winnerId }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify(buildPrdRefinedArtifact(
        winnerId,
        refinement.winnerDraftContent,
        refinement,
        {
          repairApplied: refinement.repairApplied,
          repairWarnings: refinement.repairWarnings,
          autoRetryCount: 0,
        },
      )),
    })

    runOpenCodePromptMock.mockImplementationOnce(async ({ parts }: { parts: Array<{ content: string }> }) => {
      const promptText = parts.map((part) => part.content).join('\n')
      expect(promptText).toContain('Disk PRD source of truth')
      expect(promptText).toContain('Inspect the saved PRD exactly')
      expect(promptText).not.toContain('Prompt hardening and refinement safety')

      return {
        session: { id: 'coverage-session-1', projectPath: paths.worktreePath },
        response: [
          'status: clean',
          'gaps: []',
          'follow_up_questions: []',
        ].join('\n'),
        messages: [],
      }
    })

    await handleCoverageVerification(ticket.id, context, sendEvent, 'prd', new AbortController().signal)

    const coverageInput = getLatestPhaseArtifact(ticket.id, 'ui_artifact_companion:prd_coverage_input', 'VERIFYING_PRD_COVERAGE')
    expect(coverageInput).toBeDefined()
    const parsedCoverageInput = parseUiArtifactCompanionArtifact(coverageInput!.content)?.payload as {
      prd?: string
      refinedContent?: string
    } | undefined
    if (!parsedCoverageInput) throw new Error('Expected PRD coverage-input companion payload')
    expect(parsedCoverageInput.prd?.trim()).toBe(diskPrdContent.trim())
    expect(parsedCoverageInput.refinedContent?.trim()).toBe(diskPrdContent.trim())
    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(1)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'COVERAGE_CLEAN' })
  })

  it('retries PRD coverage once when the first semantic result contradicts itself', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticket.externalId), {
      ticketId: ticket.externalId,
      interviewContent,
      winnerDraftContent,
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')
    writeFileSync(`${paths.ticketDir}/prd.yaml`, refinement.refinedContent, 'utf-8')

    insertPhaseArtifact(ticket.id, {
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          { memberId: winnerId, outcome: 'completed', content: interviewContent },
        ],
      }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_winner',
      content: JSON.stringify({ winnerId }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify(buildPrdRefinedArtifact(
        winnerId,
        refinement.winnerDraftContent,
        refinement,
        {
          repairApplied: refinement.repairApplied,
          repairWarnings: refinement.repairWarnings,
          autoRetryCount: 0,
        },
      )),
    })

    runOpenCodePromptMock
      .mockResolvedValueOnce({
        session: { id: 'coverage-session-1', projectPath: paths.worktreePath },
        response: [
          'status: clean',
          'gaps:',
          '  - "Missing acceptance criteria."',
          'follow_up_questions: []',
        ].join('\n'),
        messages: [],
      })
      .mockResolvedValueOnce({
        session: { id: 'coverage-session-2', projectPath: paths.worktreePath },
        response: [
          'status: clean',
          'gaps: []',
          'follow_up_questions: []',
        ].join('\n'),
        messages: [],
      })

    await handleCoverageVerification(ticket.id, context, sendEvent, 'prd', new AbortController().signal)

    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(2)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'COVERAGE_CLEAN' })
  })

  it('routes final PRD coverage gaps to approval instead of Beads when the retry cap is reached', async () => {
    const { ticket, paths } = createInitializedTicket()
    const sendEvent = vi.fn()
    const winnerId = 'openai/gpt-5.2'
    const interviewContent = buildInterviewYaml(ticket.externalId)
    const winnerDraftContent = buildPrdContent(ticket.externalId)
    const refinement = validatePrdRefinementOutput(buildValidRefinementOutput(ticket.externalId), {
      ticketId: ticket.externalId,
      interviewContent,
      winnerDraftContent,
      losingDraftMeta: [{ memberId: 'openai/gpt-5-mini' }],
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, interviewContent, 'utf-8')
    writeFileSync(`${paths.ticketDir}/prd.yaml`, refinement.refinedContent, 'utf-8')

    insertPhaseArtifact(ticket.id, {
      phase: 'DRAFTING_PRD',
      artifactType: 'prd_full_answers',
      content: JSON.stringify({
        drafts: [
          { memberId: winnerId, outcome: 'completed', content: interviewContent },
        ],
      }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_winner',
      content: JSON.stringify({ winnerId }),
    })
    insertPhaseArtifact(ticket.id, {
      phase: 'REFINING_PRD',
      artifactType: 'prd_refined',
      content: JSON.stringify(buildPrdRefinedArtifact(
        winnerId,
        refinement.winnerDraftContent,
        refinement,
        {
          repairApplied: refinement.repairApplied,
          repairWarnings: refinement.repairWarnings,
          autoRetryCount: 0,
        },
      )),
    })

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'coverage-session-1', projectPath: paths.worktreePath },
      response: [
        'status: gaps',
        'gaps:',
        '  - "Missing out-of-scope guidance."',
        'follow_up_questions: []',
      ].join('\n'),
      messages: [],
    })

    await handleCoverageVerification(
      ticket.id,
      buildTicketContext(ticket, { lockedMaxCoveragePasses: 1 }),
      sendEvent,
      'prd',
      new AbortController().signal,
    )

    expect(sendEvent).toHaveBeenCalledWith({ type: 'COVERAGE_LIMIT_REACHED' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'GAPS_FOUND' })
    expect(sendEvent).not.toHaveBeenCalledWith({ type: 'COVERAGE_CLEAN' })
  })
})
