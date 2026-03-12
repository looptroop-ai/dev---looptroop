import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftPhaseResult, DraftProgressEvent } from '../../council/types'
import { generateDrafts } from '../../council/drafter'
import { buildPromptFromTemplate, PROM1 } from '../../prompts/index'
import type { Message, PromptPart, StreamEvent } from '../../opencode/types'
import type { OpenCodePromptDispatchEvent } from '../../workflow/runOpenCodePrompt'
import { validateInterviewDraft } from './validation'

interface InterviewDeliberationOptions {
  draftTimeoutMs: number
  minQuorum: number
  maxInitialQuestions: number
  ticketId?: string
  phaseAttempt?: number
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
  onOpenCodePromptDispatched?: (entry: {
    stage: 'draft'
    memberId: string
    event: OpenCodePromptDispatchEvent
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
    {
      ticketId: options.ticketId,
      phase: 'COUNCIL_DELIBERATING',
      phaseAttempt: options.phaseAttempt,
      onPromptDispatched: onOpenCodePromptDispatched,
    },
  )

  return {
    phase: 'interview_draft',
    drafts: draftRun.drafts,
    memberOutcomes: draftRun.memberOutcomes,
    deadlineReached: draftRun.deadlineReached,
  }
}
