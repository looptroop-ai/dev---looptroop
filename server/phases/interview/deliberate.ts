import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { CouncilMember } from '../../council/types'
import { runCouncilPipeline } from '../../council/pipeline'
import { buildPromptFromTemplate, PROM1 } from '../../prompts/index'
import type { PromptPart } from '../../opencode/types'

export async function deliberateInterview(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketContext: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
) {
  const promptContent = buildPromptFromTemplate(PROM1, ticketContext.map(p => ({ type: p.type, content: p.content })))

  return runCouncilPipeline(adapter, {
    phase: 'interview_draft',
    members,
    contextParts: [{ type: 'text', content: promptContent }],
    projectPath,
    signal,
  })
}
