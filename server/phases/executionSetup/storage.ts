import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { phaseArtifacts } from '../../db/schema'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { getTicketContext, getTicketPaths } from '../../storage/tickets'
import {
  EXECUTION_SETUP_PLAN_ARTIFACT_TYPE,
  EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE,
  EXECUTION_SETUP_PLAN_REPORT_ARTIFACT_TYPE,
} from '../executionSetupPlan/types'
import {
  EXECUTION_LOG_RUNTIME_PATH,
  EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE,
  EXECUTION_SETUP_PROFILE_MIRROR,
  EXECUTION_SETUP_REPORT_ARTIFACT_TYPE,
  EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE,
  EXECUTION_SETUP_RUNTIME_DIR,
  serializeExecutionSetupProfile,
  type ExecutionSetupProfile,
} from './types'

const EXECUTION_SETUP_PROFILE_UI_COMPANION_ARTIFACT_TYPE = `ui_artifact_companion:${EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE}`
const EXECUTION_SETUP_PLAN_UI_COMPANION_ARTIFACT_TYPE = `ui_artifact_companion:${EXECUTION_SETUP_PLAN_ARTIFACT_TYPE}`
const EXECUTION_SETUP_UI_STATE_ARTIFACT_TYPES = new Set([
  'ui_state:approval_execution_setup',
])

export const EXECUTION_SETUP_ALLOWED_RUNTIME_PATHS = [
  EXECUTION_SETUP_RUNTIME_DIR,
  EXECUTION_SETUP_PROFILE_MIRROR,
] as const

export const EXECUTION_RUNTIME_PRESERVE_PATHS = [
  EXECUTION_LOG_RUNTIME_PATH,
  ...EXECUTION_SETUP_ALLOWED_RUNTIME_PATHS,
] as const

export interface ExecutionSetupPathSnapshot {
  untrackedPaths: string[]
}

function normalizeRepoRelativePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

export function isAllowedExecutionSetupRuntimePath(path: string): boolean {
  const normalized = normalizeRepoRelativePath(path)
  return normalized === EXECUTION_SETUP_PROFILE_MIRROR
    || normalized === EXECUTION_LOG_RUNTIME_PATH
    || normalized === EXECUTION_SETUP_RUNTIME_DIR
    || normalized.startsWith(`${EXECUTION_SETUP_RUNTIME_DIR}/`)
}

function listGitPaths(worktreePath: string, args: string[]): string[] {
  const result = spawnSync('git', ['-C', worktreePath, ...args], {
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) {
    return []
  }
  return (result.stdout ?? '')
    .split('\n')
    .map((entry) => normalizeRepoRelativePath(entry))
    .filter(Boolean)
}

function listUntrackedPathsIncludingIgnored(worktreePath: string): string[] {
  return [
    ...listGitPaths(worktreePath, ['ls-files', '--others', '--exclude-standard']),
    ...listGitPaths(worktreePath, ['ls-files', '--others', '--ignored', '--exclude-standard']),
  ]
}

export function createExecutionSetupPathSnapshot(worktreePath: string): ExecutionSetupPathSnapshot {
  return {
    untrackedPaths: [...new Set(listUntrackedPathsIncludingIgnored(worktreePath))],
  }
}

export function validateExecutionSetupPaths(
  worktreePath: string,
  baseline?: ExecutionSetupPathSnapshot,
): {
  ok: boolean
  violations: string[]
  changedPaths: string[]
} {
  const baselineUntracked = new Set(baseline?.untrackedPaths ?? [])
  const changedPaths = [
    ...listGitPaths(worktreePath, ['diff', '--name-only', 'HEAD']),
    ...listUntrackedPathsIncludingIgnored(worktreePath)
      .filter((path) => !baselineUntracked.has(path)),
  ]
  const uniqueChangedPaths = [...new Set(changedPaths)]
  const violations = uniqueChangedPaths.filter((path) => !isAllowedExecutionSetupRuntimePath(path))
  return {
    ok: violations.length === 0,
    violations,
    changedPaths: uniqueChangedPaths,
  }
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath)
  const candidate = resolve(candidatePath)
  const rel = relative(parent, candidate)
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel))
}

export function removeExecutionSetupPathViolations(
  worktreePath: string,
  baseline?: ExecutionSetupPathSnapshot,
): string[] {
  const validation = validateExecutionSetupPaths(worktreePath, baseline)
  const removed: string[] = []
  for (const violation of validation.violations) {
    const targetPath = resolve(worktreePath, violation)
    if (!isPathInside(worktreePath, targetPath) || !existsSync(targetPath)) continue
    rmSync(targetPath, { recursive: true, force: true })
    removed.push(violation)
  }
  return removed
}

export function writeExecutionSetupProfileMirror(ticketId: string, profile: ExecutionSetupProfile): string | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  safeAtomicWrite(paths.executionSetupProfilePath, serializeExecutionSetupProfile(profile))
  return paths.executionSetupProfilePath
}

export function clearExecutionSetupRuntimeArtifacts(ticketId: string): string[] {
  const paths = getTicketPaths(ticketId)
  if (!paths) return []

  const removed: string[] = []
  for (const targetPath of [paths.executionSetupDir, paths.executionSetupProfilePath]) {
    if (!existsSync(targetPath)) continue
    rmSync(targetPath, { recursive: true, force: true })
    removed.push(targetPath)
  }
  return removed
}

export function clearExecutionSetupState(ticketId: string): {
  removedArtifacts: number
  removedFiles: string[]
} {
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) {
    return {
      removedArtifacts: 0,
      removedFiles: clearExecutionSetupRuntimeArtifacts(ticketId),
    }
  }

  const removedFiles = clearExecutionSetupRuntimeArtifacts(ticketId)
  const artifacts = ticketContext.projectDb
    .select()
    .from(phaseArtifacts)
    .where(eq(phaseArtifacts.ticketId, ticketContext.localTicketId))
    .all()

  let removedArtifacts = 0
  for (const artifact of artifacts) {
    const artifactType = artifact.artifactType ?? ''
    if (
      artifact.phase !== 'PREPARING_EXECUTION_ENV'
      && artifact.phase !== 'WAITING_EXECUTION_SETUP_APPROVAL'
      && artifactType !== EXECUTION_SETUP_PROFILE_UI_COMPANION_ARTIFACT_TYPE
      && artifactType !== EXECUTION_SETUP_PLAN_UI_COMPANION_ARTIFACT_TYPE
      && artifactType !== EXECUTION_SETUP_PLAN_ARTIFACT_TYPE
      && artifactType !== EXECUTION_SETUP_PLAN_REPORT_ARTIFACT_TYPE
      && artifactType !== EXECUTION_SETUP_PLAN_NOTES_ARTIFACT_TYPE
      && !EXECUTION_SETUP_UI_STATE_ARTIFACT_TYPES.has(artifactType)
    ) {
      continue
    }
    ticketContext.projectDb
      .delete(phaseArtifacts)
      .where(eq(phaseArtifacts.id, artifact.id))
      .run()
    removedArtifacts += 1
  }

  return { removedArtifacts, removedFiles }
}

export function describeExecutionSetupPaths(ticketId: string): {
  setupDir: string
  profilePath: string
  logPath: string
} | null {
  const paths = getTicketPaths(ticketId)
  if (!paths) return null
  return {
    setupDir: paths.executionSetupDir,
    profilePath: paths.executionSetupProfilePath,
    logPath: resolve(paths.worktreePath, EXECUTION_LOG_RUNTIME_PATH),
  }
}

export {
  EXECUTION_SETUP_PROFILE_ARTIFACT_TYPE,
  EXECUTION_SETUP_REPORT_ARTIFACT_TYPE,
  EXECUTION_SETUP_RETRY_NOTES_ARTIFACT_TYPE,
}
