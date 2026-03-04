import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { DraftResult } from '../../council/types'
import { refineDraft } from '../../council/refiner'
import { buildPromptFromTemplate, PROM22 } from '../../prompts/index'
import type { PromptPart } from '../../opencode/types'

export async function refineBeads(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  ticketContext: PromptPart[],
  projectPath: string,
): Promise<string> {
  const promptContent = buildPromptFromTemplate(PROM22, ticketContext.map(p => ({ type: p.type, content: p.content })))
  return refineDraft(adapter, winnerDraft, losingDrafts, [{ type: 'text', content: promptContent }], projectPath)
}
