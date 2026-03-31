import type { TicketContext, TicketEvent } from '../../machines/types'
import type { MemberOutcome, Vote } from '../../council/types'
import { CancelledError } from '../../council/types'
import { conductVoting, selectWinner } from '../../council/voter'
import { refineDraft } from '../../council/refiner'
import { checkMemberResponseQuorum, checkQuorum } from '../../council/quorum'
import { draftBeads, buildBeadsContextBuilder } from '../../phases/beads/draft'
import { expandBeads, hydrateExpandedBeads, validateBeadExpansion } from '../../phases/beads/expand'
import type { Bead, BeadSubset } from '../../phases/beads/types'
import { buildMinimalContext, clearContextCache, type TicketState } from '../../opencode/contextBuilder'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'
import { getTicketPaths, insertPhaseArtifact, patchTicket } from '../../storage/tickets'
import { readJsonl, writeJsonl } from '../../io/jsonl'
import { buildStructuredRetryPrompt, normalizeBeadSubsetYamlOutput, normalizeBeadsJsonlOutput } from '../../structuredOutput'
import { buildPromptFromTemplate, PROM22, PROM23 } from '../../prompts/index'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { RefinementChange } from '@shared/refinementChanges'
import {
  buildBeadsUiRefinementDiffArtifact,
  buildBeadsUiRefinementDiffArtifactFromChanges,
} from '@shared/refinementDiffArtifacts'

import { adapter, phaseIntermediate } from './state'
import {
  emitPhaseLog,
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
import { persistUiRefinementDiffArtifact } from '../refinementDiffArtifacts'
import { persistUiArtifactCompanionArtifact } from '../artifactCompanions'
import { runOpenCodePrompt, type OpenCodePromptDispatchEvent } from '../runOpenCodePrompt'

async function executeBeadsExpandStep(params: {
  ticketId: string
  externalId: string
  worktreePath: string
  winnerId: string
  externalRef: string
  timeoutMs: number
  signal: AbortSignal
  ticketState: TicketState
  beadSubsets: BeadSubset[]
  onSessionLog: (entry: {
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void
  onStreamEvent: (entry: { memberId: string; sessionId: string; event: StreamEvent }) => void
  onPromptDispatched: (entry: { memberId: string; event: OpenCodePromptDispatchEvent }) => void
}): Promise<{
  expandedModelContent: string
  hydratedContent: string
  hydratedBeads: Bead[]
  structuredMeta: ReturnType<typeof buildStructuredMetadata>
}> {
  clearContextCache(params.externalId)
  const baseParts: PromptPart[] = [{ type: 'text', content: buildPromptFromTemplate(PROM23, buildMinimalContext('beads_expand', params.ticketState)) }]
  let promptParts: PromptPart[] = baseParts
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let sessionId = ''
    const result = await runOpenCodePrompt({
      adapter,
      projectPath: params.worktreePath,
      parts: promptParts,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
      model: params.winnerId,
      variant: 'refine',
      sessionOwnership: {
        ticketId: params.ticketId,
        phase: 'REFINING_BEADS',
        phaseAttempt: 1,
        memberId: params.winnerId,
        step: 'expand',
      },
      onSessionCreated: (session) => {
        sessionId = session.id
      },
      onStreamEvent: (event) => {
        if (!sessionId) return
        params.onStreamEvent({
          memberId: params.winnerId,
          sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        params.onPromptDispatched({
          memberId: params.winnerId,
          event,
        })
      },
    })

    const response = result.response
    params.onSessionLog({
      memberId: params.winnerId,
      sessionId: result.session.id,
      response,
      messages: result.messages,
    })

    try {
      const expandedResult = normalizeBeadsJsonlOutput(response)
      if (!expandedResult.ok) {
        throw new Error(expandedResult.error)
      }

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: expandedResult.repairApplied,
        repairWarnings: expandedResult.repairWarnings,
      })

      validateBeadExpansion(params.beadSubsets, expandedResult.value)
      const hydratedBeads = hydrateExpandedBeads(params.beadSubsets, expandedResult.value, params.externalRef)
      const hydratedContent = hydratedBeads.map((bead) => JSON.stringify(bead)).join('\n')
      const hydratedResult = normalizeBeadsJsonlOutput(hydratedContent)
      if (!hydratedResult.ok) {
        throw new Error(`Hydrated bead graph failed validation: ${hydratedResult.error}`)
      }

      return {
        expandedModelContent: expandedResult.normalizedContent,
        hydratedContent: hydratedResult.normalizedContent,
        hydratedBeads: hydratedResult.value,
        structuredMeta,
      }
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error)
      if (attempt >= 1) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError,
        })
        throw error
      }

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError,
      })
      promptParts = buildStructuredRetryPrompt(baseParts, {
        validationError,
        rawResponse: response,
        schemaReminder: PROM23.outputFormat,
        doNotUseTools: false,
      })
    }
  }

  throw new Error('Beads expansion finished without a valid structured result')
}

export async function handleBeadsDraft(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, relevantFiles } = loadTicketDirContext(context)
  const phase = 'DRAFTING_BEADS' as const
  const council = resolveCouncilMembers(context)
  const members = council.members

  // Load PRD from disk
  const prdPath = resolve(ticketDir, 'prd.yaml')
  let prd: string | undefined
  if (existsSync(prdPath)) {
    try { prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    relevantFiles,
    prd,
  }
  const ticketContext = buildMinimalContext('beads_draft', ticketState)

  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    formatCouncilResolutionLog(context, council))
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    prd
      ? `Loaded PRD artifact (${prd.length} chars).`
      : 'PRD artifact missing; beads drafting will rely on available ticket context.')
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Beads council drafting started. Context: ${ticketContext.length} parts, prd=${prd ? 'loaded' : 'missing'}.`)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  emitPhaseLog(ticketId, context.externalId, phase, 'info',
    `Beads draft settings: council_response_timeout=${councilSettings.draftTimeoutMs}ms, min_council_quorum=${councilSettings.minQuorum}.`)
  emitPhaseLog(ticketId, context.externalId, phase, 'info', `Dispatching beads draft requests to ${members.length} council members.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  const startedAt = Date.now()
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveDrafts = createPendingDrafts(members)
  upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', liveDrafts)
  const result = await draftBeads(
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
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
        streamState,
      )
    },
    (entry) => {
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
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
      const targetStatus = mapCouncilStageToStatus('beads', entry.stage)
      emitOpenCodePromptLog(
        ticketId,
        context.externalId,
        targetStatus,
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      emitDraftProgressInfoLog(ticketId, context.externalId, phase, 'Beads', entry)
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
      upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', liveDrafts)
    },
  )

  const draftSummary = summarizeDraftOutcomes(result.drafts)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    formatDraftRoundSummary(
      'Beads draft round',
      Date.now() - startedAt,
      councilSettings.draftTimeoutMs,
      Boolean(result.deadlineReached),
      draftSummary,
    ),
  )
  const quorum = checkQuorum(result.drafts, councilSettings.minQuorum)
  const nextStatus = quorum.passed ? 'COUNCIL_VOTING_BEADS' : 'BLOCKED_ERROR'
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

  upsertCouncilDraftArtifact(ticketId, phase, 'beads_drafts', result.drafts, result.memberOutcomes, true)
  emitPhaseLog(
    ticketId,
    context.externalId,
    phase,
    'info',
    `Saved beads draft artifact with ${Object.keys(result.memberOutcomes).length} member outcomes.`,
  )

  if (!quorum.passed) {
    throw new Error(`Council quorum not met for beads_draft: ${quorum.message}`)
  }

  phaseIntermediate.set(`${ticketId}:beads`, {
    drafts: result.drafts,
    memberOutcomes: result.memberOutcomes,
    contextBuilder: buildBeadsContextBuilder(ticketContext),
    worktreePath,
    phase: result.phase,
  })

  sendEvent({ type: 'DRAFTS_READY' })
}

export async function handleBeadsVote(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const intermediate = phaseIntermediate.get(`${ticketId}:beads`)
  if (!intermediate) {
    throw new Error('No Beads drafts found — cannot vote')
  }

  const { members } = resolveCouncilMembers(context)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No beads context builder found — cannot vote')
  }
  const voteContext = intermediate.contextBuilder('vote')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const liveVotes: Vote[] = []
  const liveVoterOutcomes = members.reduce<Record<string, MemberOutcome>>((acc, member) => {
    acc[member.modelId] = 'pending'
    return acc
  }, {})
  const liveVoterDetails = new Map<string, { voterId: string; error?: string; structuredOutput?: NonNullable<typeof intermediate.drafts[number]['structuredOutput']> }>()

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, [], liveVoterOutcomes, [...liveVoterDetails.values()])

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
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeSessionLogs(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_BEADS',
        entry.memberId,
        entry.sessionId,
        entry.stage,
        entry.response,
        entry.messages,
        streamState,
      )
    },
    (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        ticketId,
        context.externalId,
        'COUNCIL_VOTING_BEADS',
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
        'COUNCIL_VOTING_BEADS',
        entry.memberId,
        entry.event,
      )
    },
    (entry) => {
      liveVoterOutcomes[entry.memberId] = entry.outcome
      if (entry.votes.length > 0) liveVotes.push(...entry.votes)
      liveVoterDetails.set(entry.memberId, {
        voterId: entry.memberId,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.structuredOutput ? { structuredOutput: entry.structuredOutput } : {}),
      })
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, liveVotes, liveVoterOutcomes, [...liveVoterDetails.values()])
    },
    undefined,
    {
      ticketId,
      phase: 'COUNCIL_VOTING_BEADS',
    },
  )

  const voteQuorum = checkMemberResponseQuorum(voteRun.memberOutcomes, councilSettings.minQuorum)
  const nextVoteStatus = voteQuorum.passed ? 'REFINING_BEADS' : 'BLOCKED_ERROR'
  emitCouncilDecisionLogs(
    ticketId,
    context.externalId,
    'COUNCIL_VOTING_BEADS',
    councilSettings.draftTimeoutMs,
    voteRun.deadlineReached,
    voteRun.memberOutcomes,
    voteQuorum,
    nextVoteStatus,
  )

  if (!voteQuorum.passed) {
    upsertCouncilVoteArtifact(
      ticketId,
      'COUNCIL_VOTING_BEADS',
      'beads_votes',
      intermediate.drafts,
      voteRun.votes,
      voteRun.memberOutcomes,
      voteRun.voterDetails,
      voteRun.presentationOrders,
      undefined,
      undefined,
      true,
    )
    throw new Error(`Beads voting quorum not met: ${voteQuorum.message}`)
  }

  if (voteRun.votes.length === 0) {
    throw new Error('Beads voting failed: no valid vote responses received')
  }

  const { winnerId, totalScore } = selectWinner(voteRun.votes, members)

  intermediate.votes = voteRun.votes
  intermediate.winnerId = winnerId

  upsertCouncilVoteArtifact(
    ticketId,
    'COUNCIL_VOTING_BEADS',
    'beads_votes',
    intermediate.drafts,
    voteRun.votes,
    voteRun.memberOutcomes,
    voteRun.voterDetails,
    voteRun.presentationOrders,
    winnerId,
    totalScore,
    true,
  )
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting selected winner: ${winnerId} (score: ${totalScore}).`)
  sendEvent({ type: 'WINNER_SELECTED', winner: winnerId })
}

export async function handleBeadsRefine(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const { ticket, ticketDir, relevantFiles } = loadTicketDirContext(context)
  const intermediate = phaseIntermediate.get(`${ticketId}:beads`)
  if (!intermediate || !intermediate.winnerId) {
    throw new Error('No Beads vote results found — cannot refine')
  }

  const winnerDraft = intermediate.drafts.find(d => d.memberId === intermediate.winnerId)!
  const losingDrafts = intermediate.drafts.filter(d => d.memberId !== intermediate.winnerId && d.outcome === 'completed')
  const councilSettings = resolveCouncilRuntimeSettings(context)
  if (!intermediate.contextBuilder) {
    throw new Error('No beads context builder found — cannot refine')
  }
  const refineContext = intermediate.contextBuilder('refine')
  const streamStates = new Map<string, OpenCodeStreamState>()
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  }
  const beadsPath = paths.beadsPath
  const prdPath = resolve(ticketDir, 'prd.yaml')
  const prd = existsSync(prdPath)
    ? readFileSync(prdPath, 'utf-8')
    : undefined

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Beads refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)
  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Substep blueprint_refine started with ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let refineStructuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  let validatedChanges: RefinementChange[] = []
  let refinedContent: string
  try {
    refinedContent = await refineDraft(
      adapter,
      winnerDraft,
      losingDrafts,
      refineContext,
      intermediate.worktreePath,
      councilSettings.draftTimeoutMs,
      signal,
      (entry) => {
        const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
        streamStates.set(entry.sessionId, streamState)
        emitOpenCodeSessionLogs(
          ticketId,
          context.externalId,
          'REFINING_BEADS',
          entry.memberId,
          entry.sessionId,
          entry.stage,
          entry.response,
          entry.messages,
          streamState,
        )
      },
      (entry) => {
        const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
        streamStates.set(entry.sessionId, streamState)
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          'REFINING_BEADS',
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
          'REFINING_BEADS',
          entry.memberId,
          entry.event,
        )
      },
      {
        ticketId,
        phase: 'REFINING_BEADS',
      },
      undefined,
      (content) => {
        const losingDraftMeta = losingDrafts.map((d) => ({ memberId: d.memberId }))
        const result = normalizeBeadSubsetYamlOutput(content, losingDraftMeta)
        if (!result.ok) {
          refineStructuredMeta = buildStructuredMetadata(refineStructuredMeta, {
            autoRetryCount: 1,
            validationError: result.error,
          })
          throw new Error(result.error)
        }
        refineStructuredMeta = buildStructuredMetadata(refineStructuredMeta, {
          repairApplied: result.repairApplied,
          repairWarnings: result.repairWarnings,
        })
        validatedChanges = Array.isArray(result.value.changes) ? result.value.changes : []
        return { normalizedContent: result.normalizedContent }
      },
      PROM22.outputFormat,
    )
  } catch (error) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      'REFINING_BEADS',
      'error',
      `Substep blueprint_refine failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:beads`)

  // Parse refined content as bead subsets and expand to full beads
  const beadSubsetResult = normalizeBeadSubsetYamlOutput(refinedContent)
  if (!beadSubsetResult.ok) {
    throw new Error(`PROM22 refinement output failed validation: ${beadSubsetResult.error}`)
  }
  const beadSubsets: BeadSubset[] = beadSubsetResult.value
  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Substep blueprint_refine completed with ${beadSubsets.length} beads.`)

  const uiDiffArtifact = validatedChanges.length > 0
    ? buildBeadsUiRefinementDiffArtifactFromChanges({
        winnerId: intermediate.winnerId,
        changes: validatedChanges,
        winnerDraftContent: winnerDraft.content,
        refinedContent,
        losingDrafts: losingDrafts.map((draft) => ({ memberId: draft.memberId, content: draft.content })),
      })
    : buildBeadsUiRefinementDiffArtifact({
        winnerId: intermediate.winnerId,
        winnerDraftContent: winnerDraft.content,
        refinedContent,
        losingDrafts: losingDrafts.map((draft) => ({ memberId: draft.memberId, content: draft.content })),
      })

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_refined',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent,
    }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'REFINING_BEADS', 'beads_refined', {
    winnerDraftContent: winnerDraft.content,
    structuredOutput: refineStructuredMeta,
  })
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_winner',
    content: JSON.stringify({ winnerId: intermediate.winnerId }),
  })
  persistUiRefinementDiffArtifact(ticketId, 'REFINING_BEADS', paths.ticketDir, uiDiffArtifact)

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Substep beads_expand started with fresh context (prd=${prd ? 'loaded' : 'missing'}, relevant_files=${relevantFiles ? 'loaded' : 'missing'}).`)

  const expandStreamStates = new Map<string, OpenCodeStreamState>()
  let expansionResult: Awaited<ReturnType<typeof executeBeadsExpandStep>>
  try {
    expansionResult = await executeBeadsExpandStep({
      ticketId,
      externalId: context.externalId,
      worktreePath: intermediate.worktreePath,
      winnerId: intermediate.winnerId,
      externalRef: context.externalId,
      timeoutMs: councilSettings.draftTimeoutMs,
      signal,
      ticketState: {
        ticketId: context.externalId,
        title: context.title,
        description: ticket?.description ?? '',
        relevantFiles,
        prd,
        beadsDraft: refinedContent,
      },
      beadSubsets,
      onSessionLog: (entry) => {
        const streamState = expandStreamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
        expandStreamStates.set(entry.sessionId, streamState)
        emitOpenCodeSessionLogs(
          ticketId,
          context.externalId,
          'REFINING_BEADS',
          entry.memberId,
          entry.sessionId,
          'refine',
          entry.response,
          entry.messages,
          streamState,
        )
      },
      onStreamEvent: (entry) => {
        const streamState = expandStreamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
        expandStreamStates.set(entry.sessionId, streamState)
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          'REFINING_BEADS',
          entry.memberId,
          entry.sessionId,
          entry.event,
          streamState,
        )
      },
      onPromptDispatched: (entry) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          'REFINING_BEADS',
          entry.memberId,
          entry.event,
        )
      },
    })
  } catch (error) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      'REFINING_BEADS',
      'error',
      `Substep beads_expand failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }

  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_expanded',
    content: JSON.stringify({
      winnerId: intermediate.winnerId,
      refinedContent: expansionResult.hydratedContent,
      expandedContent: expansionResult.expandedModelContent,
    }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'REFINING_BEADS', 'beads_expanded', {
    structuredOutput: expansionResult.structuredMeta,
  })

  writeJsonl(beadsPath, expansionResult.hydratedBeads)

  clearContextCache(context.externalId)
  patchTicket(ticketId, {
    totalBeads: expansionResult.hydratedBeads.length,
    currentBead: 0,
    percentComplete: 0,
  })

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Substep beads_expand completed with ${expansionResult.hydratedBeads.length} hydrated beads written to ${beadsPath}.`)

  sendEvent({ type: 'REFINED' })
}

export function getBeadsPath(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${ticketId}`)
  return paths.beadsPath
}

export function readTicketBeads(ticketId: string): Bead[] {
  return readJsonl<Bead>(getBeadsPath(ticketId))
}

export function writeTicketBeads(ticketId: string, beads: Bead[]) {
  writeJsonl(getBeadsPath(ticketId), beads)
}

export function updateTicketProgressFromBeads(ticketId: string, beads: Bead[]) {
  const total = beads.length
  const completed = beads.filter(bead => bead.status === 'done').length
  const currentIndex = total === 0
    ? 0
    : completed >= total
      ? total
      : completed + 1
  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100)

  patchTicket(ticketId, {
    currentBead: currentIndex,
    totalBeads: total,
    percentComplete,
  })
}

export function buildMockBeadSubsets(context: TicketContext): BeadSubset[] {
  return [
    {
      id: 'bead-1',
      title: 'Project-local storage plumbing',
      prdRefs: ['AC-1'],
      description: `Store ${context.title} runtime state under the project-local .looptroop directory.`,
      contextGuidance: {
        patterns: ['Update path resolution and local-db ownership first.'],
        anti_patterns: ['Do not use global paths.'],
      },
      acceptanceCriteria: ['All ticket files resolve under <project>/.looptroop/worktrees/<ticket-id>/.ticket/.'],
      tests: ['Create a ticket and verify its meta and execution log paths.'],
      testCommands: ['npm run test -- server/routes'],
    },
    {
      id: 'bead-2',
      title: 'String ticket refs through the app',
      prdRefs: ['AC-2'],
      description: 'Propagate <projectId>:<externalId> ticket refs through API, SSE, and UI state.',
      contextGuidance: {
        patterns: ['Keep project ids numeric while converting public ticket ids to strings.'],
        anti_patterns: ['Do not use numeric-only ticket IDs in public APIs.'],
      },
      acceptanceCriteria: ['Routes, SSE, and UI all accept string ticket refs.'],
      tests: ['Fetch and open a ticket using its string ref.'],
      testCommands: ['npm run test -- src/hooks'],
    },
    {
      id: 'bead-3',
      title: 'Deterministic mock lifecycle verification',
      prdRefs: ['AC-3'],
      description: 'Support a deterministic mock runtime for complete browser-driven lifecycle tests.',
      contextGuidance: {
        patterns: ['Mock mode should create stable artifacts and pass through the full flow.'],
        anti_patterns: ['Do not depend on external AI services in mock mode.'],
      },
      acceptanceCriteria: ['A ticket reaches COMPLETED in mock mode without external AI dependencies.'],
      tests: ['Run the browser lifecycle script end-to-end.'],
      testCommands: ['npm run test'],
    },
  ]
}

export async function handleMockBeadsDraft(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const refinedContent = JSON.stringify(buildMockBeadSubsets(context))
  insertPhaseArtifact(ticketId, {
    phase: 'DRAFTING_BEADS',
    artifactType: 'beads_drafts',
    content: JSON.stringify({
      drafts: [{ memberId: 'mock-model-1', outcome: 'completed', content: refinedContent }],
      memberOutcomes: { 'mock-model-1': 'completed' },
      isFinal: true,
    }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'DRAFTING_BEADS', 'beads_drafts', {
    draftDetails: [{ memberId: 'mock-model-1', duration: 1 }],
  })
  emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'info', 'Mock beads drafts ready.')
  sendEvent({ type: 'DRAFTS_READY' })
}

export async function handleMockBeadsVote(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  insertPhaseArtifact(ticketId, {
    phase: 'COUNCIL_VOTING_BEADS',
    artifactType: 'beads_votes',
    content: JSON.stringify({
      winnerId: 'mock-model-1',
      isFinal: true,
    }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', {
    totalScore: 1,
    voterOutcomes: { 'mock-model-1': 'completed' },
    presentationOrders: {
      'mock-model-1': {
        seed: 'mock-seed-beads',
        order: ['mock-model-1'],
      },
    },
    votes: [],
    drafts: [{ memberId: 'mock-model-1', outcome: 'completed', content: JSON.stringify(buildMockBeadSubsets(context)) }],
  })
  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info', 'Mock beads winner selected.')
  sendEvent({ type: 'WINNER_SELECTED', winner: 'mock-model-1' })
}

export async function handleMockBeadsRefine(ticketId: string, context: TicketContext, sendEvent: (event: TicketEvent) => void) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
  const beadSubsets = buildMockBeadSubsets(context)
  const expandedBeads = expandBeads(beadSubsets)
  const refinedContent = JSON.stringify(beadSubsets)
  const uiDiffArtifact = buildBeadsUiRefinementDiffArtifact({
    winnerId: 'mock-model-1',
    winnerDraftContent: refinedContent,
    refinedContent,
  })
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_refined',
    content: JSON.stringify({ refinedContent }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'REFINING_BEADS', 'beads_refined', {
    winnerDraftContent: refinedContent,
  })
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_winner',
    content: JSON.stringify({ winnerId: 'mock-model-1' }),
  })
  persistUiRefinementDiffArtifact(ticketId, 'REFINING_BEADS', paths.ticketDir, uiDiffArtifact)
  writeJsonl(paths.beadsPath, expandedBeads)
  patchTicket(ticketId, {
    totalBeads: expandedBeads.length,
    currentBead: 0,
    percentComplete: 0,
  })
  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info', `Mock beads expanded to ${expandedBeads.length} tasks.`)
  sendEvent({ type: 'REFINED' })
}
