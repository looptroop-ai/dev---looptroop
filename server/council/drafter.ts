import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftProgressEvent, DraftResult } from './types'
import { CancelledError } from './types'
import type { Message, PromptPart } from '../opencode/types'

export async function generateDrafts(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  contextParts: PromptPart[],
  projectPath: string,
  timeout: number = 300000,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
): Promise<DraftResult[]> {
  const results: DraftResult[] = []

  // Run drafts in parallel — each member gets a fresh session
  const promises = members.map(async (member): Promise<DraftResult> => {
    const startTime = Date.now()
    let sessionId: string | undefined
    try {
      if (signal?.aborted) throw new CancelledError()
      const session = await adapter.createSession(projectPath, signal)
      sessionId = session.id
      onDraftProgress?.({
        memberId: member.modelId,
        status: 'session_created',
        sessionId,
      })
      let content = ''

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      )

      const draftPromise = adapter.promptSession(session.id, contextParts, signal)

      content = await Promise.race([draftPromise, timeoutPromise])
      const messages: Message[] = await adapter.getSessionMessages(session.id)

      onOpenCodeSessionLog?.({
        stage: 'draft',
        memberId: member.modelId,
        sessionId: session.id,
        response: content,
        messages,
      })

      onDraftProgress?.({
        memberId: member.modelId,
        status: 'finished',
        sessionId,
        outcome: 'completed',
        duration: Date.now() - startTime,
      })

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
      const outcome = isTimeout ? 'timed_out' : 'invalid_output'
      const duration = Date.now() - startTime
      onDraftProgress?.({
        memberId: member.modelId,
        status: 'finished',
        sessionId,
        outcome,
        duration,
        error: errorDetail,
      })
      return {
        memberId: member.modelId,
        content: isTimeout ? '' : `error: ${errorDetail}`,
        outcome,
        duration,
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
