import { existsSync, rmSync } from 'fs'
import { resolve } from 'path'

export interface CleanupReport {
  removedDirs: string[]
  removedFiles: string[]
  errors: string[]
  preservedPaths: string[]
}

export function cleanupTicketResources(ticketExternalId: string): CleanupReport {
  const report: CleanupReport = {
    removedDirs: [],
    removedFiles: [],
    errors: [],
    preservedPaths: [],
  }

  const ticketRoot = resolve(process.cwd(), '.looptroop/worktrees', ticketExternalId)

  if (!existsSync(ticketRoot)) {
    report.errors.push('Ticket directory not found')
    return report
  }

  // Only remove runtime directories — never delete planning artifacts
  const runtimeDirs = [
    resolve(ticketRoot, '.ticket', 'runtime'),
    resolve(ticketRoot, '.ticket', 'locks'),
    resolve(ticketRoot, '.ticket', 'streams'),
    resolve(ticketRoot, '.ticket', 'sessions'),
    resolve(ticketRoot, '.ticket', 'tmp'),
  ]

  for (const dir of runtimeDirs) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
        report.removedDirs.push(dir)
      } catch (err) {
        report.errors.push(
          `Failed to remove ${dir}: ${err instanceof Error ? err.message : 'Unknown'}`,
        )
      }
    }
  }

  // Preserve planning artifacts
  const preservedArtifacts = [
    'meta.json',
    'interview.yaml',
    'prd.yaml',
    'codebase-map.yaml',
    'issues.jsonl',
  ]
  for (const artifact of preservedArtifacts) {
    const path = resolve(ticketRoot, '.ticket', artifact)
    if (existsSync(path)) {
      report.preservedPaths.push(path)
    }
  }

  return report
}
