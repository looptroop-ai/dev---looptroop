import { randomUUID } from 'node:crypto'
import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftResult, MemberOutcome, Vote, VotePresentationOrder, VoteScore, VotingPhaseResult } from './types'
import { CancelledError } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { VOTING_RUBRIC, getVotingRubricForPhase } from './types'
import { runOpenCodePrompt } from '../workflow/runOpenCodePrompt'

const PHASE_DEADLINE_ERROR = 'CouncilPhaseDeadlineReached'

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function isPhaseDeadlineError(error: unknown) {
  return error instanceof Error && error.message === PHASE_DEADLINE_ERROR
}

/**
 * Parse a numerical score from an AI voter response for a specific draft.
 * Looks for common patterns: "Score: X/20", "X/20", "Rating: X", JSON scores,
 * or bare numbers on a line. Returns null when the score cannot be parsed.
 */
export function parseScore(response: string, draftLabel: string, category: string): number | null {
  // Try to isolate the section for this draft
  const draftSection = extractDraftSection(response, draftLabel)
  const text = draftSection ?? response

  // Try to find score specifically for this category
  const catScore = parseCategoryScore(text, category)
  if (catScore !== null) return clampScore(catScore)

  // Try generic patterns in the draft section
  const genericScore = parseGenericScore(text)
  if (genericScore !== null) return clampScore(genericScore)

  return null
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

function buildStrictVoteSchemaReminder(rubric: typeof VOTING_RUBRIC): string {
  return [
    'Output strict machine-readable YAML with top-level `draft_scores` keyed by the exact presented draft labels (`Draft 1`, `Draft 2`, etc.).',
    `For each draft, include only these integer fields: ${rubric.map(item => `\`${item.category}\``).join(', ')}, and \`total_score\`.`,
    'Each rubric score must be an integer from 0 to 20. `total_score` must equal the sum of the rubric scores for that draft.',
    'Do not output prose, markdown fences, rankings, winners, comments, or extra keys.',
  ].join('\n')
}

interface PresentedDraft {
  draftId: string
  content: string
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createSeededRandom(seed: string) {
  let state = hashSeed(seed) || 1
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Anonymize and randomize drafts per voter with a replayable seed.
export function buildVotePresentationOrder(
  drafts: DraftResult[],
  seed: string,
): PresentedDraft[] {
  const shuffled = drafts
    .filter(draft => draft.outcome === 'completed' && draft.content)
    .map(draft => ({ draftId: draft.memberId, content: draft.content }))
  const nextRandom = createSeededRandom(seed)

  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(nextRandom() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]!
    shuffled[swapIndex] = current!
  }

  return shuffled.map((draft, index) => ({
    draftId: draft.draftId,
    content: `Draft ${index + 1}:\n${draft.content}`,
  }))
}

export async function conductVoting(
  adapter: OpenCodeAdapter,
  voters: CouncilMember[],
  drafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  phase?: string,
  timeoutMs?: number,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onOpenCodeStreamEvent?: (entry: {
    stage: 'vote'
    memberId: string
    sessionId: string
    event: StreamEvent
  }) => void,
  onVoteProgress?: (entry: {
    memberId: string
    outcome: MemberOutcome
    votes: Vote[]
    error?: string
  }) => void,
  buildPromptForVoter?: (entry: {
    voter: CouncilMember
    anonymizedDrafts: PresentedDraft[]
    rubric: typeof VOTING_RUBRIC
  }) => PromptPart[],
  sessionOwnership?: {
    ticketId: string
    phase: string
    phaseAttempt?: number
  },
): Promise<VotingPhaseResult> {
  const votes: Vote[] = []
  const validDrafts = drafts.filter(d => d.outcome === 'completed' && d.content)
  const rubric = phase ? getVotingRubricForPhase(phase) : VOTING_RUBRIC
  const presentationOrders: Record<string, VotePresentationOrder> = {}
  const memberOutcomes = voters.reduce<Record<string, MemberOutcome>>((outcomes, voter) => {
    outcomes[voter.modelId] = 'pending'
    return outcomes
  }, {})
  const finalizedMembers = new Set<string>()
  const deadlineAt = timeoutMs && timeoutMs > 0 ? Date.now() + timeoutMs : null
  let deadlineReached = false

  function recordOutcome(
    memberId: string,
    outcome: MemberOutcome,
    voterVotes: Vote[],
    error?: string,
  ): boolean {
    if (finalizedMembers.has(memberId)) return false

    finalizedMembers.add(memberId)
    memberOutcomes[memberId] = outcome
    if (outcome === 'completed' && voterVotes.length > 0) {
      votes.push(...voterVotes)
    }
    onVoteProgress?.({
      memberId,
      outcome,
      votes: voterVotes,
      error,
    })
    return true
  }

  if (validDrafts.length === 0) {
    return { votes, memberOutcomes, deadlineReached: false, presentationOrders }
  }

  const promises = voters.map(async (voter): Promise<Vote[]> => {
    const presentationSeed = randomUUID()
    const anonymized = buildVotePresentationOrder(validDrafts, presentationSeed)
    presentationOrders[voter.modelId] = {
      seed: presentationSeed,
      order: anonymized.map(draft => draft.draftId),
    }
    const voterVotes: Vote[] = []
    let sessionId = ''
    let closed = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const markTimedOut = async () => {
      if (closed) return
      closed = true
      deadlineReached = true
      if (sessionId) {
        await adapter.abortSession(sessionId)
      }
    }

    const executeVote = (async () => {
      const votingPrompt = buildPromptForVoter
        ? buildPromptForVoter({ voter, anonymizedDrafts: anonymized, rubric })
        : [
            ...contextParts,
            {
              type: 'text' as const,
              content: [
                'Score each draft on these categories (0-20 points each):',
                ...rubric.map(r => `- ${r.category} (${r.weight}pts): ${r.description}`),
                '',
                ...anonymized.map(d => d.content),
                '',
                buildStrictVoteSchemaReminder(rubric),
              ].join('\n'),
            },
          ]

      const result = await runOpenCodePrompt({
        adapter,
        projectPath,
        parts: votingPrompt,
        signal,
        model: voter.modelId,
        ...(sessionOwnership
          ? {
              sessionOwnership: {
                ticketId: sessionOwnership.ticketId,
                phase: sessionOwnership.phase,
                phaseAttempt: sessionOwnership.phaseAttempt ?? 1,
                memberId: voter.modelId,
              },
            }
          : {}),
        onSessionCreated: (session) => {
          if (closed) {
            void adapter.abortSession(session.id)
            return
          }

          sessionId = session.id
        },
        onStreamEvent: (event) => {
          if (closed) return
          onOpenCodeStreamEvent?.({
            stage: 'vote',
            memberId: voter.modelId,
            sessionId,
            event,
          })
        },
      })

      if (closed) {
        return voterVotes
      }

      const response = result.response

      // Parse voting response — extract real scores from AI output
      const parseErrors: string[] = []
      for (const draft of anonymized) {
        const draftLabel = `Draft ${anonymized.indexOf(draft) + 1}`
        const scores: VoteScore[] = []
        let draftValid = true
        for (const rubricItem of rubric) {
          const parsedScore = parseScore(response, draftLabel, rubricItem.category)
          if (parsedScore === null) {
            draftValid = false
            parseErrors.push(`Missing score for ${draftLabel} / ${rubricItem.category}`)
            break
          }
          scores.push({
            category: rubricItem.category,
            score: parsedScore,
            justification: 'Evaluated by council member',
          })
        }

        if (!draftValid) {
          continue
        }

        voterVotes.push({
          voterId: voter.modelId,
          draftId: draft.draftId,
          scores,
          totalScore: scores.reduce((sum, s) => sum + s.score, 0),
        })
      }

      if (parseErrors.length > 0 || voterVotes.length !== anonymized.length) {
        recordOutcome(
          voter.modelId,
          'invalid_output',
          [],
          parseErrors.length > 0
            ? parseErrors.join('; ')
            : 'Voting response did not include a complete scorecard for every draft',
        )
        return voterVotes
      }

      if (!recordOutcome(voter.modelId, 'completed', voterVotes)) {
        return voterVotes
      }

      onOpenCodeSessionLog?.({
        stage: 'vote',
        memberId: voter.modelId,
        sessionId: result.session.id,
        response,
        messages: result.messages,
      })

      return voterVotes
    })()

    const deadlinePromise = deadlineAt === null
      ? null
      : new Promise<never>((_, reject) => {
        const remainingMs = Math.max(0, deadlineAt - Date.now())
        timeoutHandle = setTimeout(() => {
          void markTimedOut()
          reject(new Error(PHASE_DEADLINE_ERROR))
        }, remainingMs)
      })

    try {
      return deadlinePromise
        ? await Promise.race([executeVote, deadlinePromise])
        : await executeVote
    } catch (error) {
      if (signal?.aborted || error instanceof CancelledError || (isAbortError(error) && signal?.aborted)) {
        throw new CancelledError()
      }

      const errorDetail = error instanceof Error ? error.message : String(error)
      const outcome: MemberOutcome = isPhaseDeadlineError(error) || closed
        ? 'timed_out'
        : 'failed'
      recordOutcome(voter.modelId, outcome, [], outcome === 'timed_out'
        ? `Council response timeout reached after ${timeoutMs}ms`
        : errorDetail)
      return []
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  })

  const settled = await Promise.allSettled(promises)
  if (signal?.aborted) {
    throw new CancelledError()
  }

  for (const result of settled) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }

  return {
    votes,
    memberOutcomes,
    deadlineReached,
    presentationOrders,
  }
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
