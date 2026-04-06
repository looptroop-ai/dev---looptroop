import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Bead } from '../../beads/types'
import type { PreFlightContext } from '../types'

vi.mock('../../../storage/tickets', () => ({
  getTicketPaths: vi.fn(),
  getLatestPhaseArtifact: vi.fn(),
}))

vi.mock('../../../git/repository', () => ({
  getCurrentBranch: vi.fn(),
}))

vi.mock('../../../opencode/providerCatalog', () => ({
  fetchConnectedModelIds: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  }
})

import { existsSync } from 'fs'
import { runPreFlightChecks } from '../doctor'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'
import { getTicketPaths, getLatestPhaseArtifact } from '../../../storage/tickets'
import { getCurrentBranch } from '../../../git/repository'
import { fetchConnectedModelIds } from '../../../opencode/providerCatalog'

const mockedExistsSync = vi.mocked(existsSync)
const mockedGetTicketPaths = vi.mocked(getTicketPaths)
const mockedGetLatestPhaseArtifact = vi.mocked(getLatestPhaseArtifact)
const mockedGetCurrentBranch = vi.mocked(getCurrentBranch)
const mockedFetchConnectedModelIds = vi.mocked(fetchConnectedModelIds)

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'b1',
    title: 'Bead 1',
    prdRefs: ['e1'],
    description: 'desc',
    contextGuidance: { patterns: [], anti_patterns: [] },
    acceptanceCriteria: ['ac1'],
    tests: ['test1'],
    testCommands: ['npm test'],
    priority: 1,
    status: 'pending',
    issueType: 'task',
    externalRef: '',
    labels: [],
    dependencies: { blocked_by: [], blocks: [] },
    targetFiles: [],
    notes: '',
    iteration: 1,
    createdAt: '',
    updatedAt: '',
    completedAt: '',
    startedAt: '',
    beadStartCommit: null,
    ...overrides,
  }
}

const defaultContext: PreFlightContext = {
  lockedMainImplementer: 'model-a',
  maxIterations: 5,
}

describe('Pre-Flight Doctor', () => {
  let adapter: MockOpenCodeAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new MockOpenCodeAdapter()

    mockedExistsSync.mockReturnValue(true)

    mockedGetTicketPaths.mockReturnValue({
      worktreePath: '/tmp/test-worktree',
      ticketDir: '/tmp/test-worktree/.ticket',
      executionLogPath: '/tmp/test-worktree/.ticket/runtime/execution-log.jsonl',
      baseBranch: 'main',
      beadsPath: '/tmp/beads',
    })
    mockedGetLatestPhaseArtifact.mockReturnValue({
      id: 1,
      ticketId: 1,
      phase: 'WAITING_BEADS_APPROVAL',
      artifactType: 'approval_receipt',
      filePath: null,
      content: '{}',
      createdAt: new Date().toISOString(),
    })
    mockedGetCurrentBranch.mockReturnValue('PROJ-1')
    mockedFetchConnectedModelIds.mockResolvedValue(['model-a', 'model-b'])
  })

  it('passes all checks in happy path', async () => {
    const beads = [makeBead()]
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    expect(report.passed).toBe(true)
    expect(report.criticalFailures).toHaveLength(0)
  })

  it('detects circular dependencies', async () => {
    const b1 = makeBead({ id: 'b1', dependencies: { blocked_by: ['b2'], blocks: [] } })
    const b2 = makeBead({ id: 'b2', dependencies: { blocked_by: ['b1'], blocks: [] } })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1, b2], defaultContext)

    expect(report.passed).toBe(false)
    const circularCheck = report.criticalFailures.find(c => c.message.includes('Circular'))
    expect(circularCheck).toBeDefined()
  })

  it('detects duplicate bead IDs', async () => {
    const b1 = makeBead({ id: 'dup' })
    const b2 = makeBead({ id: 'dup' })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1, b2], defaultContext)

    expect(report.passed).toBe(false)
    const dupCheck = report.criticalFailures.find(c => c.message.includes('Duplicate'))
    expect(dupCheck).toBeDefined()
  })

  it('detects no runnable bead when all depend on non-existent', async () => {
    const b1 = makeBead({ id: 'b1', dependencies: { blocked_by: ['nonexistent'], blocks: [] } })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1], defaultContext)

    expect(report.passed).toBe(false)
    expect(report.criticalFailures.some(c => c.message.includes('dangling'))).toBe(true)
  })

  it('accepts maxIterations = 0 as valid (unlimited)', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, maxIterations: 0 }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx)

    const budgetCheck = report.checks.find(c => c.name === 'Runtime Budget')
    expect(budgetCheck?.result).toBe('pass')
    expect(budgetCheck?.message).toContain('unlimited')
  })

  it('fails for negative maxIterations', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, maxIterations: -1 }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx)

    const budgetCheck = report.checks.find(c => c.name === 'Runtime Budget')
    expect(budgetCheck?.result).toBe('fail')
  })

  it('fails when main implementer model is not available', async () => {
    const beads = [makeBead()]
    mockedFetchConnectedModelIds.mockResolvedValue(['model-b', 'model-c'])

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const modelCheck = report.criticalFailures.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck).toBeDefined()
    expect(modelCheck?.message).toContain('not available')
  })

  it('does not fail for missing council members (only main implementer checked)', async () => {
    const beads = [makeBead()]
    mockedFetchConnectedModelIds.mockResolvedValue(['model-a'])

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const modelCheck = report.checks.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck?.result).toBe('pass')
  })

  it('fails when beads approval receipt is missing', async () => {
    const beads = [makeBead()]
    mockedGetLatestPhaseArtifact.mockReturnValue(undefined)

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const approvalCheck = report.criticalFailures.find(c => c.name === 'Beads Approval')
    expect(approvalCheck).toBeDefined()
    expect(approvalCheck?.message).toContain('not found')
  })

  it('fails when git worktree path does not exist', async () => {
    const beads = [makeBead()]
    mockedExistsSync.mockImplementation((p) => {
      if (typeof p === 'string' && p === '/tmp/test-worktree') return false
      return true
    })

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const gitCheck = report.criticalFailures.find(c => c.name === 'Git Worktree')
    expect(gitCheck).toBeDefined()
    expect(gitCheck?.message).toContain('does not exist')
  })

  it('fails when no main implementer configured', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, lockedMainImplementer: null }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx)

    const modelCheck = report.criticalFailures.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck).toBeDefined()
    expect(modelCheck?.message).toContain('No main implementer')
  })

  it('detects detached HEAD state', async () => {
    const beads = [makeBead()]
    mockedGetCurrentBranch.mockReturnValue(null)

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const gitCheck = report.criticalFailures.find(c => c.name === 'Git Worktree')
    expect(gitCheck).toBeDefined()
    expect(gitCheck?.message).toContain('detached HEAD')
  })

  it('reports relevant files as warning when missing', async () => {
    const beads = [makeBead()]
    mockedExistsSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('relevant-files')) return false
      return true
    })

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext)

    const rfCheck = report.warnings.find(c => c.name === 'Relevant Files')
    expect(rfCheck).toBeDefined()
    expect(rfCheck?.result).toBe('warning')
    expect(report.criticalFailures.every(c => c.name !== 'Relevant Files')).toBe(true)
  })
})
