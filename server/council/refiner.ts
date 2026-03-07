import type { OpenCodeAdapter } from '../opencode/adapter'
import type { DraftResult } from './types'
import type { Message, PromptPart } from '../opencode/types'

export async function refineDraft(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
): Promise<string> {
  const session = await adapter.createSession(projectPath, signal)

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

  const refined = await adapter.promptSession(session.id, refineParts, signal)
  const messages: Message[] = await adapter.getSessionMessages(session.id)

  onOpenCodeSessionLog?.({
    stage: 'refine',
    memberId: winnerDraft.memberId,
    sessionId: session.id,
    response: refined || winnerDraft.content,
    messages,
  })

  return refined || winnerDraft.content
}
