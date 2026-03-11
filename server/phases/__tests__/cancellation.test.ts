import { describe, expect, it } from 'vitest'
import { MockOpenCodeAdapter } from '../../opencode/adapter'
import { CancelledError } from '../../council/types'
import { executeBead } from '../execution/executor'
import { generateFinalTests } from '../finalTest/generator'
import { startInterviewSession } from '../interview/qa'
import type { Bead } from '../beads/types'
import type { PromptPart, PromptSessionOptions } from '../../opencode/types'

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

class BlockingPromptAdapter extends MockOpenCodeAdapter {
  override async promptSession(
    _sessionId: string,
    _parts: PromptPart[],
    signal?: AbortSignal,
    _options?: PromptSessionOptions,
  ): Promise<string> {
    return await new Promise((_, reject) => {
      const rejectAborted = () => reject(createAbortError())
      if (signal?.aborted) {
        rejectAborted()
        return
      }
      signal?.addEventListener('abort', rejectAborted, { once: true })
    })
  }
}

const bead: Bead = {
  id: 'b1',
  title: 'Blocking bead',
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
}

describe('phase cancellation', () => {
  it('throws CancelledError instead of swallowing cancel during bead execution', async () => {
    const adapter = new BlockingPromptAdapter()
    const controller = new AbortController()

    const execution = executeBead(
      adapter,
      bead,
      [{ type: 'text', content: 'context' }],
      '/tmp/project',
      1,
      60000,
      controller.signal,
    )

    controller.abort()

    await expect(execution).rejects.toBeInstanceOf(CancelledError)
  })

  it('throws CancelledError during final test generation', async () => {
    const adapter = new BlockingPromptAdapter()
    const controller = new AbortController()

    const generation = generateFinalTests(
      adapter,
      [{ type: 'text', content: 'ticket context' }],
      '/tmp/project',
      controller.signal,
    )

    controller.abort()

    await expect(generation).rejects.toBeInstanceOf(CancelledError)
  })

  it('throws CancelledError while starting the interview QA session', async () => {
    const adapter = new BlockingPromptAdapter()
    const controller = new AbortController()

    const sessionStart = startInterviewSession(
      adapter,
      '/tmp/project',
      'mock-model-1',
      'questions: []',
      {
        ticketId: 'TEST-1',
        title: 'Interview',
      },
      3,
      controller.signal,
    )

    controller.abort()

    await expect(sessionStart).rejects.toBeInstanceOf(CancelledError)
  })
})
