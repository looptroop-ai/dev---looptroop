import type { TicketContext, TicketEvent } from '../../machines/types'
import { handleMockExecutionUnsupported } from './executionPhase'
import type { PromptPart } from '../../opencode/types'
import { CancelledError, throwIfAborted } from '../../council/types'
import { throwIfCancelled } from '../../lib/abort'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { buildPromptFromTemplate, PROM0, PROM13b, PROM24 } from '../../prompts/index'
import { getLatestPhaseArtifact, getTicketPaths, insertPhaseArtifact, countPhaseArtifacts } from '../../storage/tickets'
import { runOpenCodePrompt, runOpenCodeSessionPrompt } from '../runOpenCodePrompt'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { buildRelevantFilesArtifact, type RelevantFilesData } from '../../ticket/relevantFiles'
import {
  normalizeBeadSubsetYamlOutput,
  normalizeRelevantFilesOutput,
  normalizeCoverageResultOutput,
  buildStructuredRetryPrompt,
  type CoverageResultEnvelope,
  type RelevantFilesOutputPayload,
  type StructuredOutputResult,
} from '../../structuredOutput'
import { buildYamlDocument } from '../../structuredOutput/yamlUtils'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { runPreFlightChecks } from '../../phases/preflight/doctor'
import { generateFinalTests } from '../../phases/finalTest/generator'
import { executeFinalTestCommands } from '../../phases/finalTest/runner'
import { broadcaster } from '../../sse/broadcaster'
import { resolveInterviewCoverageFollowUpResolution } from '../interviewCoverageFollowUps'
import { resolveCoverageGapDisposition, resolveCoverageRunState } from '../coverageControl'
import { calculateFollowUpLimit } from '../../phases/interview/followUpBudget'
import { parsePrdRefinedArtifact } from '../../phases/prd/refined'
import {
  buildPrdCoverageRevisionArtifact,
  buildPrdCoverageRevisionRetryPrompt,
  buildPrdCoverageRevisionUiDiff,
  validatePrdCoverageRevisionOutput,
} from '../../phases/prd/coverageRevision'
import {
  buildBeadsCoverageRevisionArtifact,
  buildBeadsCoverageRevisionRetryPrompt,
  validateBeadsCoverageRevisionOutput,
} from '../../phases/beads/coverageRevision'
import { BEADS_PIPELINE_STEPS, getBeadsDraftMetrics } from '../../phases/beads/refined'
import { clearContextCache } from '../../opencode/contextBuilder'
import {
  countCoverageFollowUpQuestions,
  buildCoverageFollowUpBatch,
  recordPreparedBatch,
  clearInterviewSessionBatch,
} from '../../phases/interview/sessionState'
import { adapter, phaseResults, interviewQASessions } from './state'
import {
  emitPhaseLog,
  emitModelSystemLog,
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
import { readTicketBeads, updateTicketProgressFromBeads, writeTicketBeads } from './beadsPhase'
import { executeBeadsExpandStep } from './beadsPhase'
import { getStructuredRetryDecision } from '../../lib/structuredOutputRetry'
import { persistUiArtifactCompanionArtifact } from '../artifactCompanions'
import { resolveStructuredRetryDiagnostic } from '../../lib/structuredRetryDiagnostics'
import { buildStructuredOutputFailure } from '../../structuredOutput/failure'
import { parseUiArtifactCompanionArtifact } from '@shared/artifactCompanions'
import type { UiRefinementDiffArtifact } from '@shared/refinementDiffArtifacts'

export function validateRelevantFilesScanResponse(response: string): StructuredOutputResult<RelevantFilesOutputPayload> {
  const trimmed = response.trim()
  if (!trimmed) {
    return buildStructuredOutputFailure(response, 'Relevant files output was empty.')
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
    return buildStructuredOutputFailure(
      response,
      `Relevant files output must contain exactly one <RELEVANT_FILES_RESULT>...</RELEVANT_FILES_RESULT> block (found open=${openTagCount}, close=${closeTagCount}). Parse error: ${normalized.error}`,
      {
        repairWarnings: normalized.repairWarnings,
        retryDiagnostic: normalized.retryDiagnostic,
      },
    )
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

function loadRecoveredPrdCoverageContent(ticketId: string) {
  const artifact = getLatestPhaseArtifact(ticketId, 'prd_refined', 'REFINING_PRD')
  if (!artifact) return null

  try {
    const parsed = parsePrdRefinedArtifact(artifact.content)
    return parsed.refinedContent
  } catch {
    return null
  }
}

function loadRecoveredBeadsCoverageContent(ticketId: string) {
  const artifact = getLatestPhaseArtifact(ticketId, 'beads_coverage_revision', 'VERIFYING_BEADS_COVERAGE')
    ?? getLatestPhaseArtifact(ticketId, 'beads_refined', 'REFINING_BEADS')
  if (!artifact) return null

  try {
    const parsed = JSON.parse(artifact.content) as { refinedContent?: unknown }
    return typeof parsed.refinedContent === 'string' ? parsed.refinedContent : null
  } catch {
    return null
  }
}

type CoverageAttemptHistoryEntry = {
  candidateVersion: number
  status: 'clean' | 'gaps'
  summary: string
  gaps: string[]
  auditNotes: string
  response: string
  normalizedContent: string
  structuredOutput: ReturnType<typeof buildStructuredMetadata>
  coverageRunNumber: number
  maxCoveragePasses: number
  limitReached: boolean
  terminationReason: string | null
}

type CoverageTransitionHistoryEntry = {
  fromVersion: number
  toVersion: number
  summary: string
  gaps: string[]
  auditNotes: string
  fromContent: string
  toContent: string
  gapResolutions: Array<{
    gap: string
    action: string
    rationale: string
    affectedItems: Array<{ itemType: string; id: string; label: string }>
  }>
  resolutionNotes: string[]
  uiRefinementDiff: UiRefinementDiffArtifact | null
  structuredOutput: ReturnType<typeof buildStructuredMetadata>
}

type CoverageHistorySnapshot = {
  attempts: CoverageAttemptHistoryEntry[]
  transitions: CoverageTransitionHistoryEntry[]
  finalCandidateVersion?: number
}

function persistVersionedCoverageArtifact(params: {
  ticketId: string
  stateLabel: string
  phase: 'prd' | 'beads'
  winnerId: string
  response: string
  normalizedContent: string
  parsed: CoverageResultEnvelope
  structuredOutput: ReturnType<typeof buildStructuredMetadata>
  attemptEntry: CoverageAttemptHistoryEntry
  attempts: CoverageAttemptHistoryEntry[]
  transitions: CoverageTransitionHistoryEntry[]
  coverageRunNumber: number
  maxCoveragePasses: number
  limitReached: boolean
  terminationReason?: string | null
  finalCandidateVersion: number
  hasRemainingGaps: boolean
  remainingGaps: string[]
}) {
  insertPhaseArtifact(params.ticketId, {
    phase: params.stateLabel,
    artifactType: `${params.phase}_coverage`,
    content: JSON.stringify({
      winnerId: params.winnerId,
      hasGaps: params.attemptEntry.status === 'gaps',
      status: params.attemptEntry.status,
      gaps: params.attemptEntry.gaps,
      summary: params.attemptEntry.summary,
      coverageRunNumber: params.coverageRunNumber,
      maxCoveragePasses: params.maxCoveragePasses,
      limitReached: params.limitReached,
      terminationReason: params.terminationReason ?? null,
      finalCandidateVersion: params.finalCandidateVersion,
      hasRemainingGaps: params.hasRemainingGaps,
      remainingGaps: params.remainingGaps,
    }),
  })

  persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, `${params.phase}_coverage`, {
    response: params.response,
    normalizedContent: params.normalizedContent,
    parsed: params.parsed,
    structuredOutput: params.structuredOutput,
    status: params.attemptEntry.status,
    summary: params.attemptEntry.summary,
    gaps: params.attemptEntry.gaps,
    finalCandidateVersion: params.finalCandidateVersion,
    attempts: params.attempts,
    transitions: params.transitions,
    hasRemainingGaps: params.hasRemainingGaps,
    remainingGaps: params.remainingGaps,
    auditNotes: params.attemptEntry.auditNotes,
  })
}

function getVersionedCoveragePassLimit(phase: 'interview' | 'prd' | 'beads', configuredMax: number): number {
  if (phase === 'interview') return configuredMax
  return 3
}

function buildCoverageAttemptSummary(params: {
  phase: 'prd' | 'beads'
  status: 'clean' | 'gaps'
  candidateVersion: number
  gaps: string[]
  remaining: boolean
}): string {
  const candidateLabel = params.phase === 'prd'
    ? `PRD Candidate v${params.candidateVersion}`
    : `Implementation Plan v${params.candidateVersion}`

  if (params.status === 'clean') {
    return params.candidateVersion > 1
      ? `No remaining coverage gaps found in ${candidateLabel}.`
      : `No coverage gaps found in ${candidateLabel}.`
  }

  const gapLabel = params.gaps.length === 1 ? '1 gap' : `${params.gaps.length} gaps`
  return params.remaining
    ? `${candidateLabel} still has ${gapLabel}.`
    : `Coverage found ${gapLabel} in ${candidateLabel}.`
}

function buildCoverageTransitionSummary(params: {
  phase: 'prd' | 'beads'
  fromVersion: number
  toVersion: number
  gaps: string[]
}): string {
  const candidateLabel = params.phase === 'prd' ? 'PRD Candidate' : 'Implementation Plan'
  const gapLabel = params.gaps.length === 1 ? '1 gap' : `${params.gaps.length} gaps`
  return `Coverage found ${gapLabel} in ${candidateLabel} v${params.fromVersion} and created ${candidateLabel} v${params.toVersion}.`
}

function loadCoverageHistorySnapshot(
  ticketId: string,
  phase: 'prd' | 'beads',
  stateLabel: string,
): CoverageHistorySnapshot {
  const artifact = getLatestPhaseArtifact(ticketId, `ui_artifact_companion:${phase}_coverage`, stateLabel)
  if (!artifact) {
    return { attempts: [], transitions: [] }
  }

  const parsed = parseUiArtifactCompanionArtifact(artifact.content)?.payload as Record<string, unknown> | undefined
  if (!parsed) {
    return { attempts: [], transitions: [] }
  }

  return {
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts as CoverageAttemptHistoryEntry[] : [],
    transitions: Array.isArray(parsed.transitions) ? parsed.transitions as CoverageTransitionHistoryEntry[] : [],
    finalCandidateVersion: typeof parsed.finalCandidateVersion === 'number' ? parsed.finalCandidateVersion : undefined,
  }
}

function normalizePrdCoverageEnvelope(envelope: CoverageResultEnvelope): {
  envelope: CoverageResultEnvelope
  repairWarnings: string[]
  validationError?: string
} {
  const repairWarnings: string[] = []
  const sanitizedFollowUpQuestions: CoverageResultEnvelope['followUpQuestions'] = []

  if (envelope.followUpQuestions.length > 0) {
    repairWarnings.push('PRD coverage follow_up_questions were ignored because PRD coverage is envelope-only.')
  }

  const sanitizedGaps = envelope.gaps.map(gap => gap.trim()).filter((gap): gap is string => gap.length > 0)

  if (envelope.status === 'clean') {
    if (sanitizedGaps.length > 0) {
      return {
        envelope: {
          status: 'clean',
          gaps: sanitizedGaps,
          followUpQuestions: sanitizedFollowUpQuestions,
        },
        repairWarnings,
        validationError: 'PRD coverage reported status clean but also returned gaps. Return status gaps for unresolved coverage and keep gaps empty when status is clean.',
      }
    }

    return {
      envelope: {
        status: 'clean',
        gaps: [],
        followUpQuestions: sanitizedFollowUpQuestions,
      },
      repairWarnings,
    }
  }

  if (sanitizedGaps.length === 0) {
    return {
      envelope: {
        status: 'gaps',
        gaps: [],
        followUpQuestions: sanitizedFollowUpQuestions,
      },
      repairWarnings,
      validationError: 'PRD coverage reported status gaps but did not return any non-empty gap strings. Return at least one concrete gap string.',
    }
  }

  if (sanitizedGaps.length !== envelope.gaps.length) {
    repairWarnings.push('Trimmed empty PRD coverage gap strings before persisting the normalized result.')
  }

  return {
    envelope: {
      status: 'gaps',
      gaps: sanitizedGaps,
      followUpQuestions: sanitizedFollowUpQuestions,
    },
    repairWarnings,
  }
}

function normalizeBeadsCoverageEnvelope(envelope: CoverageResultEnvelope): {
  envelope: CoverageResultEnvelope
  repairWarnings: string[]
  validationError?: string
} {
  const repairWarnings: string[] = []
  const sanitizedFollowUpQuestions: CoverageResultEnvelope['followUpQuestions'] = []

  if (envelope.followUpQuestions.length > 0) {
    repairWarnings.push('Beads coverage follow_up_questions were ignored because beads coverage is envelope-only.')
  }

  const sanitizedGaps = envelope.gaps.map(gap => gap.trim()).filter((gap): gap is string => gap.length > 0)

  if (envelope.status === 'clean') {
    if (sanitizedGaps.length > 0) {
      return {
        envelope: {
          status: 'clean',
          gaps: sanitizedGaps,
          followUpQuestions: sanitizedFollowUpQuestions,
        },
        repairWarnings,
        validationError: 'Beads coverage reported status clean but also returned gaps. Return status gaps for unresolved coverage and keep gaps empty when status is clean.',
      }
    }

    return {
      envelope: {
        status: 'clean',
        gaps: [],
        followUpQuestions: sanitizedFollowUpQuestions,
      },
      repairWarnings,
    }
  }

  if (sanitizedGaps.length === 0) {
    return {
      envelope: {
        status: 'gaps',
        gaps: [],
        followUpQuestions: sanitizedFollowUpQuestions,
      },
      repairWarnings,
      validationError: 'Beads coverage reported status gaps but did not return any non-empty gap strings. Return at least one concrete gap string.',
    }
  }

  if (sanitizedGaps.length !== envelope.gaps.length) {
    repairWarnings.push('Trimmed empty beads coverage gap strings before persisting the normalized result.')
  }

  return {
    envelope: {
      status: 'gaps',
      gaps: sanitizedGaps,
      followUpQuestions: sanitizedFollowUpQuestions,
    },
    repairWarnings,
  }
}

async function runPrdCoverageAuditPrompt(params: {
  ticketId: string
  externalId: string
  stateLabel: string
  winnerId: string
  worktreePath: string
  promptContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  coverageRunNumber: number
  maxCoveragePasses: number
  signal: AbortSignal
}): Promise<{
  response: string
  envelope: CoverageResultEnvelope
  normalizedContent: string
  structuredMeta: ReturnType<typeof buildStructuredMetadata>
}> {
  throwIfAborted(params.signal, params.ticketId)

  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>> | undefined
  let response = ''
  let coverageEnvelope: ReturnType<typeof normalizeCoverageResultOutput> | null = null
  let promptParts: PromptPart[] = [{ type: 'text', content: params.promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: params.worktreePath,
        parts: promptParts,
        signal: params.signal,
        timeoutMs: params.councilSettings.draftTimeoutMs,
        model: params.winnerId,
        variant: 'coverage',
        toolPolicy: getCoveragePromptTemplate('prd').toolPolicy,
        sessionOwnership: {
          ticketId: params.ticketId,
          phase: params.stateLabel,
          memberId: params.winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            `OpenCode coverage: sending prd verification prompt to ${params.winnerId} (session=${session.id}).`,
            `${params.stateLabel}:${session.id}:prd-coverage-audit-created`,
            {
              modelId: params.winnerId,
              sessionId: session.id,
              source: `model:${params.winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            event,
          )
        },
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      if (error instanceof Error && error.message === 'Timeout') {
        throw new Error('Coverage verification failed: Timeout')
      }
      throwIfCancelled(error, params.signal, params.ticketId)
      throw error
    }

    throwIfAborted(params.signal, params.ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      params.ticketId,
      params.externalId,
      params.stateLabel,
      params.winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
      streamState,
    )

    coverageEnvelope = normalizeCoverageResultOutput(response)
    if (coverageEnvelope.ok) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: coverageEnvelope.repairApplied,
        repairWarnings: coverageEnvelope.repairWarnings,
      })

      const prdCoverageNormalization = normalizePrdCoverageEnvelope(coverageEnvelope.value)
      if (prdCoverageNormalization.repairWarnings.length > 0) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          repairWarnings: prdCoverageNormalization.repairWarnings,
        })
      }

      if (prdCoverageNormalization.validationError) {
        if (attempt === 1) {
          structuredMeta = buildStructuredMetadata(structuredMeta, {
            autoRetryCount: 1,
            validationError: prdCoverageNormalization.validationError,
            retryDiagnostics: [resolveStructuredRetryDiagnostic({
              attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
              rawResponse: response,
              validationError: prdCoverageNormalization.validationError,
            })],
          })
          throw new Error(`PRD coverage output failed semantic validation after retry: ${prdCoverageNormalization.validationError}`)
        }

        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: prdCoverageNormalization.validationError,
          retryDiagnostics: [resolveStructuredRetryDiagnostic({
            attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
            rawResponse: response,
            validationError: prdCoverageNormalization.validationError,
          })],
        })
        promptParts = buildStructuredRetryPrompt([{ type: 'text', content: params.promptContent }], {
          validationError: prdCoverageNormalization.validationError,
          rawResponse: response,
          schemaReminder: getCoveragePromptTemplate('prd').outputFormat,
        })
        continue
      }

      coverageEnvelope = {
        ...coverageEnvelope,
        value: prdCoverageNormalization.envelope,
        normalizedContent: buildYamlDocument({
          status: prdCoverageNormalization.envelope.status,
          gaps: prdCoverageNormalization.envelope.gaps,
          follow_up_questions: prdCoverageNormalization.envelope.followUpQuestions,
        }),
        repairApplied: coverageEnvelope.repairApplied || prdCoverageNormalization.repairWarnings.length > 0,
        repairWarnings: [...coverageEnvelope.repairWarnings, ...prdCoverageNormalization.repairWarnings],
      }
      break
    }

    if (attempt === 1) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError: coverageEnvelope.error,
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
          rawResponse: response,
          validationError: coverageEnvelope.error,
          retryDiagnostic: coverageEnvelope.retryDiagnostic,
        })],
      })
      throw new Error(`Coverage output failed validation after retry: ${coverageEnvelope.error}`)
    }

    structuredMeta = buildStructuredMetadata(structuredMeta, {
      autoRetryCount: 1,
      validationError: coverageEnvelope.error,
      retryDiagnostics: [resolveStructuredRetryDiagnostic({
        attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
        rawResponse: response,
        validationError: coverageEnvelope.error,
        retryDiagnostic: coverageEnvelope.retryDiagnostic,
      })],
    })
    promptParts = buildStructuredRetryPrompt([{ type: 'text', content: params.promptContent }], {
      validationError: coverageEnvelope.error,
      rawResponse: response,
      schemaReminder: getCoveragePromptTemplate('prd').outputFormat,
    })
  }

  if (!coverageEnvelope?.ok || !runResult) {
    throw new Error('Coverage verification finished without a parseable structured result.')
  }

  return {
    response,
    envelope: coverageEnvelope.value,
    normalizedContent: coverageEnvelope.normalizedContent,
    structuredMeta,
  }
}

async function runPrdCoverageResolutionPrompt(params: {
  ticketId: string
  externalId: string
  stateLabel: string
  winnerId: string
  worktreePath: string
  promptContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  signal: AbortSignal
  interviewContent: string
  currentCandidateContent: string
  coverageGaps: string[]
}): Promise<{
  response: string
  revision: ReturnType<typeof validatePrdCoverageRevisionOutput>
  structuredMeta: ReturnType<typeof buildStructuredMetadata>
}> {
  throwIfAborted(params.signal, params.ticketId)

  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let response = ''
  let promptParts: PromptPart[] = [{ type: 'text', content: params.promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>>
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: params.worktreePath,
        parts: promptParts,
        signal: params.signal,
        timeoutMs: params.councilSettings.draftTimeoutMs,
        model: params.winnerId,
        variant: 'coverage',
        toolPolicy: PROM13b.toolPolicy,
        sessionOwnership: {
          ticketId: params.ticketId,
          phase: params.stateLabel,
          memberId: params.winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            `OpenCode coverage: sending PRD coverage resolution prompt to ${params.winnerId} (session=${session.id}).`,
            `${params.stateLabel}:${session.id}:prd-coverage-resolution-created`,
            {
              modelId: params.winnerId,
              sessionId: session.id,
              source: `model:${params.winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            event,
          )
        },
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      if (error instanceof Error && error.message === 'Timeout') {
        throw new Error('PRD coverage resolution failed: Timeout')
      }
      throwIfCancelled(error, params.signal, params.ticketId)
      throw error
    }

    throwIfAborted(params.signal, params.ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      params.ticketId,
      params.externalId,
      params.stateLabel,
      params.winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
      streamState,
    )

    try {
      const revision = validatePrdCoverageRevisionOutput(response, {
        ticketId: params.externalId,
        interviewContent: params.interviewContent,
        currentCandidateContent: params.currentCandidateContent,
        coverageGaps: params.coverageGaps,
      })

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: revision.repairApplied,
        repairWarnings: revision.repairWarnings,
      })

      return { response, revision, structuredMeta }
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error)
      if (attempt === 1) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError,
          retryDiagnostics: [resolveStructuredRetryDiagnostic({
            attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
            rawResponse: response,
            validationError,
            error,
          })],
        })
        throw new Error(`PRD coverage resolution output failed validation after retry: ${validationError}`)
      }

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError,
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
          rawResponse: response,
          validationError,
          error,
        })],
      })
      promptParts = buildPrdCoverageRevisionRetryPrompt([{ type: 'text', content: params.promptContent }], {
        validationError,
        rawResponse: response,
      })
    }
  }

  throw new Error('PRD coverage resolution finished without a validated structured result.')
}

async function runBeadsCoverageAuditPrompt(params: {
  ticketId: string
  externalId: string
  stateLabel: string
  winnerId: string
  worktreePath: string
  promptContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  signal: AbortSignal
}): Promise<{
  response: string
  envelope: CoverageResultEnvelope
  normalizedContent: string
  structuredMeta: ReturnType<typeof buildStructuredMetadata>
}> {
  throwIfAborted(params.signal, params.ticketId)

  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>> | undefined
  let response = ''
  let coverageEnvelope: ReturnType<typeof normalizeCoverageResultOutput> | null = null
  let promptParts: PromptPart[] = [{ type: 'text', content: params.promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: params.worktreePath,
        parts: promptParts,
        signal: params.signal,
        timeoutMs: params.councilSettings.draftTimeoutMs,
        model: params.winnerId,
        variant: 'coverage',
        toolPolicy: getCoveragePromptTemplate('beads').toolPolicy,
        sessionOwnership: {
          ticketId: params.ticketId,
          phase: params.stateLabel,
          memberId: params.winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            `OpenCode coverage: sending beads verification prompt to ${params.winnerId} (session=${session.id}).`,
            `${params.stateLabel}:${session.id}:beads-coverage-audit-created`,
            {
              modelId: params.winnerId,
              sessionId: session.id,
              source: `model:${params.winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            event,
          )
        },
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      if (error instanceof Error && error.message === 'Timeout') {
        throw new Error('Coverage verification failed: Timeout')
      }
      throwIfCancelled(error, params.signal, params.ticketId)
      throw error
    }

    throwIfAborted(params.signal, params.ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      params.ticketId,
      params.externalId,
      params.stateLabel,
      params.winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
      streamState,
    )

    coverageEnvelope = normalizeCoverageResultOutput(response)
    if (coverageEnvelope.ok) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: coverageEnvelope.repairApplied,
        repairWarnings: coverageEnvelope.repairWarnings,
      })

      const beadsCoverageNormalization = normalizeBeadsCoverageEnvelope(coverageEnvelope.value)
      if (beadsCoverageNormalization.repairWarnings.length > 0) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          repairWarnings: beadsCoverageNormalization.repairWarnings,
        })
      }

      if (beadsCoverageNormalization.validationError) {
        if (attempt === 1) {
          structuredMeta = buildStructuredMetadata(structuredMeta, {
            autoRetryCount: 1,
            validationError: beadsCoverageNormalization.validationError,
            retryDiagnostics: [resolveStructuredRetryDiagnostic({
              attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
              rawResponse: response,
              validationError: beadsCoverageNormalization.validationError,
            })],
          })
          throw new Error(`Beads coverage output failed semantic validation after retry: ${beadsCoverageNormalization.validationError}`)
        }

        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError: beadsCoverageNormalization.validationError,
          retryDiagnostics: [resolveStructuredRetryDiagnostic({
            attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
            rawResponse: response,
            validationError: beadsCoverageNormalization.validationError,
          })],
        })
        promptParts = buildStructuredRetryPrompt([{ type: 'text', content: params.promptContent }], {
          validationError: beadsCoverageNormalization.validationError,
          rawResponse: response,
          schemaReminder: getCoveragePromptTemplate('beads').outputFormat,
        })
        continue
      }

      coverageEnvelope = {
        ...coverageEnvelope,
        value: beadsCoverageNormalization.envelope,
        normalizedContent: buildYamlDocument({
          status: beadsCoverageNormalization.envelope.status,
          gaps: beadsCoverageNormalization.envelope.gaps,
          follow_up_questions: beadsCoverageNormalization.envelope.followUpQuestions,
        }),
        repairApplied: coverageEnvelope.repairApplied || beadsCoverageNormalization.repairWarnings.length > 0,
        repairWarnings: [...coverageEnvelope.repairWarnings, ...beadsCoverageNormalization.repairWarnings],
      }
      break
    }

    if (attempt === 1) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError: coverageEnvelope.error,
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
          rawResponse: response,
          validationError: coverageEnvelope.error,
          retryDiagnostic: coverageEnvelope.retryDiagnostic,
        })],
      })
      throw new Error(`Coverage output failed validation after retry: ${coverageEnvelope.error}`)
    }

    structuredMeta = buildStructuredMetadata(structuredMeta, {
      autoRetryCount: 1,
      validationError: coverageEnvelope.error,
      retryDiagnostics: [resolveStructuredRetryDiagnostic({
        attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
        rawResponse: response,
        validationError: coverageEnvelope.error,
        retryDiagnostic: coverageEnvelope.retryDiagnostic,
      })],
    })
    promptParts = buildStructuredRetryPrompt([{ type: 'text', content: params.promptContent }], {
      validationError: coverageEnvelope.error,
      rawResponse: response,
      schemaReminder: getCoveragePromptTemplate('beads').outputFormat,
    })
  }

  if (!coverageEnvelope?.ok || !runResult) {
    throw new Error('Coverage verification finished without a parseable structured result.')
  }

  return {
    response,
    envelope: coverageEnvelope.value,
    normalizedContent: coverageEnvelope.normalizedContent,
    structuredMeta,
  }
}

async function runBeadsCoverageResolutionPrompt(params: {
  ticketId: string
  externalId: string
  stateLabel: string
  winnerId: string
  worktreePath: string
  promptContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  signal: AbortSignal
  currentCandidateContent: string
  coverageGaps: string[]
}): Promise<{
  response: string
  revision: ReturnType<typeof validateBeadsCoverageRevisionOutput>
  structuredMeta: ReturnType<typeof buildStructuredMetadata>
}> {
  throwIfAborted(params.signal, params.ticketId)

  const streamState = createOpenCodeStreamState()
  let sessionId = ''
  let response = ''
  let promptParts: PromptPart[] = [{ type: 'text', content: params.promptContent }]
  let structuredMeta = buildStructuredMetadata({ autoRetryCount: 0, repairApplied: false, repairWarnings: [] })

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let runResult: Awaited<ReturnType<typeof runOpenCodePrompt>>
    try {
      runResult = await runOpenCodePrompt({
        adapter,
        projectPath: params.worktreePath,
        parts: promptParts,
        signal: params.signal,
        timeoutMs: params.councilSettings.draftTimeoutMs,
        model: params.winnerId,
        variant: 'coverage',
        toolPolicy: PROM24.toolPolicy,
        sessionOwnership: {
          ticketId: params.ticketId,
          phase: params.stateLabel,
          memberId: params.winnerId,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            `OpenCode coverage: sending beads coverage resolution prompt to ${params.winnerId} (session=${session.id}).`,
            `${params.stateLabel}:${session.id}:beads-coverage-resolution-created`,
            {
              modelId: params.winnerId,
              sessionId: session.id,
              source: `model:${params.winnerId}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            params.ticketId,
            params.externalId,
            params.stateLabel,
            params.winnerId,
            event,
          )
        },
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      if (error instanceof Error && error.message === 'Timeout') {
        throw new Error('Beads coverage resolution failed: Timeout')
      }
      throwIfCancelled(error, params.signal, params.ticketId)
      throw error
    }

    throwIfAborted(params.signal, params.ticketId)
    response = runResult.response

    emitOpenCodeSessionLogs(
      params.ticketId,
      params.externalId,
      params.stateLabel,
      params.winnerId,
      runResult.session.id,
      'coverage',
      response,
      runResult.messages,
      streamState,
    )

    try {
      const revision = validateBeadsCoverageRevisionOutput(response, {
        currentCandidateContent: params.currentCandidateContent,
        coverageGaps: params.coverageGaps,
      })

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: revision.repairApplied,
        repairWarnings: revision.repairWarnings,
      })

      return { response, revision, structuredMeta }
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error)
      if (attempt === 1) {
        structuredMeta = buildStructuredMetadata(structuredMeta, {
          autoRetryCount: 1,
          validationError,
          retryDiagnostics: [resolveStructuredRetryDiagnostic({
            attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
            rawResponse: response,
            validationError,
            error,
          })],
        })
        throw new Error(`Beads coverage resolution output failed validation after retry: ${validationError}`)
      }

      structuredMeta = buildStructuredMetadata(structuredMeta, {
        autoRetryCount: 1,
        validationError,
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
          rawResponse: response,
          validationError,
          error,
        })],
      })
      promptParts = buildBeadsCoverageRevisionRetryPrompt([{ type: 'text', content: params.promptContent }], {
        validationError,
        rawResponse: response,
      })
    }
  }

  throw new Error('Beads coverage resolution finished without a validated structured result.')
}

async function finalizeBeadsCoverageExpansion(params: {
  ticketId: string
  externalId: string
  stateLabel: string
  winnerId: string
  worktreePath: string
  signal: AbortSignal
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  ticketState: TicketState
  candidateContent: string
  candidateVersion: number
}) {
  const normalizedBlueprint = normalizeBeadSubsetYamlOutput(params.candidateContent)
  if (!normalizedBlueprint.ok) {
    throw new Error(`Final beads expansion requires a valid semantic blueprint: ${normalizedBlueprint.error}`)
  }

  const beadSubsets = normalizedBlueprint.value
  const draftMetrics = getBeadsDraftMetrics(beadSubsets)
  const streamStates = new Map<string, OpenCodeStreamState>()

  emitModelSystemLog(
    params.ticketId,
    params.externalId,
    params.stateLabel,
    'info',
    `Coverage finished for Implementation Plan v${params.candidateVersion}. Running the final expansion step on the validated semantic blueprint.`,
    params.winnerId,
  )

  const expansionResult = await executeBeadsExpandStep({
    ticketId: params.ticketId,
    externalId: params.externalId,
    phaseLabel: params.stateLabel,
    worktreePath: params.worktreePath,
    winnerId: params.winnerId,
    externalRef: params.externalId,
    timeoutMs: params.councilSettings.draftTimeoutMs,
    signal: params.signal,
    ticketState: {
      ...params.ticketState,
      beadsDraft: params.candidateContent,
    },
    beadSubsets,
    variant: 'coverage',
    onSessionLog: (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeSessionLogs(
        params.ticketId,
        params.externalId,
        params.stateLabel,
        entry.memberId,
        entry.sessionId,
        'coverage',
        entry.response,
        entry.messages,
        streamState,
      )
    },
    onStreamEvent: (entry) => {
      const streamState = streamStates.get(entry.sessionId) ?? createOpenCodeStreamState()
      streamStates.set(entry.sessionId, streamState)
      emitOpenCodeStreamEvent(
        params.ticketId,
        params.externalId,
        params.stateLabel,
        entry.memberId,
        entry.sessionId,
        entry.event,
        streamState,
      )
    },
    onPromptDispatched: (entry) => {
      emitOpenCodePromptLog(
        params.ticketId,
        params.externalId,
        params.stateLabel,
        entry.memberId,
        entry.event,
      )
    },
  })

  insertPhaseArtifact(params.ticketId, {
    phase: params.stateLabel,
    artifactType: 'beads_expanded',
    content: JSON.stringify({
      winnerId: params.winnerId,
      refinedContent: expansionResult.hydratedContent,
      expandedContent: expansionResult.expandedModelContent,
      candidateVersion: params.candidateVersion,
    }),
  })
  persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, 'beads_expanded', {
    structuredOutput: expansionResult.structuredMeta,
    draftMetrics,
    pipelineSteps: BEADS_PIPELINE_STEPS,
    candidateVersion: params.candidateVersion,
  })

  writeTicketBeads(params.ticketId, expansionResult.hydratedBeads)
  updateTicketProgressFromBeads(params.ticketId, expansionResult.hydratedBeads)
  clearContextCache(params.externalId)

  emitModelSystemLog(
    params.ticketId,
    params.externalId,
    params.stateLabel,
    'info',
    `Final beads expansion completed for Implementation Plan v${params.candidateVersion}. Persisted ${expansionResult.hydratedBeads.length} execution-ready beads.`,
    params.winnerId,
  )
}

async function handlePrdCoverageVerificationLoop(params: {
  ticketId: string
  context: TicketContext
  sendEvent: (event: TicketEvent) => void
  signal: AbortSignal
  worktreePath: string
  ticketDir: string
  winnerId: string
  stateLabel: string
  ticketState: TicketState
  effectivePrdContent: string
  interviewContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  coverageSettings: ReturnType<typeof resolveCoverageRuntimeSettings>
}) {
  const prdPath = resolve(params.ticketDir, 'prd.yaml')
  let currentCandidateContent = params.effectivePrdContent.trim()
  const historySnapshot = loadCoverageHistorySnapshot(params.ticketId, 'prd', params.stateLabel)
  const maxCoveragePasses = getVersionedCoveragePassLimit('prd', params.coverageSettings.maxCoveragePasses)
  let attempts = [...historySnapshot.attempts]
  let transitions = [...historySnapshot.transitions]
  let currentCandidateVersion = historySnapshot.finalCandidateVersion
    ?? (countPhaseArtifacts(params.ticketId, 'prd_coverage_revision', params.stateLabel) + 1)

  while (true) {
    const completedCoveragePasses = attempts.length
    const coverageRunState = resolveCoverageRunState(completedCoveragePasses, maxCoveragePasses)
    if (coverageRunState.limitAlreadyReached) {
      emitPhaseLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Coverage retry cap already reached for prd (${completedCoveragePasses}/${maxCoveragePasses}). Routing to approval without another coverage execution.`,
      )
      params.sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
      return
    }

    const { coverageRunNumber, isFinalAllowedRun } = coverageRunState
    params.ticketState.prd = currentCandidateContent
    clearContextCache(params.context.externalId)

    const coverageContext = buildMinimalContext('prd_coverage', params.ticketState)
    const coveragePromptConfiguration = buildCoveragePromptConfiguration({
      phase: 'prd',
      coverageRunNumber,
      maxCoveragePasses,
      isFinalAllowedRun,
    })
    const auditPromptContent = buildPromptFromTemplate(
      getCoveragePromptTemplate('prd'),
      [...coverageContext, coveragePromptConfiguration],
    )

    const auditResult = await runPrdCoverageAuditPrompt({
      ticketId: params.ticketId,
      externalId: params.context.externalId,
      stateLabel: params.stateLabel,
      winnerId: params.winnerId,
      worktreePath: params.worktreePath,
      promptContent: auditPromptContent,
      councilSettings: params.councilSettings,
      coverageRunNumber,
      maxCoveragePasses,
      signal: params.signal,
    })

    insertPhaseArtifact(params.ticketId, {
      phase: params.stateLabel,
      artifactType: 'prd_coverage_input',
      content: JSON.stringify({
        candidateVersion: currentCandidateVersion,
        refinedContent: currentCandidateContent,
      }),
    })
    persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, 'prd_coverage_input', {
      interview: params.interviewContent,
      ...(params.ticketState.fullAnswers?.[0] ? { fullAnswers: params.ticketState.fullAnswers[0] } : {}),
      prd: currentCandidateContent,
      refinedContent: currentCandidateContent,
      candidateVersion: currentCandidateVersion,
    })

    const detectedGaps = auditResult.envelope.status === 'gaps'
    const gapDisposition = resolveCoverageGapDisposition({
      phase: 'prd',
      hasGaps: detectedGaps,
      isFinalAllowedRun,
      hasFollowUpQuestions: false,
      remainingInterviewBudget: undefined,
    })
    const attemptEntry: CoverageAttemptHistoryEntry = {
      candidateVersion: currentCandidateVersion,
      status: auditResult.envelope.status,
      summary: buildCoverageAttemptSummary({
        phase: 'prd',
        status: auditResult.envelope.status,
        candidateVersion: currentCandidateVersion,
        gaps: auditResult.envelope.gaps,
        remaining: detectedGaps,
      }),
      gaps: [...auditResult.envelope.gaps],
      auditNotes: auditResult.normalizedContent,
      response: auditResult.response,
      normalizedContent: auditResult.normalizedContent,
      structuredOutput: auditResult.structuredMeta,
      coverageRunNumber,
      maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason ?? null,
    }
    const nextAttempts = [...attempts, attemptEntry]

    if (!detectedGaps) {
      persistVersionedCoverageArtifact({
        ticketId: params.ticketId,
        stateLabel: params.stateLabel,
        phase: 'prd',
        winnerId: params.winnerId,
        response: auditResult.response,
        normalizedContent: auditResult.normalizedContent,
        parsed: auditResult.envelope,
        structuredOutput: auditResult.structuredMeta,
        attemptEntry,
        attempts: nextAttempts,
        transitions,
        coverageRunNumber,
        maxCoveragePasses,
        limitReached: false,
        terminationReason: gapDisposition.terminationReason,
        finalCandidateVersion: currentCandidateVersion,
        hasRemainingGaps: false,
        remainingGaps: [],
      })
      attempts = nextAttempts
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Coverage verification passed (winning model: ${params.winnerId}) for PRD Candidate v${currentCandidateVersion}.`,
        params.winnerId,
      )
      params.sendEvent({ type: 'COVERAGE_CLEAN' })
      return
    }

    if (!gapDisposition.shouldLoopBack) {
      persistVersionedCoverageArtifact({
        ticketId: params.ticketId,
        stateLabel: params.stateLabel,
        phase: 'prd',
        winnerId: params.winnerId,
        response: auditResult.response,
        normalizedContent: auditResult.normalizedContent,
        parsed: auditResult.envelope,
        structuredOutput: auditResult.structuredMeta,
        attemptEntry,
        attempts: nextAttempts,
        transitions,
        coverageRunNumber,
        maxCoveragePasses,
        limitReached: gapDisposition.limitReached,
        terminationReason: gapDisposition.terminationReason,
        finalCandidateVersion: currentCandidateVersion,
        hasRemainingGaps: true,
        remainingGaps: auditResult.envelope.gaps,
      })
      attempts = nextAttempts
      const reviewReason = `Coverage gaps detected by winning model ${params.winnerId}, but ${describeCoverageTerminationReason(gapDisposition.terminationReason)}. Routing to approval with unresolved gaps for manual review.`
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        reviewReason,
        params.winnerId,
      )
      params.sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
      return
    }

    emitModelSystemLog(
      params.ticketId,
      params.context.externalId,
      params.stateLabel,
      'info',
      `Coverage found ${auditResult.envelope.gaps.length} gap(s) in PRD Candidate v${currentCandidateVersion}. Revising candidate before the next audit pass.`,
      params.winnerId,
    )

    params.ticketState.prd = currentCandidateContent
    clearContextCache(params.context.externalId)
    const revisionContext = buildMinimalContext('prd_coverage', params.ticketState)
    const revisionPromptContent = buildPromptFromTemplate(PROM13b, [
      ...revisionContext,
      {
        type: 'text',
        source: 'coverage_gaps',
        content: buildYamlDocument({ gaps: auditResult.envelope.gaps }),
      },
    ])

    const revisionRun = await runPrdCoverageResolutionPrompt({
      ticketId: params.ticketId,
      externalId: params.context.externalId,
      stateLabel: params.stateLabel,
      winnerId: params.winnerId,
      worktreePath: params.worktreePath,
      promptContent: revisionPromptContent,
      councilSettings: params.councilSettings,
      signal: params.signal,
      interviewContent: params.interviewContent,
      currentCandidateContent,
      coverageGaps: auditResult.envelope.gaps,
    })

    const nextCandidateVersion = currentCandidateVersion + 1
    const revisionArtifact = buildPrdCoverageRevisionArtifact(
      params.winnerId,
      nextCandidateVersion,
      revisionRun.revision,
      revisionRun.structuredMeta,
    )
    const uiDiffArtifact = buildPrdCoverageRevisionUiDiff(revisionArtifact)

    insertPhaseArtifact(params.ticketId, {
      phase: params.stateLabel,
      artifactType: 'prd_coverage_revision',
      content: JSON.stringify({
        winnerId: revisionArtifact.winnerId,
        refinedContent: revisionArtifact.refinedContent,
        candidateVersion: revisionArtifact.candidateVersion,
      }),
    })
    persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, 'prd_coverage_revision', {
      winnerId: revisionArtifact.winnerId,
      candidateVersion: revisionArtifact.candidateVersion,
      beforeContent: revisionArtifact.winnerDraftContent,
      afterContent: revisionArtifact.refinedContent,
      winnerDraftContent: revisionArtifact.winnerDraftContent,
      refinedContent: revisionArtifact.refinedContent,
      changes: revisionArtifact.changes,
      gapResolutions: revisionArtifact.gapResolutions,
      draftMetrics: revisionArtifact.draftMetrics,
      structuredOutput: revisionArtifact.structuredOutput ?? null,
      uiRefinementDiff: uiDiffArtifact,
      coverageBaselineContent: revisionArtifact.winnerDraftContent,
      coverageBaselineVersion: currentCandidateVersion,
      coverageUiRefinementDiff: uiDiffArtifact,
    })

    const nextTransitions = [
      ...transitions,
      {
        fromVersion: currentCandidateVersion,
        toVersion: nextCandidateVersion,
        summary: buildCoverageTransitionSummary({
          phase: 'prd',
          fromVersion: currentCandidateVersion,
          toVersion: nextCandidateVersion,
          gaps: auditResult.envelope.gaps,
        }),
        gaps: [...auditResult.envelope.gaps],
        auditNotes: auditResult.normalizedContent,
        fromContent: currentCandidateContent,
        toContent: revisionArtifact.refinedContent,
        gapResolutions: revisionArtifact.gapResolutions,
        resolutionNotes: revisionArtifact.gapResolutions.map((resolution) => resolution.rationale),
        uiRefinementDiff: uiDiffArtifact,
        structuredOutput: revisionRun.structuredMeta,
      } satisfies CoverageTransitionHistoryEntry,
    ]

    persistVersionedCoverageArtifact({
      ticketId: params.ticketId,
      stateLabel: params.stateLabel,
      phase: 'prd',
      winnerId: params.winnerId,
      response: auditResult.response,
      normalizedContent: auditResult.normalizedContent,
      parsed: auditResult.envelope,
      structuredOutput: auditResult.structuredMeta,
      attemptEntry,
      attempts: nextAttempts,
      transitions: nextTransitions,
      coverageRunNumber,
      maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason,
      finalCandidateVersion: nextCandidateVersion,
      hasRemainingGaps: true,
      remainingGaps: auditResult.envelope.gaps,
    })

    safeAtomicWrite(prdPath, revisionArtifact.refinedContent)
    clearContextCache(params.context.externalId)

    if (revisionRun.revision.repairWarnings.length > 0) {
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `PRD coverage resolution normalization applied repairs: ${revisionRun.revision.repairWarnings.join(' | ')}`,
        params.winnerId,
      )
    }
    if ((revisionRun.structuredMeta.autoRetryCount ?? 0) > 0 && revisionRun.structuredMeta.validationError) {
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `PRD coverage resolution required ${revisionRun.structuredMeta.autoRetryCount} structured retry attempt(s): ${revisionRun.structuredMeta.validationError}`,
        params.winnerId,
      )
    }

    emitModelSystemLog(
      params.ticketId,
      params.context.externalId,
      params.stateLabel,
      'info',
      `Revised PRD Candidate v${currentCandidateVersion} into PRD Candidate v${nextCandidateVersion} and saved it to ${prdPath}.`,
      params.winnerId,
    )

    attempts = nextAttempts
    transitions = nextTransitions
    currentCandidateContent = revisionArtifact.refinedContent
    currentCandidateVersion = nextCandidateVersion
  }
}

async function handleBeadsCoverageVerificationLoop(params: {
  ticketId: string
  context: TicketContext
  sendEvent: (event: TicketEvent) => void
  signal: AbortSignal
  worktreePath: string
  winnerId: string
  stateLabel: string
  ticketState: TicketState
  effectivePrdContent: string
  effectiveBeadsContent: string
  councilSettings: ReturnType<typeof resolveCouncilRuntimeSettings>
  coverageSettings: ReturnType<typeof resolveCoverageRuntimeSettings>
}) {
  let currentCandidateContent = params.effectiveBeadsContent.trim()
  const historySnapshot = loadCoverageHistorySnapshot(params.ticketId, 'beads', params.stateLabel)
  const maxCoveragePasses = getVersionedCoveragePassLimit('beads', params.coverageSettings.maxCoveragePasses)
  let attempts = [...historySnapshot.attempts]
  let transitions = [...historySnapshot.transitions]
  let currentCandidateVersion = historySnapshot.finalCandidateVersion
    ?? (countPhaseArtifacts(params.ticketId, 'beads_coverage_revision', params.stateLabel) + 1)

  while (true) {
    const completedCoveragePasses = attempts.length
    const coverageRunState = resolveCoverageRunState(completedCoveragePasses, maxCoveragePasses)
    if (coverageRunState.limitAlreadyReached) {
      emitPhaseLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Coverage retry cap already reached for beads (${completedCoveragePasses}/${maxCoveragePasses}). Finalizing the execution-ready blueprint before approval.`,
      )
      await finalizeBeadsCoverageExpansion({
        ticketId: params.ticketId,
        externalId: params.context.externalId,
        stateLabel: params.stateLabel,
        winnerId: params.winnerId,
        worktreePath: params.worktreePath,
        signal: params.signal,
        councilSettings: params.councilSettings,
        ticketState: params.ticketState,
        candidateContent: currentCandidateContent,
        candidateVersion: currentCandidateVersion,
      })
      params.sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
      return
    }

    const { coverageRunNumber, isFinalAllowedRun } = coverageRunState
    params.ticketState.prd = params.effectivePrdContent
    params.ticketState.beads = currentCandidateContent
    clearContextCache(params.context.externalId)

    const coverageContext = buildMinimalContext('beads_coverage', params.ticketState)
    const coveragePromptConfiguration = buildCoveragePromptConfiguration({
      phase: 'beads',
      coverageRunNumber,
      maxCoveragePasses,
      isFinalAllowedRun,
    })
    const auditPromptContent = buildPromptFromTemplate(
      getCoveragePromptTemplate('beads'),
      [...coverageContext, coveragePromptConfiguration],
    )

    const auditResult = await runBeadsCoverageAuditPrompt({
      ticketId: params.ticketId,
      externalId: params.context.externalId,
      stateLabel: params.stateLabel,
      winnerId: params.winnerId,
      worktreePath: params.worktreePath,
      promptContent: auditPromptContent,
      councilSettings: params.councilSettings,
      signal: params.signal,
    })

    insertPhaseArtifact(params.ticketId, {
      phase: params.stateLabel,
      artifactType: 'beads_coverage_input',
      content: JSON.stringify({
        candidateVersion: currentCandidateVersion,
        refinedContent: currentCandidateContent,
      }),
    })
    persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, 'beads_coverage_input', {
      prd: params.effectivePrdContent,
      beads: currentCandidateContent,
      refinedContent: currentCandidateContent,
      candidateVersion: currentCandidateVersion,
    })

    const detectedGaps = auditResult.envelope.status === 'gaps'
    const gapDisposition = resolveCoverageGapDisposition({
      phase: 'beads',
      hasGaps: detectedGaps,
      isFinalAllowedRun,
      hasFollowUpQuestions: false,
      remainingInterviewBudget: undefined,
    })
    const attemptEntry: CoverageAttemptHistoryEntry = {
      candidateVersion: currentCandidateVersion,
      status: auditResult.envelope.status,
      summary: buildCoverageAttemptSummary({
        phase: 'beads',
        status: auditResult.envelope.status,
        candidateVersion: currentCandidateVersion,
        gaps: auditResult.envelope.gaps,
        remaining: detectedGaps,
      }),
      gaps: [...auditResult.envelope.gaps],
      auditNotes: auditResult.normalizedContent,
      response: auditResult.response,
      normalizedContent: auditResult.normalizedContent,
      structuredOutput: auditResult.structuredMeta,
      coverageRunNumber,
      maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason ?? null,
    }
    const nextAttempts = [...attempts, attemptEntry]

    if (!detectedGaps) {
      persistVersionedCoverageArtifact({
        ticketId: params.ticketId,
        stateLabel: params.stateLabel,
        phase: 'beads',
        winnerId: params.winnerId,
        response: auditResult.response,
        normalizedContent: auditResult.normalizedContent,
        parsed: auditResult.envelope,
        structuredOutput: auditResult.structuredMeta,
        attemptEntry,
        attempts: nextAttempts,
        transitions,
        coverageRunNumber,
        maxCoveragePasses,
        limitReached: false,
        terminationReason: gapDisposition.terminationReason,
        finalCandidateVersion: currentCandidateVersion,
        hasRemainingGaps: false,
        remainingGaps: [],
      })
      attempts = nextAttempts
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Coverage verification passed (winning model: ${params.winnerId}) for Implementation Plan v${currentCandidateVersion}.`,
        params.winnerId,
      )
      await finalizeBeadsCoverageExpansion({
        ticketId: params.ticketId,
        externalId: params.context.externalId,
        stateLabel: params.stateLabel,
        winnerId: params.winnerId,
        worktreePath: params.worktreePath,
        signal: params.signal,
        councilSettings: params.councilSettings,
        ticketState: params.ticketState,
        candidateContent: currentCandidateContent,
        candidateVersion: currentCandidateVersion,
      })
      params.sendEvent({ type: 'COVERAGE_CLEAN' })
      return
    }

    if (!gapDisposition.shouldLoopBack) {
      persistVersionedCoverageArtifact({
        ticketId: params.ticketId,
        stateLabel: params.stateLabel,
        phase: 'beads',
        winnerId: params.winnerId,
        response: auditResult.response,
        normalizedContent: auditResult.normalizedContent,
        parsed: auditResult.envelope,
        structuredOutput: auditResult.structuredMeta,
        attemptEntry,
        attempts: nextAttempts,
        transitions,
        coverageRunNumber,
        maxCoveragePasses,
        limitReached: gapDisposition.limitReached,
        terminationReason: gapDisposition.terminationReason,
        finalCandidateVersion: currentCandidateVersion,
        hasRemainingGaps: true,
        remainingGaps: auditResult.envelope.gaps,
      })
      attempts = nextAttempts
      const reviewReason = `Coverage gaps detected by winning model ${params.winnerId}, but ${describeCoverageTerminationReason(gapDisposition.terminationReason)}. Routing to approval with unresolved gaps for manual review.`
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        reviewReason,
        params.winnerId,
      )
      await finalizeBeadsCoverageExpansion({
        ticketId: params.ticketId,
        externalId: params.context.externalId,
        stateLabel: params.stateLabel,
        winnerId: params.winnerId,
        worktreePath: params.worktreePath,
        signal: params.signal,
        councilSettings: params.councilSettings,
        ticketState: params.ticketState,
        candidateContent: currentCandidateContent,
        candidateVersion: currentCandidateVersion,
      })
      params.sendEvent({ type: 'COVERAGE_LIMIT_REACHED' })
      return
    }

    emitModelSystemLog(
      params.ticketId,
      params.context.externalId,
      params.stateLabel,
      'info',
      `Coverage found ${auditResult.envelope.gaps.length} gap(s) in Implementation Plan v${currentCandidateVersion}. Revising candidate before the next audit pass.`,
      params.winnerId,
    )

    params.ticketState.prd = params.effectivePrdContent
    params.ticketState.beads = currentCandidateContent
    clearContextCache(params.context.externalId)
    const revisionContext = buildMinimalContext('beads_coverage', params.ticketState)
    const revisionPromptContent = buildPromptFromTemplate(PROM24, [
      ...revisionContext,
      {
        type: 'text',
        source: 'coverage_gaps',
        content: buildYamlDocument({ gaps: auditResult.envelope.gaps }),
      },
    ])

    const revisionRun = await runBeadsCoverageResolutionPrompt({
      ticketId: params.ticketId,
      externalId: params.context.externalId,
      stateLabel: params.stateLabel,
      winnerId: params.winnerId,
      worktreePath: params.worktreePath,
      promptContent: revisionPromptContent,
      councilSettings: params.councilSettings,
      signal: params.signal,
      currentCandidateContent,
      coverageGaps: auditResult.envelope.gaps,
    })

    const nextCandidateVersion = currentCandidateVersion + 1
    const revisionArtifact = buildBeadsCoverageRevisionArtifact(
      params.winnerId,
      nextCandidateVersion,
      revisionRun.revision,
      revisionRun.structuredMeta,
      params.effectivePrdContent,
    )

    insertPhaseArtifact(params.ticketId, {
      phase: params.stateLabel,
      artifactType: 'beads_coverage_revision',
      content: JSON.stringify({
        winnerId: revisionArtifact.winnerId,
        refinedContent: revisionArtifact.refinedContent,
        candidateVersion: revisionArtifact.candidateVersion,
      }),
    })
    persistUiArtifactCompanionArtifact(params.ticketId, params.stateLabel, 'beads_coverage_revision', {
      winnerId: revisionArtifact.winnerId,
      candidateVersion: revisionArtifact.candidateVersion,
      beforeContent: revisionArtifact.winnerDraftContent,
      afterContent: revisionArtifact.refinedContent,
      winnerDraftContent: revisionArtifact.winnerDraftContent,
      refinedContent: revisionArtifact.refinedContent,
      changes: revisionArtifact.changes,
      gapResolutions: revisionArtifact.gapResolutions,
      draftMetrics: revisionArtifact.draftMetrics,
      structuredOutput: revisionArtifact.structuredOutput ?? null,
      uiRefinementDiff: revisionArtifact.uiRefinementDiff,
      coverageBaselineContent: revisionArtifact.winnerDraftContent,
      coverageBaselineVersion: currentCandidateVersion,
      coverageUiRefinementDiff: revisionArtifact.uiRefinementDiff,
    })

    const nextTransitions = [
      ...transitions,
      {
        fromVersion: currentCandidateVersion,
        toVersion: nextCandidateVersion,
        summary: buildCoverageTransitionSummary({
          phase: 'beads',
          fromVersion: currentCandidateVersion,
          toVersion: nextCandidateVersion,
          gaps: auditResult.envelope.gaps,
        }),
        gaps: [...auditResult.envelope.gaps],
        auditNotes: auditResult.normalizedContent,
        fromContent: currentCandidateContent,
        toContent: revisionArtifact.refinedContent,
        gapResolutions: revisionArtifact.gapResolutions,
        resolutionNotes: revisionArtifact.gapResolutions.map((resolution) => resolution.rationale),
        uiRefinementDiff: revisionArtifact.uiRefinementDiff,
        structuredOutput: revisionRun.structuredMeta,
      } satisfies CoverageTransitionHistoryEntry,
    ]

    persistVersionedCoverageArtifact({
      ticketId: params.ticketId,
      stateLabel: params.stateLabel,
      phase: 'beads',
      winnerId: params.winnerId,
      response: auditResult.response,
      normalizedContent: auditResult.normalizedContent,
      parsed: auditResult.envelope,
      structuredOutput: auditResult.structuredMeta,
      attemptEntry,
      attempts: nextAttempts,
      transitions: nextTransitions,
      coverageRunNumber,
      maxCoveragePasses,
      limitReached: gapDisposition.limitReached,
      terminationReason: gapDisposition.terminationReason,
      finalCandidateVersion: nextCandidateVersion,
      hasRemainingGaps: true,
      remainingGaps: auditResult.envelope.gaps,
    })
    clearContextCache(params.context.externalId)

    if (revisionRun.revision.repairWarnings.length > 0) {
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Beads coverage resolution normalization applied repairs: ${revisionRun.revision.repairWarnings.join(' | ')}`,
        params.winnerId,
      )
    }
    if ((revisionRun.structuredMeta.autoRetryCount ?? 0) > 0 && revisionRun.structuredMeta.validationError) {
      emitModelSystemLog(
        params.ticketId,
        params.context.externalId,
        params.stateLabel,
        'info',
        `Beads coverage resolution required ${revisionRun.structuredMeta.autoRetryCount} structured retry attempt(s): ${revisionRun.structuredMeta.validationError}`,
        params.winnerId,
      )
    }

    emitModelSystemLog(
      params.ticketId,
      params.context.externalId,
      params.stateLabel,
      'info',
      `Revised Implementation Plan v${currentCandidateVersion} into Implementation Plan v${nextCandidateVersion}.`,
      params.winnerId,
    )

    attempts = nextAttempts
    transitions = nextTransitions
    currentCandidateContent = revisionArtifact.refinedContent
    currentCandidateVersion = nextCandidateVersion
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
      toolPolicy: PROM0.toolPolicy,
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
      streamState,
    )

    let normalized = validateRelevantFilesScanResponse(result.response)
    let finalResponse = result.response
    let retryMeta = buildStructuredMetadata({
      autoRetryCount: 0,
      repairApplied: false,
      repairWarnings: [],
    })

    if (!normalized.ok) {
      const retryDecision = getStructuredRetryDecision(result.response, result.responseMeta)
      const retryMode = retryDecision.reuseSession ? 'same session' : 'fresh session'
      retryMeta = buildStructuredMetadata(retryMeta, {
        autoRetryCount: 1,
        validationError: normalized.error,
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (retryMeta.autoRetryCount ?? 0) + 1,
          rawResponse: result.response,
          validationError: normalized.error,
          failureClass: retryDecision.failureClass,
          retryDiagnostic: normalized.retryDiagnostic,
        })],
      })
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
          toolPolicy: PROM0.toolPolicy,
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
          streamState,
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
          toolPolicy: PROM0.toolPolicy,
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
          streamState,
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

    const structuredMeta = buildStructuredMetadata(retryMeta, {
      repairApplied: normalized.repairApplied,
      repairWarnings: normalized.repairWarnings,
    })

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
        structuredOutput: structuredMeta,
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
  const effectiveMaxCoveragePasses = getVersionedCoveragePassLimit(phase, coverageSettings.maxCoveragePasses)
  const completedCoveragePasses = countPhaseArtifacts(ticketId, `${phase}_coverage`, stateLabel)
  const coverageRunState = resolveCoverageRunState(completedCoveragePasses, effectiveMaxCoveragePasses)

  if (coverageRunState.limitAlreadyReached) {
    emitPhaseLog(
      ticketId,
      context.externalId,
      stateLabel,
      'info',
      `Coverage retry cap already reached for ${phase} (${completedCoveragePasses}/${effectiveMaxCoveragePasses}). Routing to approval without another coverage execution.`,
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
  emitModelSystemLog(
    ticketId,
    context.externalId,
    stateLabel,
    'info',
    `Coverage verification started using winning model: ${winnerId} (run ${coverageRunNumber}/${effectiveMaxCoveragePasses}).`,
    winnerId,
  )

  // Resolve refinedContent: prefer in-memory, fall back to persisted artifact
  let refinedContent: string | undefined = councilResult?.refinedContent
  if (!refinedContent) {
    const compiledArtifactType = phase === 'interview'
      ? 'interview_compiled'
      : phase === 'prd'
        ? 'prd_refined'
        : 'beads_refined'
    const compiledArtifact = phase === 'beads'
      ? getLatestPhaseArtifact(ticketId, 'beads_coverage_revision', 'VERIFYING_BEADS_COVERAGE')
        ?? getLatestPhaseArtifact(ticketId, 'beads_refined', 'REFINING_BEADS')
      : getLatestPhaseArtifact(ticketId, compiledArtifactType)
    if (compiledArtifact) {
      try {
        refinedContent = phase === 'prd'
          ? parsePrdRefinedArtifact(compiledArtifact.content).refinedContent
          : (JSON.parse(compiledArtifact.content) as { refinedContent?: string }).refinedContent
      } catch {
        // Ignore malformed refinement artifacts and fall back to other sources.
      }
    }
  }

  const interviewSnapshot = phase === 'interview'
    ? readInterviewSessionSnapshotArtifact(ticketId)
    : null
  let canonicalInterview = phase === 'interview' || phase === 'prd'
    ? loadCanonicalInterview(ticketDir)
    : undefined
  let effectivePrdContent: string | undefined
  let effectiveBeadsContent: string | undefined

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

  if (phase === 'prd') {
    if (!canonicalInterview?.trim()) {
      const msg = 'PRD coverage requires an approved canonical interview, but interview.yaml was not available.'
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    const prdPath = resolve(ticketDir, 'prd.yaml')
    const diskPrdContent = existsSync(prdPath) ? readFileSync(prdPath, 'utf-8').trim() : ''
    if (diskPrdContent.length > 0) {
      effectivePrdContent = diskPrdContent
    } else if (refinedContent?.trim()) {
      effectivePrdContent = refinedContent.trim()
      try {
        safeAtomicWrite(prdPath, refinedContent)
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', `Recovered missing prd.yaml from the validated refined PRD artifact before coverage.`)
      } catch (err) {
        const msg = `Failed to restore prd.yaml from the validated refined PRD artifact before coverage: ${err instanceof Error ? err.message : String(err)}`
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }
    } else {
      const recoveredPrdContent = loadRecoveredPrdCoverageContent(ticketId)
      if (!recoveredPrdContent) {
        const msg = 'PRD coverage requires a canonical prd.yaml or recovered prd_refined artifact, but neither was available.'
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }

      effectivePrdContent = recoveredPrdContent.trim()
      try {
        safeAtomicWrite(prdPath, recoveredPrdContent)
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', `Recovered missing prd.yaml from the validated refined PRD artifact before coverage.`)
      } catch (err) {
        const msg = `Failed to restore prd.yaml from the validated refined PRD artifact before coverage: ${err instanceof Error ? err.message : String(err)}`
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }
    }
  }

  if (phase === 'beads') {
    const prdPath = resolve(ticketDir, 'prd.yaml')
    const diskPrdContent = existsSync(prdPath) ? readFileSync(prdPath, 'utf-8').trim() : ''
    if (!diskPrdContent) {
      const msg = 'Beads coverage requires an approved PRD, but prd.yaml was not available.'
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }
    effectivePrdContent = diskPrdContent

    if (!paths) {
      const msg = 'Beads coverage requires a ticket workspace path, but it was not available.'
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    if (refinedContent?.trim()) {
      effectiveBeadsContent = refinedContent.trim()
    } else {
      const recoveredBeadsContent = loadRecoveredBeadsCoverageContent(ticketId)
      if (!recoveredBeadsContent) {
        const msg = 'Beads coverage requires a canonical semantic beads blueprint or recovered beads coverage revision artifact, but neither was available.'
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }

      effectiveBeadsContent = recoveredBeadsContent.trim()
      if (!effectiveBeadsContent) {
        const msg = 'Recovered beads coverage content was empty.'
        emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
        sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
        return
      }
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'info', 'Recovered semantic beads blueprint from the latest persisted refinement artifact before coverage.')
    }

    const normalizedBlueprint = normalizeBeadSubsetYamlOutput(effectiveBeadsContent)
    if (!normalizedBlueprint.ok) {
      const msg = `Beads coverage requires a valid semantic blueprint, but the recovered artifact failed validation: ${normalizedBlueprint.error}`
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
    ...(phase === 'prd' && effectivePrdContent
      ? { prd: effectivePrdContent }
      : {}),
    ...(phase === 'beads' && effectivePrdContent
      ? { prd: effectivePrdContent }
      : {}),
    ...(phase === 'beads' && effectiveBeadsContent
      ? { beads: effectiveBeadsContent }
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

  if (phase === 'prd') {
    await handlePrdCoverageVerificationLoop({
      ticketId,
      context,
      sendEvent,
      signal,
      worktreePath,
      ticketDir,
      winnerId,
      stateLabel,
      ticketState,
      effectivePrdContent: effectivePrdContent ?? '',
      interviewContent: canonicalInterview ?? '',
      councilSettings,
      coverageSettings,
    })
    return
  }

  if (phase === 'beads') {
    await handleBeadsCoverageVerificationLoop({
      ticketId,
      context,
      sendEvent,
      signal,
      worktreePath,
      winnerId,
      stateLabel,
      ticketState,
      effectivePrdContent: effectivePrdContent ?? '',
      effectiveBeadsContent: effectiveBeadsContent ?? '',
      councilSettings,
      coverageSettings,
    })
    return
  }

  clearContextCache(context.externalId)
  const coverageContext = buildMinimalContext(contextPhase, ticketState)
  const coveragePromptConfiguration = buildCoveragePromptConfiguration({
    phase,
    coverageRunNumber,
    maxCoveragePasses: effectiveMaxCoveragePasses,
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
        toolPolicy: promptTemplate.toolPolicy,
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
      streamState,
    )

    coverageEnvelope = normalizeCoverageResultOutput(response)
    if (coverageEnvelope.ok) {
      structuredMeta = buildStructuredMetadata(structuredMeta, {
        repairApplied: coverageEnvelope.repairApplied,
        repairWarnings: coverageEnvelope.repairWarnings,
      })

      // PRD coverage is handled by handlePrdCoverageVerificationLoop (returns early above)

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
          retryDiagnostics: [resolveStructuredRetryDiagnostic({
            attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
            rawResponse: response,
            validationError: interviewCoverageResolution.validationError,
          })],
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
        retryDiagnostics: [resolveStructuredRetryDiagnostic({
          attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
          rawResponse: response,
          validationError: coverageEnvelope.error,
          retryDiagnostic: coverageEnvelope.retryDiagnostic,
        })],
      })
      const msg = `Coverage output failed validation after retry: ${coverageEnvelope.error}`
      emitPhaseLog(ticketId, context.externalId, stateLabel, 'error', msg)
      sendEvent({ type: 'ERROR', message: msg, codes: ['COVERAGE_FAILED'] })
      return
    }

    structuredMeta = buildStructuredMetadata(structuredMeta, {
      autoRetryCount: 1,
      validationError: coverageEnvelope.error,
      retryDiagnostics: [resolveStructuredRetryDiagnostic({
        attempt: (structuredMeta.autoRetryCount ?? 0) + 1,
        rawResponse: response,
        validationError: coverageEnvelope.error,
        retryDiagnostic: coverageEnvelope.retryDiagnostic,
      })],
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
      maxCoveragePasses: effectiveMaxCoveragePasses,
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
      emitModelSystemLog(
        ticketId,
        context.externalId,
        stateLabel,
        'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`,
        winnerId,
      )
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    if (phase !== 'interview' && gapDisposition.shouldLoopBack) {
      emitModelSystemLog(
        ticketId,
        context.externalId,
        stateLabel,
        'info',
        `Coverage gaps detected by winning model ${winnerId}. Looping back for refinement.`,
        winnerId,
      )
      sendEvent({ type: 'GAPS_FOUND' })
      return
    }

    const reviewReason = phase === 'interview' && gapDisposition.terminationReason === 'follow_up_generation_failed'
      ? interviewCoverageResolution?.validationError
        ?? 'Coverage found interview gaps but produced no parseable follow-up questions.'
      : `Coverage gaps detected by winning model ${winnerId}, but ${describeCoverageTerminationReason(gapDisposition.terminationReason)}. Routing to approval with unresolved gaps for manual review.`
    emitModelSystemLog(
      ticketId,
      context.externalId,
      stateLabel,
      'info',
      reviewReason,
      winnerId,
    )
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

    emitModelSystemLog(
      ticketId,
      context.externalId,
      stateLabel,
      'info',
      `Coverage verification passed (winning model: ${winnerId}).`,
      winnerId,
    )
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
  const preFlightContext = {
    lockedMainImplementer: context.lockedMainImplementer,
    maxIterations: context.maxIterations,
  }
  const report = await runPreFlightChecks(adapter, ticketId, beads, preFlightContext, signal)
  throwIfAborted(signal, ticketId)

  // Emit individual per-check SYS log entries so each diagnostic result
  // is visible in the SYS tab (not only stored in the JSON artifact).
  for (const check of report.checks) {
    const icon = check.result === 'pass' ? '✓' : check.result === 'warning' ? '⚠' : '✗'
    emitPhaseLog(
      ticketId,
      context.externalId,
      'PRE_FLIGHT_CHECK',
      check.result === 'fail' ? 'error' : 'info',
      `${icon} ${check.name}: ${check.message}`,
    )
  }

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
  const finalTestGeneration = await generateFinalTests(
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

  const {
    output,
    commandPlan,
    structuredOutput: planStructuredOutput,
  } = finalTestGeneration
  const executionSettings = resolveExecutionRuntimeSettings(context)
  const report = commandPlan.commands.length > 0
    ? await executeFinalTestCommands({
        commands: commandPlan.commands,
        cwd: worktreePath,
        timeoutMs: executionSettings.perIterationTimeoutMs,
        plannedBy: finalTestModelId!,
        ...(commandPlan.summary ? { summary: commandPlan.summary } : {}),
        modelOutput: output,
        planStructuredOutput,
      })
    : {
        status: 'failed' as const,
        passed: false,
        checkedAt: new Date().toISOString(),
        plannedBy: finalTestModelId,
        modelOutput: output,
        commands: [],
        errors: commandPlan.errors,
        planStructuredOutput,
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
  const effectiveMaxCoveragePasses = getVersionedCoveragePassLimit(phase, coverageSettings.maxCoveragePasses)
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
      maxCoveragePasses: effectiveMaxCoveragePasses,
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
