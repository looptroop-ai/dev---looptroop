import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { buildPromptFromTemplate, PROM52 } from '../../prompts/index'
import { runOpenCodePrompt } from '../../workflow/runOpenCodePrompt'
import { throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'

export async function generateFinalTests(
  adapter: OpenCodeAdapter,
  ticketContext: PromptPart[],
  projectPath: string,
  signal?: AbortSignal,
  callbacks?: {
    model?: string
    onSessionCreated?: (sessionId: string) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; event: StreamEvent }) => void
  },
): Promise<string> {
  const promptContent = buildPromptFromTemplate(PROM52, ticketContext)
  let sessionId = ''
  throwIfAborted(signal)
  let result: Awaited<ReturnType<typeof runOpenCodePrompt>>
  try {
    result = await runOpenCodePrompt({
      adapter,
      projectPath,
      parts: [{ type: 'text', content: promptContent }],
      signal,
      model: callbacks?.model,
      onSessionCreated: (session) => {
        sessionId = session.id
        callbacks?.onSessionCreated?.(session.id)
      },
      onStreamEvent: (event) => {
        if (!sessionId) return
        callbacks?.onOpenCodeStreamEvent?.({
          sessionId,
          event,
        })
      },
    })
  } catch (error) {
    throwIfCancelled(error, signal)
    throw error
  }
  throwIfAborted(signal)

  return result.response
}
