import type { TicketContext, TicketEvent } from '../../machines/types'
import type { DraftResult, MemberOutcome, Vote } from '../../council/types'
import { CancelledError } from '../../council/types'
import { conductVoting, selectWinner } from '../../council/voter'
import { refineDraft } from '../../council/refiner'
import { checkMemberResponseQuorum, checkQuorum } from '../../council/quorum'
import { draftPRD, buildPrdContextBuilder } from '../../phases/prd/draft'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { getTicketPaths, insertPhaseArtifact } from '../../storage/tickets'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import jsYaml from 'js-yaml'
import { normalizeInterviewDocumentOutput } from '../../structuredOutput'
import { PROM12 } from '../../prompts/index'
import { validatePrdDraft } from '../../phases/prd/validation'

import { adapter, phaseIntermediate } from './state'
import {
  emitPhaseLog,
  emitAiDetail,
  emitOpenCodeSessionLogs,
  emitOpenCodeStreamEvent,
  emitOpenCodePromptLog,
  emitDraftProgressInfoLog,
  createOpenCodeStreamState,
  resolveCouncilRuntimeSettings,
  resolveCouncilMembers,
  loadTicketDirContext,
  formatCouncilResolutionLog,
  formatDraftRoundSummary,
  summarizeDraftOutcomes,
  createPendingDrafts,
  upsertCouncilDraftArtifact,
  upsertCouncilVoteArtifact,
  emitCouncilDecisionLogs,
  buildStructuredMetadata,
  mapCouncilStageToStatus,
} from './helpers'
import type { OpenCodeStreamState } from './types'

function requireCanonicalInterviewForPrdDraft(ticketDir: string, ticketExternalId: string): string {
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  if (!existsSync(interviewPath)) {
    throw new Error(`Canonical interview artifact is required before PRD drafting: ${interviewPath}`)
  }

  const interview = readFileSync(interviewPath, 'utf-8')
  const validation = normalizeInterviewDocumentOutput(interview, { ticketId: ticketExternalId })
  if (!validation.ok) {
    throw new Error(`Canonical interview artifact is invalid for PRD drafting: ${validation.error}`)
  }

  return interview
}

function formatPrdDraftMetrics(draft: {
  content?: string
  draftMetrics?: {
    epicCount?: number
    userStoryCount?: number
  }
}): string {
  const epicCount = draft.draftMetrics?.epicCount
  const userStoryCount = draft.draftMetrics?.userStoryCount

  if (typeof epicCount === 'number' || typeof userStoryCount === 'number') {
    return [
      `${epicCount ?? 0} epics`,
      `${userStoryCount ?? 0} user stories`,
    ].join(' · ')
  }

  const lineCount = draft.content?.split('\n').filter((line) => line.trim()).length ?? 0
  return lineCount > 0 ? `${lineCount} lines` : 'empty draft'
}

function formatFullAnswersMetrics(draft: DraftResult): string {
  if (typeof draft.questionCount === 'number' && draft.questionCount > 0) {
    return `${draft.questionCount} answered questions`
  }

  const lineCount = draft.content?.split('\n').filter((line) => line.trim()).length ?? 0
  return lineCount > 0 ? `${lineCount} lines` : 'empty artifact'
}

function findWinnerFullAnswers(fullAnswers: DraftResult[], winnerId: string): DraftResult | undefined {
  return fullAnswers.find((draft) => draft.memberId === winnerId && draft.outcome === 'completed' && draft.content)
}

export async function handlePrdDraft(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, relevantFiles } = loadTicketDirContext(context)
  const phase = 'DRAFTING_PRD' as const
  const council = resolveCouncilMembers(context)
  const members = council.members

  const interview = requireCanonicalInterviewForPrdDraft(ticketDir, context.externalId)

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    relevantFiles,
    interview,
  }
  const ticketContext = buildMinimalContext('prd_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    formatCouncilResolutionLog(context, council))
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Loaded canonical interview artifact (${interview.length} chars).`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD council drafting started. Context: ${ticketContext.length} parts, interview=loaded.`)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD draft settings: council_response_timeout=${councilSettings.draftTimeoutMs}ms, min_council_quorum=${councilSettings.minQuorum}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching PRD draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveFullAnswers = createPendingDrafts(members)
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'prd_full_answers', liveFullAnswers)
  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
  const result = await draftPRD(
    adapter,
    members,
    ticketState,
    worktreePath,
    {
      ...councilSettings,
      ticketId,
      ticketExternalId: context.externalId,
    },
    signal,
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('prd', entry.stage)
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      const fullAnswersIndex = liveFullAnswers.findIndex((draft) => draft.memberId === entry.memberId)
      if (fullAnswersIndex < 0 || !entry.outcome) return
      liveFullAnswers[fullAnswersIndex] = {
        ...liveFullAnswers[fullAnswersIndex]!,
        content: entry.content ?? liveFullAnswers[fullAnswersIndex]!.content,
        outcome: entry.outcome,
        duration: entry.duration ?? liveFullAnswers[fullAnswersIndex]!.duration,
        error: entry.error,
        questionCount: entry.questionCount,
        structuredOutput: entry.structuredOutput,
      }
      if (entry.structuredOutput?.repairWarnings.length) {
        emitPhaseLog(
          ticketId,
          context.externalId,
          phase,
          'info',
          `${entry.memberId} Full Answers normalization applied repairs: ${entry.structuredOutput.repairWarnings.join(' ')}`,
        )
      }
      if (entry.structuredOutput?.validationError && entry.structuredOutput.autoRetryCount > 0) {
        emitPhaseLog(
          ticketId,
          context.externalId,
          phase,
          'info',
          `${entry.memberId} Full Answers required ${entry.structuredOutput.autoRetryCount} structured retry attempt(s): ${entry.structuredOutput.validationError}`,
        )
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'prd_full_answers', liveFullAnswers)
    },
    (entry) => {
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'PRD', entry)
      if (entry.status !== 'finished' || !entry.outcome) return
      const draftIndex = liveDrafts.findIndex(draft => draft.memberId === entry.memberId)
      if (draftIndex < 0) return
      liveDrafts[draftIndex] = {
        ...liveDrafts[draftIndex]!,
        content: entry.content ?? liveDrafts[draftIndex]!.content,
        outcome: entry.outcome,
        duration: entry.duration ?? liveDrafts[draftIndex]!.duration,
        error: entry.error,
        questionCount: entry.questionCount,
        draftMetrics: entry.draftMetrics,
        structuredOutput: entry.structuredOutput,
      }
      if (entry.structuredOutput?.repairWarnings.length) {
        emitPhaseLog(
          ticketId,
          context.externalId,
          phase,
          'info',
          `${entry.memberId} PRD draft normalization applied repairs: ${entry.structuredOutput.repairWarnings.join(' ')}`,
        )
      }
      if (entry.structuredOutput?.validationError && entry.structuredOutput.autoRetryCount > 0) {
        emitPhaseLog(
          ticketId,
          context.externalId,
          phase,
          'info',
          `${entry.memberId} PRD draft required ${entry.structuredOutput.autoRetryCount} structured retry attempt(s): ${entry.structuredOutput.validationError}`,
        )
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
    },
    (entry) => {
      const stepLabel = entry.step === 'full_answers' ? 'Full Answers' : 'PRD draft'
      if (entry.status === 'started') {
        emitPhaseLog(ticketId, context.externalId, phase, 'info', `${entry.memberId} ${stepLabel} started.`)
        return
      }
      if (entry.status === 'skipped') {
        emitPhaseLog(ticketId, context.externalId, phase, 'info', `${entry.memberId} ${stepLabel} skipped; reusing the approved interview artifact.`)
        return
      }
      if (entry.status === 'completed') {
        emitPhaseLog(ticketId, context.externalId, phase, 'info', `${entry.memberId} ${stepLabel} completed.`)
        return
      }
      emitPhaseLog(
        ticketId,
        context.externalId,
        phase,
        entry.outcome === 'failed' ? 'error' : 'info',
        `${entry.memberId} ${stepLabel} ${entry.outcome === 'timed_out' ? 'timed out' : 'failed'}${entry.error ? `: ${entry.error}` : '.'}`,
      )
    },
  )

  const fullAnswersSummary = summarizeDraftOutcomes(result.fullAnswers)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'Full Answers round',
      Date.now() - startedAt,
      councilSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      fullAnswersSummary,
    ),
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'PRD draft round',
      Date.now() - startedAt,
      councilSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      draftSummary,
    ),
  )
  const quorum = checkQuorum(result.drafts, councilSettings.minQuorum)
  const nextStatus = quorum.passed ? 'COUNCIL_VOTING_PRD' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    phase,
    councilSettings.draftTimeoutMs,
    Boolean(result.deadlineReached),
    result.memberOutcomes,
    quorum,
    nextStatus,
  )

  for (const draft of result.drafts) {
    const detail = draft.outcome === 'timed_out'
      ? 'timed out'
      : draft.outcome === 'invalid_output'
        ? 'invalid output'
        : draft.outcome === 'failed'
          ? 'failed'
          : `drafted PRD (${formatPrdDraftMetrics(draft)})`
    emitAiDetail(ticketId, context.externalId, 'DRAFTING_PRD', 'model_output',
      `${draft.memberId} ${detail}.`,
      {
        entryId: `prd-draft-summary:${draft.memberId}`,
        audience: 'ai',
        kind: draft.outcome === 'completed' ? 'text' : 'error',
        op: 'append',
        source: `model:${draft.memberId}`,
        modelId: draft.memberId,
        streaming: false,
        outcome: draft.outcome,
        duration: draft.duration,
      })
  }

  for (const fullAnswers of result.fullAnswers) {
    const detail = fullAnswers.outcome === 'timed_out'
      ? 'timed out'
      : fullAnswers.outcome === 'invalid_output'
        ? 'invalid output'
        : fullAnswers.outcome === 'failed'
          ? 'failed'
          : `produced Full Answers (${formatFullAnswersMetrics(fullAnswers)})`
    emitAiDetail(ticketId, context.externalId, 'DRAFTING_PRD', 'model_output',
      `${fullAnswers.memberId} ${detail}.`,
      {
        entryId: `prd-full-answers-summary:${fullAnswers.memberId}`,
        audience: 'ai',
        kind: fullAnswers.outcome === 'completed' ? 'text' : 'error',
        op: 'append',
        source: `model:${fullAnswers.memberId}`,
        modelId: fullAnswers.memberId,
        streaming: false,
        outcome: fullAnswers.outcome,
        duration: fullAnswers.duration,
      })
  }

  upsertCouncilDraftArtifact(ticketId, phase, 'prd_full_answers', result.fullAnswers, result.fullAnswerOutcomes, true)
  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved PRD drafting artifacts with ${Object.keys(result.memberOutcomes).length} PRD outcomes and ${Object.keys(result.fullAnswerOutcomes).length} Full Answers outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for prd_draft: ${quorum.message}`)
  }

  const nextTicketState: TicketState = {
    ...ticketState,
    fullAnswers: result.fullAnswers
      .filter((draft) => draft.outcome === 'completed' && draft.content)
      .map((draft) => draft.content),
  }

  phaseIntermediate.set(`${ticketId}:prd`, {
    drafts: result.drafts,
    fullAnswers: result.fullAnswers,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildPrdContextBuilder(nextTicketState),
    worktreePath,
    phase: result.phase,
    ticketState: nextTicketState,
  })

  sendEvent({ type: 'DRAFTS_READY' })
}

export async function handlePrdVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:prd`)
  if (!intermediate) {
    throw new Error('No PRD drafts found — cannot vote')
  }

  const { members } = resolveCouncilMembers(context)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No PRD context builder found — cannot vote')
  }
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveVotes: Vote[] = []
  const liveVoterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'pending'
    return acc
  }, {})

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_PRD', 'prd_votes', intermediate.drafts, [], liveVoterOutcomes)

  if (signal.aborted) throw new CancelledError(ticketId)
  const voteRun = await conductVoting(
    adapter,
    members,
    intermediate.drafts,
    voteContext,
    intermediate.worktreePath,
    intermediate.phase,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_PRD',
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      liveVoterOutcomes[entry.memberId] = entry.outcome
      if (entry.votes.length > 0) liveVotes.push(...entry.votes)
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_PRD', 'prd_votes', intermediate.drafts, liveVotes, liveVoterOutcomes)
    },
    undefined,
    {
      ticketId,
      phase: 'COUNCIL_VOTING_PRD',
    },
  )

  const voteQuorum = checkMemberResponseQuorum(voteRun.memberOutcomes, councilSettings.minQuorum)
  const nextVoteStatus = voteQuorum.passed ? 'REFINING_PRD' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_PRD',
    councilSettings.draftTimeoutMs,
    voteRun.deadlineReached,
    voteRun.memberOutcomes,
    voteQuorum,
    nextVoteStatus,
  )

  if (!voteQuorum.passed) {
    upsertCouncilVoteArtifact(
      ticketId,
      'COUNCIL_VOTING_PRD',
      'prd_votes',
      intermediate.drafts,
      voteRun.votes,
      voteRun.memberOutcomes,
      voteRun.presentationOrders,
      undefined,
      undefined,
      true,
    )
    throw new Error(`PRD voting quorum not met: ${voteQuorum.message}`)
  }

  if (voteRun.votes.length === 0) {
    throw new Error('PRD voting failed: no valid vote responses received')
  }

  const { winnerId, totalScore } = selectWinner(voteRun.votes, members)

  intermediate.votes = voteRun.votes
  intermediate.winnerId = winnerId

  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_PRD',
    'prd_votes',
    intermediate.drafts,
    voteRun.votes,
    voteRun.memberOutcomes,
    voteRun.presentationOrders,
    winnerId,
    totalScore,
    true,
  )
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info',
    `PRD voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
}

export async function handlePrdRefine(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:prd`)
  if (!intermediate || !intermediate.winnerId) {
    throw new Error('No PRD vote results found — cannot refine')
  }

  const winnerDraft = intermediate.drafts.find(d => d.memberId === intermediate.winnerId)!
  const losingDrafts = intermediate.drafts.filter(d => d.memberId !== intermediate.winnerId && d.outcome === 'completed')
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No PRD context builder found — cannot refine')
  }
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const ticketDir = paths.ticketDir
  const winnerFullAnswers = findWinnerFullAnswers(intermediate.fullAnswers ?? [], intermediate.winnerId)
  if (!winnerFullAnswers?.content) {
    throw new Error(`No Full Answers artifact found for PRD winner ${intermediate.winnerId}`)
  }

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `PRD refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    intermediate.worktreePath,
    councilSettings.draftTimeoutMs,
    signal,
    (entry) => {
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    (entry) => {
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        'REFINING_PRD',
        entry.memberId,
        entry.event,
      )
    },
    {
      ticketId,
      phase: 'REFINING_PRD',
    },
    undefined,
    (content) => {
      const result = validatePrdDraft(content, {
        ticketId: context.externalId,
        interviewContent: winnerFullAnswers.content,
      })
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: result.repairApplied,
        repairWarnings: result.repairWarnings,
      })
      return { normalizedContent: result.normalizedContent }
    },
    PROM12.outputFormat,
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:prd`)
  const prdPath = resolve(ticketDir, 'prd.yaml')

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_PRD',
    artifactType: 'prd_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
      structuredOutput: structuredMeta,
    }),
  })

  // Save refined PRD to disk
  safeAtomicWrite(prdPath, refinedContent)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info',
    `Refined PRD from winner ${intermediate.winnerId}. Saved to ${prdPath}.`)

  sendEvent({ type: 'REFINED' })
}

export function buildMockPrdContent(context: TicketContext) {
  return jsYaml.dump({
    schema_version: 1,
    ticket_id: context.externalId,
    artifact: 'prd',
    status: 'draft',
    source_interview: {
      content_sha256: 'mock-interview-sha256',
    },
    product: {
      problem_statement: `Mock PRD for ${context.title}`,
      target_users: ['LoopTroop maintainers'],
    },
    scope: {
      in_scope: [
        'Keep all LoopTroop runtime state inside the project-local .looptroop directory.',
        'Preserve ticket lifecycle metadata and artifacts for restart and inspection.',
      ],
      out_of_scope: [
        'Changes outside the mock workflow path.',
      ],
    },
    technical_requirements: {
      architecture_constraints: [
        'Do not write ticket data into the app checkout.',
        'Keep the workflow deterministic in mock mode for testing.',
      ],
      data_model: [],
      api_contracts: [],
      security_constraints: [],
      performance_constraints: [],
      reliability_constraints: [],
      error_handling_rules: [],
      tooling_assumptions: [],
    },
    epics: [
      {
        id: 'EPIC-1',
        title: 'Persist mock planning artifacts',
        objective: 'Produce a canonical mock PRD artifact that downstream phases can consume.',
        implementation_steps: [
          'Write the refined mock PRD to disk.',
          'Keep the artifact shape aligned with the real PRD schema.',
        ],
        user_stories: [
          {
            id: 'US-1-1',
            title: 'Maintain deterministic mock planning data',
            acceptance_criteria: [
              'The mock PRD matches the canonical PRD schema.',
              'Downstream phases can read the PRD without special-case parsing.',
            ],
            implementation_steps: [
              'Emit canonical YAML fields.',
              'Keep mock-only assumptions explicit inside the artifact.',
            ],
            verification: {
              required_commands: ['npm test'],
            },
          },
        ],
      },
    ],
    risks: [],
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }, { lineWidth: 120, noRefs: true }) as string
}

export async function handleMockPrdDraft(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const interviewPath = resolve(paths.ticketDir, 'interview.yaml')
  const fullAnswersContent = existsSync(interviewPath) ? readFileSync(interviewPath, 'utf-8') : ''
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_PRD',
    artifactType: 'prd_full_answers',
    content: JSON.stringify({
      phase: 'prd_full_answer',
      drafts: [{ memberId: 'mock-model-1', outcome: 'completed', content: fullAnswersContent }],
      memberOutcomes: { 'mock-model-1': 'completed' },
      isFinal: true,
    }),
  })
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_PRD',
    artifactType: 'prd_drafts',
    content: JSON.stringify({
      phase: 'prd_draft',
      drafts: [{ memberId: 'mock-model-1', outcome: 'completed', content: buildMockPrdContent(context) }],
      memberOutcomes: { 'mock-model-1': 'completed' },
      isFinal: true,
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'info', 'Mock PRD drafts ready.')
  sendEvent({ type: 'DRAFTS_READY' })
}

export async function handleMockPrdVote(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_PRD',
    artifactType: 'prd_votes',
    content: JSON.stringify({
      winnerId: 'mock-model-1',
      totalScore: 1,
      presentationOrders: {
        'mock-model-1': {
          seed: 'mock-seed-prd',
          order: ['mock-model-1'],
        },
      },
    }),
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'info', 'Mock PRD winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: 'mock-model-1' })
}

export async function handleMockPrdRefine(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const refinedContent = buildMockPrdContent(context)
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_PRD',
    artifactType: 'prd_refined',
    content: JSON.stringify({ winnerId: 'mock-model-1', refinedContent }),
  })
  safeAtomicWrite(resolve(paths.ticketDir, 'prd.yaml'), refinedContent)
  emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'info', 'Mock PRD written to disk.')
  sendEvent({ type: 'REFINED' })
}
