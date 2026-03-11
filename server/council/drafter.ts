import type { OpenCodeAdapter } from '../opencode/adapter'
import type { CouncilMember, DraftGenerationResult, DraftProgressEvent, DraftResult, MemberOutcome } from './types'
import { CancelledError } from './types'
import type { Message, PromptPart, StreamEvent } from '../opencode/types'
import { runOpenCodePrompt } from '../workflow/runOpenCodePrompt'

interface DraftValidationResult {
  questionCount?: number
}

type DraftValidator = (content: string) => DraftValidationResult

interface GenerateDraftsRuntimeOptions {
  ticketId?: string
  phase?: string
  phaseAttempt?: number
  onDraftResult?: (draft: DraftResult) => void
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

      const result = await runOpenCodePrompt({
        adapter,
        projectPath,
        parts: contextParts,
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
      })

      if (closed) {
        return {
          memberId: member.modelId,
          content: '',
          outcome: 'timed_out' as const,
          duration: Date.now() - startTime,
          error: `Council response timeout reached after ${timeout}ms`,
        }
      }

      content = result.response
      if (validateDraft) {
        validation = validateDraft(content)
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

      onOpenCodeSessionLog?.({
        stage: 'draft',
        memberId: member.modelId,
        sessionId: result.session.id,
        response: content,
        messages: result.messages,
      })

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
          duration,
          error: `Council response timeout reached after ${timeout}ms`,
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
    error: `Council response timeout reached after ${timeout}ms`,
  })

  return {
    drafts,
    memberOutcomes: buildMemberOutcomeMap(drafts),
    deadlineReached,
  }
}
