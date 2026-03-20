import type { TicketContext, TicketEvent } from '../../machines/types'
import type { DraftResult, MemberOutcome, Vote, VotePresentationOrder } from '../../council/types'
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
import { normalizePrdYamlOutput } from '../../structuredOutput'
import { PROM12 } from '../../prompts/index'

import { adapter, phaseIntermediate } from './state'
import {
  emitPhaseLog,
  emitStateChange,
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

  // Load interview results from disk
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  let interview: string | undefined
  if (existsSync(interviewPath)) {
    try { interview = readFileSync(interviewPath, 'utf-8') } catch { /* ignore */ }
  }

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
    interview
      ? `Loaded interview artifact (${interview.length} chars).`
      : 'Interview artifact missing; PRD drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD council drafting started. Context: ${ticketContext.length} parts, interview=${interview ? 'loaded' : 'missing'}.`)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `PRD draft settings: council_response_timeout=${councilSettings.draftTimeoutMs}ms, min_council_quorum=${councilSettings.minQuorum}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching PRD draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
  const result = await draftPRD(
    adapter,
    members,
    ticketContext,
    worktreePath,
    {
      ...councilSettings,
      ticketId,
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
      }
      upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', liveDrafts)
    },
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
          : `drafted PRD (${draft.content.length} chars)`
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

  upsertCouncilDraftArtifact(ticketId, phase, 'prd_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved PRD draft artifact with ${Object.keys(result.memberOutcomes).length} member outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for prd_draft: ${quorum.message}`)
  }

  phaseIntermediate.set(`${ticketId}:prd`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildPrdContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  sendEvent({ type: 'DRAFTS_READY' })

  emitStateChange(ticketId, context.externalId, phase, 'COUNCIL_VOTING_PRD')
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
  emitStateChange(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'REFINING_PRD')
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
  const interviewPath = resolve(ticketDir, 'interview.yaml')
  const interviewContent = existsSync(interviewPath)
    ? (() => {
        try {
          return readFileSync(interviewPath, 'utf-8')
        } catch {
          return undefined
        }
      })()
    : undefined

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
      const result = normalizePrdYamlOutput(content, {
        ticketId: context.externalId,
        interviewContent,
      })
      if (!result.ok) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: result.error,
        })
        throw new Error(result.error)
      }
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

  emitStateChange(ticketId, context.externalId, 'REFINING_PRD', 'VERIFYING_PRD_COVERAGE')
}

export function buildMockPrdContent(context: TicketContext) {
  return jsYaml.dump({
    schema_version: 1,
    artifact: 'prd',
    title: context.title,
    summary: `Mock PRD for ${context.title}`,
    goals: [
      'Keep all LoopTroop runtime state inside the project-local .looptroop directory.',
      'Preserve ticket lifecycle metadata and artifacts for restart and inspection.',
    ],
    constraints: [
      'Do not write ticket data into the app checkout.',
      'Keep the workflow deterministic in mock mode for testing.',
    ],
    acceptance_criteria: [
      'Project-local db.sqlite exists inside the attached repo.',
      'Ticket artifacts and execution log are written under the project-local worktree.',
      'The ticket can progress through the full lifecycle in mock mode.',
    ],
  }, { lineWidth: 120, noRefs: true }) as string
}

export async function handleMockPrdDraft(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_PRD',
    artifactType: 'prd_drafts',
    content: JSON.stringify({ drafts: [{ memberId: 'mock-model-1', outcome: 'completed' }] }),
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
