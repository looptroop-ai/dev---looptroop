import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, CouncilResult, DraftResult, MemberOutcome } from './types'
import { throwIfAborted } from './types'
import type { Message, PromptPart } from '../opencode/types'
import { generateDrafts } from './drafter'
import { conductVoting, selectWinner } from './voter'
import { refineDraft } from './refiner'
import { checkQuorum } from './quorum'

export interface OpenCodeSessionLog {
  stage: 'draft' | 'vote' | 'refine'
  memberId: string
  sessionId: string
  response: string
  messages: Message[]
}

interface PipelineOptions {
  phase: string
  members: CouncilMember[]
  contextParts: PromptPart[]
  projectPath: string
  minQuorum?: number
  draftTimeout?: number
  signal?: AbortSignal
  /** Optional callback to rebuild context between council steps. */
  contextBuilder?: (step: 'vote' | 'refine', drafts: DraftResult[]) => PromptPart[]
  /** Optional callback to stream complete OpenCode transcript per council session. */
  onOpenCodeSessionLog?: (entry: OpenCodeSessionLog) => void
}

export async function runCouncilPipeline(
  adapter: OpenCodeAdapter,
  options: PipelineOptions,
): Promise<CouncilResult> {
  const {
    phase,
    members,
    contextParts,
    projectPath,
    minQuorum = 2,
    draftTimeout = 300000,
    signal,
    contextBuilder,
    onOpenCodeSessionLog,
  } = options

  // Step 1: Draft — parallel generation
  throwIfAborted(signal)
  const drafts = await generateDrafts(
    adapter,
    members,
    contextParts,
    projectPath,
    draftTimeout,
    signal,
    onOpenCodeSessionLog,
  )

  // Step 2: Quorum check
  throwIfAborted(signal)
  const quorum = checkQuorum(drafts, minQuorum)
  if (!quorum.passed) {
    throw new Error(`Council quorum not met for ${phase}: ${quorum.message}`)
  }

  // Per arch.md §9.1: rebuild context between council steps when a builder is provided
  const voteContext = contextBuilder ? contextBuilder('vote', drafts) : contextParts

  // Step 3: Vote — parallel anonymized voting
  throwIfAborted(signal)
  const votes = await conductVoting(
    adapter,
    members,
    drafts,
    voteContext,
    projectPath,
    phase,
    signal,
    onOpenCodeSessionLog,
  )

  // Step 4: Select winner
  throwIfAborted(signal)
  const { winnerId } = selectWinner(votes, members)
  const winnerDraft = drafts.find(d => d.memberId === winnerId)!
  const losingDrafts = drafts.filter(d => d.memberId !== winnerId && d.outcome === 'completed')

  // Step 5: Refine — sequential
  throwIfAborted(signal)
  const refineContext = contextBuilder ? contextBuilder('refine', drafts) : contextParts
  const refinedContent = await refineDraft(
    adapter,
    winnerDraft,
    losingDrafts,
    refineContext,
    projectPath,
    signal,
    onOpenCodeSessionLog,
  )

  // Build outcome map
  const memberOutcomes: Record<string, MemberOutcome> = {}
  for (const draft of drafts) {
    memberOutcomes[draft.memberId] = draft.outcome
  }

  return {
    phase,
    drafts,
    votes,
    winnerId,
    winnerContent: winnerDraft.content,
    refinedContent,
    memberOutcomes,
  }
}
