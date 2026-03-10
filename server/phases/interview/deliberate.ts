import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult, DraftProgressEvent } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { buildPromptFromTemplate, PROM1, PROM2, PROM3 } from '../../prompts/index'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'
import { validateInterviewDraft } from './validation'

interface InterviewDeliberationOptions {
  draftTimeoutMs: number
  minQuorum: number
  maxInitialQuestions: number
}

/** Build a context builder that returns PROM2 (vote) or PROM3 (refine) context. */
export function buildInterviewContextBuilder(ticketContext: PromptPart[]) {
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM2 : PROM3
    return [{ type: 'text', content: buildPromptFromTemplate(template, ticketContext) }]
  }
}

export async function deliberateInterview(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
  options: InterviewDeliberationOptions,
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
  const promptContent = [
    buildPromptFromTemplate(PROM1, ticketContext),
    '',
    '## Configuration',
    `max_initial_questions: ${options.maxInitialQuestions}`,
  ].join('\n')

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
    (content) => validateInterviewDraft(content, options.maxInitialQuestions),
  )

  return {
    phase: 'interview_draft',
    drafts: draftRun.drafts,
    memberOutcomes: draftRun.memberOutcomes,
    deadlineReached: draftRun.deadlineReached,
  }
}
