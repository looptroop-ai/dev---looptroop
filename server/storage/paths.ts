import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'

export function normalizeFolderPath(input: string): string {
  let output = input.trim().replace(/[\\/]+$/, '')
  output = output.replace(/\\/g, '/')
  const driveMatch = output.match(/^([A-Za-z]):\/(.*)$/)
  if (driveMatch && driveMatch[1] && driveMatch[2] !== undefined) {
    output = `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`
  }
  if (!isAbsolute(output)) {
    output = resolve(process.cwd(), output)
  }
  return output
}

export function resolveGitRepoRoot(folderPath: string): string | null {
  const normalized = normalizeFolderPath(folderPath)
  if (!existsSync(normalized)) return null
  try {
    return normalizeFolderPath(
      execFileSync('git', ['-C', normalized, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' })
        .toString()
        .trim(),
    )
  } catch {
    return null
  }
}

export function isGitRepo(folderPath: string): boolean {
  return resolveGitRepoRoot(folderPath) !== null
}

export function getProjectLoopTroopDir(projectRoot: string): string {
  return resolve(projectRoot, '.looptroop')
}

export function getProjectDbPath(projectRoot: string): string {
  return resolve(getProjectLoopTroopDir(projectRoot), 'db.sqlite')
}

export function getProjectWorktreesRoot(projectRoot: string): string {
  return resolve(getProjectLoopTroopDir(projectRoot), 'worktrees')
}

export function getTicketWorktreePath(projectRoot: string, externalId: string): string {
  return resolve(getProjectWorktreesRoot(projectRoot), externalId)
}

export function getTicketDir(projectRoot: string, externalId: string): string {
  return resolve(getTicketWorktreePath(projectRoot, externalId), '.ticket')
}

export function getTicketRuntimeDir(projectRoot: string, externalId: string): string {
  return resolve(getTicketDir(projectRoot, externalId), 'runtime')
}

export function getTicketExecutionLogPath(projectRoot: string, externalId: string): string {
  return resolve(getTicketRuntimeDir(projectRoot, externalId), 'execution-log.jsonl')
}

export function ensureProjectStorageDirs(projectRoot: string) {
  mkdirSync(getProjectLoopTroopDir(projectRoot), { recursive: true })
  mkdirSync(getProjectWorktreesRoot(projectRoot), { recursive: true })
}

export function ensureParentDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
}
