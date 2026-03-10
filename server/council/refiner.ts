import type { OpenCodeAdapter } from '../opencode/adapter'
import type { DraftResult } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { runOpenCodePrompt } from '../workflow/runOpenCodePrompt'

export async function refineDraft(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  timeoutMs: number = 300000,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onOpenCodeStreamEvent?: (entry: {
    stage: 'refine'
    memberId: string
    sessionId: string
    event: StreamEvent
  }) => void,
): Promise<string> {
  let sessionId = ''
  const refineParts: PromptPart[] = [
    ...contextParts,
    {
      type: 'text',
      content: [
        '## Winning Draft',
        winnerDraft.content,
        '',
        '## Alternative Drafts',
        ...losingDrafts.map((d, i) => `### Alternative ${i + 1}\n${d.content}`),
      ].join('\n'),
    },
  ]

  const result = await runOpenCodePrompt({
    adapter,
    projectPath,
    parts: refineParts,
    signal,
    timeoutMs,
    model: winnerDraft.memberId,
    onSessionCreated: (session) => {
      sessionId = session.id
    },
    onStreamEvent: (event) => {
      onOpenCodeStreamEvent?.({
        stage: 'refine',
        memberId: winnerDraft.memberId,
        sessionId,
        event,
      })
    },
  })
  const refined = result.response
  const messages: Message[] = result.messages

  onOpenCodeSessionLog?.({
    stage: 'refine',
    memberId: winnerDraft.memberId,
    sessionId: result.session.id,
    response: refined || winnerDraft.content,
    messages,
  })

  return refined || winnerDraft.content
}
