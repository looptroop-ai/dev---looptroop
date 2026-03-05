import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftResult } from './types'
import { CancelledError } from './types'
import type { PromptPart } from '../opencode/types'

export async function generateDrafts(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  contextParts: PromptPart[],
  projectPath: string,
  timeout: number = 300000,
  signal?: AbortSignal,
): Promise<DraftResult[]> {
  const results: DraftResult[] = []

  // Run drafts in parallel — each member gets a fresh session
  const promises = members.map(async (member): Promise<DraftResult> => {
    const startTime = Date.now()
    try {
      if (signal?.aborted) throw new CancelledError()
      const session = await adapter.createSession(projectPath, signal)
      let content = ''

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      )

      const draftPromise = adapter.promptSession(session.id, contextParts, signal)

      content = await Promise.race([draftPromise, timeoutPromise])

      return {
        memberId: member.modelId,
        content,
        outcome: 'completed',
        duration: Date.now() - startTime,
      }
    } catch (err) {
      if (err instanceof CancelledError || (err instanceof Error && err.name === 'AbortError')) {
        throw new CancelledError()
      }
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
    // Rejected results from CancelledError propagate up naturally
  }

  // If ALL results were rejected (all cancelled), re-throw
  if (results.length === 0 && signal?.aborted) {
    throw new CancelledError()
  }

  return results
}
