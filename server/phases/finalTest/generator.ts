import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart } from '../../opencode/types'
import { buildPromptFromTemplate, PROM52 } from '../../prompts/index'

export async function generateFinalTests(
  adapter: OpenCodeAdapter,
  ticketContext: PromptPart[],
  projectPath: string,
): Promise<string> {
  const session = await adapter.createSession(projectPath)
  const promptContent = buildPromptFromTemplate(
    PROM52,
    ticketContext.map((p) => ({ type: p.type, content: p.content })),
  )

  const output = await adapter.promptSession(session.id, [{ type: 'text', content: promptContent }])

  return output
}
