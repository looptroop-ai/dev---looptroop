import type { OpenCodeAdapter } from '../opencode/adapter'
import type { DraftResult } from './types'
import type { PromptPart } from '../opencode/types'

export async function refineDraft(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
): Promise<string> {
  const session = await adapter.createSession(projectPath)

  const refineParts: PromptPart[] = [
    ...contextParts,
    {
      type: 'text',
      content: [
        '## Winning Draft',
        winnerDraft.content,
        '',
        '## Other Drafts (incorporate superior ideas)',
        ...losingDrafts.map((d, i) => `### Alternative ${i + 1}\n${d.content}`),
        '',
        'Refine the winning draft by incorporating strong ideas from alternatives.',
        'Maintain the structure of the winning draft.',
      ].join('\n'),
    },
  ]

  const refined = await adapter.promptSession(session.id, refineParts)

  return refined || winnerDraft.content
}
