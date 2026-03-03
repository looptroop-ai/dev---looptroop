import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember, DraftResult, Vote } from '../../council/types'
import { conductVoting } from '../../council/voter'
import { buildPromptFromTemplate, PROM21 } from '../../prompts/index'
import type { PromptPart } from '../../opencode/types'

export async function voteBeads(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  drafts: DraftResult[],
  ticketContext: PromptPart[],
  projectPath: string,
): Promise<Vote[]> {
  const promptContent = buildPromptFromTemplate(PROM21, ticketContext.map(p => ({ type: p.type, content: p.content })))
  return conductVoting(adapter, members, drafts, [{ type: 'text', content: promptContent }], projectPath)
}
