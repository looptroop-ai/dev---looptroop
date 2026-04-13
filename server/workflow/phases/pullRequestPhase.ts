import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import jsYaml from 'js-yaml'
import type { TicketContext, TicketEvent } from '../../machines/types'
import {
  getLatestPhaseArtifact,
  getTicketPaths,
  insertPhaseArtifact,
  upsertLatestPhaseArtifact,
} from '../../storage/tickets'
import { isMockOpenCodeMode } from '../../opencode/factory'
import { withCommandLoggingAsync } from '../../log/commandLogger'
import { throwIfAborted } from '../../council/types'
import { runOpenCodePrompt } from '../runOpenCodePrompt'
import { buildMinimalContext, type TicketState } from '../../opencode/contextBuilder'
import { pushBranchRef } from '../../git/push'
import {
  captureGitRecoveryReceipt,
  createOrUpdateDraftPullRequest,
  getPullRequestForBranch,
  markPullRequestReady,
  mergePullRequest,
  readGitDiff,
  syncLocalBaseBranch,
  tryDeleteRemoteBranch,
  type PullRequestInfo,
  type PullRequestState,
} from '../../git/github'
import {
  createOpenCodeStreamState,
  emitAiMilestone,
  emitOpenCodePromptLog,
  emitOpenCodeSessionLogs,
  emitOpenCodeStreamEvent,
  emitPhaseLog,
  loadTicketDirContext,
} from './helpers'
import { adapter } from './state'
import { handleMockExecutionUnsupported } from './executionPhase'

const PULL_REQUEST_REPORT_ARTIFACT = 'pull_request_report'
const MERGE_REPORT_ARTIFACT = 'merge_report'
const GIT_RECOVERY_RECEIPT_ARTIFACT = 'git_recovery_receipt'

interface PullRequestDraftPayload {
  title?: unknown
  summary?: unknown
  why?: unknown
  what_changed?: unknown
  validation?: unknown
  follow_ups?: unknown
}

export interface PullRequestReport {
  status: 'passed' | 'failed'
  completedAt: string
  baseBranch: string
  headBranch: string
  candidateCommitSha: string | null
  prNumber: number | null
  prUrl: string | null
  prState: PullRequestState | null
  prHeadSha: string | null
  title: string | null
  body: string | null
  createdAt: string | null
  updatedAt: string | null
  mergedAt: string | null
  closedAt: string | null
  message: string
}

export interface MergeCompletionReport {
  status: 'passed'
  completedAt: string
  disposition: 'merged' | 'closed_unmerged'
  baseBranch: string
  headBranch: string
  candidateCommitSha: string | null
  prNumber: number | null
  prUrl: string | null
  prState: PullRequestState | null
  prHeadSha: string | null
  localBaseHead: string | null
  remoteBaseHead: string | null
  remoteBranchDeleteWarning: string | null
  message: string
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()]
  }
  return []
}

function parsePullRequestDraftResponse(response: string, fallbackTitle: string): {
  title: string
  body: string
} {
  let parsed: PullRequestDraftPayload | null = null

  try {
    const loaded = jsYaml.load(response) as PullRequestDraftPayload | null
    parsed = loaded && typeof loaded === 'object' ? loaded : null
  } catch {
    parsed = null
  }

  if (!parsed) {
    throw new Error('Pull request draft output was not valid YAML.')
  }

  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0
    ? parsed.title.trim()
    : fallbackTitle

  const summary = normalizeStringArray(parsed.summary)
  const why = normalizeStringArray(parsed.why)
  const whatChanged = normalizeStringArray(parsed.what_changed)
  const validation = normalizeStringArray(parsed.validation)
  const followUps = normalizeStringArray(parsed.follow_ups)

  if (summary.length === 0 || why.length === 0 || whatChanged.length === 0 || validation.length === 0) {
    throw new Error('Pull request draft output was missing one or more required sections.')
  }

  const renderSection = (heading: string, items: string[]) => [
    `## ${heading}`,
    ...items.map((item) => `- ${item}`),
  ].join('\n')

  const sections = [
    renderSection('Summary', summary),
    renderSection('Why', why),
    renderSection('What Changed', whatChanged),
    renderSection('Validation', validation),
  ]

  if (followUps.length > 0) {
    sections.push(renderSection('Follow-ups', followUps))
  }

  return {
    title,
    body: sections.join('\n\n'),
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 18))}\n\n[truncated by LoopTroop]`
}

function buildPullRequestPrompt(input: {
  fallbackTitle: string
  contextParts: Array<{ source?: string; content: string }>
  integrationReport: string
  finalTestReport: string
  diffStat: string
  diffNameStatus: string
  diffPatch: string
}): string {
  const contextSections = input.contextParts
    .map((part) => {
      const label = part.source ?? 'context'
      return `### ${label}\n${part.content.trim() || '[empty]'}`
    })
    .join('\n\n')

  return [
    'You are the main implementer who just finished this ticket and now need to write the draft pull request.',
    'Use the final diff as the source of truth for what changed.',
    'Use the ticket details, interview, and PRD to explain why the change exists.',
    'Use the final test report to describe validation accurately.',
    'Do not mention work that is not present in the final diff.',
    'Be concise, specific, and reviewer-friendly.',
    'Return strict YAML only with exactly these top-level keys:',
    'title, summary, why, what_changed, validation, follow_ups',
    '`title` must be a single-line string.',
    '`summary`, `why`, `what_changed`, and `validation` must be non-empty YAML string lists.',
    '`follow_ups` must be a YAML string list and may be empty.',
    `If you are unsure about the title, fall back to this exact title: "${input.fallbackTitle}"`,
    '',
    contextSections,
    '',
    '### integration_report',
    input.integrationReport.trim() || '[missing integration report]',
    '',
    '### final_test_report',
    input.finalTestReport.trim() || '[missing final test report]',
    '',
    '### final_diff_stat',
    input.diffStat.trim() || '[empty diff stat]',
    '',
    '### final_diff_name_status',
    input.diffNameStatus.trim() || '[empty diff name/status]',
    '',
    '### final_diff_patch',
    input.diffPatch.trim() || '[empty diff patch]',
  ].join('\n')
}

function buildPullRequestReport(input: {
  baseBranch: string
  headBranch: string
  candidateCommitSha: string | null
  pr: PullRequestInfo
  title: string
  body: string
  message: string
}): PullRequestReport {
  return {
    status: 'passed',
    completedAt: new Date().toISOString(),
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    candidateCommitSha: input.candidateCommitSha,
    prNumber: input.pr.number,
    prUrl: input.pr.url,
    prState: input.pr.state,
    prHeadSha: input.pr.headRefOid,
    title: input.title,
    body: input.body,
    createdAt: input.pr.createdAt,
    updatedAt: input.pr.updatedAt,
    mergedAt: input.pr.mergedAt,
    closedAt: input.pr.closedAt,
    message: input.message,
  }
}

function recordGitRecoveryReceipt(ticketId: string, receipt: unknown, phase: string) {
  upsertLatestPhaseArtifact(ticketId, GIT_RECOVERY_RECEIPT_ARTIFACT, phase, JSON.stringify(receipt))
}

function readIntegrationArtifact(ticketId: string) {
  const artifact = getLatestPhaseArtifact(ticketId, 'integration_report', 'INTEGRATING_CHANGES')
  if (!artifact?.content) {
    throw new Error('Integration report not found. Cannot create the pull request.')
  }

  const parsed = JSON.parse(artifact.content) as {
    candidateCommitSha?: unknown
    mergeBase?: unknown
  }
  const candidateCommitSha = typeof parsed.candidateCommitSha === 'string' && parsed.candidateCommitSha.trim().length > 0
    ? parsed.candidateCommitSha.trim()
    : null
  const mergeBase = typeof parsed.mergeBase === 'string' && parsed.mergeBase.trim().length > 0
    ? parsed.mergeBase.trim()
    : null

  if (!candidateCommitSha || !mergeBase) {
    throw new Error('Integration report is missing candidate commit metadata.')
  }

  return {
    raw: artifact.content,
    candidateCommitSha,
    mergeBase,
  }
}

function buildPullRequestContext(ticketId: string, context: TicketContext, description: string): {
  ticketState: TicketState
  contextParts: Array<{ source?: string; content: string }>
  finalTestReport: string
} {
  const { ticketDir, relevantFiles } = loadTicketDirContext(context)
  const paths = getTicketPaths(ticketId)
  const ticketState: TicketState = {
    ticketId: context.externalId,
    title: context.title,
    description,
    relevantFiles,
  }

  const interviewPath = resolve(ticketDir, 'interview.yaml')
  const prdPath = resolve(ticketDir, 'prd.yaml')
  const beadsPath = paths?.beadsPath

  if (existsSync(interviewPath)) {
    try { ticketState.interview = readFileSync(interviewPath, 'utf8') } catch { /* ignore */ }
  }
  if (existsSync(prdPath)) {
    try { ticketState.prd = readFileSync(prdPath, 'utf8') } catch { /* ignore */ }
  }
  if (beadsPath && existsSync(beadsPath)) {
    try { ticketState.beads = readFileSync(beadsPath, 'utf8') } catch { /* ignore */ }
  }

  const finalTestArtifact = getLatestPhaseArtifact(ticketId, 'final_test_report', 'RUNNING_FINAL_TEST')
  return {
    ticketState,
    contextParts: buildMinimalContext('final_test', ticketState),
    finalTestReport: finalTestArtifact?.content ?? '',
  }
}

export async function handleCreatePullRequest(
  ticketId: string,
  context: TicketContext,
  sendEvent: (event: TicketEvent) => void,
  signal?: AbortSignal,
) {
  if (isMockOpenCodeMode()) {
    await handleMockExecutionUnsupported(ticketId, context, 'CREATING_PULL_REQUEST', sendEvent)
    return
  }

  return withCommandLoggingAsync(
    ticketId,
    context.externalId,
    'CREATING_PULL_REQUEST',
    async () => {
      const { worktreePath, ticket } = loadTicketDirContext(context)
      const paths = getTicketPaths(ticketId)
      if (!paths) {
        throw new Error(`Ticket workspace not initialized: missing ticket paths for ${context.externalId}`)
      }

      throwIfAborted(signal, ticketId)

      const headBranch = ticket.branchName?.trim() || context.externalId
      const baseBranch = paths.baseBranch
      const integration = readIntegrationArtifact(ticketId)
      const fallbackTitle = `${context.externalId}: ${context.title}`
      const { contextParts, finalTestReport } = buildPullRequestContext(
        ticketId,
        context,
        ticket?.description ?? '',
      )
      const diff = readGitDiff(worktreePath, integration.mergeBase, integration.candidateCommitSha)
      const prompt = buildPullRequestPrompt({
        fallbackTitle,
        contextParts,
        integrationReport: integration.raw,
        finalTestReport,
        diffStat: diff.stat,
        diffNameStatus: diff.nameStatus,
        diffPatch: truncateText(diff.patch, 30_000),
      })

      const mainImplementer = context.lockedMainImplementer
      if (!mainImplementer) {
        throw new Error('No locked main implementer is configured for pull request drafting.')
      }

      const streamState = createOpenCodeStreamState()
      let sessionId = ''

      const draftResult = await runOpenCodePrompt({
        adapter,
        projectPath: worktreePath,
        parts: [{ type: 'text', content: prompt }],
        signal,
        model: mainImplementer,
        variant: context.lockedMainImplementerVariant ?? undefined,
        toolPolicy: 'disabled',
        sessionOwnership: {
          ticketId,
          phase: 'CREATING_PULL_REQUEST',
          phaseAttempt: 1,
          keepActive: false,
          memberId: mainImplementer,
        },
        onSessionCreated: (session) => {
          sessionId = session.id
          emitAiMilestone(
            ticketId,
            context.externalId,
            'CREATING_PULL_REQUEST',
            `PR drafting session created for ${mainImplementer} (session=${session.id}).`,
            `${session.id}:pull-request-draft-created`,
            {
              modelId: mainImplementer,
              sessionId: session.id,
              source: `model:${mainImplementer}`,
            },
          )
        },
        onStreamEvent: (event) => {
          if (!sessionId) return
          emitOpenCodeStreamEvent(
            ticketId,
            context.externalId,
            'CREATING_PULL_REQUEST',
            mainImplementer,
            sessionId,
            event,
            streamState,
          )
        },
        onPromptDispatched: (event) => {
          emitOpenCodePromptLog(
            ticketId,
            context.externalId,
            'CREATING_PULL_REQUEST',
            mainImplementer,
            event,
          )
        },
        onPromptCompleted: (event) => {
          emitOpenCodeSessionLogs(
            ticketId,
            context.externalId,
            'CREATING_PULL_REQUEST',
            mainImplementer,
            event.session.id,
            'pull_request_draft',
            event.response,
            event.messages,
            streamState,
          )
        },
      })

      const prDraft = parsePullRequestDraftResponse(draftResult.response, fallbackTitle)

      throwIfAborted(signal, ticketId)

      let pullRequest: PullRequestInfo | null = null
      let currentStep = 'push_candidate_branch'

      try {
        const pushResult = pushBranchRef({
          projectPath: worktreePath,
          destinationBranch: headBranch,
          sourceRef: integration.candidateCommitSha,
          forceWithLease: true,
          maxRetries: 1,
        })
        if (!pushResult.pushed) {
          throw new Error(pushResult.error ?? `Failed to update remote branch ${headBranch}.`)
        }

        emitPhaseLog(
          ticketId,
          context.externalId,
          'CREATING_PULL_REQUEST',
          'info',
          `Updated remote ticket branch ${headBranch} to candidate ${integration.candidateCommitSha}.`,
        )

        currentStep = 'create_or_update_pull_request'
        pullRequest = createOrUpdateDraftPullRequest({
          projectPath: worktreePath,
          branchName: headBranch,
          baseBranch,
          title: prDraft.title,
          body: prDraft.body,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordGitRecoveryReceipt(
          ticketId,
          captureGitRecoveryReceipt({
            projectPath: worktreePath,
            phase: 'CREATING_PULL_REQUEST',
            step: currentStep,
            error: message,
            branch: headBranch,
            baseBranch,
            candidateSha: integration.candidateCommitSha,
            pr: pullRequest,
          }),
          'CREATING_PULL_REQUEST',
        )
        throw error
      }

      const report = buildPullRequestReport({
        baseBranch,
        headBranch,
        candidateCommitSha: integration.candidateCommitSha,
        pr: pullRequest,
        title: prDraft.title,
        body: prDraft.body,
        message: `Draft pull request ready at ${pullRequest.url}.`,
      })

      upsertLatestPhaseArtifact(ticketId, PULL_REQUEST_REPORT_ARTIFACT, 'CREATING_PULL_REQUEST', JSON.stringify(report))
      emitPhaseLog(
        ticketId,
        context.externalId,
        'CREATING_PULL_REQUEST',
        'info',
        `Draft pull request ready: ${pullRequest.url}`,
        {
          prNumber: pullRequest.number,
          prUrl: pullRequest.url,
          prState: pullRequest.state,
        },
      )

      sendEvent({ type: 'PULL_REQUEST_READY' })
    },
    (phase, type, content) => emitPhaseLog(ticketId, context.externalId, phase, type, content),
  )
}

export function readPullRequestReport(ticketId: string): PullRequestReport | null {
  const artifact = getLatestPhaseArtifact(ticketId, PULL_REQUEST_REPORT_ARTIFACT)
  if (!artifact?.content) return null

  try {
    return JSON.parse(artifact.content) as PullRequestReport
  } catch {
    return null
  }
}

export function refreshPullRequestReport(ticketId: string, report: PullRequestReport) {
  upsertLatestPhaseArtifact(ticketId, PULL_REQUEST_REPORT_ARTIFACT, 'CREATING_PULL_REQUEST', JSON.stringify(report))
}

export function refreshPullRequestState(projectPath: string, branchName: string, baseBranch: string): PullRequestInfo | null {
  return getPullRequestForBranch(projectPath, branchName, baseBranch)
}

export function completeMergedPullRequest(input: {
  ticketId: string
  externalId: string
  projectPath: string
  baseBranch: string
  headBranch: string
  candidateCommitSha: string | null
  prReport: PullRequestReport
  skipRemoteMerge?: boolean
}): MergeCompletionReport {
  const existingPullRequest = getPullRequestForBranch(input.projectPath, input.headBranch, input.baseBranch)
  if (!existingPullRequest) {
    throw new Error(`No pull request found for branch ${input.headBranch}.`)
  }

  let pr = existingPullRequest
  let currentStep = 'sync_local_base_branch'

  try {
    if (!input.skipRemoteMerge && pr.state !== 'merged') {
      if (pr.state === 'draft') {
        currentStep = 'mark_pull_request_ready'
        pr = markPullRequestReady(input.projectPath, pr.number)
      }

      currentStep = 'merge_pull_request'
      pr = mergePullRequest(input.projectPath, pr.number, pr.title)
    }

    currentStep = 'sync_local_base_branch'
    const syncResult = syncLocalBaseBranch(input.projectPath, input.baseBranch)
    const remoteBranchDelete = pr.state === 'merged'
      ? tryDeleteRemoteBranch(input.projectPath, input.headBranch)
      : { deleted: false, warning: null as string | null }

    const report: MergeCompletionReport = {
      status: 'passed',
      completedAt: new Date().toISOString(),
      disposition: 'merged',
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      candidateCommitSha: input.candidateCommitSha,
      prNumber: pr.number,
      prUrl: pr.url,
      prState: pr.state,
      prHeadSha: pr.headRefOid,
      localBaseHead: syncResult.localBaseHead,
      remoteBaseHead: syncResult.remoteBaseHead,
      remoteBranchDeleteWarning: remoteBranchDelete.warning,
      message: pr.state === 'merged'
        ? `Pull request merged and local ${input.baseBranch} synced to origin/${input.baseBranch}.`
        : `Pull request state is ${pr.state}; local ${input.baseBranch} synced to origin/${input.baseBranch}.`,
    }

    insertPhaseArtifact(input.ticketId, {
      phase: 'WAITING_PR_REVIEW',
      artifactType: MERGE_REPORT_ARTIFACT,
      content: JSON.stringify(report),
    })
    refreshPullRequestReport(input.ticketId, {
      ...input.prReport,
      completedAt: new Date().toISOString(),
      prNumber: pr.number,
      prUrl: pr.url,
      prState: pr.state,
      prHeadSha: pr.headRefOid,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      mergedAt: pr.mergedAt,
      closedAt: pr.closedAt,
      message: report.message,
    })

    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordGitRecoveryReceipt(
      input.ticketId,
      captureGitRecoveryReceipt({
        projectPath: input.projectPath,
        phase: 'WAITING_PR_REVIEW',
        step: currentStep,
        error: message,
        branch: input.headBranch,
        baseBranch: input.baseBranch,
        candidateSha: input.candidateCommitSha,
        pr,
      }),
      'WAITING_PR_REVIEW',
    )
    throw error
  }
}

export function completeCloseUnmerged(input: {
  ticketId: string
  baseBranch: string
  headBranch: string
  candidateCommitSha: string | null
  prReport: PullRequestReport | null
}): MergeCompletionReport {
  const report: MergeCompletionReport = {
    status: 'passed',
    completedAt: new Date().toISOString(),
    disposition: 'closed_unmerged',
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    candidateCommitSha: input.candidateCommitSha,
    prNumber: input.prReport?.prNumber ?? null,
    prUrl: input.prReport?.prUrl ?? null,
    prState: input.prReport?.prState ?? null,
    prHeadSha: input.prReport?.prHeadSha ?? null,
    localBaseHead: null,
    remoteBaseHead: null,
    remoteBranchDeleteWarning: null,
    message: 'Ticket finished without merging the pull request. The pull request and remote branch were left untouched.',
  }

  insertPhaseArtifact(input.ticketId, {
    phase: 'WAITING_PR_REVIEW',
    artifactType: MERGE_REPORT_ARTIFACT,
    content: JSON.stringify(report),
  })

  return report
}

export { GIT_RECOVERY_RECEIPT_ARTIFACT, MERGE_REPORT_ARTIFACT, PULL_REQUEST_REPORT_ARTIFACT }
