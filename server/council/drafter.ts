import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftGenerationResult, DraftProgressEvent, DraftResult, MemberOutcome } from './types'
import { CancelledError } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { runOpenCodePrompt, type OpenCodePromptDispatchEvent } from '../workflow/runOpenCodePrompt'

interface DraftValidationResult {
  questionCount?: number
  normalizedContent?: string
  repairApplied?: boolean
  repairWarnings?: string[]
}

type DraftValidator = (content: string) => DraftValidationResult

interface GenerateDraftsRuntimeOptions {
  ticketId?: string
  phase?: string
  phaseAttempt?: number
  onPromptDispatched?: (entry: {
    stage: 'draft'
    memberId: string
    event: OpenCodePromptDispatchEvent
  }) => void
  onDraftResult?: (draft: DraftResult) => void
  maxStructuredRetries?: number
  structuredRetrySchemaReminder?: string
}

const PHASE_DEADLINE_ERROR = 'CouncilPhaseDeadlineReached'

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function isPhaseDeadlineError(error: unknown) {
  return error instanceof Error && error.message === PHASE_DEADLINE_ERROR
}

function buildMemberOutcomeMap(drafts: DraftResult[]) {
  return drafts.reduce<Record<string, MemberOutcome>>((outcomes, draft) => {
    outcomes[draft.memberId] = draft.outcome
    return outcomes
  }, {})
}

function classifyDraftFailure(error: unknown, hasResponse: boolean) {
  return {
    outcome: hasResponse ? 'invalid_output' as const : 'failed' as const,
    errorDetail: error instanceof Error ? error.message : String(error),
  }
}

function buildStructuredRetryPrompt(
  baseParts: PromptPart[],
  validationError: string,
  rawResponse: string,
  schemaReminder?: string,
): PromptPart[] {
  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## Structured Output Retry',
        `Your previous response failed machine validation: ${validationError}`,
        'Return only a corrected artifact in the required structured format.',
        schemaReminder ? `Schema reminder:\n${schemaReminder}` : '',
        'Previous invalid response:',
        '```',
        rawResponse.trim() || '[empty response]',
        '```',
      ].filter(Boolean).join('\n\n'),
    },
  ]
}

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
  runtimeOptions?: GenerateDraftsRuntimeOptions,
): Promise<DraftGenerationResult> {
  const results = new Map<string, DraftResult>()
  const finalizedMembers = new Set<string>()
  const deadlineAt = timeout > 0 ? Date.now() + timeout : null
  let deadlineReached = false

  function recordResult(draft: DraftResult, sessionId?: string): boolean {
    if (finalizedMembers.has(draft.memberId)) return false

    finalizedMembers.add(draft.memberId)
    results.set(draft.memberId, draft)
    runtimeOptions?.onDraftResult?.(draft)
    onDraftProgress?.({
      memberId: draft.memberId,
      status: 'finished',
      sessionId,
      outcome: draft.outcome,
      duration: draft.duration,
      error: draft.error,
      content: draft.content,
      questionCount: draft.questionCount,
    })
    return true
  }

  const promises = members.map(async (member): Promise<DraftResult> => {
    const startTime = Date.now()
    let sessionId: string | undefined
    let content = ''
    let validation: DraftValidationResult | undefined
    let attemptCount = 0
    let closed = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const markTimedOut = async () => {
      if (closed) return
      closed = true
      deadlineReached = true
      if (sessionId) {
        await adapter.abortSession(sessionId)
      }
    }

    const executeDraft = (async () => {
      if (signal?.aborted) throw new CancelledError()
      let promptParts = contextParts
      let result: Awaited<ReturnType<typeof runOpenCodePrompt>> | undefined
      const maxStructuredRetries = runtimeOptions?.maxStructuredRetries ?? 1

      while (true) {
        result = await runOpenCodePrompt({
          adapter,
          projectPath,
          parts: promptParts,
          signal,
          model: member.modelId,
          ...(runtimeOptions?.ticketId && runtimeOptions.phase
            ? {
                sessionOwnership: {
                  ticketId: runtimeOptions.ticketId,
                  phase: runtimeOptions.phase,
                  phaseAttempt: runtimeOptions.phaseAttempt ?? 1,
                  memberId: member.modelId,
                },
              }
            : {}),
          onSessionCreated: (session) => {
            if (closed) {
              void adapter.abortSession(session.id)
              return
            }

            sessionId = session.id
            onDraftProgress?.({
              memberId: member.modelId,
              status: 'session_created',
              sessionId,
            })
          },
          onStreamEvent: (event) => {
            if (closed || !sessionId) return
            onOpenCodeStreamEvent?.({
              stage: 'draft',
              memberId: member.modelId,
              sessionId,
              event,
            })
          },
          onPromptDispatched: (event) => {
            if (closed) return
            runtimeOptions?.onPromptDispatched?.({
              stage: 'draft',
              memberId: member.modelId,
              event,
            })
          },
        })

        if (closed) {
          return {
            memberId: member.modelId,
            content: '',
            outcome: 'timed_out' as const,
            duration: Date.now() - startTime,
            error: `AI response timeout reached after ${timeout}ms`,
          }
        }

        content = result.response

        onOpenCodeSessionLog?.({
          stage: 'draft',
          memberId: member.modelId,
          sessionId: result.session.id,
          response: content,
          messages: result.messages,
        })

        if (!validateDraft) {
          break
        }

        try {
          validation = validateDraft(content)
          content = validation.normalizedContent ?? content
          break
        } catch (error) {
          const validationError = error instanceof Error ? error.message : String(error)
          if (attemptCount >= maxStructuredRetries) {
            throw error
          }
          attemptCount += 1
          promptParts = buildStructuredRetryPrompt(
            contextParts,
            validationError,
            content,
            runtimeOptions?.structuredRetrySchemaReminder,
          )
        }
      }

      const draft: DraftResult = {
        memberId: member.modelId,
        outcome: 'completed',
        duration: Date.now() - startTime,
        content,
        questionCount: validation?.questionCount,
      }

      if (!recordResult(draft, sessionId)) {
        return draft
      }

      return draft
    })()

    const deadlinePromise = deadlineAt === null
      ? null
      : new Promise<never>((_, reject) => {
        const remainingMs = Math.max(0, deadlineAt - Date.now())
        timeoutHandle = setTimeout(() => {
          void markTimedOut()
          reject(new Error(PHASE_DEADLINE_ERROR))
        }, remainingMs)
      })

    try {
      return deadlinePromise
        ? await Promise.race([executeDraft, deadlinePromise])
        : await executeDraft
    } catch (err) {
      if (signal?.aborted || err instanceof CancelledError || (isAbortError(err) && signal?.aborted)) {
        throw new CancelledError()
      }

      const duration = Date.now() - startTime
      if (isPhaseDeadlineError(err) || closed) {
        const draft: DraftResult = {
          memberId: member.modelId,
          content: '',
          outcome: 'timed_out',
          duration: timeout,
          error: `AI response timeout reached after ${timeout}ms`,
          questionCount: validation?.questionCount,
        }
        recordResult(draft, sessionId)
        return draft
      }

      const { outcome, errorDetail } = classifyDraftFailure(err, content.length > 0)
      const draft: DraftResult = {
        memberId: member.modelId,
        content: outcome === 'failed' ? '' : content,
        outcome,
        duration,
        error: errorDetail,
        questionCount: validation?.questionCount,
      }
      recordResult(draft, sessionId)
      return draft
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  })

  const settled = await Promise.allSettled(promises)
  if (signal?.aborted) {
    throw new CancelledError()
  }

  for (const result of settled) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }

  const drafts = members.map(member => results.get(member.modelId) ?? {
    memberId: member.modelId,
    content: '',
    outcome: 'timed_out' as const,
    duration: timeout,
    error: `AI response timeout reached after ${timeout}ms`,
  })

  return {
    drafts,
    memberOutcomes: buildMemberOutcomeMap(drafts),
    deadlineReached,
  }
}
