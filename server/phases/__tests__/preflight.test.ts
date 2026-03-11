import { describe, it, expect } from 'vitest'
import { MockOpenCodeAdapter } from '../../opencode/adapter'
import { runPreFlightChecks } from '../preflight/doctor'
import type { Bead } from '../beads/types'
import { CancelledError } from '../../council/types'

class BlockingHealthAdapter extends MockOpenCodeAdapter {
  override async checkHealth() {
    return await new Promise<Awaited<ReturnType<MockOpenCodeAdapter['checkHealth']>>>(() => {})
  }
}

describe('Pre-flight Checks', () => {
  it('passes with valid beads and mock OpenCode', async () => {
    const adapter = new MockOpenCodeAdapter()
    const beads: Bead[] = [
      {
        id: 'b1',
        title: 'Bead 1',
        prdRefs: [],
        description: 'desc',
        contextGuidance: '',
        acceptanceCriteria: ['ac'],
        tests: ['t'],
        testCommands: ['cmd'],
        priority: 1,
        status: 'pending',
        labels: [],
        dependencies: [],
        targetFiles: [],
        notes: [],
        iteration: 0,
        createdAt: '',
        updatedAt: '',
        beadStartCommit: null,
        estimatedComplexity: 'moderate',
        epicId: '',
        storyId: '',
      },
    ]
    const report = await runPreFlightChecks(adapter, 'TEST-1', beads)
    expect(report.checks.find((c) => c.name === 'OpenCode Connectivity')?.result).toBe('pass')
    expect(report.checks.find((c) => c.name === 'Beads Available')?.result).toBe('pass')
  })

  it('fails with no beads', async () => {
    const adapter = new MockOpenCodeAdapter()
    const report = await runPreFlightChecks(adapter, 'TEST-1', [])
    expect(report.passed).toBe(false)
    expect(report.criticalFailures.some((c) => c.name === 'Beads Available')).toBe(true)
  })

  it('detects dependency graph issues', async () => {
    const adapter = new MockOpenCodeAdapter()
    const beads: Bead[] = [
      {
        id: 'b1',
        title: 'B1',
        prdRefs: [],
        description: 'd',
        contextGuidance: '',
        acceptanceCriteria: ['ac'],
        tests: ['t'],
        testCommands: ['cmd'],
        priority: 1,
        status: 'pending',
        labels: [],
        dependencies: ['nonexistent'],
        targetFiles: [],
        notes: [],
        iteration: 0,
        createdAt: '',
        updatedAt: '',
        beadStartCommit: null,
        estimatedComplexity: 'moderate',
        epicId: '',
        storyId: '',
      },
    ]
    const report = await runPreFlightChecks(adapter, 'TEST-1', beads)
    expect(report.criticalFailures.some((c) => c.name === 'Dependency Graph')).toBe(true)
  })

  it('stops immediately when the ticket is canceled during pre-flight checks', async () => {
    const adapter = new BlockingHealthAdapter()
    const controller = new AbortController()
    const beads: Bead[] = [
      {
        id: 'b1',
        title: 'Bead 1',
        prdRefs: [],
        description: 'desc',
        contextGuidance: '',
        acceptanceCriteria: ['ac'],
        tests: ['t'],
        testCommands: ['cmd'],
        priority: 1,
        status: 'pending',
        labels: [],
        dependencies: [],
        targetFiles: [],
        notes: [],
        iteration: 0,
        createdAt: '',
        updatedAt: '',
        beadStartCommit: null,
        estimatedComplexity: 'moderate',
        epicId: '',
        storyId: '',
      },
    ]

    const reportPromise = runPreFlightChecks(adapter, 'TEST-1', beads, controller.signal)
    controller.abort()

    await expect(reportPromise).rejects.toBeInstanceOf(CancelledError)
  })
})
