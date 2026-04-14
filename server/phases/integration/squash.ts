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

const GIT_ADD_BATCH_SIZE = 100

function normalizeCandidatePath(filePath: string): string | null {
  const trimmed = filePath.trim()
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('\n')) return null

  const normalized = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('/')
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || normalized === '.ticket'
    || normalized.startsWith('.ticket/')
  ) {
    return null
  }

  return normalized
}

function uniqueCandidatePaths(files: string[]): string[] {
  return [...new Set(files.map(normalizeCandidatePath).filter((file): file is string => file !== null))]
}

function parsePathList(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function toLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

export function prepareSquashCandidate(
  worktreePath: string,
  baseBranch: string,
  ticketTitle: string,
  ticketId: string,
  extraFilesToStage: string[] = [],
): SquashResult {
  let preSquashHead: string | undefined
  let resetForSquash = false
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
    preSquashHead = runGit(['rev-parse', 'HEAD'])
    const mergeBase = runGit(['merge-base', 'HEAD', baseBranchRef])
    const commitCount = Number(runGit(['rev-list', '--count', `${mergeBase}..HEAD`]))
    const committedCandidateFiles = uniqueCandidatePaths(parsePathList(runGit([
      'diff',
      '--name-only',
      '--no-renames',
      `${mergeBase}..${preSquashHead}`,
      '--',
      '.',
      ':(top,exclude).ticket',
    ])))
    const explicitFiles = uniqueCandidatePaths(extraFilesToStage)
    const candidateFiles = uniqueCandidatePaths([
      ...committedCandidateFiles,
      ...explicitFiles,
    ])

    if (candidateFiles.length === 0) {
      return {
        success: false,
        message: 'No candidate changes were available to squash',
        mergeBase,
        preSquashHead,
        commitCount,
      }
    }

    runGit(['reset', '--mixed', mergeBase])
    resetForSquash = true

    for (let index = 0; index < candidateFiles.length; index += GIT_ADD_BATCH_SIZE) {
      const batch = candidateFiles.slice(index, index + GIT_ADD_BATCH_SIZE)
      runGit(['add', '-v', '-A', '--', ...batch.map(toLiteralPathspec)])
    }

    const stagedChanges = runGit(['diff', '--cached', '--name-only', '--', '.', ':(top,exclude).ticket'])
    if (!stagedChanges) {
      runGit(['reset', '--mixed', preSquashHead])
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
    resetForSquash = false
    return {
      success: true,
      message: `Prepared candidate commit ${commitHash} from ${commitCount} commit(s) on ${ticketId}`,
      commitHash,
      mergeBase,
      preSquashHead,
      commitCount,
    }
  } catch (error) {
    if (resetForSquash && preSquashHead) {
      try {
        runGit(['reset', '--mixed', preSquashHead])
      } catch {
        // Preserve the original error; caller-level recovery records the failure context.
      }
    }
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
