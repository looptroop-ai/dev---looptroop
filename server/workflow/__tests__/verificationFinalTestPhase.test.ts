import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'fs'
import {
  createInitializedTestTicket,
  createTestRepoManager,
  makeBeadsYaml,
  makeInterviewYaml,
  makePrdYaml,
  resetTestDb,
  TEST,
} from '../../test/factories'
import { upsertLatestPhaseArtifact } from '../../storage/tickets'
import { updateProject } from '../../storage/projects'

const {
  executeFinalTestWithRetriesMock,
  recordWorktreeStartCommitMock,
  resetWorktreeToCommitMock,
  isMockOpenCodeModeMock,
} = vi.hoisted(() => ({
  executeFinalTestWithRetriesMock: vi.fn(),
  recordWorktreeStartCommitMock: vi.fn(),
  resetWorktreeToCommitMock: vi.fn(),
  isMockOpenCodeModeMock: vi.fn(),
}))

vi.mock('../../phases/finalTest/executor', () => ({
  executeFinalTestWithRetries: executeFinalTestWithRetriesMock,
}))

vi.mock('../../phases/execution/gitOps', () => ({
  recordWorktreeStartCommit: recordWorktreeStartCommitMock,
  resetWorktreeToCommit: resetWorktreeToCommitMock,
  recordBeadStartCommit: vi.fn(),
  resetToBeadStart: vi.fn(),
  commitBeadChanges: vi.fn(),
  captureBeadDiff: vi.fn(),
}))

vi.mock('../../opencode/factory', async () => {
  const actual = await vi.importActual<typeof import('../../opencode/factory')>('../../opencode/factory')
  return {
    ...actual,
    isMockOpenCodeMode: isMockOpenCodeModeMock,
  }
})

import { handleFinalTest } from '../phases/verificationPhase'

const repoManager = createTestRepoManager('verification-final-test-')

describe('handleFinalTest', () => {
  beforeEach(() => {
    resetTestDb()
    executeFinalTestWithRetriesMock.mockReset()
    recordWorktreeStartCommitMock.mockReset()
    resetWorktreeToCommitMock.mockReset()
    isMockOpenCodeModeMock.mockReset()

    recordWorktreeStartCommitMock.mockReturnValue('abc123')
    isMockOpenCodeModeMock.mockReturnValue(false)
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('reloads persisted final-test retry notes into context and uses execution runtime settings', async () => {
    const { ticket, context, paths, project } = createInitializedTestTicket(repoManager, {
      title: 'Final test retry state',
      description: 'Ensure retries keep prior final-test notes.',
    })
    updateProject(project.id, {
      maxIterations: 2,
      perIterationTimeout: 12345,
    })

    writeFileSync(`${paths.ticketDir}/interview.yaml`, makeInterviewYaml())
    writeFileSync(`${paths.ticketDir}/prd.yaml`, makePrdYaml({ ticketId: ticket.externalId }))
    writeFileSync(paths.beadsPath, makeBeadsYaml({ beadCount: 1 }))
    upsertLatestPhaseArtifact(
      ticket.id,
      'final_test_retry_notes',
      'RUNNING_FINAL_TEST',
      JSON.stringify({ notes: ['Prior retry note: avoid repeating the broad contrast assertion.'] }),
    )

    let capturedContextParts: Array<{ source?: string; content: string }> = []
    executeFinalTestWithRetriesMock.mockImplementationOnce(async (
      _adapter: unknown,
      contextParts: () => Promise<Array<{ source?: string; content: string }>>,
      _projectPath: string,
      _signal: AbortSignal,
      options: { timeoutMs: number; maxIterations: number; model: string },
    ) => {
      capturedContextParts = await contextParts()
      expect(options.timeoutMs).toBe(12345)
      expect(options.maxIterations).toBe(2)
      expect(options.model).toBe(TEST.implementer)

      return {
        status: 'passed' as const,
        passed: true,
        checkedAt: '2026-04-09T12:00:00.000Z',
        plannedBy: TEST.implementer,
        summary: 'verify retry state',
        testFiles: ['src/final.test.ts'],
        modifiedFiles: ['src/final.test.ts'],
        testsCount: 1,
        modelOutput: '<FINAL_TEST_COMMANDS>{"commands":["npm run test:final"]}</FINAL_TEST_COMMANDS>',
        commands: [
          {
            command: 'npm run test:final',
            exitCode: 0,
            signal: null,
            stdout: 'ok',
            stderr: '',
            durationMs: 10,
            timedOut: false,
          },
        ],
        errors: [],
        attempt: 1,
        maxIterations: 2,
        attemptHistory: [],
        retryNotes: ['Prior retry note: avoid repeating the broad contrast assertion.'],
      }
    })

    const sendEvent = vi.fn()
    await handleFinalTest(
      ticket.id,
      {
        ...context,
        lockedMainImplementer: TEST.implementer,
      },
      sendEvent,
      new AbortController().signal,
    )

    expect(recordWorktreeStartCommitMock).toHaveBeenCalled()
    expect(executeFinalTestWithRetriesMock).toHaveBeenCalledTimes(1)
    expect(
      capturedContextParts.some((part) => (
        part.source === 'final_test_note'
        && part.content.includes('Prior retry note: avoid repeating the broad contrast assertion.')
      )),
    ).toBe(true)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'TESTS_PASSED' })
  })
})
