import { execFileSync } from 'node:child_process'

function runGit(
  projectPath: string,
  args: string[],
  options: { stdio?: 'ignore' | 'pipe' } = {},
): string {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', options.stdio ?? 'pipe', 'pipe'],
  }).trim()
}

function gitCommandSucceeds(projectPath: string, args: string[]) {
  try {
    execFileSync('git', ['-C', projectPath, ...args], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
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
