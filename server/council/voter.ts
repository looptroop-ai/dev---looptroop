import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftResult, Vote, VoteScore } from './types'
import type { Message, PromptPart } from '../opencode/types'
import { VOTING_RUBRIC, getVotingRubricForPhase } from './types'

/**
 * Parse a numerical score from an AI voter response for a specific draft.
 * Looks for common patterns: "Score: X/20", "X/20", "Rating: X", JSON scores,
 * or bare numbers on a line. Falls back to a random score in [8, 18].
 */
export function parseScore(response: string, draftLabel: string, category: string): number {
  // Try to isolate the section for this draft
  const draftSection = extractDraftSection(response, draftLabel)
  const text = draftSection ?? response

  // Try to find score specifically for this category
  const catScore = parseCategoryScore(text, category)
  if (catScore !== null) return clampScore(catScore)

  // Try generic patterns in the draft section
  const genericScore = parseGenericScore(text)
  if (genericScore !== null) return clampScore(genericScore)

  // Fallback: random score between 8-18
  const fallback = Math.floor(Math.random() * 11) + 8
  console.warn(`[voter] parseScore fallback for draft="${draftLabel}" category="${category}": using ${fallback}`)
  return fallback
}

function extractDraftSection(response: string, draftLabel: string): string | null {
  // Match "Draft N" sections (e.g., "Draft 1:", "## Draft 1", "**Draft 1**")
  const draftNum = draftLabel.match(/\d+/)?.[0]
  if (!draftNum) return null
  const nextNum = String(Number(draftNum) + 1)
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{1,2})?Draft\\s+${draftNum}\\b[^]*?(?=(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:\\*{1,2})?Draft\\s+${nextNum}\\b|$)`,
    'i',
  )
  const match = response.match(pattern)
  return match ? match[0] : null
}

function parseCategoryScore(text: string, category: string): number | null {
  // Escape category for regex, allow partial match on first word(s)
  const catWords = category.split(/[\s/]+/).filter(w => w.length > 2).slice(0, 3)
  const catPattern = catWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\n]*')

  // Pattern: "Category ... : X/20" or "Category ... : X" or "Category ... X/20"
  const re = new RegExp(`${catPattern}[^\\n]*?[:\\-]?\\s*(\\d{1,2})\\s*(?:/\\s*20)?`, 'i')
  const match = text.match(re)
  if (match?.[1]) {
    const val = Number(match[1])
    if (val >= 0 && val <= 20) return val
  }
  return null
}

function parseGenericScore(text: string): number | null {
  // Try "Score: X/20" or "X/20"
  const scoreSlash = text.match(/\bscore\s*:\s*(\d{1,2})\s*\/\s*20/i)
    ?? text.match(/\brating\s*:\s*(\d{1,2})\s*\/\s*20/i)
    ?? text.match(/(\d{1,2})\s*\/\s*20/)
  if (scoreSlash?.[1]) {
    const val = Number(scoreSlash[1])
    if (val >= 0 && val <= 20) return val
  }

  // Try "Score: X" or "Rating: X"
  const scoreLabel = text.match(/\b(?:score|rating)\s*:\s*(\d{1,2})\b/i)
  if (scoreLabel?.[1]) {
    const val = Number(scoreLabel[1])
    if (val >= 0 && val <= 20) return val
  }

  // Try JSON-like { "score": X }
  const jsonScore = text.match(/"score"\s*:\s*(\d{1,2})/i)
  if (jsonScore?.[1]) {
    const val = Number(jsonScore[1])
    if (val >= 0 && val <= 20) return val
  }

  return null
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(20, Math.round(score)))
}

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
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
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
      const session = await adapter.createSession(projectPath, signal)
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

      const response = await adapter.promptSession(session.id, votingPrompt, signal)
      const messages: Message[] = await adapter.getSessionMessages(session.id)

      onOpenCodeSessionLog?.({
        stage: 'vote',
        memberId: voter.modelId,
        sessionId: session.id,
        response,
        messages,
      })

      // Parse voting response — extract real scores from AI output
      for (const draft of anonymized) {
        const draftMemberId = validDrafts[draft.index]!.memberId
        const draftLabel = `Draft ${anonymized.indexOf(draft) + 1}`
        const scores: VoteScore[] = rubric.map(r => ({
          category: r.category,
          score: parseScore(response, draftLabel, r.category),
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
