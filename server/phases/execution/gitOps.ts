// Git operations for bead execution — allowlist-based

import { spawnSync } from 'node:child_process'
import { getCurrentBranch } from '../../git/repository'
import { pushBranchRef } from '../../git/push'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(
  bin: string,
  args: string[],
  result:
    | { ok: true; stdin?: string; stdout?: string; stderr?: string }
    | { ok: false; error: string; stdin?: string; stdout?: string; stderr?: string },
) {
  try {
    const { logCommand } = _require('../../log/commandLogger') as typeof import('../../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.txt',
  '.svg',
  '.py',
  '.rb',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.sh',
  '.toml',
  '.lock',
  '.gitignore',
])

const BLOCKED_PATTERNS = [
  /\.ticket\/runtime\//,
  /\.ticket\/locks\//,
  /\.ticket\/streams\//,
  /\.ticket\/sessions\//,
  /\.ticket\/tmp\//,
  /node_modules\//,
  /\.looptroop\//,
  /dist\//,
  /build\//,
]

// Stable ticket artifacts that should always be committed regardless of extension
const ALWAYS_ALLOW_PATHS = [
  'issues.jsonl',
  'interview.yaml',
  'prd.yaml',
  'codebase-map.yaml',
]

const GIT_OP_MAX_BUFFER_BYTES = 16 * 1024 * 1024

interface ResetWorktreeOptions {
  preservePaths?: string[]
}

export function isAllowedFile(path: string): boolean {
  // Check blocked patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(path)) return false
  }

  // Always allow known ticket artifacts
  for (const allowed of ALWAYS_ALLOW_PATHS) {
    if (path.endsWith(allowed)) return true
  }

  // Check extension
  const ext = path.slice(path.lastIndexOf('.'))
  return ALLOWED_EXTENSIONS.has(ext)
}

export function filterAllowedFiles(files: string[]): string[] {
  return files.filter(isAllowedFile)
}

function runGitOp(worktreePath: string, args: string[]): string {
  const fullArgs = ['-C', worktreePath, ...args]
  const result = spawnSync('git', fullArgs, {
    encoding: 'utf8',
    maxBuffer: GIT_OP_MAX_BUFFER_BYTES,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd('git', fullArgs, {
      ok: false,
      error: result.error?.message ?? `exit code ${result.status ?? '?'}`,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    })
    throw new Error(detail)
  }
  logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  return stdout
}

function runGitOpSafe(worktreePath: string, args: string[]): { ok: boolean; stdout: string; error?: string } {
  try {
    const stdout = runGitOp(worktreePath, args)
    return { ok: true, stdout }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, stdout: '', error }
  }
}

function probeStagedChanges(worktreePath: string): { hasStagedChanges: boolean; error?: string } {
  const fullArgs = ['-C', worktreePath, 'diff', '--cached', '--quiet']
  const result = spawnSync('git', fullArgs, {
    encoding: 'utf8',
    maxBuffer: GIT_OP_MAX_BUFFER_BYTES,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()

  if (result.error) {
    const detail = result.error.message
      ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd('git', fullArgs, {
      ok: false,
      error: result.error.message,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    })
    return { hasStagedChanges: false, error: detail }
  }

  if (result.status === 0) {
    logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
    return { hasStagedChanges: false }
  }

  if (result.status === 1) {
    // For `git diff --cached --quiet`, exit code 1 is a normal probe result:
    // staged changes are present and the commit flow should continue.
    logCmd('git', fullArgs, { ok: false, error: 'exit code 1' })
    return { hasStagedChanges: true }
  }

  const detail = [stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`
  logCmd('git', fullArgs, {
    ok: false,
    error: `exit code ${result.status ?? '?'}`,
    stdout: stdout || undefined,
    stderr: stderr || undefined,
  })
  return { hasStagedChanges: false, error: detail }
}

export function recordWorktreeStartCommit(worktreePath: string): string {
  return runGitOp(worktreePath, ['rev-parse', 'HEAD'])
}

/**
 * Record the current HEAD commit SHA before bead execution starts.
 * Used as a reset point if the iteration fails and needs a context wipe.
 */
export function recordBeadStartCommit(worktreePath: string): string {
  return recordWorktreeStartCommit(worktreePath)
}

/**
 * Commit and push changes after a successful bead.
 * Uses allowlist/denylist filtering. Graceful — logs warnings but doesn't block on failure.
 */
export function commitBeadChanges(
  worktreePath: string,
  beadId: string,
  beadTitle: string,
): { committed: boolean; pushed: boolean; error?: string } {
  // Get changed/untracked files
  const trackedResult = runGitOpSafe(worktreePath, ['diff', '--name-only', 'HEAD'])
  const untrackedResult = runGitOpSafe(worktreePath, ['ls-files', '--others', '--exclude-standard'])

  const changedFiles = [
    ...(trackedResult.ok ? trackedResult.stdout.split('\n').filter(Boolean) : []),
    ...(untrackedResult.ok ? untrackedResult.stdout.split('\n').filter(Boolean) : []),
  ]

  const allowedFiles = filterAllowedFiles(changedFiles)
  if (allowedFiles.length === 0) {
    return { committed: false, pushed: false }
  }

  // Stage allowed files
  const addResult = runGitOpSafe(worktreePath, ['add', '-v', '--', ...allowedFiles])
  if (!addResult.ok) {
    return { committed: false, pushed: false, error: `git add failed: ${addResult.error}` }
  }

  // Check if there's anything staged
  const stagedProbe = probeStagedChanges(worktreePath)
  if (stagedProbe.error) {
    return { committed: false, pushed: false, error: `git diff --cached --quiet failed: ${stagedProbe.error}` }
  }
  if (!stagedProbe.hasStagedChanges) {
    return { committed: false, pushed: false }
  }

  // Commit
  const commitMsg = `bead(${beadId}): ${beadTitle}`
  const commitResult = runGitOpSafe(worktreePath, ['commit', '-m', commitMsg])
  if (!commitResult.ok) {
    return { committed: false, pushed: false, error: `git commit failed: ${commitResult.error}` }
  }

  const currentBranch = getCurrentBranch(worktreePath)
  if (!currentBranch) {
    return { committed: true, pushed: false, error: 'git push failed: could not determine current branch' }
  }

  const pushResult = pushBranchRef({
    projectPath: worktreePath,
    destinationBranch: currentBranch,
    sourceRef: 'HEAD',
    maxRetries: 3,
  })
  if (!pushResult.pushed) {
    return { committed: true, pushed: false, error: pushResult.error }
  }

  return { committed: true, pushed: true }
}

/**
 * Capture a code-only diff between beadStartCommit and HEAD.
 * Excludes .ticket/** to avoid noise from metadata changes.
 * Returns the diff string (empty string if no code changes).
 */
export function captureBeadDiff(worktreePath: string, beadStartCommit: string): string {
  const result = runGitOpSafe(worktreePath, [
    'diff', beadStartCommit, 'HEAD', '--', '.', ':!.ticket',
  ])
  return result.ok ? result.stdout : ''
}

export function resetWorktreeToCommit(worktreePath: string, commit: string, options?: ResetWorktreeOptions): void {
  runGitOp(worktreePath, ['reset', '--hard', commit])
  const cleanArgs = ['clean', '-fdq']
  for (const path of options?.preservePaths ?? []) {
    cleanArgs.push('-e', path)
  }
  runGitOp(worktreePath, cleanArgs)
}

/**
 * Reset the worktree to the bead start commit on context wipe / new iteration.
 * This ensures the next retry starts from a clean state.
 */
export function resetToBeadStart(worktreePath: string, beadStartCommit: string, options?: ResetWorktreeOptions): void {
  resetWorktreeToCommit(worktreePath, beadStartCommit, options)
}
