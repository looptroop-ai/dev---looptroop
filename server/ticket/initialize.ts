import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { resolveBaseBranchRef } from '../git/repository'
import {
  detectGitBaseBranch,
  getTicketDir as resolveTicketDir,
  getTicketRuntimeDir,
  getTicketWorktreePath as resolveTicketWorktreePath,
} from '../storage/paths'
import { getTicketBeadsDir, updateTicketMeta } from './metadata'
import { safeAtomicWrite } from '../io/atomicWrite'

import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)

// Lazy-load commandLogger to avoid vitest mock-resolution deadlock when
// tickets.start.test.ts uses `importOriginal` on this module.
function logCmd(bin: string, args: string[], result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string }) {
  try {
    const { logCommand } = _require('../log/commandLogger') as typeof import('../log/commandLogger')
    logCommand(bin, args, result)
  } catch {
    // Silently ignore if commandLogger can't be loaded (e.g. in test isolation).
  }
}

interface InitializeOptions {
  externalId: string
  projectFolder: string
}

export interface InitializeTicketResult {
  worktreePath: string
  ticketDir: string
  branchName: string
  baseBranch: string
  reused: boolean
}

export class TicketInitializationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TicketInitializationError'
    this.code = code
  }
}

const RUNTIME_GITIGNORE = [
  'runtime/**',
  'locks/**',
  'streams/**',
  'sessions/**',
  'tmp/**',
].join('\n') + '\n'

export function getTicketWorktreePath(projectRoot: string, externalId: string): string {
  return resolveTicketWorktreePath(projectRoot, externalId)
}

export function getTicketDir(projectRoot: string, externalId: string): string {
  return resolveTicketDir(projectRoot, externalId)
}

function runGit(args: string[], cwd: string, code: string, message: string): string {
  const fullArgs = ['-C', cwd, ...args]
  const result = spawnSync('git', fullArgs, { encoding: 'utf8' })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message ?? ([stdout, stderr].filter(Boolean).join(' | ') || `exit code ${result.status ?? '?'}`)
    logCmd('git', fullArgs, { ok: false, error: detail })
    throw new TicketInitializationError(code, `${message}: ${detail}`)
  }
  logCmd('git', fullArgs, { ok: true, stdout: stdout || undefined, stderr: stderr || undefined })
  return stdout
}

function gitCommandSucceeds(args: string[], cwd: string): boolean {
  const fullArgs = ['-C', cwd, ...args]
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

function resolveGitPath(basePath: string, gitPath: string): string {
  return isAbsolute(gitPath) ? gitPath : resolve(basePath, gitPath)
}

function ensureGitRepo(projectFolder: string) {
  const inside = runGit(
    ['rev-parse', '--is-inside-work-tree'],
    projectFolder,
    'INIT_NOT_GIT_REPO',
    'Project folder is not a git repository',
  )

  if (inside !== 'true') {
    throw new TicketInitializationError('INIT_NOT_GIT_REPO', `Project folder is not a git repository: ${projectFolder}`)
  }
}

function ensureBaseBranch(projectFolder: string, baseBranch: string): string {
  try {
    return resolveBaseBranchRef(projectFolder, baseBranch)
  } catch {
    throw new TicketInitializationError(
      'INIT_BASE_BRANCH_MISSING',
      `Project repository does not have the detected base branch "${baseBranch}": ${projectFolder}`,
    )
  }
}

function branchExists(projectFolder: string, branchName: string): boolean {
  return gitCommandSucceeds(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
    projectFolder,
  )
}

function isValidTicketWorktree(
  projectFolder: string,
  worktreePath: string,
  branchName: string,
): boolean {
  if (!existsSync(worktreePath)) return false
  if (!gitCommandSucceeds(['rev-parse', '--is-inside-work-tree'], worktreePath)) return false

  try {
    const currentBranch = runGit(
      ['branch', '--show-current'],
      worktreePath,
      'INIT_WORKTREE_INVALID',
      'Failed to inspect ticket worktree branch',
    )
    if (currentBranch !== branchName) return false

    const repoCommonDir = runGit(
      ['rev-parse', '--absolute-git-dir'],
      projectFolder,
      'INIT_WORKTREE_INVALID',
      'Failed to inspect project repository git dir',
    )
    const worktreeCommonDir = resolveGitPath(
      worktreePath,
      runGit(
        ['rev-parse', '--git-common-dir'],
        worktreePath,
        'INIT_WORKTREE_INVALID',
        'Failed to inspect ticket worktree common git dir',
      ),
    )

    return realpathSync(repoCommonDir) === realpathSync(worktreeCommonDir)
  } catch {
    return false
  }
}

function isPreStartTicketSkeleton(worktreePath: string): boolean {
  if (!existsSync(worktreePath)) return false

  const rootEntries = readdirSync(worktreePath, { withFileTypes: true })
  if (rootEntries.length === 0) return true
  if (rootEntries.some(entry => entry.name !== '.ticket')) return false

  return true
}

function preserveTicketSkeleton(worktreePath: string): {
  restore: () => void
  restoreForFailure: () => void
} {
  const ticketPath = resolve(worktreePath, '.ticket')
  if (!existsSync(ticketPath)) {
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true })
    }
    return {
      restore: () => {},
      restoreForFailure: () => {},
    }
  }

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'looptroop-ticket-skeleton-'))
  const preservedTicketPathLocal = resolve(tempRoot, '.ticket')
  cpSync(ticketPath, preservedTicketPathLocal, { recursive: true })
  rmSync(worktreePath, { recursive: true, force: true })

  const restoreTicket = () => {
    if (existsSync(ticketPath)) {
      rmSync(ticketPath, { recursive: true, force: true })
    }
    cpSync(preservedTicketPathLocal, ticketPath, { recursive: true })
    rmSync(tempRoot, { recursive: true, force: true })
  }

  return {
    restore: restoreTicket,
    restoreForFailure: restoreTicket,
  }
}

function ensureTicketDirectories(
  projectRoot: string,
  externalId: string,
  ticketDir: string,
  baseBranch: string,
) {
  const runtimeDir = resolve(ticketDir, 'runtime')
  const dirs = [
    ticketDir,
    resolve(ticketDir, 'meta'),
    resolve(ticketDir, 'approvals'),
    runtimeDir,
    resolve(runtimeDir, 'streams'),
    resolve(runtimeDir, 'sessions'),
    resolve(runtimeDir, 'locks'),
    resolve(runtimeDir, 'tmp'),
    getTicketBeadsDir(projectRoot, externalId, baseBranch),
  ]

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true })
  }
}

function writeRuntimeGitignore(ticketDir: string) {
  safeAtomicWrite(resolve(ticketDir, '.gitignore'), RUNTIME_GITIGNORE)
}

function materializeWorktree(
  projectFolder: string,
  worktreePath: string,
  branchName: string,
  baseBranchRef: string,
) {
  if (!existsSync(worktreePath)) {
    const args = branchExists(projectFolder, branchName)
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, baseBranchRef]
    runGit(args, projectFolder, 'INIT_WORKTREE_CREATE_FAILED', 'Failed to create ticket worktree')
    return
  }

  if (isValidTicketWorktree(projectFolder, worktreePath, branchName)) {
    return
  }

  if (!isPreStartTicketSkeleton(worktreePath)) {
    throw new TicketInitializationError(
      'INIT_WORKTREE_PATH_INVALID',
      `Reserved ticket path is not reusable for worktree creation: ${worktreePath}`,
    )
  }

  const preserved = preserveTicketSkeleton(worktreePath)
  try {
    const args = branchExists(projectFolder, branchName)
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, baseBranchRef]
    runGit(args, projectFolder, 'INIT_WORKTREE_CREATE_FAILED', 'Failed to create ticket worktree')
    preserved.restore()
  } catch (err) {
    preserved.restoreForFailure()
    throw err
  }
}

export function initializeTicket(options: InitializeOptions): InitializeTicketResult {
  const branchName = options.externalId
  const baseBranch = detectGitBaseBranch(options.projectFolder)
  const baseBranchRef = ensureBaseBranch(options.projectFolder, baseBranch)
  const worktreePath = getTicketWorktreePath(options.projectFolder, options.externalId)
  const ticketDir = getTicketDir(options.projectFolder, options.externalId)

  ensureGitRepo(options.projectFolder)

  const reused = isValidTicketWorktree(options.projectFolder, worktreePath, branchName)
  if (!reused) {
    materializeWorktree(options.projectFolder, worktreePath, branchName, baseBranchRef)
  }

  if (!isValidTicketWorktree(options.projectFolder, worktreePath, branchName)) {
    throw new TicketInitializationError(
      'INIT_WORKTREE_INVALID',
      `Ticket worktree is invalid after initialization: ${worktreePath}`,
    )
  }

  ensureTicketDirectories(options.projectFolder, options.externalId, ticketDir, baseBranch)
  mkdirSync(getTicketRuntimeDir(options.projectFolder, options.externalId), { recursive: true })
  writeRuntimeGitignore(ticketDir)
  updateTicketMeta(options.projectFolder, options.externalId, { baseBranch })

  return {
    worktreePath,
    ticketDir,
    branchName,
    baseBranch,
    reused,
  }
}
