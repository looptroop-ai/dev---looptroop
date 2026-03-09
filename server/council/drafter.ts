import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftProgressEvent, DraftResult } from './types'
import { CancelledError } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { runOpenCodePrompt } from '../workflow/runOpenCodePrompt'

interface DraftValidationResult {
  questionCount?: number
}

type DraftValidator = (content: string) => DraftValidationResult

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
  onOpenCodeStreamEvent?: (entry: {
    stage: 'draft'
    memberId: string
    sessionId: string
    event: StreamEvent
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
  validateDraft?: DraftValidator,
): Promise<DraftResult[]> {
  const results: DraftResult[] = []

  // Run drafts in parallel — each member gets a fresh session
  const promises = members.map(async (member): Promise<DraftResult> => {
    const startTime = Date.now()
    let sessionId: string | undefined
    let content = ''
    try {
      if (signal?.aborted) throw new CancelledError()
      const result = await runOpenCodePrompt({
        adapter,
        projectPath,
        parts: contextParts,
        signal,
        timeoutMs: timeout,
        model: member.modelId,
        onSessionCreated: (session) => {
          sessionId = session.id
          onDraftProgress?.({
            memberId: member.modelId,
            status: 'session_created',
            sessionId,
          })
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          onOpenCodeStreamEvent?.({
            stage: 'draft',
            memberId: member.modelId,
            sessionId,
            event,
          })
        },
      })
      content = result.response
      const messages: Message[] = result.messages

      onOpenCodeSessionLog?.({
        stage: 'draft',
        memberId: member.modelId,
        sessionId: result.session.id,
        response: content,
        messages,
      })

      let validation: DraftValidationResult | undefined
      if (validateDraft) {
        validation = validateDraft(content)
      }

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
        questionCount: validation?.questionCount,
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
        content: isTimeout ? '' : content,
        outcome,
        duration,
        error: errorDetail,
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
