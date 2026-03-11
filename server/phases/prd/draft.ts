import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult, DraftProgressEvent } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { buildPromptFromTemplate, PROM10, PROM11, PROM12 } from '../../prompts/index'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'

/** Build a context builder that returns PROM11 (vote) or PROM12 (refine) context. */
export function buildPrdContextBuilder(ticketContext: PromptPart[]) {
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM11 : PROM12
    return [{ type: 'text', content: buildPromptFromTemplate(template, ticketContext) }]
  }
}

export async function draftPRD(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
  options: {
    draftTimeoutMs: number
    minQuorum: number
    ticketId?: string
    phaseAttempt?: number
  },
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onOpenCodeStreamEvent?: (entry: {
    stage: 'draft'
    memberId: string
    sessionId: string
    event: StreamEvent
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
): Promise<DraftPhaseResult> {
  const promptContent = buildPromptFromTemplate(PROM10, ticketContext)

  const draftRun = await generateDrafts(
    adapter,
    members,
    [{ type: 'text', content: promptContent }],
    projectPath,
    options.draftTimeoutMs,
    signal,
    onOpenCodeSessionLog,
    onOpenCodeStreamEvent,
    onDraftProgress,
    undefined,
    {
      ticketId: options.ticketId,
      phase: 'DRAFTING_PRD',
      phaseAttempt: options.phaseAttempt,
    },
  )

  return {
    phase: 'prd_draft',
    drafts: draftRun.drafts,
    memberOutcomes: draftRun.memberOutcomes,
    deadlineReached: draftRun.deadlineReached,
  }
}
