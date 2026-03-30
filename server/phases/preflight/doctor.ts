import type { DiagnosticCheck, PreFlightReport } from './types'
import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import { existsSync } from 'fs'
import { getTicketPaths } from '../../storage/tickets'
import { throwIfAborted } from '../../council/types'
import { raceWithCancel, throwIfCancelled } from '../../lib/abort'

export async function runPreFlightChecks(
  adapter: OpenCodeAdapter,
  ticketId: string,
  beads: Bead[],
  signal?: AbortSignal,
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
  const paths = getTicketPaths(ticketId)
  const ticketDir = paths?.ticketDir
  checks.push({
    name: 'Ticket Directory',
    category: 'artifacts',
    result: ticketDir && existsSync(ticketDir) ? 'pass' : 'fail',
    message: ticketDir && existsSync(ticketDir) ? 'Ticket directory exists' : 'Ticket directory not found',
  })

  // 3. Relevant files artifact exists
  const relevantFiles = ticketDir ? `${ticketDir}/relevant-files.yaml` : null
  checks.push({
    name: 'Relevant Files',
    category: 'artifacts',
    result: relevantFiles && existsSync(relevantFiles) ? 'pass' : 'warning',
    message: relevantFiles && existsSync(relevantFiles) ? 'Relevant files artifact exists' : 'Relevant files artifact not found',
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

  // 5. Dependency graph integrity
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
  if (graphValid && beads.length > 0) {
    checks.push({
      name: 'Dependency Graph',
      category: 'graph',
      result: 'pass',
      message: 'No dangling or self-dependencies detected',
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
