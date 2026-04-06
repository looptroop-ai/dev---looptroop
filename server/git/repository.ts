import { execFileSync } from 'node:child_process'

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string } | { ok: false; error: string }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logCommand } = require('../log/commandLogger') as typeof import('../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
  }
}

function runGit(
  projectPath: string,
  args: string[],
  options: { stdio?: 'ignore' | 'pipe' } = {},
): string {
  const fullArgs = ['-C', projectPath, ...args]
  const stdout = execFileSync('git', fullArgs, {
    encoding: 'utf8',
    stdio: ['ignore', options.stdio ?? 'pipe', 'pipe'],
  }).trim()
  logCmd('git', fullArgs, { ok: true, stdout })
  return stdout
}

function gitCommandSucceeds(projectPath: string, args: string[]) {
  const fullArgs = ['-C', projectPath, ...args]
  try {
    execFileSync('git', fullArgs, {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    logCmd('git', fullArgs, { ok: true })
    return true
  } catch {
    logCmd('git', fullArgs, { ok: false, error: 'command returned non-zero' })
    return false
  }
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
