import { spawnSync } from 'node:child_process'
import { getCurrentBranch, resolveBaseBranchRef } from '../../git/repository'
import { pushBranchRef } from '../../git/push'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../../log/commandLogger') as typeof import('../../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Best-effort logging only.
  }
}

function runGit(projectPath: string, args: string[]): string {
  const fullArgs = ['-C', projectPath, ...args]
  const result = spawnSync('git', fullArgs, { encoding: 'utf8' })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()

  if (result.status !== 0 || result.error) {
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd('git', fullArgs, { ok: false, error: detail })
    throw new Error(detail)
  }

  logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  return stdout
}

function tryGit(projectPath: string, args: string[]): boolean {
  const fullArgs = ['-C', projectPath, ...args]
  const result = spawnSync('git', fullArgs, { encoding: 'utf8' })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (result.status === 0 && !result.error) {
    logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
    return true
  }

  const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
  logCmd('git', fullArgs, { ok: false, error: detail })
  return false
}

const FILTERED_STATUS_ARGS = ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(top,exclude).looptroop']

export interface ManualVerificationMergeReport {
  success: boolean
  baseBranch: string
  sourceRef: string
  remoteBranchRef: string
  candidateCommitSha: string | null
  originalBranch: string | null
  previousBaseHead: string | null
  mergedHead: string | null
  remotePushSuccess: boolean
  remotePushError: string | null
  message: string
  errorCode: string | null
}

export function completeManualVerificationMerge(params: {
  projectPath: string
  baseBranch: string
  ticketBranch: string
  candidateCommitSha?: string | null
}): ManualVerificationMergeReport {
  const candidateCommitSha = params.candidateCommitSha?.trim() || null
  const sourceRef = candidateCommitSha ?? params.ticketBranch
  const remoteBranchRef = `refs/heads/${params.ticketBranch}`
  const originalBranch = getCurrentBranch(params.projectPath)
  let remotePushSuccess = false
  let remotePushError: string | null = null

  try {
    const worktreeStatus = runGit(params.projectPath, FILTERED_STATUS_ARGS)
    if (worktreeStatus) {
      return {
        success: false,
        baseBranch: params.baseBranch,
        sourceRef,
        remoteBranchRef,
        candidateCommitSha,
        originalBranch,
        previousBaseHead: null,
        mergedHead: null,
        remotePushSuccess: false,
        remotePushError: null,
        message: 'Project worktree has uncommitted changes. Clean the worktree before completing manual verification.',
        errorCode: 'VERIFICATION_MERGE_WORKTREE_DIRTY',
      }
    }

    const pushResult = pushBranchRef({
      projectPath: params.projectPath,
      destinationBranch: params.ticketBranch,
      sourceRef,
      forceWithLease: true,
      maxRetries: 1,
    })
    if (!pushResult.pushed) {
      remotePushError = pushResult.error ?? null
      return {
        success: false,
        baseBranch: params.baseBranch,
        sourceRef,
        remoteBranchRef,
        candidateCommitSha,
        originalBranch,
        previousBaseHead: null,
        mergedHead: null,
        remotePushSuccess,
        remotePushError,
        message: pushResult.error ?? `Failed to update remote ${remoteBranchRef}.`,
        errorCode: 'VERIFICATION_REMOTE_PUSH_FAILED',
      }
    }
    remotePushSuccess = true

    const baseBranchRef = resolveBaseBranchRef(params.projectPath, params.baseBranch)
    const previousBaseHead = runGit(params.projectPath, ['rev-parse', baseBranchRef])

    if (originalBranch !== params.baseBranch) {
      try {
        runGit(params.projectPath, ['checkout', params.baseBranch])
      } catch {
        runGit(params.projectPath, ['checkout', '-B', params.baseBranch, baseBranchRef])
      }
    }

    runGit(params.projectPath, [
      '-c',
      'user.name=LoopTroop',
      '-c',
      'user.email=looptroop@local',
      'merge',
      '--no-edit',
      sourceRef,
    ])

    const mergedHead = runGit(params.projectPath, ['rev-parse', 'HEAD'])
    let message = `Updated remote ${params.ticketBranch} and merged ${sourceRef} into ${params.baseBranch} at ${mergedHead}.`

    if (originalBranch && originalBranch !== params.baseBranch) {
      if (!tryGit(params.projectPath, ['checkout', originalBranch])) {
        message += ` Could not restore original branch ${originalBranch}; repository remains on ${params.baseBranch}.`
      }
    }

    return {
      success: true,
      baseBranch: params.baseBranch,
      sourceRef,
      remoteBranchRef,
      candidateCommitSha,
      originalBranch,
      previousBaseHead,
      mergedHead,
      remotePushSuccess,
      remotePushError,
      message,
      errorCode: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const mergeConflict = message.includes('CONFLICT')

    tryGit(params.projectPath, ['merge', '--abort'])
    if (originalBranch && originalBranch !== params.baseBranch) {
      tryGit(params.projectPath, ['checkout', originalBranch])
    }

    return {
      success: false,
      baseBranch: params.baseBranch,
      sourceRef,
      remoteBranchRef,
      candidateCommitSha,
      originalBranch,
      previousBaseHead: null,
      mergedHead: null,
      remotePushSuccess,
      remotePushError,
      message,
      errorCode: mergeConflict ? 'VERIFICATION_MERGE_CONFLICT' : 'VERIFICATION_MERGE_FAILED',
    }
  }
}
