import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult, DraftProgressEvent } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { buildPromptFromTemplate, PROM20, PROM21, PROM22 } from '../../prompts/index'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'
import type { OpenCodePromptDispatchEvent } from '../../workflow/runOpenCodePrompt'

/** Build a context builder that returns PROM21 (vote) or PROM22 (refine) context. */
export function buildBeadsContextBuilder(ticketContext: PromptPart[]) {
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM21 : PROM22
    return [{ type: 'text', content: buildPromptFromTemplate(template, ticketContext) }]
  }
}

export async function draftBeads(
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
  onOpenCodePromptDispatched?: (entry: {
    stage: 'draft'
    memberId: string
    event: OpenCodePromptDispatchEvent
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
): Promise<DraftPhaseResult> {
  const promptContent = buildPromptFromTemplate(PROM20, ticketContext)

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
      phase: 'DRAFTING_BEADS',
      phaseAttempt: options.phaseAttempt,
      onPromptDispatched: onOpenCodePromptDispatched,
    },
  )

  return {
    phase: 'beads_draft',
    drafts: draftRun.drafts,
    memberOutcomes: draftRun.memberOutcomes,
    deadlineReached: draftRun.deadlineReached,
  }
}
