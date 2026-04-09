import { spawnSync } from 'node:child_process'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../log/commandLogger') as typeof import('../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded.
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

export interface PushBranchRefResult {
  pushed: boolean
  error?: string
}

interface PushBranchRefParams {
  projectPath: string
  destinationBranch: string
  sourceRef?: string
  remote?: string
  forceWithLease?: boolean
  maxRetries?: number
}

function readRemoteBranchSha(projectPath: string, remote: string, branch: string): string | null {
  const stdout = runGit(projectPath, ['ls-remote', '--heads', remote, `refs/heads/${branch}`])
  const [line] = stdout.split('\n').filter(Boolean)
  if (!line) return null

  const [sha] = line.split(/\s+/)
  return sha?.trim() || null
}

export function pushBranchRef({
  projectPath,
  destinationBranch,
  sourceRef = 'HEAD',
  remote = 'origin',
  forceWithLease = false,
  maxRetries = 3,
}: PushBranchRefParams): PushBranchRefResult {
  const refspec = `${sourceRef}:refs/heads/${destinationBranch}`
  let leaseArg: string[] = []

  try {
    if (forceWithLease) {
      const expectedRemoteSha = readRemoteBranchSha(projectPath, remote, destinationBranch)
      leaseArg = [`--force-with-lease=refs/heads/${destinationBranch}:${expectedRemoteSha ?? ''}`]
    }
  } catch (error) {
    return {
      pushed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      runGit(projectPath, ['push', '--progress', ...leaseArg, remote, refspec])
      return { pushed: true }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (attempt === maxRetries) {
        return {
          pushed: false,
          error: `git push failed after ${maxRetries} attempts: ${detail}`,
        }
      }
    }
  }

  return { pushed: false, error: 'push failed' }
}
