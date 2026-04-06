import type { DiagnosticCheck, PreFlightContext, PreFlightReport } from './types'
import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import { existsSync } from 'fs'
import { getLatestPhaseArtifact, getTicketPaths } from '../../storage/tickets'
import { throwIfAborted } from '../../council/types'
import { raceWithCancel, throwIfCancelled } from '../../lib/abort'
import { getRunnable } from '../execution/scheduler'
import { getCurrentBranch } from '../../git/repository'
import { fetchConnectedModelIds } from '../../opencode/providerCatalog'

export interface DoctorDeps {
  fileExists: (path: string) => boolean
  getTicketPaths: typeof getTicketPaths
  getCurrentBranch: typeof getCurrentBranch
  getLatestPhaseArtifact: typeof getLatestPhaseArtifact
  fetchConnectedModelIds: typeof fetchConnectedModelIds
}

export const defaultDoctorDeps: DoctorDeps = {
  fileExists: existsSync,
  getTicketPaths,
  getCurrentBranch,
  getLatestPhaseArtifact,
  fetchConnectedModelIds,
}

export async function runPreFlightChecks(
  adapter: OpenCodeAdapter,
  ticketId: string,
  beads: Bead[],
  preFlightContext: PreFlightContext,
  signal?: AbortSignal,
  deps: DoctorDeps = defaultDoctorDeps,
): Promise<PreFlightReport> {
  const checks: DiagnosticCheck[] = []

  // 1. OpenCode connectivity
  try {
    throwIfAborted(signal, ticketId)
    const health = await raceWithCancel(adapter.checkHealth(), signal, ticketId)
    throwIfAborted(signal, ticketId)
    checks.push({
      name: 'OpenCode Connectivity',
      category: 'connectivity',
      result: health.available ? 'pass' : 'fail',
      message: health.available ? 'OpenCode is reachable' : `OpenCode unreachable: ${health.error}`,
    })
  } catch (err) {
    throwIfCancelled(err, signal, ticketId)
    checks.push({
      name: 'OpenCode Connectivity',
      category: 'connectivity',
      result: 'fail',
      message: `OpenCode check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    })
  }

  // 2. Ticket directory exists
  const paths = deps.getTicketPaths(ticketId)
  const ticketDir = paths?.ticketDir
  checks.push({
    name: 'Ticket Directory',
    category: 'artifacts',
    result: ticketDir && deps.fileExists(ticketDir) ? 'pass' : 'fail',
    message: ticketDir && deps.fileExists(ticketDir) ? 'Ticket directory exists' : 'Ticket directory not found',
  })

  // 3. Relevant files artifact exists
  const relevantFiles = ticketDir ? `${ticketDir}/relevant-files.yaml` : null
  checks.push({
    name: 'Relevant Files',
    category: 'artifacts',
    result: relevantFiles && deps.fileExists(relevantFiles) ? 'pass' : 'warning',
    message: relevantFiles && deps.fileExists(relevantFiles) ? 'Relevant files artifact exists' : 'Relevant files artifact not found',
  })

  // 4. Beads validation
  if (beads.length === 0) {
    checks.push({
      name: 'Beads Available',
      category: 'config',
      result: 'fail',
      message: 'No beads to execute',
    })
  } else {
    checks.push({
      name: 'Beads Available',
      category: 'config',
      result: 'pass',
      message: `${beads.length} beads ready for execution`,
    })
  }

  // 5. Dependency graph integrity (dangling + self-deps)
  const beadIds = new Set(beads.map((b) => b.id))
  let graphValid = true
  for (const bead of beads) {
    for (const dep of bead.dependencies.blocked_by) {
      if (!beadIds.has(dep)) {
        graphValid = false
        checks.push({
          name: 'Dependency Graph',
          category: 'graph',
          result: 'fail',
          message: `Bead ${bead.id} has dangling blocked_by dependency: ${dep}`,
        })
      }
    }
    for (const dep of bead.dependencies.blocks) {
      if (!beadIds.has(dep)) {
        graphValid = false
        checks.push({
          name: 'Dependency Graph',
          category: 'graph',
          result: 'fail',
          message: `Bead ${bead.id} has dangling blocks dependency: ${dep}`,
        })
      }
    }
    if (bead.dependencies.blocked_by.includes(bead.id) || bead.dependencies.blocks.includes(bead.id)) {
      graphValid = false
      checks.push({
        name: 'Dependency Graph',
        category: 'graph',
        result: 'fail',
        message: `Bead ${bead.id} has self-dependency`,
      })
    }
  }

  // 6. Duplicate bead IDs
  if (beads.length > 0 && beadIds.size !== beads.length) {
    graphValid = false
    const seen = new Set<string>()
    for (const bead of beads) {
      if (seen.has(bead.id)) {
        checks.push({
          name: 'Dependency Graph',
          category: 'graph',
          result: 'fail',
          message: `Duplicate bead ID: ${bead.id}`,
        })
      }
      seen.add(bead.id)
    }
  }

  // 7. Circular dependency detection
  if (beads.length > 0 && graphValid) {
    const visited = new Set<string>()
    const recStack = new Set<string>()
    let hasCycleResult = false

    function detectCycle(beadId: string): boolean {
      visited.add(beadId)
      recStack.add(beadId)

      const bead = beads.find(b => b.id === beadId)
      if (bead) {
        for (const dep of bead.dependencies.blocked_by) {
          if (!visited.has(dep)) {
            if (detectCycle(dep)) return true
          } else if (recStack.has(dep)) {
            return true
          }
        }
      }

      recStack.delete(beadId)
      return false
    }

    for (const bead of beads) {
      if (!visited.has(bead.id)) {
        if (detectCycle(bead.id)) {
          hasCycleResult = true
          break
        }
      }
    }

    if (hasCycleResult) {
      graphValid = false
      checks.push({
        name: 'Dependency Graph',
        category: 'graph',
        result: 'fail',
        message: 'Circular dependency detected in bead graph',
      })
    }
  }

  // 8. Runnable bead exists (at least one bead can start immediately)
  if (beads.length > 0 && graphValid) {
    const runnable = getRunnable(beads)
    if (runnable.length === 0) {
      graphValid = false
      checks.push({
        name: 'Dependency Graph',
        category: 'graph',
        result: 'fail',
        message: 'No runnable bead found — all beads are blocked by dependencies',
      })
    }
  }

  if (graphValid && beads.length > 0) {
    checks.push({
      name: 'Dependency Graph',
      category: 'graph',
      result: 'pass',
      message: 'No dangling, circular, or duplicate dependencies detected',
    })
  }

  // 9. Git safety — verify worktree and branch
  if (paths?.worktreePath) {
    const worktreeExists = deps.fileExists(paths.worktreePath)
    if (!worktreeExists) {
      checks.push({
        name: 'Git Worktree',
        category: 'git',
        result: 'fail',
        message: 'Ticket worktree directory does not exist',
      })
    } else {
      try {
      const currentBranch = deps.getCurrentBranch(paths.worktreePath)
        if (currentBranch) {
          checks.push({
            name: 'Git Worktree',
            category: 'git',
            result: 'pass',
            message: `Worktree active on branch: ${currentBranch}`,
          })
        } else {
          checks.push({
            name: 'Git Worktree',
            category: 'git',
            result: 'fail',
            message: 'Worktree is in detached HEAD state',
          })
        }
      } catch {
        checks.push({
          name: 'Git Worktree',
          category: 'git',
          result: 'fail',
          message: 'Failed to inspect git worktree branch',
        })
      }
    }
  } else {
    checks.push({
      name: 'Git Worktree',
      category: 'git',
      result: 'fail',
      message: 'Ticket paths not available — cannot verify worktree',
    })
  }

  // 10. Beads approval receipt
  const approvalReceipt = deps.getLatestPhaseArtifact(ticketId, 'approval_receipt', 'WAITING_BEADS_APPROVAL')
  checks.push({
    name: 'Beads Approval',
    category: 'artifacts',
    result: approvalReceipt ? 'pass' : 'fail',
    message: approvalReceipt ? 'Beads approval receipt found' : 'Beads approval receipt not found',
  })

  // 11. Main implementer model reachability
  if (preFlightContext.lockedMainImplementer) {
    try {
      throwIfAborted(signal, ticketId)
      const connectedIds = await raceWithCancel(deps.fetchConnectedModelIds(), signal, ticketId)
      throwIfAborted(signal, ticketId)
      const connected = new Set(connectedIds)
      if (connected.has(preFlightContext.lockedMainImplementer)) {
        checks.push({
          name: 'Main Implementer Model',
          category: 'config',
          result: 'pass',
          message: `Model available: ${preFlightContext.lockedMainImplementer}`,
        })
      } else {
        checks.push({
          name: 'Main Implementer Model',
          category: 'config',
          result: 'fail',
          message: `Main implementer model not available in OpenCode: ${preFlightContext.lockedMainImplementer}`,
        })
      }
    } catch (err) {
      throwIfCancelled(err, signal, ticketId)
      checks.push({
        name: 'Main Implementer Model',
        category: 'config',
        result: 'fail',
        message: `Failed to verify model availability: ${err instanceof Error ? err.message : 'Unknown'}`,
      })
    }
  } else {
    checks.push({
      name: 'Main Implementer Model',
      category: 'config',
      result: 'fail',
      message: 'No main implementer model configured',
    })
  }

  // 12. Runtime safety budgets
  if (preFlightContext.maxIterations < 0) {
    checks.push({
      name: 'Runtime Budget',
      category: 'config',
      result: 'fail',
      message: `Invalid maxIterations: ${preFlightContext.maxIterations} (must be >= 0)`,
    })
  } else {
    checks.push({
      name: 'Runtime Budget',
      category: 'config',
      result: 'pass',
      message: preFlightContext.maxIterations === 0
        ? 'maxIterations: unlimited'
        : `maxIterations: ${preFlightContext.maxIterations}`,
    })
  }

  // Build report
  const criticalFailures = checks.filter((c) => c.result === 'fail')
  const warnings = checks.filter((c) => c.result === 'warning')

  return {
    passed: criticalFailures.length === 0,
    checks,
    criticalFailures,
    warnings,
  }
}
