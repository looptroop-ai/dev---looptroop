import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, CouncilResult, MemberOutcome } from './types'
import type { PromptPart } from '../opencode/types'
import { generateDrafts } from './drafter'
import { conductVoting, selectWinner } from './voter'
import { refineDraft } from './refiner'
import { checkQuorum } from './quorum'

interface PipelineOptions {
  phase: string
  members: CouncilMember[]
  contextParts: PromptPart[]
  projectPath: string
  minQuorum?: number
  draftTimeout?: number
}

export async function runCouncilPipeline(
  adapter: OpenCodeAdapter,
  options: PipelineOptions,
): Promise<CouncilResult> {
  const { phase, members, contextParts, projectPath, minQuorum = 2, draftTimeout = 300000 } = options

  // Step 1: Draft — parallel generation
  const drafts = await generateDrafts(adapter, members, contextParts, projectPath, draftTimeout)

  // Step 2: Quorum check
  const quorum = checkQuorum(drafts, minQuorum)
  if (!quorum.passed) {
    throw new Error(`Council quorum not met for ${phase}: ${quorum.message}`)
  }

  // Step 3: Vote — parallel anonymized voting
  const votes = await conductVoting(adapter, members, drafts, contextParts, projectPath, phase)

  // Step 4: Select winner
  const { winnerId } = selectWinner(votes, members)
  const winnerDraft = drafts.find(d => d.memberId === winnerId)!
  const losingDrafts = drafts.filter(d => d.memberId !== winnerId && d.outcome === 'completed')

  // Step 5: Refine — sequential
  const refinedContent = await refineDraft(adapter, winnerDraft, losingDrafts, contextParts, projectPath)

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
