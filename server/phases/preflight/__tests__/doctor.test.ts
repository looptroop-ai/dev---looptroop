import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Bead } from '../../beads/types'
import type { PreFlightContext } from '../types'
import type { DoctorDeps } from '../doctor'
import { runPreFlightChecks } from '../doctor'
import { MockOpenCodeAdapter } from '../../../opencode/adapter'

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
    iteration: 0,
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
  lockedMainImplementerVariant: 'high',
  maxIterations: 5,
}

describe('Pre-Flight Doctor', () => {
  let adapter: MockOpenCodeAdapter
  let deps: DoctorDeps

  const ticketPaths = {
    worktreePath: '/tmp/test-worktree',
    ticketDir: '/tmp/test-worktree/.ticket',
    executionLogPath: '/tmp/test-worktree/.ticket/runtime/execution-log.jsonl',
    executionSetupDir: '/tmp/test-worktree/.ticket/runtime/execution-setup',
    executionSetupProfilePath: '/tmp/test-worktree/.ticket/runtime/execution-setup-profile.json',
    baseBranch: 'main',
    beadsPath: '/tmp/beads',
  }

  const approvalReceipt = {
    id: 1,
    ticketId: 1,
    phase: 'WAITING_BEADS_APPROVAL' as const,
    artifactType: 'approval_receipt',
    filePath: null,
    content: '{}',
    createdAt: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new MockOpenCodeAdapter()
    deps = {
      fileExists: () => true,
      getTicketPaths: () => ticketPaths,
      getCurrentBranch: () => 'PROJ-1',
      readOriginRemoteUrl: () => 'git@github.com:test/looptroop.git',
      parseGitHubRemoteUrl: () => ({
        owner: 'test',
        repo: 'looptroop',
        slug: 'test/looptroop',
        remoteUrl: 'git@github.com:test/looptroop.git',
      }),
      isGhInstalled: () => true,
      getGhAuthStatus: () => ({ ok: true }),
      getGitHubRepoAccess: () => ({
        ok: true,
        repo: {
          owner: 'test',
          repo: 'looptroop',
          slug: 'test/looptroop',
          remoteUrl: 'git@github.com:test/looptroop.git',
        },
      }),
      getLatestPhaseArtifact: () => approvalReceipt,
      fetchConnectedModelIds: async () => ['model-a', 'model-b'],
      findExecutionBandConflict: () => null,
    }
  })

  it('passes all checks in happy path', async () => {
    const beads = [makeBead()]
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    expect(report.passed).toBe(true)
    expect(report.criticalFailures).toHaveLength(0)
    const capabilityCheck = report.checks.find((check) => check.name === 'OpenCode Execution Capability')
    expect(capabilityCheck?.result).toBe('pass')
    expect(adapter.sessionCreateCalls).toHaveLength(1)
    expect(adapter.promptCalls[0]?.options?.variant).toBe('high')
  })

  it('detects circular dependencies', async () => {
    const b1 = makeBead({ id: 'b1', dependencies: { blocked_by: ['b2'], blocks: [] } })
    const b2 = makeBead({ id: 'b2', dependencies: { blocked_by: ['b1'], blocks: [] } })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1, b2], defaultContext, undefined, deps)

    expect(report.passed).toBe(false)
    const circularCheck = report.criticalFailures.find(c => c.message.includes('Circular'))
    expect(circularCheck).toBeDefined()
  })

  it('detects duplicate bead IDs', async () => {
    const b1 = makeBead({ id: 'dup' })
    const b2 = makeBead({ id: 'dup' })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1, b2], defaultContext, undefined, deps)

    expect(report.passed).toBe(false)
    const dupCheck = report.criticalFailures.find(c => c.message.includes('Duplicate'))
    expect(dupCheck).toBeDefined()
  })

  it('detects no runnable bead when all depend on non-existent', async () => {
    const b1 = makeBead({ id: 'b1', dependencies: { blocked_by: ['nonexistent'], blocks: [] } })

    const report = await runPreFlightChecks(adapter, 'ticket-1', [b1], defaultContext, undefined, deps)

    expect(report.passed).toBe(false)
    expect(report.criticalFailures.some(c => c.message.includes('dangling'))).toBe(true)
  })

  it('accepts maxIterations = 0 as valid (unlimited)', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, maxIterations: 0 }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx, undefined, deps)

    const budgetCheck = report.checks.find(c => c.name === 'Runtime Budget')
    expect(budgetCheck?.result).toBe('pass')
    expect(budgetCheck?.message).toContain('unlimited')
  })

  it('fails for negative maxIterations', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, maxIterations: -1 }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx, undefined, deps)

    const budgetCheck = report.checks.find(c => c.name === 'Runtime Budget')
    expect(budgetCheck?.result).toBe('fail')
  })

  it('fails when main implementer model is not available', async () => {
    const beads = [makeBead()]
    deps.fetchConnectedModelIds = async () => ['model-b', 'model-c']

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const modelCheck = report.criticalFailures.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck).toBeDefined()
    expect(modelCheck?.message).toContain('not available')
  })

  it('does not fail for missing council members (only main implementer checked)', async () => {
    const beads = [makeBead()]
    deps.fetchConnectedModelIds = async () => ['model-a']

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const modelCheck = report.checks.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck?.result).toBe('pass')
  })

  it('fails when beads approval receipt is missing', async () => {
    const beads = [makeBead()]
    deps.getLatestPhaseArtifact = () => undefined

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const approvalCheck = report.criticalFailures.find(c => c.name === 'Beads Approval')
    expect(approvalCheck).toBeDefined()
    expect(approvalCheck?.message).toContain('not found')
  })

  it('fails when git worktree path does not exist', async () => {
    const beads = [makeBead()]
    deps.fileExists = (p) => p !== '/tmp/test-worktree'

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const gitCheck = report.criticalFailures.find(c => c.name === 'Git Worktree')
    expect(gitCheck).toBeDefined()
    expect(gitCheck?.message).toContain('does not exist')
  })

  it('fails when no main implementer configured', async () => {
    const beads = [makeBead()]
    const ctx = { ...defaultContext, lockedMainImplementer: null }
    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, ctx, undefined, deps)

    const modelCheck = report.criticalFailures.find(c => c.name === 'Main Implementer Model')
    expect(modelCheck).toBeDefined()
    expect(modelCheck?.message).toContain('No main implementer')
  })

  it('detects detached HEAD state', async () => {
    const beads = [makeBead()]
    deps.getCurrentBranch = () => null

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const gitCheck = report.criticalFailures.find(c => c.name === 'Git Worktree')
    expect(gitCheck).toBeDefined()
    expect(gitCheck?.message).toContain('detached HEAD')
  })

  it('reports relevant files as warning when missing', async () => {
    const beads = [makeBead()]
    deps.fileExists = (p) => typeof p === 'string' && !p.includes('relevant-files')

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const rfCheck = report.warnings.find(c => c.name === 'Relevant Files')
    expect(rfCheck).toBeDefined()
    expect(rfCheck?.result).toBe('warning')
    expect(report.criticalFailures.every(c => c.name !== 'Relevant Files')).toBe(true)
  })

  it('fails when another ticket is already in the execution band', async () => {
    const beads = [makeBead()]
    deps.findExecutionBandConflict = () => ({
      ticketId: '1:TEST-2',
      externalId: 'TEST-2',
      title: 'Conflicting execution',
      status: 'CODING',
    })

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const lockCheck = report.criticalFailures.find(c => c.name === 'Project Execution Lock')
    expect(lockCheck).toBeDefined()
    expect(lockCheck?.message).toContain('TEST-2')
  })

  it('fails when the execution capability probe does not return the exact OK marker', async () => {
    const beads = [makeBead()]
    adapter.mockResponses.set('mock-session-1', 'NOT OK')

    const report = await runPreFlightChecks(adapter, 'ticket-1', beads, defaultContext, undefined, deps)

    const capabilityCheck = report.criticalFailures.find((check) => check.name === 'OpenCode Execution Capability')
    expect(capabilityCheck).toBeDefined()
    expect(capabilityCheck?.message).toContain('unexpected response')
  })
})
