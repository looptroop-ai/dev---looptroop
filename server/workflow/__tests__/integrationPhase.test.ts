import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketEvent } from '../../machines/types'
import { TEST, makeTicketContext } from '../../test/factories'
import { CancelledError } from '../../council/types'

const {
  prepareSquashCandidateMock,
  getLatestPhaseArtifactMock,
  getTicketPathsMock,
  insertPhaseArtifactMock,
  emitPhaseLogMock,
  isMockOpenCodeModeMock,
  handleMockExecutionUnsupportedMock,
} = vi.hoisted(() => ({
  prepareSquashCandidateMock: vi.fn(),
  getLatestPhaseArtifactMock: vi.fn(),
  getTicketPathsMock: vi.fn(),
  insertPhaseArtifactMock: vi.fn(),
  emitPhaseLogMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
  handleMockExecutionUnsupportedMock: vi.fn(),
}))

vi.mock('../../phases/integration/squash', () => ({
  prepareSquashCandidate: prepareSquashCandidateMock,
}))

vi.mock('../../storage/tickets', () => ({
  getLatestPhaseArtifact: getLatestPhaseArtifactMock,
  getTicketPaths: getTicketPathsMock,
  insertPhaseArtifact: insertPhaseArtifactMock,
}))

vi.mock('../../opencode/factory', async () => {
  const actual = await vi.importActual<typeof import('../../opencode/factory')>('../../opencode/factory')
  return {
    ...actual,
    isMockOpenCodeMode: isMockOpenCodeModeMock,
  }
})

vi.mock('../phases/helpers', async () => {
  const actual = await vi.importActual<typeof import('../phases/helpers')>('../phases/helpers')
  return {
    ...actual,
    emitPhaseLog: emitPhaseLogMock,
  }
})

vi.mock('../phases/executionPhase', () => ({
  handleMockExecutionUnsupported: handleMockExecutionUnsupportedMock,
}))

vi.mock('../../log/commandLogger', () => ({
  withCommandLoggingAsync: async (_tid: string, _eid: string, _phase: string, fn: () => Promise<unknown>) => fn(),
}))

import { handleIntegration } from '../phases/integrationPhase'

const defaultPaths = {
  worktreePath: '/fake/worktree',
  baseBranch: 'main',
  ticketDir: '/fake/worktree/.ticket',
  executionLogPath: '/fake/worktree/.ticket/runtime/execution-log.jsonl',
  debugLogPath: '/fake/worktree/.ticket/runtime/execution-log.debug.jsonl',
  executionSetupDir: '/fake/worktree/.ticket/runtime/execution-setup',
  executionSetupProfilePath: '/fake/worktree/.ticket/runtime/execution-setup-profile.json',
  beadsPath: '/fake/worktree/.ticket/beads.yaml',
}

const successSquash = {
  success: true,
  message: 'Squashed successfully',
  commitHash: 'abc1234',
  mergeBase: 'def5678',
  preSquashHead: '999aaa',
  commitCount: 3,
}

describe('handleIntegration', () => {
  let context: ReturnType<typeof makeTicketContext>

  beforeEach(() => {
    vi.resetAllMocks()
    isMockOpenCodeModeMock.mockReturnValue(false)
    getTicketPathsMock.mockReturnValue(defaultPaths)
    getLatestPhaseArtifactMock.mockReturnValue(undefined)
    prepareSquashCandidateMock.mockReturnValue(successSquash)

    context = makeTicketContext()
  })

  it('successful integration defers the remote update until manual verification', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    await handleIntegration(TEST.ticketId, context, sendEvent)

    expect(prepareSquashCandidateMock).toHaveBeenCalledWith(
      defaultPaths.worktreePath,
      defaultPaths.baseBranch,
      context.title,
      context.externalId,
      [],
    )

    expect(insertPhaseArtifactMock).toHaveBeenCalledWith(TEST.ticketId, expect.objectContaining({
      phase: 'INTEGRATING_CHANGES',
      artifactType: 'integration_report',
    }))
    const report = JSON.parse(insertPhaseArtifactMock.mock.calls[0]![1].content)
    expect(report.status).toBe('passed')
    expect(report.pushed).toBe(false)
    expect(report.pushDeferred).toBe(true)
    expect(report.pushError).toBeNull()
    expect(report.candidateCommitSha).toBe('abc1234')

    expect(sendEvent).toHaveBeenCalledWith({ type: 'INTEGRATION_DONE' })
    expect(emitPhaseLogMock).toHaveBeenCalled()
  })

  it('squash failure throws', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    prepareSquashCandidateMock.mockReturnValue({
      success: false,
      message: 'merge conflict',
    })

    await expect(handleIntegration(TEST.ticketId, context, sendEvent))
      .rejects.toThrow('merge conflict')

    const report = JSON.parse(insertPhaseArtifactMock.mock.calls[0]![1].content)
    expect(report.status).toBe('failed')
    expect(report.message).toBe('merge conflict')

    expect(sendEvent).not.toHaveBeenCalled()
  })

  it('passes validated final-test modified files into the squash stage', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    getLatestPhaseArtifactMock.mockReturnValue({
      content: JSON.stringify({
        modifiedFiles: ['src/final.test.ts', 'src/feature.ts'],
      }),
    })

    await handleIntegration(TEST.ticketId, context, sendEvent)

    expect(prepareSquashCandidateMock).toHaveBeenCalledWith(
      defaultPaths.worktreePath,
      defaultPaths.baseBranch,
      context.title,
      context.externalId,
      ['src/final.test.ts', 'src/feature.ts'],
    )
  })

  it('missing ticket paths throws', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    getTicketPathsMock.mockReturnValue(null)

    await expect(handleIntegration(TEST.ticketId, context, sendEvent))
      .rejects.toThrow('Ticket workspace not initialized')
  })

  it('mock mode delegates to handleMockExecutionUnsupported', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    isMockOpenCodeModeMock.mockReturnValue(true)

    await handleIntegration(TEST.ticketId, context, sendEvent)

    expect(handleMockExecutionUnsupportedMock).toHaveBeenCalledWith(
      TEST.ticketId, context, 'INTEGRATING_CHANGES', sendEvent,
    )
    expect(prepareSquashCandidateMock).not.toHaveBeenCalled()
  })

  it('AbortSignal already aborted throws CancelledError', async () => {
    const sendEvent = vi.fn<(event: TicketEvent) => void>()
    const ac = new AbortController()
    ac.abort()

    await expect(handleIntegration(TEST.ticketId, context, sendEvent, ac.signal))
      .rejects.toThrow(CancelledError)

    expect(prepareSquashCandidateMock).not.toHaveBeenCalled()
  })
})
