import type { OpenCodeAdapter } from '../../opencode/adapter'
import type {
  CouncilMember,
  DraftPhaseResult,
  DraftProgressEvent,
  DraftResult,
  DraftStructuredOutputMeta,
  MemberOutcome,
} from '../../council/types'
import { CancelledError } from '../../council/types'
import { classifyDraftFailure, isAbortError, isPhaseDeadlineError, PHASE_DEADLINE_ERROR } from '../../council/draftUtils'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import type { Message, PromptPart, Session, StreamEvent } from '../../opencode/types'
import { SessionManager } from '../../opencode/sessionManager'
import { buildPromptFromTemplate, PROM09D, PROM10, PROM11, PROM12 } from '../../prompts/index'
import type { OpenCodePromptDispatchEvent } from '../../workflow/runOpenCodePrompt'
import { runOpenCodePrompt, runOpenCodeSessionPrompt } from '../../workflow/runOpenCodePrompt'
import { buildStructuredRetryPrompt } from '../../structuredOutput'
import { validatePrdDraft, validateResolvedInterview } from './validation'

interface StepValidationResult {
  questionCount?: number
  draftMetrics?: DraftResult['draftMetrics']
  normalizedContent?: string
  repairApplied?: boolean
  repairWarnings?: string[]
}

interface StructuredStepSuccess {
  session: Session
  content: string
  questionCount?: number
  draftMetrics?: DraftResult['draftMetrics']
  structuredOutput: DraftStructuredOutputMeta
}

class StructuredStepError extends Error {
  constructor(
    message: string,
    readonly content: string,
    readonly structuredOutput: DraftStructuredOutputMeta,
    readonly questionCount?: number,
    readonly draftMetrics?: DraftResult['draftMetrics'],
  ) {
    super(message)
    this.name = 'StructuredStepError'
  }
}

export interface PrdDraftPhaseResult extends DraftPhaseResult {
  fullAnswers: DraftResult[]
  fullAnswerOutcomes: Record<string, MemberOutcome>
}

export interface PrdDraftStepEvent {
  memberId: string
  step: 'full_answers' | 'prd_draft'
  status: 'started' | 'completed' | 'skipped' | 'failed'
  outcome?: MemberOutcome
  duration?: number
  error?: string
}

/** Build a context builder that returns PROM11 (vote) or PROM12 (refine) context. */
export function buildPrdContextBuilder(ticketState: TicketState) {
  return (step: 'vote' | 'refine'): PromptPart[] => {
    const template = step === 'vote' ? PROM11 : PROM12
    const contextPhase = step === 'vote' ? 'prd_vote' : 'prd_refine'
    return [{ type: 'text', content: buildPromptFromTemplate(template, buildMinimalContext(contextPhase, ticketState)) }]
  }
}

function buildPromptParts(template: typeof PROM09D | typeof PROM10, contextParts: PromptPart[]): PromptPart[] {
  return [{ type: 'text', content: buildPromptFromTemplate(template, contextParts) }]
}

function buildStructuredOutput(
  validation: StepValidationResult | undefined,
  lastValidationError: string | undefined,
  attemptCount: number,
): DraftStructuredOutputMeta {
  return {
    repairApplied: validation?.repairApplied ?? false,
    repairWarnings: validation?.repairWarnings ?? [],
    autoRetryCount: attemptCount,
    ...(lastValidationError ? { validationError: lastValidationError } : {}),
  }
}

function buildFailedDraft(
  memberId: string,
  outcome: MemberOutcome,
  duration: number,
  error: string,
  content = '',
  questionCount?: number,
  draftMetrics?: DraftResult['draftMetrics'],
  structuredOutput?: DraftStructuredOutputMeta,
): DraftResult {
  return {
    memberId,
    content,
    outcome,
    duration,
    error,
    questionCount,
    draftMetrics,
    structuredOutput,
  }
}

function buildCompletedDraft(
  memberId: string,
  duration: number,
  content: string,
  questionCount?: number,
  draftMetrics?: DraftResult['draftMetrics'],
  structuredOutput?: DraftStructuredOutputMeta,
): DraftResult {
  return {
    memberId,
    content,
    outcome: 'completed',
    duration,
    questionCount,
    draftMetrics,
    structuredOutput,
  }
}

async function executeStructuredStep(
  adapter: OpenCodeAdapter,
  member: CouncilMember,
  projectPath: string,
  baseParts: PromptPart[],
  options: {
    signal?: AbortSignal
    ticketId?: string
    phaseAttempt?: number
    timeoutMs: number
    activeSession?: Session
    deadlineAt: number | null
    validateStep: (content: string) => StepValidationResult
    schemaReminder: string
    onOpenCodeSessionLog?: (entry: {
      stage: 'draft' | 'vote' | 'refine'
      memberId: string
      sessionId: string
      response: string
      messages: Message[]
    }) => void
    onOpenCodeStreamEvent?: (entry: {
      stage: 'draft'
      memberId: string
      sessionId: string
      event: StreamEvent
    }) => void
    onOpenCodePromptDispatched?: (entry: {
      stage: 'draft'
      memberId: string
      event: OpenCodePromptDispatchEvent
    }) => void
    onSessionCreated?: (sessionId: string) => void
  },
): Promise<StructuredStepSuccess> {
  let session = options.activeSession
  let promptParts = baseParts
  let attemptCount = 0
  let validation: StepValidationResult | undefined
  let lastValidationError: string | undefined
  let rawResponse = ''

  const sessionOwnership = options.ticketId
    ? {
        ticketId: options.ticketId,
        phase: 'DRAFTING_PRD',
        phaseAttempt: options.phaseAttempt ?? 1,
        memberId: member.modelId,
        keepActive: true,
      }
    : undefined

  while (true) {
    if (options.signal?.aborted) throw new CancelledError()

    const remainingTimeoutMs = options.deadlineAt === null
      ? options.timeoutMs
      : Math.max(1, options.deadlineAt - Date.now())
    if (options.deadlineAt !== null && remainingTimeoutMs <= 0) {
      throw new Error(PHASE_DEADLINE_ERROR)
    }

    const result = session
      ? await runOpenCodeSessionPrompt({
          adapter,
          session,
          parts: promptParts,
          signal: options.signal,
          timeoutMs: remainingTimeoutMs,
          model: member.modelId,
          variant: member.variant,
          ...(sessionOwnership ? { sessionOwnership } : {}),
          onStreamEvent: (event) => {
            options.onOpenCodeStreamEvent?.({
              stage: 'draft',
              memberId: member.modelId,
              sessionId: session!.id,
              event,
            })
          },
          onPromptDispatched: (event) => {
            options.onOpenCodePromptDispatched?.({
              stage: 'draft',
              memberId: member.modelId,
              event,
            })
          },
        })
      : await runOpenCodePrompt({
          adapter,
          projectPath,
          parts: promptParts,
          signal: options.signal,
          timeoutMs: remainingTimeoutMs,
          model: member.modelId,
          variant: member.variant,
          ...(sessionOwnership ? { sessionOwnership } : {}),
          onSessionCreated: (createdSession) => {
            session = createdSession
            options.onSessionCreated?.(createdSession.id)
          },
          onStreamEvent: (event) => {
            if (!session) return
            options.onOpenCodeStreamEvent?.({
              stage: 'draft',
              memberId: member.modelId,
              sessionId: session.id,
              event,
            })
          },
          onPromptDispatched: (event) => {
            options.onOpenCodePromptDispatched?.({
              stage: 'draft',
              memberId: member.modelId,
              event,
            })
          },
        })

    session = result.session
    rawResponse = result.response
    options.onOpenCodeSessionLog?.({
      stage: 'draft',
      memberId: member.modelId,
      sessionId: result.session.id,
      response: result.response,
      messages: result.messages,
    })

    try {
      validation = options.validateStep(rawResponse)
      return {
        session: result.session,
        content: validation.normalizedContent ?? rawResponse,
        questionCount: validation.questionCount,
        draftMetrics: validation.draftMetrics,
        structuredOutput: buildStructuredOutput(validation, lastValidationError, attemptCount),
      }
    } catch (error) {
      lastValidationError = error instanceof Error ? error.message : String(error)
      if (attemptCount >= 1) {
        throw new StructuredStepError(
          lastValidationError,
          rawResponse,
          buildStructuredOutput(validation, lastValidationError, attemptCount),
          validation?.questionCount,
          validation?.draftMetrics,
        )
      }

      attemptCount += 1
      promptParts = buildStructuredRetryPrompt(baseParts, {
        validationError: lastValidationError,
        rawResponse,
        schemaReminder: options.schemaReminder,
      })
    }
  }
}

export async function draftPRD(
  adapter: OpenCodeAdapter,
  members: CouncilMember[],
  ticketState: TicketState,
  projectPath: string,
  options: {
    draftTimeoutMs: number
    minQuorum: number
    ticketId?: string
    ticketExternalId?: string
    phaseAttempt?: number
  },
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
  onOpenCodePromptDispatched?: (entry: {
    stage: 'draft'
    memberId: string
    event: OpenCodePromptDispatchEvent
  }) => void,
  onDraftProgress?: (entry: DraftProgressEvent) => void,
  onFullAnswersProgress?: (entry: DraftProgressEvent) => void,
  onStepEvent?: (entry: PrdDraftStepEvent) => void,
): Promise<PrdDraftPhaseResult> {
  const canonicalInterview = ticketState.interview ?? ''
  if (!canonicalInterview.trim()) {
    throw new Error('Canonical interview artifact is required before PRD drafting')
  }

  const shouldResolveGaps = canonicalInterview.includes('skipped: true')
  const deadlineAt = options.draftTimeoutMs > 0 ? Date.now() + options.draftTimeoutMs : null
  let deadlineReached = false

  const results = await Promise.all(members.map(async (member) => {
    const memberStart = Date.now()
    const sessionManager = new SessionManager(adapter)
    let activeSession: Session | undefined
    let fullAnswersResult: DraftResult | null = null
    let prdResult: DraftResult | null = null

    const emitFailedResult = (error: unknown, step: 'full_answers' | 'prd_draft') => {
      if (signal?.aborted || error instanceof CancelledError || (isAbortError(error) && signal?.aborted)) {
        throw new CancelledError()
      }

      const duration = Date.now() - memberStart
      const timedOut = isPhaseDeadlineError(error) || (error instanceof Error && error.message === 'Timeout')
      if (timedOut) deadlineReached = true
      const timedOutDuration = options.draftTimeoutMs
      const structuredError = error instanceof StructuredStepError ? error : null
      const errorContent = structuredError?.content ?? ''

      const failed = timedOut
        ? buildFailedDraft(
            member.modelId,
            'timed_out',
            timedOutDuration,
            `AI response timeout reached after ${options.draftTimeoutMs}ms`,
            '',
            structuredError?.questionCount,
            structuredError?.draftMetrics,
            structuredError?.structuredOutput,
          )
        : (() => {
            const { outcome, errorDetail } = classifyDraftFailure(error, errorContent.length > 0)
            return buildFailedDraft(
              member.modelId,
              outcome,
              duration,
              errorDetail,
              outcome === 'failed' ? '' : errorContent,
              structuredError?.questionCount,
              structuredError?.draftMetrics,
              structuredError?.structuredOutput,
            )
          })()

      onStepEvent?.({
        memberId: member.modelId,
        step,
        status: 'failed',
        outcome: failed.outcome,
        duration: failed.duration,
        error: failed.error,
      })

      if (!fullAnswersResult) {
        fullAnswersResult = failed
        onFullAnswersProgress?.({
          memberId: member.modelId,
          status: 'finished',
          sessionId: activeSession?.id,
          outcome: fullAnswersResult.outcome,
          duration: fullAnswersResult.duration,
          error: fullAnswersResult.error,
          content: fullAnswersResult.content,
          questionCount: fullAnswersResult.questionCount,
          structuredOutput: fullAnswersResult.structuredOutput,
        })
      }

      if (!prdResult) {
        prdResult = failed
        onDraftProgress?.({
          memberId: member.modelId,
          status: 'finished',
          sessionId: activeSession?.id,
          outcome: prdResult.outcome,
          duration: prdResult.duration,
          error: prdResult.error,
          content: prdResult.content,
          questionCount: prdResult.questionCount,
          draftMetrics: prdResult.draftMetrics,
          structuredOutput: prdResult.structuredOutput,
        })
      }
    }

    try {
      let resolvedInterviewContent: string

      if (shouldResolveGaps) {
        onStepEvent?.({ memberId: member.modelId, step: 'full_answers', status: 'started' })
        const gapResolutionParts = buildPromptParts(
          PROM09D,
          buildMinimalContext('prd_draft', {
            ...ticketState,
            fullAnswers: undefined,
          }),
        )

        const fullAnswersStep = await executeStructuredStep(adapter, member, projectPath, gapResolutionParts, {
          signal,
          ticketId: options.ticketId,
          phaseAttempt: options.phaseAttempt,
          timeoutMs: options.draftTimeoutMs,
          activeSession,
          deadlineAt,
          validateStep: (content) => {
            const result = validateResolvedInterview(content, {
              ticketId: options.ticketExternalId ?? options.ticketId ?? '',
              canonicalInterviewContent: canonicalInterview,
              memberId: member.modelId,
            })
            return {
              questionCount: result.questionCount,
              normalizedContent: result.normalizedContent,
              repairApplied: result.repairApplied,
              repairWarnings: result.repairWarnings,
            }
          },
          schemaReminder: PROM09D.outputFormat,
          onOpenCodeSessionLog,
          onOpenCodeStreamEvent,
          onOpenCodePromptDispatched,
          onSessionCreated: (sessionId) => {
            onFullAnswersProgress?.({
              memberId: member.modelId,
              status: 'session_created',
              sessionId,
            })
          },
        })

        activeSession = fullAnswersStep.session
        resolvedInterviewContent = fullAnswersStep.content
        fullAnswersResult = buildCompletedDraft(
          member.modelId,
          Date.now() - memberStart,
          fullAnswersStep.content,
          fullAnswersStep.questionCount,
          undefined,
          fullAnswersStep.structuredOutput,
        )
        onFullAnswersProgress?.({
          memberId: member.modelId,
          status: 'finished',
          sessionId: activeSession.id,
          outcome: 'completed',
          duration: fullAnswersResult.duration,
          content: fullAnswersResult.content,
          questionCount: fullAnswersResult.questionCount,
          structuredOutput: fullAnswersResult.structuredOutput,
        })
        onStepEvent?.({
          memberId: member.modelId,
          step: 'full_answers',
          status: 'completed',
          outcome: 'completed',
          duration: fullAnswersResult.duration,
        })
      } else {
        const syntheticFullAnswers = validateResolvedInterview(canonicalInterview, {
          ticketId: options.ticketExternalId ?? options.ticketId ?? '',
          canonicalInterviewContent: canonicalInterview,
          memberId: member.modelId,
        })
        resolvedInterviewContent = syntheticFullAnswers.normalizedContent
        fullAnswersResult = buildCompletedDraft(
          member.modelId,
          0,
          resolvedInterviewContent,
          syntheticFullAnswers.questionCount,
          undefined,
          {
            repairApplied: syntheticFullAnswers.repairApplied,
            repairWarnings: syntheticFullAnswers.repairWarnings,
            autoRetryCount: 0,
          },
        )
        onStepEvent?.({
          memberId: member.modelId,
          step: 'full_answers',
          status: 'skipped',
          outcome: 'completed',
        })
        onFullAnswersProgress?.({
          memberId: member.modelId,
          status: 'finished',
          outcome: 'completed',
          duration: 0,
          content: fullAnswersResult.content,
          questionCount: fullAnswersResult.questionCount,
          structuredOutput: fullAnswersResult.structuredOutput,
        })
      }

      onStepEvent?.({ memberId: member.modelId, step: 'prd_draft', status: 'started' })
      const prdPromptParts = buildPromptParts(
        PROM10,
        buildMinimalContext('prd_draft', {
          ...ticketState,
          interview: undefined,
          fullAnswers: [resolvedInterviewContent],
        }),
      )

      const prdStep = await executeStructuredStep(adapter, member, projectPath, prdPromptParts, {
        signal,
        ticketId: options.ticketId,
        phaseAttempt: options.phaseAttempt,
        timeoutMs: options.draftTimeoutMs,
        activeSession,
        deadlineAt,
        validateStep: (content) => {
          const result = validatePrdDraft(content, {
            ticketId: options.ticketExternalId ?? options.ticketId ?? '',
            interviewContent: resolvedInterviewContent,
          })
          return {
            normalizedContent: result.normalizedContent,
            repairApplied: result.repairApplied,
            repairWarnings: result.repairWarnings,
            draftMetrics: result.metrics,
          }
        },
        schemaReminder: PROM10.outputFormat,
        onOpenCodeSessionLog,
        onOpenCodeStreamEvent,
        onOpenCodePromptDispatched,
      })

      activeSession = prdStep.session
      prdResult = buildCompletedDraft(
        member.modelId,
        Date.now() - memberStart,
        prdStep.content,
        undefined,
        prdStep.draftMetrics,
        prdStep.structuredOutput,
      )
      onDraftProgress?.({
        memberId: member.modelId,
        status: 'finished',
        sessionId: activeSession.id,
        outcome: 'completed',
        duration: prdResult.duration,
        content: prdResult.content,
        draftMetrics: prdResult.draftMetrics,
        structuredOutput: prdResult.structuredOutput,
      })
      onStepEvent?.({
        memberId: member.modelId,
        step: 'prd_draft',
        status: 'completed',
        outcome: 'completed',
        duration: prdResult.duration,
      })

      if (activeSession) {
        await sessionManager.completeSession(activeSession.id)
      }

      return {
        fullAnswers: fullAnswersResult,
        prd: prdResult,
      }
    } catch (error) {
      try {
        if (activeSession) {
          await sessionManager.abandonSession(activeSession.id)
        }
      } catch {
        // Best effort cleanup only.
      }

      const failedStep = fullAnswersResult ? 'prd_draft' : 'full_answers'
      emitFailedResult(error, failedStep)
      return {
        fullAnswers: fullAnswersResult!,
        prd: prdResult!,
      }
    }
  }))

  const fullAnswers = results.map((result) => result.fullAnswers)
  const drafts = results.map((result) => result.prd)

  return {
    phase: 'prd_draft',
    drafts,
    fullAnswers,
    memberOutcomes: drafts.reduce<Record<string, MemberOutcome>>((acc, draft) => {
      acc[draft.memberId] = draft.outcome
      return acc
    }, {}),
    fullAnswerOutcomes: fullAnswers.reduce<Record<string, MemberOutcome>>((acc, draft) => {
      acc[draft.memberId] = draft.outcome
      return acc
    }, {}),
    deadlineReached,
  }
}
