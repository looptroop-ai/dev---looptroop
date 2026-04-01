import type { OpenCodeAdapter } from '../opencode/adapter'
import type { DraftResult } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import type { OpenCodeToolPolicy } from '../opencode/toolPolicy'
import { runOpenCodePrompt, type OpenCodePromptDispatchEvent } from '../workflow/runOpenCodePrompt'
import { buildStructuredRetryPrompt } from '../structuredOutput'
import { COUNCIL_RESPONSE_TIMEOUT_MS } from '../lib/constants'

export async function refineDraft(
  adapter: OpenCodeAdapter,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  contextParts: PromptPart[],
  projectPath: string,
  timeoutMs: number = COUNCIL_RESPONSE_TIMEOUT_MS,
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
  buildRetryPrompt?: (params: {
    baseParts: PromptPart[]
    validationError: string
    rawResponse: string
  }) => PromptPart[],
  toolPolicy: OpenCodeToolPolicy = 'default',
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
            ...losingDrafts.map((d, i) => `### Alternative ${i + 1} (model: ${d.memberId})\n${d.content}`),
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
      toolPolicy,
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
      const validationError = error instanceof Error ? error.message : String(error)
      promptParts = buildRetryPrompt?.({
        baseParts: refineParts,
        validationError,
        rawResponse: refined,
      }) ?? buildStructuredRetryPrompt(refineParts, {
        validationError,
        rawResponse: refined,
        schemaReminder,
      })
    }
  }
}
