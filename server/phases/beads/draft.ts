import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember } from '../../council/types'
import { runCouncilPipeline } from '../../council/pipeline'
import { buildPromptFromTemplate, PROM20 } from '../../prompts/index'
import type { PromptPart } from '../../opencode/types'

export async function draftBeads(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
) {
  const promptContent = buildPromptFromTemplate(PROM20, ticketContext.map(p => ({ type: p.type, content: p.content })))

  return runCouncilPipeline(adapter, {
    phase: 'beads_draft',
    members,
    contextParts: [{ type: 'text', content: promptContent }],
    projectPath,
  })
}
