import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { PromptPart, StreamEvent } from '../../opencode/types'
import { throwIfAborted } from '../../council/types'
import type {
  OpenCodePromptCompletedEvent,
  OpenCodePromptDispatchEvent,
} from '../../workflow/runOpenCodePrompt'
import { generateExecutionSetup, type GenerateExecutionSetupResult } from './generator'
import type {
  ExecutionSetupAttemptHistoryEntry,
  ExecutionSetupGenerationResult,
  ExecutionSetupReport,
} from './types'

type ContextPartsInput = PromptPart[] | (() => Promise<PromptPart[]>)

async function resolveContextParts(input: ContextPartsInput): Promise<PromptPart[]> {
  if (typeof input === 'function') return await input()
  return input
}

function buildAttemptHistoryEntry(
  attempt: number,
  report: ExecutionSetupReport,
): ExecutionSetupAttemptHistoryEntry {
  return {
    attempt,
    status: report.status,
    checkedAt: report.checkedAt,
    summary: report.summary,
    tempRoots: report.profile?.tempRoots ?? [],
    bootstrapCommands: report.profile?.bootstrapCommands ?? [],
    errors: [...report.errors],
    failureReason: report.errors[0] ?? undefined,
  }
}

function buildDeterministicExecutionSetupRetryNote(input: {
  attempt: number
  report: ExecutionSetupReport
  generation: ExecutionSetupGenerationResult
}): string {
  const { attempt, report, generation } = input
  const failureReason = report.errors[0]
    ?? generation.parse.errors[0]
    ?? 'Execution setup validation did not pass.'

  const tempRoots = report.profile?.tempRoots.length
    ? ` Temp roots: ${report.profile.tempRoots.join(', ')}.`
    : ''

  return [
    `Attempt ${attempt} failed.`,
    failureReason,
    `${tempRoots}Next attempt: reuse repository-native bootstrap hints, keep setup work minimal, and avoid implementing ticket feature changes during workspace preparation.`,
  ].join(' ').trim()
}

function withRetryMetadata(
  report: ExecutionSetupReport,
  input: {
    attempt: number
    maxIterations: number
    attemptHistory: ExecutionSetupAttemptHistoryEntry[]
    retryNotes: string[]
  },
): ExecutionSetupReport {
  return {
    ...report,
    attempt: input.attempt,
    maxIterations: input.maxIterations,
    attemptHistory: input.attemptHistory,
    retryNotes: input.retryNotes,
  }
}

export async function executeExecutionSetupWithRetries(
  adapter: OpenCodeAdapter,
  contextParts: ContextPartsInput,
  projectPath: string,
  signal: AbortSignal | undefined,
  options: {
    ticketId?: string
    model: string
    variant?: string
    maxIterations: number
    timeoutMs: number
    initialRetryNotes?: string[]
  },
  callbacks: {
    evaluateGeneration: (input: {
      attempt: number
      generation: GenerateExecutionSetupResult
    }) => Promise<ExecutionSetupReport>
    generateRetryNote?: (input: {
      attempt: number
      report: ExecutionSetupReport
      generation: GenerateExecutionSetupResult
      notes: string[]
    }) => Promise<string | null | undefined>
    onAttemptStart?: (attempt: number) => void | Promise<void>
    onAttemptComplete?: (input: {
      attempt: number
      report: ExecutionSetupReport
      generation: GenerateExecutionSetupResult
    }) => void | Promise<void>
    onSessionCreated?: (sessionId: string, attempt: number) => void
    onOpenCodeStreamEvent?: (entry: { sessionId: string; attempt: number; event: StreamEvent }) => void
    onPromptDispatched?: (entry: { sessionId: string; attempt: number; event: OpenCodePromptDispatchEvent }) => void
    onPromptCompleted?: (entry: { attempt: number; stage: string; event: OpenCodePromptCompletedEvent }) => void
    onFailedAttempt?: (input: {
      attempt: number
      report: ExecutionSetupReport
      generation: GenerateExecutionSetupResult
      note: string
      notes: string[]
      canRetry: boolean
    }) => void | Promise<void>
    beforeRetry?: (input: {
      attempt: number
      nextAttempt: number
      report: ExecutionSetupReport
      generation: GenerateExecutionSetupResult
      note: string
      notes: string[]
    }) => void | Promise<void>
    onRetriesExhausted?: (input: {
      attempt: number
      maxIterations: number
      report: ExecutionSetupReport
      notes: string[]
    }) => void | Promise<void>
  },
): Promise<ExecutionSetupReport> {
  const notes: string[] = [...(options.initialRetryNotes ?? [])]
  const attemptHistory: ExecutionSetupAttemptHistoryEntry[] = []
  let attempt = 0

  while (options.maxIterations <= 0 || attempt < options.maxIterations) {
    attempt += 1
    throwIfAborted(signal)
    await callbacks.onAttemptStart?.(attempt)

    const generation = await generateExecutionSetup(
      adapter,
      await resolveContextParts(contextParts),
      projectPath,
      signal,
      {
        ticketId: options.ticketId,
        model: options.model,
        variant: options.variant,
        timeoutMs: options.timeoutMs,
        phaseAttempt: attempt,
        onSessionCreated: (sessionId) => {
          callbacks.onSessionCreated?.(sessionId, attempt)
        },
        onOpenCodeStreamEvent: ({ sessionId, event }) => {
          callbacks.onOpenCodeStreamEvent?.({ sessionId, attempt, event })
        },
        onPromptDispatched: ({ sessionId, event }) => {
          callbacks.onPromptDispatched?.({ sessionId, attempt, event })
        },
        onPromptCompleted: ({ stage, event }) => {
          callbacks.onPromptCompleted?.({ attempt, stage, event })
        },
      },
    )
    throwIfAborted(signal)

    const report = await callbacks.evaluateGeneration({ attempt, generation })
    const attemptEntry = buildAttemptHistoryEntry(attempt, report)
    attemptHistory.push(attemptEntry)
    await callbacks.onAttemptComplete?.({ attempt, report, generation })

    if (report.ready) {
      return withRetryMetadata(report, {
        attempt,
        maxIterations: options.maxIterations,
        attemptHistory,
        retryNotes: [...notes],
      })
    }

    let note: string | null | undefined
    try {
      note = await callbacks.generateRetryNote?.({
        attempt,
        report,
        generation,
        notes: [...notes],
      })
    } catch {
      note = null
    }

    const resolvedNote = note?.trim() || buildDeterministicExecutionSetupRetryNote({
      attempt,
      report,
      generation,
    })
    notes.push(resolvedNote)
    attemptEntry.noteAppended = resolvedNote

    const canRetry = options.maxIterations <= 0 || attempt < options.maxIterations
    await callbacks.onFailedAttempt?.({
      attempt,
      report,
      generation,
      note: resolvedNote,
      notes: [...notes],
      canRetry,
    })

    if (!canRetry) {
      await callbacks.onRetriesExhausted?.({
        attempt,
        maxIterations: options.maxIterations,
        report,
        notes: [...notes],
      })
      return withRetryMetadata(report, {
        attempt,
        maxIterations: options.maxIterations,
        attemptHistory,
        retryNotes: [...notes],
      })
    }

    await callbacks.beforeRetry?.({
      attempt,
      nextAttempt: attempt + 1,
      report,
      generation,
      note: resolvedNote,
      notes: [...notes],
    })
  }

  return {
    status: 'failed',
    ready: false,
    checkedAt: new Date().toISOString(),
    preparedBy: options.model,
    profile: null,
    checks: null,
    modelOutput: '',
    errors: ['Execution setup retry loop terminated unexpectedly'],
    attempt,
    maxIterations: options.maxIterations,
    attemptHistory,
    retryNotes: notes,
  }
}
