import type { DiagnosticCheck, PreFlightReport } from './types'
import type { OpenCodeAdapter } from '../../opencode/adapter'
import type { Bead } from '../beads/types'
import { existsSync } from 'fs'
import { resolve } from 'path'

export async function runPreFlightChecks(
  adapter: OpenCodeAdapter,
  ticketExternalId: string,
  beads: Bead[],
): Promise<PreFlightReport> {
  const checks: DiagnosticCheck[] = []

  // 1. OpenCode connectivity
  try {
    const health = await adapter.checkHealth()
    checks.push({
      name: 'OpenCode Connectivity',
      category: 'connectivity',
      result: health.available ? 'pass' : 'fail',
      message: health.available ? 'OpenCode is reachable' : `OpenCode unreachable: ${health.error}`,
    })
  } catch (err) {
    checks.push({
      name: 'OpenCode Connectivity',
      category: 'connectivity',
      result: 'fail',
      message: `OpenCode check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    })
  }

  // 2. Ticket directory exists
  const ticketDir = resolve(process.cwd(), '.looptroop/worktrees', ticketExternalId, '.ticket')
  checks.push({
    name: 'Ticket Directory',
    category: 'artifacts',
    result: existsSync(ticketDir) ? 'pass' : 'fail',
    message: existsSync(ticketDir) ? 'Ticket directory exists' : 'Ticket directory not found',
  })

  // 3. Codebase map exists
  const codebaseMap = resolve(ticketDir, 'codebase-map.yaml')
  checks.push({
    name: 'Codebase Map',
    category: 'artifacts',
    result: existsSync(codebaseMap) ? 'pass' : 'warning',
    message: existsSync(codebaseMap) ? 'Codebase map exists' : 'Codebase map not found',
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
    for (const dep of bead.dependencies) {
      if (!beadIds.has(dep)) {
        graphValid = false
        checks.push({
          name: 'Dependency Graph',
          category: 'graph',
          result: 'fail',
          message: `Bead ${bead.id} has dangling dependency: ${dep}`,
        })
      }
    }
    if (bead.dependencies.includes(bead.id)) {
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
