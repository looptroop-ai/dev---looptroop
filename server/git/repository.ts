import { spawnSync } from 'node:child_process'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../log/commandLogger') as typeof import('../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

function runGit(
  projectPath: string,
  args: string[],
): string {
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

function gitCommandSucceeds(projectPath: string, args: string[]) {
  const fullArgs = ['-C', projectPath, ...args]
  const result = spawnSync('git', fullArgs, { encoding: 'utf8' })
  const ok = result.status === 0 && !result.error
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (ok) {
    logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  } else {
    logCmd('git', fullArgs, { ok: false, error: [stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}` })
  }
  return ok
}

export function getCurrentBranch(projectPath: string): string | null {
  try {
    const branch = runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!branch || branch === 'HEAD') return null
    return branch
  } catch {
    return null
  }
}

export function resolveBaseBranch(projectPath: string): string {
  try {
    const remoteHead = runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (remoteHead.startsWith('origin/')) {
      return remoteHead.slice('origin/'.length)
    }
  } catch {
    // Fall back to local inspection below.
  }

  const currentBranch = getCurrentBranch(projectPath)
  if (currentBranch) return currentBranch

  for (const fallback of ['main', 'master']) {
    if (gitCommandSucceeds(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${fallback}`])) {
      return fallback
    }
  }

  throw new Error(`Unable to detect the repository base branch for ${projectPath}`)
}

export function resolveBaseBranchRef(projectPath: string, baseBranch: string): string {
  if (gitCommandSucceeds(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${baseBranch}`])) {
    return baseBranch
  }

  const remoteRef = `origin/${baseBranch}`
  if (gitCommandSucceeds(projectPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${remoteRef}`])) {
    return remoteRef
  }

  throw new Error(`Base branch ${baseBranch} does not exist in ${projectPath}`)
}

export function readGitStdout(projectPath: string, args: string[]): string {
  return runGit(projectPath, args)
}

export function gitRefExists(projectPath: string, ref: string): boolean {
  return gitCommandSucceeds(projectPath, ['show-ref', '--verify', '--quiet', ref])
}
