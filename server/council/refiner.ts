import type { OpenCodeAdapter } from '../opencode/adapter'
import type { DraftResult } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { runOpenCodePrompt, type OpenCodePromptDispatchEvent } from '../workflow/runOpenCodePrompt'
import { buildStructuredRetryPrompt } from '../structuredOutput'

export async function refineDraft(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  timeoutMs: number = 300000,
  signal?: AbortSignal,
  onOpenCodeSessionLog?: (entry: {
    stage: 'draft' | 'vote' | 'refine'
    memberId: string
    sessionId: string
    response: string
    messages: Message[]
  }) => void,
  onOpenCodeStreamEvent?: (entry: {
    stage: 'refine'
    memberId: string
    sessionId: string
    event: StreamEvent
  }) => void,
  onOpenCodePromptDispatched?: (entry: {
    stage: 'refine'
    memberId: string
    event: OpenCodePromptDispatchEvent
  }) => void,
  sessionOwnership?: {
    ticketId: string
    phase: string
    phaseAttempt?: number
  },
  buildPrompt?: (winnerDraft: DraftResult, losingDrafts: DraftResult[]) => PromptPart[],
  validateResponse?: (content: string) => { normalizedContent?: string },
  schemaReminder?: string,
): Promise<string> {
  let sessionId = ''
  const refineParts = buildPrompt
    ? buildPrompt(winnerDraft, losingDrafts)
    : [
        ...contextParts,
        {
          type: 'text' as const,
          content: [
            '## Winning Draft',
            winnerDraft.content,
            '',
            '## Alternative Drafts',
            ...losingDrafts.map((d, i) => `### Alternative ${i + 1}\n${d.content}`),
          ].join('\n'),
        },
      ]
  let promptParts = refineParts
  let attemptCount = 0
  const maxStructuredRetries = 1

  while (true) {
    const result = await runOpenCodePrompt({
      adapter,
      projectPath,
      parts: promptParts,
      signal,
      timeoutMs,
      model: winnerDraft.memberId,
      ...(sessionOwnership
        ? {
            sessionOwnership: {
              ticketId: sessionOwnership.ticketId,
              phase: sessionOwnership.phase,
              phaseAttempt: sessionOwnership.phaseAttempt ?? 1,
              memberId: winnerDraft.memberId,
            },
          }
        : {}),
      onSessionCreated: (session) => {
        sessionId = session.id
      },
      onStreamEvent: (event) => {
        onOpenCodeStreamEvent?.({
          stage: 'refine',
          memberId: winnerDraft.memberId,
          sessionId,
          event,
        })
      },
      onPromptDispatched: (event) => {
        onOpenCodePromptDispatched?.({
          stage: 'refine',
          memberId: winnerDraft.memberId,
          event,
        })
      },
    })
    const refined = result.response || winnerDraft.content
    const messages: Message[] = result.messages

    onOpenCodeSessionLog?.({
      stage: 'refine',
      memberId: winnerDraft.memberId,
      sessionId: result.session.id,
      response: refined,
      messages,
    })

    if (!validateResponse) {
      return refined
    }

    try {
      const validation = validateResponse(refined)
      return validation.normalizedContent ?? refined
    } catch (error) {
      if (attemptCount >= maxStructuredRetries) {
        throw error
      }
      attemptCount += 1
      promptParts = buildStructuredRetryPrompt(refineParts, {
        validationError: error instanceof Error ? error.message : String(error),
        rawResponse: refined,
        schemaReminder,
      })
    }
  }
}
