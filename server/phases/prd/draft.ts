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
import type { OpenCodeToolPolicy } from '../../opencode/toolPolicy'
import type { Message, PromptPart, Session, StreamEvent } from '../../opencode/types'
import { SessionManager } from '../../opencode/sessionManager'
import { buildPromptFromTemplate, PROM10a, PROM10b, PROM11, PROM12 } from '../../prompts/index'
import type { OpenCodePromptDispatchEvent } from '../../workflow/runOpenCodePrompt'
import { runOpenCodePrompt, runOpenCodeSessionPrompt } from '../../workflow/runOpenCodePrompt'
import { buildStructuredRetryPrompt, normalizeInterviewDocumentOutput } from '../../structuredOutput'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { validatePrdDraft, validateResolvedInterview } from './validation'
import type { InterviewDocument } from '@shared/interviewArtifact'
import jsYaml from 'js-yaml'

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

type PrdDraftSubstep = 'full_answers' | 'prd_draft'

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
  step: PrdDraftSubstep
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

/** Build labeled prompt parts for PROM12 refinement. Labels Full Answers and drafts per-model. */
export function buildPrdRefinePrompt(
  ticketState: TicketState,
  winnerDraft: DraftResult,
  losingDrafts: DraftResult[],
  allFullAnswers: DraftResult[],
): PromptPart[] {
  const labeledFullAnswers = allFullAnswers
    .filter(fa => fa.outcome === 'completed' && fa.content)
    .map(fa => {
      const isWinner = fa.memberId === winnerDraft.memberId
      return [
        `## Full Answers — ${fa.memberId}${isWinner ? ' (Winner)' : ' (Alternative)'}`,
        fa.content,
      ].join('\n')
    })

  const labeledDrafts = [
    ['## Winning Draft', winnerDraft.content].join('\n'),
    ...losingDrafts.map((draft, index) => [
      `## Alternative Draft ${index + 1} (model: ${draft.memberId})`,
      draft.content,
    ].join('\n')),
  ]

  const refineContext = buildMinimalContext('prd_refine', {
    ...ticketState,
    fullAnswers: labeledFullAnswers,
    drafts: labeledDrafts,
  })
  return [{ type: 'text', content: buildPromptFromTemplate(PROM12, refineContext) }]
}

function buildPromptParts(template: typeof PROM10a | typeof PROM10b, contextParts: PromptPart[]): PromptPart[] {
  return [{ type: 'text', content: buildPromptFromTemplate(template, contextParts) }]
}

function stripGeneratedByForRetry(
  normalizedInterviewDocument: InterviewDocument,
): string {
  const { generated_by: _generatedBy, ...sanitized } = normalizedInterviewDocument
  return (jsYaml.dump(sanitized, { lineWidth: 120, noRefs: true }) as string).trim()
}

function buildFullAnswersRetryPrompt(
  baseParts: PromptPart[],
  options: {
    validationError: string
    rawResponse: string
    canonicalInterviewContent: string
    skippedQuestionIds: string[]
  },
): PromptPart[] {
  const skippedLabel = options.skippedQuestionIds.length > 0
    ? options.skippedQuestionIds.join(', ')
    : '[none]'

  return [
    ...baseParts,
    {
      type: 'text',
      content: [
        '## Full Answers Structured Output Retry',
        `Your previous response failed machine validation: ${options.validationError}`,
        'Return only a corrected full interview YAML artifact.',
        'Keep every generated free_text answer concise, ideally 1-2 sentences.',
        'For single_choice and multiple_choice questions, `selected_option_ids` must still use the existing canonical option IDs.',
        'Treat those options as hints rather than an exhaustive truth set: choose the best-fit canonical IDs, and use concise `free_text` to capture the actual answer whenever the option set is approximate, incomplete, or needs nuance.',
        'If any free_text contains `:`, emit it as a quoted scalar or a `>-` block scalar.',
        'Keep `artifact` as the scalar value `interview`, not an object wrapper.',
        'Keep `generated_by` as a mapping with `winner_model`, `generated_at`, and `canonicalization`.',
        'Keep `follow_up_rounds`, `summary`, and `approval` as top-level blocks after `questions`, never nested under a question.',
        'Preserve the canonical `follow_up_rounds` and `summary` exactly as provided.',
        'Set `status: draft` and keep `approval.approved_by: ""` plus `approval.approved_at: ""`.',
        'If length is a concern, shorten generated answers instead of omitting later questions or trailing sections.',
        'Stop immediately after the final approval block. Do not append status text, fences, tool notes, or stray terminal characters.',
        `Only these skipped question answers may change: ${skippedLabel}`,
        'Allowed edits:',
        '- Only `questions[*].answer` for the skipped question IDs listed above.',
        '- For choice questions, populate `selected_option_ids` using the existing canonical option IDs.',
        'Forbidden edits:',
        '- Do not change question IDs, question order, prompts, phases, `answer_type`, or `options`.',
        '- Do not change any existing non-skipped answer.',
        '- Do not change `follow_up_rounds` or `summary`.',
        '- Do not set non-empty approval fields or keep `status: approved`.',
        '- Do not use markdown fences or wrap the artifact under another object.',
        'Canonical approved interview artifact (copy everything except the skipped question answers):',
        '```yaml',
        options.canonicalInterviewContent.trim() || '[empty canonical interview artifact]',
        '```',
        'Previous invalid response:',
        '```',
        options.rawResponse.trim() || '[empty response]',
        '```',
      ].join('\n\n'),
    },
  ]
}

function buildStructuredOutput(
  validation: StepValidationResult | undefined,
  lastValidationError: string | undefined,
  attemptCount: number,
  failureClass?: DraftStructuredOutputMeta['failureClass'],
): DraftStructuredOutputMeta {
  return {
    repairApplied: validation?.repairApplied ?? false,
    repairWarnings: validation?.repairWarnings ?? [],
    autoRetryCount: attemptCount,
    ...(lastValidationError ? { validationError: lastValidationError } : {}),
    ...(failureClass ? { failureClass } : {}),
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

function shouldRestartFullAnswersInFreshSession(validationError: string): boolean {
  const normalized = validationError.trim()
  if (!normalized) return false

  return [
    /^No resolved interview document content found$/i,
    /^Resolved interview must preserve all \d+ canonical questions$/i,
    /^Resolved interview must preserve canonical question ids\b/i,
    /^Resolved interview is missing canonical question\b/i,
    /^Resolved interview left skipped question unanswered\b/i,
    /^Resolved interview is missing answered_at for AI-filled question\b/i,
  ].some((pattern) => pattern.test(normalized))
}

async function executeStructuredStep(
  adapter: OpenCodeAdapter,
  member: CouncilMember,
  projectPath: string,
  baseParts: PromptPart[],
  options: {
    step: PrdDraftSubstep
    signal?: AbortSignal
    ticketId?: string
    phaseAttempt?: number
    timeoutMs: number
    activeSession?: Session
    deadlineAt: number | null
    toolPolicy: OpenCodeToolPolicy
    validateStep: (content: string) => StepValidationResult
    schemaReminder: string
    buildRetryPrompt?: (params: {
      baseParts: PromptPart[]
      validationError: string
      rawResponse: string
    }) => PromptPart[]
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
  const sessionManager = options.ticketId ? new SessionManager(adapter) : null

  const sessionOwnership = options.ticketId
    ? {
        ticketId: options.ticketId,
        phase: 'DRAFTING_PRD',
        phaseAttempt: options.phaseAttempt ?? 1,
        memberId: member.modelId,
        step: options.step,
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
          toolPolicy: options.toolPolicy,
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
          toolPolicy: options.toolPolicy,
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
      const baseRetryDecision = getStructuredRetryDecision(rawResponse, result.responseMeta)
      const retryDecision = options.step === 'full_answers'
        && baseRetryDecision.failureClass === 'validation_error'
        && shouldRestartFullAnswersInFreshSession(lastValidationError)
        ? {
            ...baseRetryDecision,
            reuseSession: false,
            useStructuredRetryPrompt: false,
          }
        : baseRetryDecision
      if (attemptCount >= 1) {
        throw new StructuredStepError(
          lastValidationError,
          rawResponse,
          buildStructuredOutput(validation, lastValidationError, attemptCount, retryDecision.failureClass),
          validation?.questionCount,
          validation?.draftMetrics,
        )
      }

      attemptCount += 1
      if (!retryDecision.reuseSession) {
        if (sessionManager && session) {
          await sessionManager.abandonSession(session.id)
        }
        session = undefined
        promptParts = baseParts
        continue
      }

      promptParts = options.buildRetryPrompt?.({
        baseParts,
        validationError: lastValidationError,
        rawResponse,
      }) ?? buildStructuredRetryPrompt(baseParts, {
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
  const canonicalInterviewResult = shouldResolveGaps
    ? normalizeInterviewDocumentOutput(canonicalInterview, {
        ticketId: options.ticketExternalId ?? options.ticketId ?? '',
      })
    : null
  const canonicalInterviewForRetry = canonicalInterviewResult?.ok
    ? stripGeneratedByForRetry(canonicalInterviewResult.value)
    : canonicalInterview
  const skippedQuestionIds = canonicalInterviewResult?.ok
    ? canonicalInterviewResult.value.questions
      .filter((question) => question.answer.skipped)
      .map((question) => question.id)
    : []

  const results = await Promise.all(members.map(async (member) => {
    const memberStart = Date.now()
    const sessionManager = options.ticketId ? new SessionManager(adapter) : null
    let currentSession: Session | undefined
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
            const {
              outcome,
              errorDetail,
              failureClass,
            } = classifyDraftFailure(error, {
              content: errorContent,
              failureClass: structuredError?.structuredOutput.failureClass,
            })
            const structuredOutput = structuredError?.structuredOutput ?? (
              failureClass
                ? buildStructuredOutput(undefined, undefined, 0, failureClass)
                : undefined
            )
            return buildFailedDraft(
              member.modelId,
              outcome,
              duration,
              errorDetail,
              outcome === 'failed' ? '' : errorContent,
              structuredError?.questionCount,
              structuredError?.draftMetrics,
              structuredOutput,
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
          sessionId: currentSession?.id,
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
          sessionId: currentSession?.id,
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
          PROM10a,
          buildMinimalContext('prd_draft', {
            ...ticketState,
            fullAnswers: undefined,
          }),
        )

        const fullAnswersStep = await executeStructuredStep(adapter, member, projectPath, gapResolutionParts, {
          step: 'full_answers',
          signal,
          ticketId: options.ticketId,
          phaseAttempt: options.phaseAttempt,
          timeoutMs: options.draftTimeoutMs,
          activeSession: currentSession,
          deadlineAt,
          toolPolicy: PROM10a.toolPolicy,
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
          schemaReminder: PROM10a.outputFormat,
          buildRetryPrompt: ({ baseParts, validationError, rawResponse }) => buildFullAnswersRetryPrompt(baseParts, {
            validationError,
            rawResponse,
            canonicalInterviewContent: canonicalInterviewForRetry,
            skippedQuestionIds,
          }),
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

        currentSession = fullAnswersStep.session
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
          sessionId: currentSession.id,
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

        if (currentSession && sessionManager) {
          await sessionManager.completeSession(currentSession.id)
        }
        currentSession = undefined
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
        PROM10b,
        buildMinimalContext('prd_draft', {
          ...ticketState,
          interview: undefined,
          fullAnswers: [resolvedInterviewContent],
        }),
      )

      const prdStep = await executeStructuredStep(adapter, member, projectPath, prdPromptParts, {
        step: 'prd_draft',
        signal,
        ticketId: options.ticketId,
        phaseAttempt: options.phaseAttempt,
        timeoutMs: options.draftTimeoutMs,
        activeSession: currentSession,
        deadlineAt,
        toolPolicy: PROM10b.toolPolicy,
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
        schemaReminder: PROM10b.outputFormat,
        onOpenCodeSessionLog,
        onOpenCodeStreamEvent,
        onOpenCodePromptDispatched,
        onSessionCreated: (sessionId) => {
          onDraftProgress?.({
            memberId: member.modelId,
            status: 'session_created',
            sessionId,
          })
        },
      })

      currentSession = prdStep.session
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
        sessionId: currentSession.id,
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

      if (currentSession && sessionManager) {
        await sessionManager.completeSession(currentSession.id)
      }
      currentSession = undefined

      return {
        fullAnswers: fullAnswersResult,
        prd: prdResult,
      }
    } catch (error) {
      try {
        if (currentSession && sessionManager) {
          await sessionManager.abandonSession(currentSession.id)
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
