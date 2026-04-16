import type { TicketContext, TicketEvent } from '../../machines/types'
import type { TicketState } from '../../opencode/contextBuilder'
import { buildMinimalContext } from '../../opencode/contextBuilder'
import { SessionManager } from '../../opencode/sessionManager'
import { buildSameSessionPromptFromTemplate, PROM_EXECUTION_SETUP_NOTE } from '../../prompts/index'
import { withCommandLoggingAsync } from '../../log/commandLogger'
import { getLatestPhaseArtifact, getTicketPaths, upsertLatestPhaseArtifact } from '../../storage/tickets'
import { throwIfAborted } from '../../council/types'
import {
  runOpenCodeSessionPrompt,
  type OpenCodePromptCompletedEvent,
  type OpenCodePromptDispatchEvent,
} from '../runOpenCodePrompt'
import { persistUiArtifactCompanionArtifact } from '../artifactCompanions'
import { adapter } from './state'
import {
  emitAiMilestone,
  emitOpenCodePromptLog,
  emitOpenCodeSessionLogs,
  emitOpenCodeStreamEvent,
  emitPhaseLog,
  createOpenCodeStreamState,
  resolveExecutionSetupRuntimeSettings,
} from './helpers'
import type { OpenCodeStreamState } from './types'
import { handleMockExecutionUnsupported } from './executionPhase'
import { recordWorktreeStartCommit, resetWorktreeToCommit } from '../../phases/execution/gitOps'
import { executeExecutionSetupWithRetries } from '../../phases/executionSetup/executor'
import { readExecutionSetupPlan } from '../../phases/executionSetupPlan/document'
import { flattenExecutionSetupPlanCommands } from '../../phases/executionSetupPlan/types'
import {
  clearExecutionSetupRuntimeArtifacts,
  describeExecutionSetupPaths,
  EXECUTION_RUNTIME_PRESERVE_PATHS,
  writeExecutionSetupProfileMirror,
} from '../../phases/executionSetup/storage'
import {
  EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE,
  EXECUTION_SETUP_REPORT_ARTIFACT_TYPE,
  EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE,
  parseExecutionSetupRetryNotes,
  serializeExecutionSetupProfile,
  serializeExecutionSetupRetryNotes,
  type ExecutionSetupGenerationResult,
  type ExecutionSetupProfile,
  type ExecutionSetupReport,
  type ExecutionSetupResult,
} from '../../phases/executionSetup/types'
import { isMockOpenCodeMode } from '../../opencode/factory'

function allChecksPass(result: ExecutionSetupResult): boolean {
  return Object.values(result.checks).every((value) => value === 'pass')
}

function buildExecutionSetupReport(input: {
  preparedBy: string
  generation: ExecutionSetupGenerationResult
  errors: string[]
  profile?: ExecutionSetupProfile | null
  approvedPlanCommands?: string[]
}): ExecutionSetupReport {
  const profile = input.profile ?? input.generation.result?.profile ?? null
  const approvedPlanCommands = [...new Set(input.approvedPlanCommands ?? [])]
  const executionAddedCommands = approvedPlanCommands.length > 0 && profile
    ? profile.bootstrapCommands.filter((command) => !approvedPlanCommands.includes(command))
    : profile?.bootstrapCommands ?? []
  return {
    status: input.errors.length === 0 && input.generation.result ? 'ready' : 'failed',
    ready: input.errors.length === 0 && input.generation.result !== null,
    checkedAt: new Date().toISOString(),
    preparedBy: input.preparedBy,
    summary: input.generation.result?.summary ?? profile?.summary,
    profile,
    checks: input.generation.result?.checks ?? null,
    modelOutput: input.generation.output,
    errors: input.errors,
    structuredOutput: input.generation.structuredOutput,
    approvedPlanCommands,
    executionAddedCommands,
  }
}

async function generateExecutionSetupRetryNote(input: {
  ticketId: string
  context: TicketContext
  generation: ExecutionSetupGenerationResult
  report: ExecutionSetupReport
  signal: AbortSignal
  model: string
  variant?: string
  onPromptDispatched?: (event: OpenCodePromptDispatchEvent) => void
  onPromptCompleted?: (event: OpenCodePromptCompletedEvent) => void
}): Promise<string | null> {
  const ticketState: TicketState = {
    ticketId: input.context.externalId,
    title: input.context.title,
    description: '',
  }

  const errorContext = {
    type: 'text' as const,
    source: 'error_context',
    content: [
      '## Execution Setup Attempt Failure',
      input.report.errors.join('\n') || 'Unknown failure',
      '',
      '## Last Output',
      input.generation.output.slice(0, 4000),
    ].join('\n'),
  }

  const prompt = buildSameSessionPromptFromTemplate(
    PROM_EXECUTION_SETUP_NOTE,
    [...buildMinimalContext('preflight', ticketState), errorContext],
  )

  const response = await runOpenCodeSessionPrompt({
    adapter,
    session: input.generation.session,
    parts: [{ type: 'text', content: prompt }],
    signal: input.signal,
    timeoutMs: 60000,
    model: input.model,
    variant: input.variant,
    erroredSessionPolicy: 'discard_errored_session_output',
    toolPolicy: PROM_EXECUTION_SETUP_NOTE.toolPolicy,
    onPromptDispatched: (event) => {
      input.onPromptDispatched?.(event)
    },
    onPromptCompleted: (event) => {
      input.onPromptCompleted?.(event)
    },
  })

  return response.response.trim() || null
}

export async function handleExecutionSetup(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'PREPARING_EXECUTION_ENV', sendEvent)
    return
  }

  return withCommandLoggingAsync(
    ticketId, context.externalId, 'PREPARING_EXECUTION_ENV',
    async () => {
      const paths = getTicketPaths(ticketId)
      if (!paths) throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)

      const setupModelId = context.lockedMainImplementer
      if (!setupModelId) {
        throw new Error('No locked main implementer is configured for execution setup')
      }

      const runtimeSettings = resolveExecutionSetupRuntimeSettings(context)
      const phaseStartCommit = recordWorktreeStartCommit(paths.worktreePath)
      const approvedPlan = readExecutionSetupPlan(ticketId).plan
      if (!approvedPlan) {
        throw new Error('Approved execution setup plan is missing')
      }
      const approvedPlanCommands = flattenExecutionSetupPlanCommands(approvedPlan)
      const sessionManager = new SessionManager(adapter)
      const streamStates = new Map<string, OpenCodeStreamState>()
      const existingRetryNotesArtifact = getLatestPhaseArtifact(
        ticketId,
        EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE,
        'PREPARING_EXECUTION_ENV',
      )
      let retryNotes = parseExecutionSetupRetryNotes(existingRetryNotesArtifact?.content)

      const report = await executeExecutionSetupWithRetries(
        adapter,
        async () => await adapter.assembleCouncilContext(ticketId, 'execution_setup'),
        paths.worktreePath,
        signal,
        {
          ticketId,
          model: setupModelId,
          variant: context.lockedMainImplementerVariant ?? undefined,
          maxIterations: runtimeSettings.maxIterations,
          timeoutMs: runtimeSettings.timeoutMs,
          initialRetryNotes: retryNotes,
        },
        {
          evaluateGeneration: async ({ generation }) => {
            const errors = [...generation.parse.errors]
            const result = generation.result

            if (result && !allChecksPass(result)) {
              errors.push('Execution setup checks must all pass before the setup profile can be accepted.')
            }

            return buildExecutionSetupReport({
              preparedBy: setupModelId,
              generation,
              errors,
              profile: result?.profile ?? null,
              approvedPlanCommands,
            })
          },
          generateRetryNote: async ({ generation, report }) => {
            try {
              return await generateExecutionSetupRetryNote({
                ticketId,
                context,
                generation,
                report,
                signal,
                model: setupModelId,
                variant: context.lockedMainImplementerVariant ?? undefined,
                onPromptDispatched: (event) => {
                  emitOpenCodePromptLog(
                    ticketId,
                    context.externalId,
                    'PREPARING_EXECUTION_ENV',
                    setupModelId,
                    event,
                  )
                },
                onPromptCompleted: (event) => {
                  emitOpenCodeSessionLogs(
                    ticketId,
                    context.externalId,
                    'PREPARING_EXECUTION_ENV',
                    setupModelId,
                    event.session.id,
                    'execution_setup_note',
                    event.response,
                    event.messages,
                  )
                },
              })
            } catch {
              return null
            }
          },
          onAttemptStart: (attempt) => {
            emitPhaseLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              'info',
              runtimeSettings.maxIterations > 0
                ? `Starting execution setup attempt ${attempt} of ${runtimeSettings.maxIterations}.`
                : `Starting execution setup attempt ${attempt} with unlimited retry budget.`,
            )
          },
          onAttemptComplete: async ({ attempt, report, generation }) => {
            emitPhaseLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              report.ready ? 'info' : 'error',
              report.ready
                ? `Execution setup attempt ${attempt} produced a reusable setup profile.`
                : `Execution setup attempt ${attempt} failed: ${report.errors.join('; ') || 'validation failed'}`,
            )

            if (report.ready) {
              await sessionManager.completeSession(generation.session.id)
            }
          },
          onSessionCreated: (sessionId, attempt) => {
            emitAiMilestone(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              `Execution setup attempt ${attempt} session created for ${setupModelId} (session=${sessionId}).`,
              `${sessionId}:execution-setup-created:${attempt}`,
              {
                attempt,
                modelId: setupModelId,
                sessionId,
                source: `model:${setupModelId}`,
              },
            )
          },
          onOpenCodeStreamEvent: ({ sessionId, event }) => {
            const streamState = streamStates.get(sessionId) ?? createOpenCodeStreamState()
            streamStates.set(sessionId, streamState)
            emitOpenCodeStreamEvent(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              setupModelId,
              sessionId,
              event,
              streamState,
            )
          },
          onPromptDispatched: ({ event }) => {
            emitOpenCodePromptLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              setupModelId,
              event,
            )
          },
          onPromptCompleted: ({ stage, event }) => {
            emitOpenCodeSessionLogs(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              setupModelId,
              event.session.id,
              stage,
              event.response,
              event.messages,
              streamStates.get(event.session.id),
            )
          },
          onFailedAttempt: async ({ generation, note, notes, canRetry }) => {
            retryNotes = notes
            upsertLatestPhaseArtifact(
              ticketId,
              EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE,
              'PREPARING_EXECUTION_ENV',
              serializeExecutionSetupRetryNotes(notes),
            )
            emitPhaseLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              'info',
              canRetry
                ? 'Appended an execution setup retry note for the next attempt.'
                : 'Appended an execution setup retry note before blocking.',
              { note },
            )
            if (!canRetry) {
              await sessionManager.abandonSession(generation.session.id)
            }
          },
          beforeRetry: async ({ generation, nextAttempt }) => {
            await sessionManager.abandonSession(generation.session.id)
            resetWorktreeToCommit(paths.worktreePath, phaseStartCommit, {
              preservePaths: [...EXECUTION_RUNTIME_PRESERVE_PATHS],
            })
            clearExecutionSetupRuntimeArtifacts(ticketId)
            emitPhaseLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              'info',
              `Reset worktree to the execution-setup start commit before attempt ${nextAttempt}.`,
              {
                commit: phaseStartCommit,
                nextAttempt,
              },
            )
          },
          onRetriesExhausted: ({ attempt }) => {
            emitPhaseLog(
              ticketId,
              context.externalId,
              'PREPARING_EXECUTION_ENV',
              'error',
              `Execution setup retries exhausted after ${attempt} attempt${attempt === 1 ? '' : 's'}.`,
            )
          },
        },
      )
      throwIfAborted(signal, ticketId)

      if (report.ready && report.profile) {
        writeExecutionSetupProfileMirror(ticketId, report.profile)
        upsertLatestPhaseArtifact(
          ticketId,
          EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE,
          'PREPARING_EXECUTION_ENV',
          serializeExecutionSetupProfile(report.profile),
        )
      }

      upsertLatestPhaseArtifact(
        ticketId,
        EXECUTION_SETUP_REPORT_ARTIFACT_TYPE,
        'PREPARING_EXECUTION_ENV',
        JSON.stringify(report),
      )

      persistUiArtifactCompanionArtifact(
        ticketId,
        'PREPARING_EXECUTION_ENV',
        EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE,
        {
          response: report.modelOutput,
          normalizedContent: report.profile ? serializeExecutionSetupProfile(report.profile) : null,
          parsed: report.profile ? { profile: report.profile, checks: report.checks, summary: report.summary } : null,
          structuredOutput: report.structuredOutput,
          status: report.status,
          errors: report.errors,
          retryNotes: retryNotes,
          attemptHistory: report.attemptHistory,
          approvedPlanCommands: report.approvedPlanCommands,
          executionAddedCommands: report.executionAddedCommands,
        },
      )

      if (report.ready) {
        const pathInfo = describeExecutionSetupPaths(ticketId)
        emitPhaseLog(
          ticketId,
          context.externalId,
          'PREPARING_EXECUTION_ENV',
          'info',
          `Execution setup profile is ready${pathInfo ? ` at ${pathInfo.profilePath}` : ''}.`,
        )
        sendEvent({ type: 'EXECUTION_SETUP_READY' })
        return
      }

      sendEvent({ type: 'EXECUTION_SETUP_FAILED', errors: report.errors })
    },
    (phase, type, content) => emitPhaseLog(ticketId, context.externalId, phase, type, content, { source: 'system', audience: 'all' }),
  )
}
