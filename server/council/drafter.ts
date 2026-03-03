import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftResult } from './types'
import type { PromptPart } from '../opencode/types'

export async function generateDrafts(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  contextParts: PromptPart[],
  projectPath: string,
  timeout: number = 300000,
): Promise<DraftResult[]> {
  const results: DraftResult[] = []

  // Run drafts in parallel — each member gets a fresh session
  const promises = members.map(async (member): Promise<DraftResult> => {
    const startTime = Date.now()
    try {
      const session = await adapter.createSession(projectPath)
      let content = ''

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      )

      const draftPromise = adapter.promptSession(session.id, contextParts)

      content = await Promise.race([draftPromise, timeoutPromise])

      return {
        memberId: member.modelId,
        content,
        outcome: 'completed',
        duration: Date.now() - startTime,
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'Timeout'
      const errorDetail = err instanceof Error ? err.message : String(err)
      return {
        memberId: member.modelId,
        content: isTimeout ? '' : `error: ${errorDetail}`,
        outcome: isTimeout ? 'timed_out' : 'invalid_output',
        duration: Date.now() - startTime,
      }
    }
  })

  const settled = await Promise.allSettled(promises)
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
    }
  }

  return results
}
