import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult, DraftProgressEvent } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { checkQuorum } from '../../council/quorum'
import { buildPromptFromTemplate, PROM10, PROM11, PROM12 } from '../../prompts/index'
import type { Message, PromptPart } from '../../opencode/types'

/** Build a context builder that returns PROM11 (vote) or PROM12 (refine) context. */
export function buildPrdContextBuilder(ticketContext: PromptPart[]) {
  const contextForTemplate = ticketContext.map(p => ({ type: p.type, content: p.content }))
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM11 : PROM12
    return [{ type: 'text', content: buildPromptFromTemplate(template, contextForTemplate) }]
  }
}

export async function draftPRD(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
): Promise<DraftPhaseResult> {
  const contextForTemplate = ticketContext.map(p => ({ type: p.type, content: p.content }))
  const promptContent = buildPromptFromTemplate(PROM10, contextForTemplate)

  const drafts = await generateDrafts(
    adapter,
    members,
    [{ type: 'text', content: promptContent }],
    projectPath,
    300000,
    undefined,
    onOpenCodeSessionLog,
    onDraftProgress,
  )

  const quorum = checkQuorum(drafts, 2)
  if (!quorum.passed) {
    throw new Error(`Council quorum not met for prd_draft: ${quorum.message}`)
  }

  const memberOutcomes: Record<string, import('../../council/types').MemberOutcome> = {}
  for (const draft of drafts) {
    memberOutcomes[draft.memberId] = draft.outcome
  }

  return { phase: 'prd_draft', drafts, memberOutcomes }
}
