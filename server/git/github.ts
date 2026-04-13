import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { getCurrentBranch } from './repository'

const _require = createRequire(import.meta.url)

function logCmd(
  bin: string,
  args: string[],
  result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string },
) {
  try {
    const { logCommand } = _require('../log/commandLogger') as typeof import('../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Best-effort logging only.
  }
}

function runCommand(
  bin: string,
  args: string[],
  options?: {
    cwd?: string
    input?: string
    env?: NodeJS.ProcessEnv
  },
): string {
  const result = spawnSync(bin, args, {
    cwd: options?.cwd,
    input: options?.input,
    encoding: 'utf8',
    env: options?.env,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()

  if (result.status !== 0 || result.error) {
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd(bin, args, { ok: false, error: detail })
    throw new Error(detail)
  }

  logCmd(bin, args, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  return stdout
}

function tryCommand(
  bin: string,
  args: string[],
  options?: {
    cwd?: string
    input?: string
    env?: NodeJS.ProcessEnv
  },
): { ok: true; stdout: string; stderr: string } | { ok: false; error: string } {
  const result = spawnSync(bin, args, {
    cwd: options?.cwd,
    input: options?.input,
    encoding: 'utf8',
    env: options?.env,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()

  if (result.status !== 0 || result.error) {
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd(bin, args, { ok: false, error: detail })
    return { ok: false, error: detail }
  }

  logCmd(bin, args, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  return { ok: true, stdout, stderr }
}

function runGit(projectPath: string, args: string[]): string {
  return runCommand('git', ['-C', projectPath, ...args])
}

export interface GitHubRepoRef {
  owner: string
  repo: string
  slug: string
  remoteUrl: string
}

export type PullRequestState = 'draft' | 'open' | 'merged' | 'closed'

export interface PullRequestInfo {
  number: number
  url: string
  title: string
  body: string | null
  state: PullRequestState
  baseRefName: string
  headRefName: string
  headRefOid: string | null
  createdAt: string | null
  updatedAt: string | null
  closedAt: string | null
  mergedAt: string | null
}

export interface GitRecoveryReceipt {
  phase: string
  step: string
  capturedAt: string
  error: string
  projectPath: string
  branch: string
  baseBranch: string
  headSha: string | null
  candidateSha: string | null
  stagedFiles: string[]
  unstagedFiles: string[]
  untrackedFiles: string[]
  prNumber: number | null
  prUrl: string | null
  prState: PullRequestState | null
  nextSafeActions: string[]
}

interface GitHubPullRecord {
  number?: unknown
  html_url?: unknown
  title?: unknown
  body?: unknown
  state?: unknown
  draft?: unknown
  created_at?: unknown
  updated_at?: unknown
  closed_at?: unknown
  merged_at?: unknown
  head?: {
    ref?: unknown
    sha?: unknown
  } | null
  base?: {
    ref?: unknown
  } | null
}

const FILTERED_STATUS_ARGS = ['status', '--porcelain=1', '--untracked-files=all', '--', '.', ':(top,exclude).looptroop']

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePullRequestState(record: GitHubPullRecord): PullRequestState | null {
  const mergedAt = normalizeString(record.merged_at)
  if (mergedAt) return 'merged'
  const state = normalizeString(record.state)?.toUpperCase()
  if (state === 'CLOSED') return 'closed'
  if (state === 'OPEN' && record.draft === true) return 'draft'
  if (state === 'OPEN') return 'open'
  return null
}

function toPullRequestInfo(record: GitHubPullRecord): PullRequestInfo | null {
  const number = typeof record.number === 'number' && Number.isFinite(record.number) ? record.number : null
  const url = normalizeString(record.html_url)
  const title = normalizeString(record.title)
  const state = normalizePullRequestState(record)
  const baseRefName = normalizeString(record.base?.ref)
  const headRefName = normalizeString(record.head?.ref)

  if (!number || !url || !title || !state || !baseRefName || !headRefName) return null

  return {
    number,
    url,
    title,
    body: normalizeString(record.body),
    state,
    baseRefName,
    headRefName,
    headRefOid: normalizeString(record.head?.sha),
    createdAt: normalizeString(record.created_at),
    updatedAt: normalizeString(record.updated_at),
    closedAt: normalizeString(record.closed_at),
    mergedAt: normalizeString(record.merged_at),
  }
}

export function readOriginRemoteUrl(projectPath: string): string | null {
  try {
    const value = runGit(projectPath, ['config', '--get', 'remote.origin.url'])
    return value.trim() || null
  } catch {
    return null
  }
}

export function parseGitHubRemoteUrl(remoteUrl: string | null | undefined): GitHubRepoRef | null {
  const trimmed = typeof remoteUrl === 'string' ? remoteUrl.trim() : ''
  if (!trimmed) return null

  const patterns = [
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
    /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
    /^git:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    const owner = match?.groups?.owner?.trim()
    const repo = match?.groups?.repo?.trim()
    if (!owner || !repo) continue
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      remoteUrl: trimmed,
    }
  }

  return null
}

export function assertGitHubOrigin(projectPath: string): GitHubRepoRef {
  const remoteUrl = readOriginRemoteUrl(projectPath)
  const repo = parseGitHubRemoteUrl(remoteUrl)
  if (!repo) {
    throw new Error('Project must have an origin remote that points to github.com.')
  }
  return repo
}

export function isGhInstalled(): boolean {
  return tryCommand('gh', ['--version']).ok
}

export function getGhAuthStatus(): { ok: true } | { ok: false; error: string } {
  const result = tryCommand('gh', ['auth', 'status', '--hostname', 'github.com'])
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export function getGitHubRepoAccess(projectPath: string): { ok: true; repo: GitHubRepoRef } | { ok: false; error: string } {
  const repo = assertGitHubOrigin(projectPath)
  const result = tryCommand('gh', ['repo', 'view', repo.slug, '--json', 'nameWithOwner'], { cwd: projectPath })
  return result.ok
    ? { ok: true, repo }
    : { ok: false, error: result.error }
}

function runGhJson<T>(
  projectPath: string,
  args: string[],
  options?: { input?: string; env?: NodeJS.ProcessEnv },
): T {
  const stdout = runCommand('gh', args, {
    cwd: projectPath,
    input: options?.input,
    env: options?.env,
  })

  if (!stdout) {
    throw new Error('GitHub CLI returned empty JSON output')
  }

  return JSON.parse(stdout) as T
}

function listPullRequests(projectPath: string, repo: GitHubRepoRef, branchName: string, baseBranch: string): PullRequestInfo[] {
  const pulls = runGhJson<GitHubPullRecord[]>(projectPath, [
    'api',
    `repos/${repo.slug}/pulls`,
    '--method',
    'GET',
    '-f',
    'state=all',
    '-f',
    `head=${repo.owner}:${branchName}`,
    '-f',
    `base=${baseBranch}`,
  ])

  if (!Array.isArray(pulls)) return []
  return pulls
    .map((record) => toPullRequestInfo(record))
    .filter((record): record is PullRequestInfo => record !== null)
    .sort((left, right) => right.number - left.number)
}

export function getPullRequestForBranch(projectPath: string, branchName: string, baseBranch: string): PullRequestInfo | null {
  const repo = assertGitHubOrigin(projectPath)
  return listPullRequests(projectPath, repo, branchName, baseBranch)[0] ?? null
}

export function createOrUpdateDraftPullRequest(params: {
  projectPath: string
  branchName: string
  baseBranch: string
  title: string
  body: string
}): PullRequestInfo {
  const repo = assertGitHubOrigin(params.projectPath)
  const existing = listPullRequests(params.projectPath, repo, params.branchName, params.baseBranch)[0] ?? null

  if (existing) {
    const updated = runGhJson<GitHubPullRecord>(params.projectPath, [
      'api',
      `repos/${repo.slug}/pulls/${existing.number}`,
      '--method',
      'PATCH',
      '-f',
      `title=${params.title}`,
      '-f',
      `body=${params.body}`,
    ])
    return toPullRequestInfo(updated) ?? existing
  }

  const created = runGhJson<GitHubPullRecord>(params.projectPath, [
    'api',
    `repos/${repo.slug}/pulls`,
    '--method',
    'POST',
    '-f',
    `title=${params.title}`,
    '-f',
    `head=${params.branchName}`,
    '-f',
    `base=${params.baseBranch}`,
    '-f',
    `body=${params.body}`,
    '-F',
    'draft=true',
  ])

  const info = toPullRequestInfo(created)
  if (!info) {
    throw new Error('GitHub CLI did not return pull request metadata after creation')
  }
  return info
}

export function markPullRequestReady(projectPath: string, prNumber: number): PullRequestInfo {
  runCommand('gh', ['pr', 'ready', String(prNumber)], { cwd: projectPath })
  const repo = assertGitHubOrigin(projectPath)
  const refreshed = runGhJson<GitHubPullRecord>(projectPath, [
    'api',
    `repos/${repo.slug}/pulls/${prNumber}`,
    '--method',
    'GET',
  ])
  const info = toPullRequestInfo(refreshed)
  if (!info) {
    throw new Error(`Failed to refresh pull request #${prNumber} after marking it ready`)
  }
  return info
}

export function mergePullRequest(projectPath: string, prNumber: number, title: string): PullRequestInfo {
  const repo = assertGitHubOrigin(projectPath)
  runGhJson<{ merged?: unknown; message?: unknown }>(projectPath, [
    'api',
    `repos/${repo.slug}/pulls/${prNumber}/merge`,
    '--method',
    'PUT',
    '-f',
    'merge_method=merge',
    '-f',
    `commit_title=${title}`,
  ])

  const refreshed = runGhJson<GitHubPullRecord>(projectPath, [
    'api',
    `repos/${repo.slug}/pulls/${prNumber}`,
    '--method',
    'GET',
  ])
  const info = toPullRequestInfo(refreshed)
  if (!info) {
    throw new Error(`Failed to refresh merged pull request #${prNumber}`)
  }
  return info
}

export function readGitDiff(projectPath: string, fromRef: string, toRef: string): { stat: string; nameStatus: string; patch: string } {
  const exclusion = ':(top,exclude).ticket'
  const stat = runGit(projectPath, ['diff', '--stat', `${fromRef}..${toRef}`, '--', '.', exclusion])
  const nameStatus = runGit(projectPath, ['diff', '--name-status', `${fromRef}..${toRef}`, '--', '.', exclusion])
  const patch = runGit(projectPath, ['diff', '--no-ext-diff', '--unified=0', `${fromRef}..${toRef}`, '--', '.', exclusion])
  return { stat, nameStatus, patch }
}

function parseStatusLines(statusOutput: string): {
  stagedFiles: string[]
  unstagedFiles: string[]
  untrackedFiles: string[]
} {
  const stagedFiles = new Set<string>()
  const unstagedFiles = new Set<string>()
  const untrackedFiles = new Set<string>()

  for (const rawLine of statusOutput.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.length < 3) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const pathText = line.slice(3).trim()
    const filePath = pathText.includes(' -> ') ? pathText.split(' -> ').at(-1)?.trim() ?? pathText : pathText
    if (!filePath) continue

    if (x === '?' && y === '?') {
      untrackedFiles.add(filePath)
      continue
    }
    if (x !== ' ') stagedFiles.add(filePath)
    if (y !== ' ') unstagedFiles.add(filePath)
  }

  return {
    stagedFiles: [...stagedFiles],
    unstagedFiles: [...unstagedFiles],
    untrackedFiles: [...untrackedFiles],
  }
}

function buildNextSafeActions(step: string): string[] {
  switch (step) {
    case 'push_candidate_branch':
      return [
        'Confirm git remote connectivity and branch permissions, then retry the ticket.',
        'Inspect the local candidate commit and remote ticket branch before retrying.',
      ]
    case 'create_or_update_pull_request':
      return [
        'Run gh auth status and re-authenticate if needed, then retry the ticket.',
        'Open the repository in GitHub and confirm pull request permissions.',
      ]
    case 'mark_pull_request_ready':
      return [
        'Inspect the draft pull request state in GitHub, then retry the merge action.',
      ]
    case 'merge_pull_request':
      return [
        'Inspect the pull request mergeability in GitHub, resolve blockers, then retry the merge action.',
      ]
    case 'sync_local_base_branch':
      return [
        'Clean the local project worktree and retry so LoopTroop can fast-forward the base branch.',
      ]
    default:
      return [
        'Inspect the recorded git recovery receipt, resolve the blocking git or GitHub issue, then retry.',
      ]
  }
}

export function captureGitRecoveryReceipt(input: {
  projectPath: string
  phase: string
  step: string
  error: string
  branch: string
  baseBranch: string
  candidateSha?: string | null
  pr?: PullRequestInfo | null
}): GitRecoveryReceipt {
  let headSha: string | null = null
  let statusOutput = ''

  try {
    headSha = runGit(input.projectPath, ['rev-parse', 'HEAD']) || null
  } catch {
    headSha = null
  }

  try {
    statusOutput = runGit(input.projectPath, FILTERED_STATUS_ARGS)
  } catch {
    statusOutput = ''
  }

  const parsed = parseStatusLines(statusOutput)

  return {
    phase: input.phase,
    step: input.step,
    capturedAt: new Date().toISOString(),
    error: input.error,
    projectPath: input.projectPath,
    branch: input.branch,
    baseBranch: input.baseBranch,
    headSha,
    candidateSha: input.candidateSha ?? null,
    stagedFiles: parsed.stagedFiles,
    unstagedFiles: parsed.unstagedFiles,
    untrackedFiles: parsed.untrackedFiles,
    prNumber: input.pr?.number ?? null,
    prUrl: input.pr?.url ?? null,
    prState: input.pr?.state ?? null,
    nextSafeActions: buildNextSafeActions(input.step),
  }
}

export function ensureWorktreeClean(projectPath: string): void {
  const worktreeStatus = runGit(projectPath, FILTERED_STATUS_ARGS)
  if (worktreeStatus) {
    throw new Error('Project worktree has uncommitted changes. Clean the worktree before finishing this ticket.')
  }
}

export function syncLocalBaseBranch(projectPath: string, baseBranch: string): {
  originalBranch: string | null
  localBaseHead: string
  remoteBaseHead: string
} {
  ensureWorktreeClean(projectPath)
  runGit(projectPath, ['fetch', '--prune', 'origin'])

  const originalBranch = getCurrentBranch(projectPath)
  const remoteBaseRef = `origin/${baseBranch}`
  const remoteBaseHead = runGit(projectPath, ['rev-parse', `refs/remotes/${remoteBaseRef}`])

  if (originalBranch !== baseBranch) {
    try {
      runGit(projectPath, ['checkout', baseBranch])
    } catch {
      runGit(projectPath, ['checkout', '-B', baseBranch, remoteBaseRef])
    }
  }

  runGit(projectPath, ['merge', '--ff-only', remoteBaseRef])
  const localBaseHead = runGit(projectPath, ['rev-parse', 'HEAD'])

  return {
    originalBranch,
    localBaseHead,
    remoteBaseHead,
  }
}

export function tryDeleteRemoteBranch(projectPath: string, branchName: string): { deleted: boolean; warning: string | null } {
  const result = tryCommand('git', ['-C', projectPath, 'push', 'origin', '--delete', branchName])
  return result.ok
    ? { deleted: true, warning: null }
    : { deleted: false, warning: result.error }
}
