import { spawnSync } from 'node:child_process'
import { resolveBaseBranchRef } from '../../git/repository'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../../log/commandLogger') as typeof import('../../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

export interface SquashResult {
  success: boolean
  message: string
  commitHash?: string
  mergeBase?: string
  preSquashHead?: string
  commitCount?: number
}

export function prepareSquashCandidate(
  worktreePath: string,
  baseBranch: string,
  ticketTitle: string,
  ticketId: string,
  extraFilesToStage: string[] = [],
): SquashResult {
  const runGit = (args: string[]) => {
    const fullArgs = ['-C', worktreePath, ...args]
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

  try {
    const baseBranchRef = resolveBaseBranchRef(worktreePath, baseBranch)
    const preSquashHead = runGit(['rev-parse', 'HEAD'])
    const mergeBase = runGit(['merge-base', 'HEAD', baseBranchRef])
    const commitCount = Number(runGit(['rev-list', '--count', `${mergeBase}..HEAD`]))

    runGit(['reset', '--soft', mergeBase])
    runGit(['add', '-v', '-u', '--', '.', ':(top,exclude).ticket'])
    const explicitFiles = [...new Set(extraFilesToStage.filter((file) => file.trim().length > 0))]
    if (explicitFiles.length > 0) {
      runGit(['add', '-v', '--', ...explicitFiles.filter((file) => !file.startsWith('.ticket/'))])
    }

    const stagedChanges = runGit(['status', '--porcelain'])
    if (!stagedChanges) {
      runGit(['reset', '--soft', preSquashHead])
      return {
        success: false,
        message: 'No candidate changes were available to squash',
        mergeBase,
        preSquashHead,
        commitCount,
      }
    }

    runGit([
      '-c',
      'user.name=LoopTroop',
      '-c',
      'user.email=looptroop@local',
      'commit',
      '--no-verify',
      '-m',
      `${ticketId}: ${ticketTitle}`,
    ])
    const commitHash = runGit(['rev-parse', 'HEAD'])
    return {
      success: true,
      message: `Prepared candidate commit ${commitHash} from ${commitCount} commit(s) on ${ticketId}`,
      commitHash,
      mergeBase,
      preSquashHead,
      commitCount,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface PushResult {
  pushed: boolean
  error?: string
}

const MAX_PUSH_RETRIES = 3

export function pushSquashedCandidate(worktreePath: string): PushResult {
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    const fullArgs = ['-C', worktreePath, 'push', '--progress']
    const result = spawnSync('git', fullArgs, { encoding: 'utf8' })
    const stdout = (result.stdout ?? '').trim()
    const stderr = (result.stderr ?? '').trim()
    if (result.status === 0 && !result.error) {
      logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
      return { pushed: true }
    }
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd('git', fullArgs, { ok: false, error: detail })
    if (attempt === MAX_PUSH_RETRIES) {
      return { pushed: false, error: `git push failed after ${MAX_PUSH_RETRIES} attempts: ${detail}` }
    }
  }
  return { pushed: false, error: 'push failed' }
}
