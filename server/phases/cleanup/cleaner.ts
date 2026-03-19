import { existsSync, rmSync } from 'fs'
import { resolve } from 'path'
import { getTicketPaths } from '../../storage/tickets'

export interface CleanupReport {
  removedDirs: string[]
  removedFiles: string[]
  errors: string[]
  preservedPaths: string[]
}

export function cleanupTicketResources(ticketId: string): CleanupReport {
  const report: CleanupReport = {
    removedDirs: [],
    removedFiles: [],
    errors: [],
    preservedPaths: [],
  }

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    report.errors.push('Ticket directory not found')
    return report
  }

  const ticketRoot = paths.worktreePath

  if (!existsSync(ticketRoot)) {
    report.errors.push('Ticket directory not found')
    return report
  }

  // Remove transient runtime state but preserve audit/debug evidence.
  const runtimePaths = [
    resolve(ticketRoot, '.ticket', 'runtime', 'locks'),
    resolve(ticketRoot, '.ticket', 'runtime', 'sessions'),
    resolve(ticketRoot, '.ticket', 'runtime', 'streams'),
    resolve(ticketRoot, '.ticket', 'runtime', 'tmp'),
    resolve(ticketRoot, '.ticket', 'runtime', 'state.yaml'),
  ]

  for (const targetPath of runtimePaths) {
    if (existsSync(targetPath)) {
      try {
        rmSync(targetPath, { recursive: true, force: true })
        report.removedDirs.push(targetPath)
      } catch (err) {
        report.errors.push(
          `Failed to remove ${targetPath}: ${err instanceof Error ? err.message : 'Unknown'}`,
        )
      }
    }
  }

  // Preserve planning artifacts and the execution log needed for audit/debug history.
  const preservedArtifacts = [
    'meta/ticket.meta.json',
    'interview.yaml',
    'prd.yaml',
    'relevant-files.yaml',
    'runtime/execution-log.jsonl',
  ]
  for (const artifact of preservedArtifacts) {
    const path = resolve(ticketRoot, '.ticket', artifact)
    if (existsSync(path)) {
      report.preservedPaths.push(path)
    }
  }

  if (existsSync(paths.beadsPath)) {
    report.preservedPaths.push(paths.beadsPath)
  }

  return report
}
