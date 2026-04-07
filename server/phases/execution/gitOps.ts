// Git operations for bead execution — allowlist-based

import { execFileSync } from 'node:child_process'

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string } | { ok: false; error: string }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logCommand } = require('../../log/commandLogger') as typeof import('../../log/commandLogger')
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
  try {
    const stdout = execFileSync('git', fullArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    logCmd('git', fullArgs, { ok: true, stdout })
    return stdout
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logCmd('git', fullArgs, { ok: false, error: detail })
    throw err
  }
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

/**
 * Record the current HEAD commit SHA before bead execution starts.
 * Used as a reset point if the iteration fails and needs a context wipe.
 */
export function recordBeadStartCommit(worktreePath: string): string {
  return runGitOp(worktreePath, ['rev-parse', 'HEAD'])
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
  const addResult = runGitOpSafe(worktreePath, ['add', '--', ...allowedFiles])
  if (!addResult.ok) {
    return { committed: false, pushed: false, error: `git add failed: ${addResult.error}` }
  }

  // Check if there's anything staged
  const diffStagedResult = runGitOpSafe(worktreePath, ['diff', '--cached', '--quiet'])
  if (diffStagedResult.ok) {
    // Exit code 0 means no staged changes
    return { committed: false, pushed: false }
  }

  // Commit
  const commitMsg = `bead(${beadId}): ${beadTitle}`
  const commitResult = runGitOpSafe(worktreePath, ['commit', '-m', commitMsg])
  if (!commitResult.ok) {
    return { committed: false, pushed: false, error: `git commit failed: ${commitResult.error}` }
  }

  // Push with retries
  const MAX_PUSH_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    const pushResult = runGitOpSafe(worktreePath, ['push'])
    if (pushResult.ok) {
      return { committed: true, pushed: true }
    }
    if (attempt === MAX_PUSH_RETRIES) {
      return { committed: true, pushed: false, error: `git push failed after ${MAX_PUSH_RETRIES} attempts: ${pushResult.error}` }
    }
  }

  return { committed: true, pushed: false }
}

/**
 * Reset the worktree to the bead start commit on context wipe / new iteration.
 * This ensures the next retry starts from a clean state.
 */
export function resetToBeadStart(worktreePath: string, beadStartCommit: string): void {
  runGitOp(worktreePath, ['reset', '--hard', beadStartCommit])
  runGitOp(worktreePath, ['clean', '-fd'])
}
