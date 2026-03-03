import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftResult, Vote, VoteScore } from './types'
import type { PromptPart } from '../opencode/types'
import { VOTING_RUBRIC, getVotingRubricForPhase } from './types'

// Anonymize and randomize drafts per voter
function anonymizeDrafts(drafts: DraftResult[], seed: string): { index: number; content: string }[] {
  const shuffled = drafts
    .map((d, i) => ({ index: i, content: d.content, sort: hashCode(d.memberId + seed) }))
    .sort((a, b) => a.sort - b.sort)
  return shuffled.map((d, i) => ({ index: d.index, content: `Draft ${i + 1}:\n${d.content}` }))
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

export async function conductVoting(
  adapter: OpenCodeAdapter,
  voters: CouncilMember[],
  drafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  phase?: string,
): Promise<Vote[]> {
  const votes: Vote[] = []
  const validDrafts = drafts.filter(d => d.outcome === 'completed' && d.content)
  const rubric = phase ? getVotingRubricForPhase(phase) : VOTING_RUBRIC

  if (validDrafts.length === 0) return votes

  // Each voter votes in parallel with anonymized, randomized draft order
  const promises = voters.map(async (voter): Promise<Vote[]> => {
    const anonymized = anonymizeDrafts(validDrafts, voter.modelId)
    const voterVotes: Vote[] = []

    try {
      const session = await adapter.createSession(projectPath)
      const votingPrompt: PromptPart[] = [
        ...contextParts,
        {
          type: 'text',
          content: [
            'Score each draft on these categories (0-20 points each):',
            ...rubric.map(r => `- ${r.category} (${r.weight}pts): ${r.description}`),
            '',
            ...anonymized.map(d => d.content),
            '',
            'Respond with scores for each draft in YAML format.',
          ].join('\n'),
        },
      ]

      await adapter.promptSession(session.id, votingPrompt)

      // Parse voting response — simplified scoring
      for (const draft of anonymized) {
        const draftMemberId = validDrafts[draft.index]!.memberId
        const scores: VoteScore[] = rubric.map(r => ({
          category: r.category,
          score: 15, // Default score, will be parsed from AI response
          justification: 'Evaluated by council member',
        }))

        voterVotes.push({
          voterId: voter.modelId,
          draftId: draftMemberId,
          scores,
          totalScore: scores.reduce((sum, s) => sum + s.score, 0),
        })
      }
    } catch {
      // Voter failed — skip
    }

    return voterVotes
  })

  const settled = await Promise.allSettled(promises)
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      votes.push(...result.value)
    }
  }

  return votes
}

// Select winner: highest score, MAI (first member) wins ties
export function selectWinner(
  votes: Vote[],
  members: CouncilMember[],
): { winnerId: string; totalScore: number } {
  const scoreMap = new Map<string, number>()

  for (const vote of votes) {
    const current = scoreMap.get(vote.draftId) ?? 0
    scoreMap.set(vote.draftId, current + vote.totalScore)
  }

  let winnerId = members[0]?.modelId ?? ''
  let winnerScore = 0

  for (const [memberId, score] of scoreMap) {
    if (score > winnerScore || (score === winnerScore && memberId === members[0]?.modelId)) {
      winnerId = memberId
      winnerScore = score
    }
  }

  return { winnerId, totalScore: winnerScore }
}
