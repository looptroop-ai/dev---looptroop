import type { TicketContext, TicketEvent } from '../../machines/types'
import { handleMockExecutionUnsupported } from './executionPhase'
import type { PromptPart } from '../../opencode/types'
import { CancelledError, throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { buildPromptFromTemplate, PROM0 } from '../../prompts/index'
import { getLatestPhaseArtifact, getTicketPaths, insertPhaseArtifact, countPhaseArtifacts } from '../../storage/tickets'
import { runOpenCodePrompt, runOpenCodeSessionPrompt } from '../runOpenCodePrompt'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { buildRelevantFilesArtifact, type RelevantFilesData } from '../../ticket/relevantFiles'
import {
  normalizeRelevantFilesOutput,
  normalizeCoverageResultOutput,
  buildStructuredRetryPrompt,
  type RelevantFilesOutputPayload,
  type StructuredOutputResult,
} from '../../structuredOutput'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { runPreFlightChecks } from '../../phases/preflight/doctor'
import { generateFinalTests } from '../../phases/finalTest/generator'
import { parseFinalTestCommands } from '../../phases/finalTest/parser'
import { executeFinalTestCommands } from '../../phases/finalTest/runner'
import { broadcaster } from '../../sse/broadcaster'
import { resolveInterviewCoverageFollowUpResolution } from '../interviewCoverageFollowUps'
import { resolveCoverageGapDisposition, resolveCoverageRunState } from '../coverageControl'
import { calculateFollowUpLimit } from '../../phases/interview/followUpBudget'
import { parsePrdRefinedArtifact } from '../../phases/prd/refined'
import {
  countCoverageFollowUpQuestions,
  buildCoverageFollowUpBatch,
  recordPreparedBatch,
  clearInterviewSessionBatch,
} from '../../phases/interview/sessionState'
import { adapter, phaseResults, interviewQASessions } from './state'
import {
  emitPhaseLog,
  emitAiMilestone,
  emitOpenCodeSessionLogs,
  emitOpenCodeStreamEvent,
  emitOpenCodePromptLog,
  createOpenCodeStreamState,
  resolveCouncilRuntimeSettings,
  resolveCoverageRuntimeSettings,
  resolveInterviewDraftSettings,
  resolveExecutionRuntimeSettings,
  resolveCouncilMembers,
  loadTicketDirContext,
  buildStructuredMetadata,
  buildCoveragePromptConfiguration,
  getCoverageStateLabel,
  getCoverageContextPhase,
  getCoveragePromptTemplate,
  describeCoverageTerminationReason,
} from './helpers'
import type { OpenCodeStreamState } from './types'
import {
  readInterviewSessionSnapshotArtifact,
  loadCanonicalInterview,
  writeCanonicalInterview,
  buildInterviewAnswerSummary,
  persistInterviewSession,
  buildCoverageFollowUpCommentary,
  readMockInterviewWinnerId,
} from './interviewPhase'
import { readTicketBeads, updateTicketProgressFromBeads } from './beadsPhase'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { persistUiArtifactCompanionArtifact } from '../artifactCompanions'

export function validateRelevantFilesScanResponse(response: string): StructuredOutputResult<RelevantFilesOutputPayload> {
  const trimmed = response.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: 'Relevant files output was empty.',
      repairApplied: false,
      repairWarnings: [],
    }
  }

  const normalized = normalizeRelevantFilesOutput(trimmed)

  // Trust the normalizer: if it successfully parsed files, return immediately
  // regardless of tag counts (handles truncated/malformed output)
  if (normalized.ok) {
    return normalized
  }

  // Normalizer failed — enrich with tag-count diagnostics
  const openTagCount = [...trimmed.matchAll(/<RELEVANT_FILES_RESULT>/gi)].length
  const closeTagCount = [...trimmed.matchAll(/<\/RELEVANT_FILES_RESULT>/gi)].length

  if (normalized.error.includes('echoed the prompt')) {
    return normalized
  }

  if (openTagCount !== 1 || closeTagCount !== 1) {
    return {
      ok: false,
      error: `Relevant files output must contain exactly one <RELEVANT_FILES_RESULT>...</RELEVANT_FILES_RESULT> block (found open=${openTagCount}, close=${closeTagCount}). Parse error: ${normalized.error}`,
      repairApplied: false,
      repairWarnings: normalized.repairWarnings,
    }
  }

  return normalized
}

function loadWinnerPrdFullAnswers(ticketId: string, winnerId: string): string | undefined {
  const artifact = getLatestPhaseArtifact(ticketId, 'prd_full_answers')
  if (!artifact) return undefined

  try {
    const parsed = JSON.parse(artifact.content) as { drafts?: Array<{ memberId?: string; outcome?: string; content?: string }> }
    const winnerDraft = parsed.drafts?.find((draft) => (
      draft.memberId === winnerId
      && draft.outcome === 'completed'
      && typeof draft.content === 'string'
      && draft.content.trim().length > 0
    ))
    return winnerDraft?.content
  } catch {
    return undefined
  }
}

export async function handleRelevantFilesScan(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const phase = 'SCANNING_RELEVANT_FILES' as const
  const { worktreePath, ticket, ticketDir } = loadTicketDirContext(context)

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
  }

  const contextParts = buildMinimalContext('preflight', ticketState)
  const prompt = buildPromptFromTemplate(PROM0, contextParts)

  const codingModelId = context.lockedMainImplementer
  if (!codingModelId) {
    const msg = 'No main implementer configured for relevant files scan.'
    emitPhaseLog(ticketId, context.externalId, phase, 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: ['RELEVANT_FILES_SCAN_FAILED', 'MAIN_IMPLEMENTER_MISSING'] })
    return
  }

  try {
    const { draftTimeoutMs } = resolveCouncilRuntimeSettings(context)
    const streamState = createOpenCodeStreamState()
    let sessionId = ''

    const result = await runOpenCodePrompt({
      adapter,
      projectPath: worktreePath,
      parts: [{ type: 'text' as const, content: prompt }],
      signal,
      timeoutMs: draftTimeoutMs,
      model: codingModelId,
      variant: 'relevant_files_scan',
      onSessionCreated: (session) => {
        sessionId = session.id
        emitAiMilestone(
          ticketId,
          context.externalId,
          phase,
          `Scanning relevant files with ${codingModelId} (session=${session.id}).`,
          `${phase}:${session.id}:scan-created`,
          {
            modelId: codingModelId,
            sessionId: session.id,
            source: `model:${codingModelId}`,
          },
        )
      },
      onStreamEvent: (event) => {
        if (!sessionId) return
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          phase,
          codingModelId,
          sessionId,
          event,
          streamState,
        )
      },
      onPromptDispatched: (event) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          phase,
          codingModelId,
          event,
        )
      },
    })

    throwIfAborted(signal, ticketId)

    emitOpenCodeSessionLogs(
      ticketId,
      context.externalId,
      phase,
      codingModelId,
      result.session.id,
      'relevant_files_scan',
      result.response,
      result.messages,
    )

    let normalized = validateRelevantFilesScanResponse(result.response)
    let finalResponse = result.response

    if (!normalized.ok) {
      const retryDecision = getStructuredRetryDecision(result.response, result.responseMeta)
      const retryMode = retryDecision.reuseSession ? 'same session' : 'fresh session'
      emitPhaseLog(
        ticketId,
        context.externalId,
        phase,
        'info',
        `Relevant files scan response failed validation; retrying once in a ${retryMode}: ${normalized.error}`,
      )

      if (retryDecision.reuseSession) {
        const retryParts = buildStructuredRetryPrompt([{ type: 'text', content: prompt }], {
          validationError: normalized.error,
          rawResponse: result.response,
          schemaReminder: PROM0.outputFormat,
        })

        const retryResult = await runOpenCodeSessionPrompt({
          adapter,
          session: result.session,
          parts: retryParts,
          signal,
          timeoutMs: draftTimeoutMs,
          model: codingModelId,
          onStreamEvent: (event) => {
            if (!sessionId) return
            emitOpenCodeStreamEvent(
              ticketId,
              context.externalId,
              phase,
              codingModelId,
              sessionId,
              event,
              streamState,
            )
          },
          onPromptDispatched: (event) => {
            emitOpenCodePromptLog(
              ticketId,
              context.externalId,
              phase,
              codingModelId,
              event,
            )
          },
        })

        throwIfAborted(signal, ticketId)

        emitOpenCodeSessionLogs(
          ticketId,
          context.externalId,
          phase,
          codingModelId,
          retryResult.session.id,
          'relevant_files_scan',
          retryResult.response,
          retryResult.messages,
        )

        finalResponse = retryResult.response
      } else {
        const freshResult = await runOpenCodePrompt({
          adapter,
          projectPath: worktreePath,
          parts: [{ type: 'text' as const, content: prompt }],
          signal,
          timeoutMs: draftTimeoutMs,
          model: codingModelId,
          variant: 'relevant_files_scan',
          onSessionCreated: (session) => {
            sessionId = session.id
            emitAiMilestone(
              ticketId,
              context.externalId,
              phase,
              `Restarting relevant files scan with ${codingModelId} in a fresh session (session=${session.id}).`,
              `${phase}:${session.id}:scan-restarted`,
              {
                modelId: codingModelId,
                sessionId: session.id,
                source: `model:${codingModelId}`,
              },
            )
          },
          onStreamEvent: (event) => {
            if (!sessionId) return
            emitOpenCodeStreamEvent(
              ticketId,
              context.externalId,
              phase,
              codingModelId,
              sessionId,
              event,
              streamState,
            )
          },
          onPromptDispatched: (event) => {
            emitOpenCodePromptLog(
              ticketId,
              context.externalId,
              phase,
              codingModelId,
              event,
            )
          },
        })

        throwIfAborted(signal, ticketId)

        emitOpenCodeSessionLogs(
          ticketId,
          context.externalId,
          phase,
          codingModelId,
          freshResult.session.id,
          'relevant_files_scan',
          freshResult.response,
          freshResult.messages,
        )

        finalResponse = freshResult.response
      }

      normalized = validateRelevantFilesScanResponse(finalResponse)
      if (!normalized.ok) {
        const msg = `Relevant files scan failed validation after retry: ${normalized.error}`
        emitPhaseLog(ticketId, context.externalId, phase, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['RELEVANT_FILES_SCAN_FAILED'] })
        return
      }
    }

    const parsed: RelevantFilesData = {
      file_count: normalized.value.file_count,
      files: normalized.value.files.map((f) => ({
        path: f.path,
        rationale: f.rationale,
        relevance: (['high', 'medium', 'low'].includes(f.relevance) ? f.relevance : 'medium') as 'high' | 'medium' | 'low',
        likely_action: (['read', 'modify', 'create'].includes(f.likely_action) ? f.likely_action : 'read') as 'read' | 'modify' | 'create',
        content: f.content,
        content_preview: f.content_preview,
      })),
    }
    const artifactContent = buildRelevantFilesArtifact(context.externalId, parsed)
    const artifactPath = resolve(ticketDir, 'relevant-files.yaml')
    safeAtomicWrite(artifactPath, artifactContent)

    insertPhaseArtifact(ticketId, {
      phase,
      artifactType: 'relevant_files_scan',
      content: JSON.stringify({
        fileCount: parsed.file_count,
        files: parsed.files.map(f => ({
          path: f.path,
          rationale: f.rationale,
          relevance: f.relevance,
          likely_action: f.likely_action,
          contentPreview: f.content_preview ?? '',
          contentLength: (f.content_preview ?? f.content ?? '').length,
        })),
        modelId: codingModelId,
      }),
    })

    emitPhaseLog(ticketId, context.externalId, phase, 'info', `Relevant files scan completed: ${parsed.file_count} files extracted.`)
    sendEvent({ type: 'RELEVANT_FILES_READY' })
  } catch (err) {
    if (err instanceof CancelledError) throw err
    if (err instanceof Error && err.message === 'Timeout') {
      emitPhaseLog(ticketId, context.externalId, phase, 'error', `Relevant files scan failed: Timeout`)
      sendEvent({ type: 'ERROR', message: `Relevant files scan failed: Timeout`, codes: ['RELEVANT_FILES_SCAN_FAILED'] })
      return
    }
    throwIfCancelled(err, signal, ticketId)
    const errMsg = err instanceof Error ? err.message : String(err)
    emitPhaseLog(ticketId, context.externalId, phase, 'error', `Relevant files scan failed: ${errMsg}`)
    sendEvent({ type: 'ERROR', message: `Relevant files scan failed: ${errMsg}`, codes: ['RELEVANT_FILES_SCAN_FAILED'] })
  }
}

export async function handleCoverageVerification(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  phase: 'interview' | 'prd' | 'beads',
  signal: AbortSignal,
) {
  const { worktreePath, ticket, ticketDir, relevantFiles } = loadTicketDirContext(context)
  const paths = getTicketPaths(ticketId)
  const stateLabel = getCoverageStateLabel(phase)
  const contextPhase = getCoverageContextPhase(phase)
  const promptTemplate = getCoveragePromptTemplate(phase)
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const coverageSettings = resolveCoverageRuntimeSettings(context)
  const completedCoveragePasses = countPhaseArtifacts(ticketId, `${phase}_coverage`, stateLabel)
  const coverageRunState = resolveCoverageRunState(completedCoveragePasses, coverageSettings.maxCoveragePasses)

  if (coverageRunState.limitAlreadyReached) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      stateLabel,
      'info',
      `Coverage retry cap already reached for ${phase} (${completedCoveragePasses}/${coverageSettings.maxCoveragePasses}). Routing to approval without another coverage execution.`,
    )
    sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
    return
  }

  const { coverageRunNumber, isFinalAllowedRun } = coverageRunState

  // Resolve the council result to find the winning model
  const councilResult = phaseResults.get(`${ticketId}:${phase}`)
  let winnerId: string

  if (councilResult) {
    winnerId = councilResult.winnerId
  } else {
    // Fallback: read winnerId from persisted phaseArtifacts (survives server restarts)
    const winnerArtifact = phase === 'interview'
      ? getLatestPhaseArtifact(ticketId, 'interview_winner')
      : phase === 'prd'
        ? getLatestPhaseArtifact(ticketId, 'prd_winner') ?? getLatestPhaseArtifact(ticketId, 'prd_votes')
        : getLatestPhaseArtifact(ticketId, 'beads_winner') ?? getLatestPhaseArtifact(ticketId, 'beads_votes')

    if (!winnerArtifact) {
      const msg = `No council result found for ${phase} phase — cannot determine winning model`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    try {
      const parsed = JSON.parse(winnerArtifact.content) as { winnerId?: string }
      winnerId = parsed.winnerId ?? ''
    } catch {
      const msg = `Failed to parse winning model from persisted artifact for ${phase} phase`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    if (!winnerId) {
      const msg = `No winnerId found in persisted artifact for ${phase} phase`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }
  }
  emitPhaseLog(
    ticketId,
    context.externalId,
    stateLabel,
    'info',
    `Coverage verification started using winning model: ${winnerId} (run ${coverageRunNumber}/${coverageSettings.maxCoveragePasses}).`,
  )

  // Resolve refinedContent: prefer in-memory, fall back to persisted artifact
  let refinedContent: string | undefined = councilResult?.refinedContent
  if (!refinedContent) {
    const compiledArtifactType = phase === 'interview'
      ? 'interview_compiled'
      : phase === 'prd'
        ? 'prd_refined'
        : 'beads_refined'
    const compiledArtifact = getLatestPhaseArtifact(ticketId, compiledArtifactType)
    if (compiledArtifact) {
      try {
        refinedContent = phase === 'prd'
          ? parsePrdRefinedArtifact(compiledArtifact.content).refinedContent
          : (JSON.parse(compiledArtifact.content) as { refinedContent?: string }).refinedContent
      } catch { /* ignore */ }
    }
  }

  const interviewSnapshot = phase === 'interview'
    ? readInterviewSessionSnapshotArtifact(ticketId)
    : null
  let canonicalInterview = phase === 'interview' || phase === 'prd'
    ? loadCanonicalInterview(ticketDir)
    : undefined

  if (phase === 'interview' && !canonicalInterview) {
    if (!interviewSnapshot) {
      const msg = 'Interview coverage requires canonical interview state, but no normalized interview session snapshot was found.'
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    try {
      writeCanonicalInterview(context.externalId, ticketDir, interviewSnapshot)
      canonicalInterview = loadCanonicalInterview(ticketDir)
    } catch (err) {
      const msg = `Failed to rebuild canonical interview.yaml before coverage: ${err instanceof Error ? err.message : String(err)}`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }
  }

  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    relevantFiles,
    interview: phase === 'interview'
      ? canonicalInterview
      : phase === 'prd'
        ? canonicalInterview
        : refinedContent,
    ...(phase === 'prd'
      ? (() => {
          const winnerFullAnswers = loadWinnerPrdFullAnswers(ticketId, winnerId)
          return winnerFullAnswers ? { fullAnswers: [winnerFullAnswers] } : {}
        })()
      : {}),
    ...(phase === 'interview'
      ? { userAnswers: buildInterviewAnswerSummary(interviewSnapshot) }
      : {}),
  }

  const interviewCoverageBudget = phase === 'interview'
    ? (() => {
        const maxInitialQuestions = context.lockedInterviewQuestions
          ?? interviewSnapshot?.maxInitialQuestions
          ?? resolveInterviewDraftSettings(context).maxInitialQuestions
        const total = calculateFollowUpLimit(maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent)
        const used = interviewSnapshot ? countCoverageFollowUpQuestions(interviewSnapshot) : 0
        return {
          total,
          used,
          remaining: Math.max(0, total - used),
        }
      })()
    : null

  // Load additional artifacts from disk for PRD/beads coverage phases
  if (phase === 'prd' || phase === 'beads') {
    const prdPath = resolve(ticketDir, 'prd.yaml')
    if (existsSync(prdPath)) {
      try { ticketState.prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
    }
  }
  if (phase === 'beads' && paths) {
    const beadsPath = paths.beadsPath
    if (beadsPath && existsSync(beadsPath)) {
      try { ticketState.beads = readFileSync(beadsPath, 'utf-8') } catch { /* ignore */ }
    }
  }

  const coverageContext = buildMinimalContext(contextPhase, ticketState)
  const coveragePromptConfiguration = buildCoveragePromptConfiguration({
    phase,
    coverageRunNumber,
    maxCoveragePasses: coverageSettings.maxCoveragePasses,
    isFinalAllowedRun,
    ...(phase === 'interview' && interviewCoverageBudget
      ? {
          coverageFollowUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
          followUpBudgetTotal: interviewCoverageBudget.total,
          followUpBudgetUsed: interviewCoverageBudget.used,
          followUpBudgetRemaining: interviewCoverageBudget.remaining,
        }
      : {}),
  })
  const promptContent = buildPromptFromTemplate(
    promptTemplate,
    [...coverageContext, coveragePromptConfiguration],
  )

  // Use a single session for the winning model only (not all council members)
  throwIfAborted(signal, ticketId)
  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>> | undefined
  let response = ''
  let coverageEnvelope: ReturnType<typeof normalizeCoverageResultOutput> | null = null
  let promptParts: PromptPart[] = [{ type: 'text', content: promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })
  let interviewCoverageResolution: ReturnType<typeof resolveInterviewCoverageFollowUpResolution> | null = null

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: worktreePath,
        parts: promptParts,
        signal,
        timeoutMs: councilSettings.draftTimeoutMs,
        model: winnerId,
        sessionOwnership: {
          ticketId,
          phase: stateLabel,
          memberId: winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            ticketId,
            context.externalId,
            stateLabel,
            `OpenCode coverage: sending ${phase} verification prompt to ${winnerId} (session=${session.id}).`,
            `${stateLabel}:${session.id}:coverage-created`,
            {
              modelId: winnerId,
              sessionId: session.id,
              source: `model:${winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            ticketId,
            context.externalId,
            stateLabel,
            winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            ticketId,
            context.externalId,
            stateLabel,
            winnerId,
            event,
          )
        },
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      if (error instanceof Error && error.message === 'Timeout') {
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', `Coverage verification failed: Timeout`)
        sendEvent({ type: 'ERROR', message: `Coverage verification failed: Timeout`, codes: ['COVERAGE_FAILED'] })
        return
      }
      throwIfCancelled(error, signal, ticketId)
      throw error
    }

    throwIfAborted(signal, ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      ticketId,
      context.externalId,
      stateLabel,
      winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
    )

    coverageEnvelope = normalizeCoverageResultOutput(response)
    if (coverageEnvelope.ok) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: coverageEnvelope.repairApplied,
        repairWarnings: coverageEnvelope.repairWarnings,
      })
      interviewCoverageResolution = phase === 'interview' && interviewSnapshot
        ? resolveInterviewCoverageFollowUpResolution({
            status: coverageEnvelope.value.status,
            structuredFollowUps: coverageEnvelope.value.followUpQuestions,
            rawResponse: response,
            snapshot: interviewSnapshot,
            attempt,
            maxFollowUps: interviewCoverageBudget?.total,
          })
        : null

      if (interviewCoverageResolution?.repairWarnings.length) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          repairWarnings: interviewCoverageResolution.repairWarnings,
        })
      }

      if (interviewCoverageResolution?.shouldRetry && interviewCoverageResolution.validationError) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: interviewCoverageResolution.validationError,
        })
        promptParts = buildStructuredRetryPrompt([{ type: 'text', content: promptContent }], {
          validationError: interviewCoverageResolution.validationError,
          rawResponse: response,
          schemaReminder: promptTemplate.outputFormat,
        })
        continue
      }

      if (interviewCoverageResolution?.validationError) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          validationError: interviewCoverageResolution.validationError,
        })
      }
      break
    }

    if (attempt === 1) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError: coverageEnvelope.error,
      })
      const msg = `Coverage output failed validation after retry: ${coverageEnvelope.error}`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    structuredMeta = buildStructuredMetadata(structuredMeta, {
      autoRetryCount: 1,
      validationError: coverageEnvelope.error,
    })
    promptParts = buildStructuredRetryPrompt([{ type: 'text', content: promptContent }], {
      validationError: coverageEnvelope.error,
      rawResponse: response,
      schemaReminder: promptTemplate.outputFormat,
    })
  }

  if (!coverageEnvelope?.ok || !runResult) {
    const msg = 'Coverage verification finished without a parseable structured result.'
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
    sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
    return
  }

  persistUiArtifactCompanionArtifact(
    ticketId,
    stateLabel,
    `${phase}_coverage_input`,
    phase === 'interview'
      ? {
          ...(ticketState.interview ? { interview: ticketState.interview } : {}),
          ...(ticketState.userAnswers ? { userAnswers: ticketState.userAnswers } : {}),
        }
      : phase === 'prd'
        ? {
            ...(ticketState.interview ? { interview: ticketState.interview } : {}),
            ...(ticketState.fullAnswers?.[0] ? { fullAnswers: ticketState.fullAnswers[0] } : {}),
            ...(refinedContent ? { refinedContent } : {}),
          }
        : {
            ...(ticketState.beads ? { beads: ticketState.beads } : {}),
            ...(refinedContent ? { refinedContent } : {}),
          },
  )
  const detectedGaps = coverageEnvelope.value.status === 'gaps'
  const followUpQuestions = interviewCoverageResolution?.followUpQuestions ?? []
  const gapDisposition = resolveCoverageGapDisposition({
    phase,
    hasGaps: detectedGaps,
    isFinalAllowedRun,
    hasFollowUpQuestions: followUpQuestions.length > 0,
    remainingInterviewBudget: interviewCoverageResolution?.budget.remaining ?? interviewCoverageBudget?.remaining,
  })
  const shouldQueueInterviewFollowUps = gapDisposition.shouldLoopBack && phase === 'interview'

  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({
      winnerId,
      hasGaps: detectedGaps,
      coverageRunNumber,
      maxCoveragePasses: coverageSettings.maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason,
    }),
  })

  persistUiArtifactCompanionArtifact(ticketId, stateLabel, `${phase}_coverage`, {
    response,
    normalizedContent: coverageEnvelope.normalizedContent,
    parsed: coverageEnvelope.value,
    structuredOutput: structuredMeta,
    ...(phase === 'interview' && interviewCoverageResolution
      ? {
          followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
          followUpBudgetTotal: interviewCoverageResolution.budget.total,
          followUpBudgetUsed: interviewCoverageResolution.budget.used,
          followUpBudgetRemaining: interviewCoverageResolution.budget.remaining,
        }
      : phase === 'interview' && interviewCoverageBudget
        ? {
            followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
            followUpBudgetTotal: interviewCoverageBudget.total,
            followUpBudgetUsed: interviewCoverageBudget.used,
            followUpBudgetRemaining: interviewCoverageBudget.remaining,
          }
        : {}),
  })

  if (detectedGaps) {
    if (phase === 'interview') {
      if (!interviewSnapshot) {
        const msg = 'Coverage found interview gaps but no normalized interview session snapshot was available.'
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }

      if (shouldQueueInterviewFollowUps) {
        const followUpBatch = buildCoverageFollowUpBatch(
          interviewSnapshot,
          followUpQuestions,
          buildCoverageFollowUpCommentary(response),
        )
        const updatedSnapshot = recordPreparedBatch(
          clearInterviewSessionBatch(interviewSnapshot),
          followUpBatch,
        )
        persistInterviewSession(ticketId, updatedSnapshot)

        // Clean up stale PROM4 session so handleInterviewQAStart can run on re-entry
        interviewQASessions.delete(ticketId)

        // Broadcast the follow-up batch so the frontend picks it up immediately
        broadcaster.broadcast(ticketId, 'needs_input', {
          ticketId,
          type: 'interview_batch',
          batch: followUpBatch,
        })
      }
    }

    if (phase === 'interview' && shouldQueueInterviewFollowUps) {
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    if (phase !== 'interview' && gapDisposition.shouldLoopBack) {
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`)
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    const reviewReason = phase === 'interview' && gapDisposition.terminationReason === 'follow_up_generation_failed'
      ? interviewCoverageResolution?.validationError
        ?? 'Coverage found interview gaps but produced no parseable follow-up questions.'
      : `Coverage gaps detected by winning model ${winnerId}, but ${describeCoverageTerminationReason(gapDisposition.terminationReason)}. Routing to approval with unresolved gaps for manual review.`
    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', reviewReason)
    sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
  } else {
    if (phase === 'interview') {
      try {
        const interviewPath = interviewSnapshot
          ? writeCanonicalInterview(context.externalId, ticketDir, interviewSnapshot)
          : resolve(ticketDir, 'interview.yaml')
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
          `Canonical interview.yaml ready at ${interviewPath}`)
      } catch (err) {
        console.error(`[runner] Failed to generate interview.yaml for ticket ${context.externalId}:`, err)
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
          `Failed to generate interview.yaml: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    emitPhaseLog(ticketId, context.externalId, stateLabel, 'info',
      `Coverage verification passed (winning model: ${winnerId}).`)
    sendEvent({ type: 'COVERAGE_CLEAN' })
  }
}

export async function handlePreFlight(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  const beads = readTicketBeads(ticketId)
  const report = await runPreFlightChecks(adapter, ticketId, beads, signal)
  throwIfAborted(signal, ticketId)
  insertPhaseArtifact(ticketId, {
    phase: 'PRE_FLIGHT_CHECK',
    artifactType: 'preflight_report',
    content: JSON.stringify(report),
  })

  if (!report.passed) {
    emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'error', 'Pre-flight checks failed.', {
      failures: report.criticalFailures.map(check => check.message),
    })
    sendEvent({ type: 'CHECKS_FAILED', errors: report.criticalFailures.map(check => check.message) })
    return
  }

  updateTicketProgressFromBeads(ticketId, beads)
  emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'info', `Pre-flight checks passed with ${beads.length} beads ready.`)
  sendEvent({ type: 'CHECKS_PASSED' })
}

export async function handleFinalTest(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal: AbortSignal,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'RUNNING_FINAL_TEST', sendEvent)
    return
  }

  const { worktreePath, ticket, relevantFiles } = loadTicketDirContext(context)
  const paths = getTicketPaths(ticketId)
  const ticketDir = paths?.ticketDir
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description: ticket?.description ?? '',
    relevantFiles,
  }

  if (ticketDir) {
    const interviewPath = resolve(ticketDir, 'interview.yaml')
    const prdPath = resolve(ticketDir, 'prd.yaml')
    const beadsPath = paths?.beadsPath

    if (existsSync(interviewPath)) {
      try { ticketState.interview = readFileSync(interviewPath, 'utf-8') } catch { /* ignore */ }
    }
    if (existsSync(prdPath)) {
      try { ticketState.prd = readFileSync(prdPath, 'utf-8') } catch { /* ignore */ }
    }
    if (existsSync(beadsPath)) {
      try { ticketState.beads = readFileSync(beadsPath, 'utf-8') } catch { /* ignore */ }
    }
  }

  const finalTestContext = buildMinimalContext('final_test', ticketState)
  const finalTestModelId = context.lockedMainImplementer
  if (!finalTestModelId) {
    throw new Error('No locked main implementer is configured for final tests')
  }
  const councilSettings = resolveCouncilRuntimeSettings(context)
  const streamStates = new Map<string, OpenCodeStreamState>()
  const output = await generateFinalTests(
    adapter,
    finalTestContext,
    worktreePath,
    signal,
    {
      ticketId,
      model: finalTestModelId,
      variant: context.lockedMainImplementerVariant ?? undefined,
      timeoutMs: councilSettings.draftTimeoutMs,
      onSessionCreated: (sessionId) => {
        emitAiMilestone(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          `Final test session created for ${finalTestModelId} (session=${sessionId}).`,
          `${sessionId}:final-test-created`,
          {
            modelId: finalTestModelId,
            sessionId,
            source: `model:${finalTestModelId}`,
          },
        )
      },
      onOpenCodeStreamEvent: ({ sessionId, event }) => {
        const streamState = streamStates.get(sessionId) ?? createOpenCodeStreamState()
        streamStates.set(sessionId, streamState)
        emitOpenCodeStreamEvent(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          finalTestModelId,
          sessionId,
          event,
          streamState,
        )
      },
      onPromptDispatched: ({ event }) => {
        emitOpenCodePromptLog(
          ticketId,
          context.externalId,
          'RUNNING_FINAL_TEST',
          finalTestModelId,
          event,
        )
      },
    },
  )
  throwIfAborted(signal, ticketId)

  const commandPlan = parseFinalTestCommands(output)
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const report = commandPlan.commands.length > 0
    ? await executeFinalTestCommands({
        commands: commandPlan.commands,
        cwd: worktreePath,
        timeoutMs: executionSettings.perIterationTimeoutMs,
        plannedBy: finalTestModelId!,
        ...(commandPlan.summary ? { summary: commandPlan.summary } : {}),
        modelOutput: output,
      })
    : {
        status: 'failed' as const,
        passed: false,
        checkedAt: new Date().toISOString(),
        plannedBy: finalTestModelId,
        modelOutput: output,
        commands: [],
        errors: commandPlan.errors,
      }

  insertPhaseArtifact(ticketId, {
    phase: 'RUNNING_FINAL_TEST',
    artifactType: 'final_test_report',
    content: JSON.stringify(report),
  })
  emitPhaseLog(
    ticketId,
    context.externalId,
    'RUNNING_FINAL_TEST',
    'test_result',
    report.passed
      ? `Final test commands passed (${report.commands.length} command${report.commands.length === 1 ? '' : 's'}).`
      : `Final test commands failed: ${report.errors.join('; ') || 'no commands were executed'}`,
    {
    audience: 'all',
    kind: 'test',
    op: 'append',
    source: `model:${finalTestModelId}`,
    modelId: finalTestModelId,
    streaming: false,
    },
  )
  if (report.passed) {
    emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'info', `Final tests passed (${report.commands.length} command${report.commands.length === 1 ? '' : 's'}).`)
    sendEvent({ type: 'TESTS_PASSED' })
    return
  }

  emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'error', 'Final tests failed.', {
    errors: report.errors,
  })
  sendEvent({ type: 'TESTS_FAILED' })
}

export async function handleMockCoverage(
  ticketId: string,
  context: TicketContext,
  phase: 'interview' | 'prd' | 'beads',
  sendEvent: (event: TicketEvent) => void,
) {
  const { members } = resolveCouncilMembers(context)
  const winnerId = readMockInterviewWinnerId(ticketId, members[0]?.modelId ?? 'mock-model-1')
  const stateLabel = getCoverageStateLabel(phase)
  const coverageSettings = resolveCoverageRuntimeSettings(context)
  const coverageRunNumber = countPhaseArtifacts(ticketId, `${phase}_coverage`, stateLabel) + 1
  const interviewSnapshot = phase === 'interview'
    ? readInterviewSessionSnapshotArtifact(ticketId)
    : null

  persistUiArtifactCompanionArtifact(ticketId, stateLabel, `${phase}_coverage`, {
    response: 'mock coverage clean',
    normalizedContent: 'mock coverage clean',
    parsed: { status: 'clean', gaps: [] },
    ...(phase === 'interview' && interviewSnapshot
      ? {
          followUpBudgetPercent: coverageSettings.coverageFollowUpBudgetPercent,
          followUpBudgetTotal: calculateFollowUpLimit(interviewSnapshot.maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent),
          followUpBudgetUsed: countCoverageFollowUpQuestions(interviewSnapshot),
          followUpBudgetRemaining: Math.max(
            0,
            calculateFollowUpLimit(interviewSnapshot.maxInitialQuestions, coverageSettings.coverageFollowUpBudgetPercent)
              - countCoverageFollowUpQuestions(interviewSnapshot),
          ),
        }
      : {}),
  })

  insertPhaseArtifact(ticketId, {
    phase: stateLabel,
    artifactType: `${phase}_coverage`,
    content: JSON.stringify({
      winnerId,
      hasGaps: false,
      coverageRunNumber,
      maxCoveragePasses: coverageSettings.maxCoveragePasses,
      limitReached: false,
      terminationReason: 'clean',
    }),
  })

  if (phase === 'interview') {
    const paths = getTicketPaths(ticketId)
    if (paths && interviewSnapshot) {
      writeCanonicalInterview(context.externalId, paths.ticketDir, interviewSnapshot)
    }
  }

  emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', `Mock ${phase} coverage passed.`)
  sendEvent({ type: 'COVERAGE_CLEAN' })
}
