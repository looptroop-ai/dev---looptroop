import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { checkQuorum } from '../../council/quorum'
import { buildPromptFromTemplate, PROM1, PROM2, PROM3 } from '../../prompts/index'
import type { Message, PromptPart } from '../../opencode/types'

/** Build a context builder that returns PROM2 (vote) or PROM3 (refine) context. */
export function buildInterviewContextBuilder(ticketContext: PromptPart[]) {
  const contextForTemplate = ticketContext.map(p => ({ type: p.type, content: p.content }))
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM2 : PROM3
    return [{ type: 'text', content: buildPromptFromTemplate(template, contextForTemplate) }]
  }
}

export async function deliberateInterview(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
): Promise<DraftPhaseResult> {
  const contextForTemplate = ticketContext.map(p => ({ type: p.type, content: p.content }))
  const promptContent = buildPromptFromTemplate(PROM1, contextForTemplate)

  const drafts = await generateDrafts(
    adapter,
    members,
    [{ type: 'text', content: promptContent }],
    projectPath,
    300000,
    signal,
    onOpenCodeSessionLog,
  )

  const quorum = checkQuorum(drafts, 2)
  if (!quorum.passed) {
    throw new Error(`Council quorum not met for interview_draft: ${quorum.message}`)
  }

  const memberOutcomes: Record<string, import('../../council/types').MemberOutcome> = {}
  for (const draft of drafts) {
    memberOutcomes[draft.memberId] = draft.outcome
  }

  return { phase: 'interview_draft', drafts, memberOutcomes }
}
