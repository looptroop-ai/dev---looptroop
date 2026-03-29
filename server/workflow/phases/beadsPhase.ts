import type { TicketContext, TicketEvent } from '../../machines/types'
import type { MemberOutcome, Vote } from '../../council/types'
import { CancelledError } from '../../council/types'
import { conductVoting, selectWinner } from '../../council/voter'
import { refineDraft } from '../../council/refiner'
import { checkMemberResponseQuorum, checkQuorum } from '../../council/quorum'
import { draftBeads, buildBeadsContextBuilder } from '../../phases/beads/draft'
import { expandBeads } from '../../phases/beads/expand'
import type { Bead, BeadSubset } from '../../phases/beads/types'
import { buildMinimalContext, clearContextCache, type TicketState } from '../../opencode/contextBuilder'
import { getTicketPaths, insertPhaseArtifact, patchTicket } from '../../storage/tickets'
import { readJsonl, writeJsonl } from '../../io/jsonl'
import { normalizeBeadSubsetYamlOutput, normalizeBeadsJsonlOutput } from '../../structuredOutput'
import { PROM22 } from '../../prompts/index'
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

  emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'info',
    `Beads voting started with ${members.length} council members on ${intermediate.drafts.filter(d => d.outcome === 'completed').length} drafts.`)
  upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, [], liveVoterOutcomes)

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
      upsertCouncilVoteArtifact(ticketId, 'COUNCIL_VOTING_BEADS', 'beads_votes', intermediate.drafts, liveVotes, liveVoterOutcomes)
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

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Beads refinement started. Winner: ${intermediate.winnerId}, incorporating ideas from ${losingDrafts.length} alternative drafts.`)

  if (signal.aborted) throw new CancelledError(ticketId)
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  let validatedChanges: RefinementChange[] = []
  const refinedContent = await refineDraft(
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
      validatedChanges = Array.isArray(result.value.changes) ? result.value.changes : []
      return { normalizedContent: result.normalizedContent }
    },
    PROM22.outputFormat,
  )

  // Clean up intermediate data
  phaseIntermediate.delete(`${ticketId}:beads`)

  // Parse refined content as bead subsets and expand to full beads
  const beadSubsetResult = normalizeBeadSubsetYamlOutput(refinedContent)
  if (!beadSubsetResult.ok) {
    throw new Error(`PROM22 refinement output failed validation: ${beadSubsetResult.error}`)
  }
  const beadSubsets: BeadSubset[] = beadSubsetResult.value

  const expandedBeads = expandBeads(beadSubsets)
  const expandedBeadsJsonl = expandedBeads.map((bead) => JSON.stringify(bead)).join('\n')
  const beadsJsonlResult = normalizeBeadsJsonlOutput(expandedBeadsJsonl)
  if (!beadsJsonlResult.ok) {
    throw new Error(`Expanded bead graph failed validation: ${beadsJsonlResult.error}`)
  }

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
      refinedContent,
    }),
  })
  persistUiArtifactCompanionArtifact(ticketId, 'REFINING_BEADS', 'beads_refined', {
    winnerDraftContent: winnerDraft.content,
    structuredOutput: structuredMeta,
  })
  insertPhaseArtifact(ticketId, {
    phase: 'REFINING_BEADS',
    artifactType: 'beads_winner',
    content: JSON.stringify({ winnerId: intermediate.winnerId }),
  })
  persistUiRefinementDiffArtifact(ticketId, 'REFINING_BEADS', paths.ticketDir, uiDiffArtifact)

  // Save expanded beads to disk as JSONL
  writeJsonl(beadsPath, beadsJsonlResult.value)

  clearContextCache(context.externalId)
  patchTicket(ticketId, {
    totalBeads: expandedBeads.length,
    currentBead: 0,
    percentComplete: 0,
  })

  emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'info',
    `Refined and expanded ${expandedBeads.length} beads from winner ${intermediate.winnerId}. Saved to ${beadsPath}.`)

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
  const completed = beads.filter(bead => bead.status === 'completed' || bead.status === 'skipped').length
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
      contextGuidance: 'Update path resolution and local-db ownership first.',
      acceptanceCriteria: ['All ticket files resolve under <project>/.looptroop/worktrees/<ticket-id>/.ticket/.'],
      tests: ['Create a ticket and verify its meta and execution log paths.'],
      testCommands: ['npm run test -- server/routes'],
    },
    {
      id: 'bead-2',
      title: 'String ticket refs through the app',
      prdRefs: ['AC-2'],
      description: 'Propagate <projectId>:<externalId> ticket refs through API, SSE, and UI state.',
      contextGuidance: 'Keep project ids numeric while converting public ticket ids to strings.',
      acceptanceCriteria: ['Routes, SSE, and UI all accept string ticket refs.'],
      tests: ['Fetch and open a ticket using its string ref.'],
      testCommands: ['npm run test -- src/hooks'],
    },
    {
      id: 'bead-3',
      title: 'Deterministic mock lifecycle verification',
      prdRefs: ['AC-3'],
      description: 'Support a deterministic mock runtime for complete browser-driven lifecycle tests.',
      contextGuidance: 'Mock mode should create stable artifacts and pass through the full flow.',
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
