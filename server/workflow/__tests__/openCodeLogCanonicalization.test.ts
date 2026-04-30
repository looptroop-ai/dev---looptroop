import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../sse/broadcaster', () => ({
  broadcaster: {
    broadcast: vi.fn(),
  },
}))

import * as ticketsModule from '../../storage/tickets'
import * as atomicAppendModule from '../../io/atomicAppend'

vi.spyOn(ticketsModule, 'getTicketPaths').mockReturnValue({
  executionLogPath: '/tmp/test-execution-log.jsonl',
  debugLogPath: '/tmp/test-execution-log.debug.jsonl',
  worktreePath: '/tmp/test-worktree',
  ticketDir: '/tmp/test-ticket-dir',
  executionSetupDir: '/tmp/test-ticket-dir/.ticket/runtime/execution-setup',
  executionSetupProfilePath: '/tmp/test-ticket-dir/.ticket/runtime/execution-setup-profile.json',
  baseBranch: 'main',
  beadsPath: '/tmp/test-beads.jsonl',
})

const mockAppend = vi.spyOn(atomicAppendModule, 'safeAtomicAppend').mockImplementation(() => {})

import {
  createOpenCodeStreamState,
  emitOpenCodeSessionLogs,
  emitOpenCodeStreamEvent,
} from '../phases/helpers'

function getPersistedEntries() {
  return mockAppend.mock.calls.map(([, payload]) => JSON.parse(payload))
}

function getPersistedTextEntries() {
  return getPersistedEntries().filter((entry) => entry.kind === 'text')
}

describe('OpenCode log canonicalization', () => {
  beforeEach(() => {
    mockAppend.mockClear()
  })

  it('persists a single canonical text row for a single text-part assistant response', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-1', {
      type: 'text',
      sessionId: 'ses-1',
      messageId: 'msg-1',
      partId: 'part-1',
      text: 'questions:\n  - id: Q01',
      streaming: true,
      complete: true,
    }, state)
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-1', {
      type: 'done',
      sessionId: 'ses-1',
    }, state)

    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'COUNCIL_DELIBERATING',
      'openai/gpt-5-mini',
      'ses-1',
      'draft',
      'questions:\n  - id: Q01',
      [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'questions:\n  - id: Q01',
        },
      ],
      state,
    )

    const textEntries = getPersistedTextEntries()
    expect(textEntries).toEqual([
      expect.objectContaining({
        entryId: 'ses-1:msg-1:text',
        content: 'questions:\n  - id: Q01',
        kind: 'text',
        op: 'finalize',
      }),
    ])
    expect(getPersistedEntries().some((entry) => entry.entryId === 'ses-1:transcript-summary')).toBe(false)
  })

  it('persists structured model attribution on OpenCode summary rows across stages', () => {
    const memberId = 'openai/gpt-5-mini'
    const stages = ['draft', 'vote', 'coverage', 'refine'] as const

    for (const stage of stages) {
      emitOpenCodeSessionLogs(
        '1:T-42',
        'T-42',
        'COUNCIL_DELIBERATING',
        memberId,
        `ses-${stage}`,
        stage,
        `${stage} response`,
        [
          {
            id: `msg-${stage}`,
            role: 'assistant',
            content: `${stage} response`,
          },
        ],
        createOpenCodeStreamState(),
      )
    }

    const summaryEntries = getPersistedEntries().filter((entry) =>
      typeof entry.message === 'string' && entry.message.startsWith('OpenCode '),
    )

    expect(summaryEntries).toEqual(expect.arrayContaining(
      stages.map((stage) => expect.objectContaining({
        message: `OpenCode ${stage}: ${memberId} session=ses-${stage}, messages=1, responseChars=${`${stage} response`.length}.`,
        source: 'system',
        modelId: memberId,
      })),
    ))
  })

  it('combines multiple text parts for the same assistant message into one persisted row', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'DRAFTING_PRD', 'openai/gpt-5-codex', 'ses-2', {
      type: 'text',
      sessionId: 'ses-2',
      messageId: 'msg-2',
      partId: 'part-a',
      text: 'prd:\n',
      streaming: true,
      complete: false,
    }, state)
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'DRAFTING_PRD', 'openai/gpt-5-codex', 'ses-2', {
      type: 'text',
      sessionId: 'ses-2',
      messageId: 'msg-2',
      partId: 'part-b',
      text: '  title: Canonical PRD',
      streaming: true,
      complete: true,
    }, state)
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'DRAFTING_PRD', 'openai/gpt-5-codex', 'ses-2', {
      type: 'done',
      sessionId: 'ses-2',
    }, state)

    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'DRAFTING_PRD',
      'openai/gpt-5-codex',
      'ses-2',
      'draft',
      'prd:\n  title: Canonical PRD',
      [
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'prd:\n  title: Canonical PRD',
        },
      ],
      state,
    )

    const textEntries = getPersistedTextEntries()
    expect(textEntries).toHaveLength(1)
    expect(textEntries[0]).toMatchObject({
      entryId: 'ses-2:msg-2:text',
      content: 'prd:\n  title: Canonical PRD',
      op: 'finalize',
    })
  })

  it('falls back to one raw output row when no streamed text was observed', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'SCANNING_RELEVANT_FILES',
      'openai/gpt-5-mini',
      'ses-3',
      'relevant_files_scan',
      'files:\n  - src/app.ts',
      [
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'files:\n  - src/app.ts',
        },
      ],
      state,
    )

    const textEntries = getPersistedTextEntries()
    expect(textEntries).toEqual([
      expect.objectContaining({
        entryId: 'ses-3:msg-3:text',
        content: 'files:\n  - src/app.ts',
        kind: 'text',
        op: 'append',
      }),
    ])
    expect(getPersistedEntries().some((entry) => entry.entryId === 'ses-3:transcript-summary')).toBe(false)
  })

  it('retains beadId on finalized streamed text rows', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'CODING', 'openai/gpt-5.4', 'ses-bead', {
      type: 'text',
      sessionId: 'ses-bead',
      messageId: 'msg-bead',
      partId: 'part-bead',
      text: '<BEAD_STATUS>{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}</BEAD_STATUS>',
      streaming: true,
      complete: true,
    }, state, 'bead-1')
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'CODING', 'openai/gpt-5.4', 'ses-bead', {
      type: 'done',
      sessionId: 'ses-bead',
    }, state, 'bead-1')

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-bead:msg-bead:text',
        beadId: 'bead-1',
        kind: 'text',
        op: 'finalize',
      }),
    ]))
  })

  it('retains beadId on fallback session-history rows', () => {
    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'CODING',
      'openai/gpt-5.4',
      'ses-fallback',
      'coding_main',
      '<BEAD_STATUS>{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}</BEAD_STATUS>',
      [
        {
          id: 'msg-fallback',
          role: 'assistant',
          content: '<BEAD_STATUS>{"bead_id":"bead-1","status":"done","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}</BEAD_STATUS>',
        },
      ],
      createOpenCodeStreamState(),
      'bead-1',
    )

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-fallback:msg-fallback:text',
        beadId: 'bead-1',
        kind: 'text',
        op: 'append',
      }),
    ]))
  })

  it('persists step-start rows without marking them as streaming', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-step', {
      type: 'step',
      sessionId: 'ses-step',
      partId: 'part-step-1',
      step: 'start',
      complete: false,
    }, state)

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-step:part-step-1',
        kind: 'step',
        op: 'append',
        streaming: false,
        content: 'Step started.',
      }),
    ]))
  })

  it('persists model attribution on session retry error rows', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'DRAFTING_PRD', 'opencode/minimax-m2.5-free', 'ses-retry', {
      type: 'session_status',
      sessionId: 'ses-retry',
      status: 'retry',
      attempt: 1,
      message: '<none>',
    }, state)

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-retry:retry:1',
        content: 'Session retry #1: <none>',
        kind: 'error',
        source: 'model:opencode/minimax-m2.5-free',
        modelId: 'opencode/minimax-m2.5-free',
        sessionId: 'ses-retry',
      }),
    ]))
  })

  it('persists structured provider details on session error rows without storing raw request bodies', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'DRAFTING_PRD', 'kilo/nvidia/nemotron-3-super-120b-a12b:free', 'ses-error', {
      type: 'session_error',
      sessionId: 'ses-error',
      error: 'Provider returned error',
      details: {
        error: {
          name: 'AI_APICallError',
          statusCode: 402,
          url: 'https://api.kilo.ai/api/gateway/chat/completions',
          requestBodyValues: {
            model: 'anthropic/claude-haiku-4.5',
            messages: [{ role: 'system', content: 'very large prompt body' }],
          },
          responseBody: JSON.stringify({
            error: {
              title: 'Low Credit Warning!',
              message: 'Add credits to continue, or switch to a free model',
            },
          }),
          data: {
            error: {
              type: 'ModelError',
              message: 'Add credits to continue, or switch to a free model',
            },
          },
        },
      },
    }, state)

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-error:error',
        content: 'Low Credit Warning!: Add credits to continue, or switch to a free model (HTTP 402, requestModel=anthropic/claude-haiku-4.5)',
        kind: 'error',
        source: 'model:kilo/nvidia/nemotron-3-super-120b-a12b:free',
        modelId: 'kilo/nvidia/nemotron-3-super-120b-a12b:free',
        sessionId: 'ses-error',
        data: expect.objectContaining({
          errorDetails: expect.objectContaining({
            name: 'AI_APICallError',
            statusCode: 402,
            requestModel: 'anthropic/claude-haiku-4.5',
            responseErrorType: 'ModelError',
            responseErrorTitle: 'Low Credit Warning!',
            responseErrorMessage: 'Add credits to continue, or switch to a free model',
          }),
        }),
      }),
    ]))

    const errorEntry = getPersistedEntries().find((entry) => entry.entryId === 'ses-error:error')
    expect(errorEntry?.data?.errorDetails).not.toHaveProperty('requestBodyValues')
  })

  it('persists generated OpenCode APIError details from readiness probe session errors', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'PRE_FLIGHT_CHECK', 'openai/gpt-5.3-codex', 'ses-probe', {
      type: 'session_error',
      sessionId: 'ses-probe',
      error: 'Provider request failed',
      details: {
        name: 'APIError',
        data: {
          message: 'Your authentication token has been invalidated. Please try signing in again.',
          statusCode: 401,
          isRetryable: false,
          responseBody: JSON.stringify({
            error: {
              type: 'invalid_request_error',
              code: 'token_invalidated',
              message: 'Your authentication token has been invalidated. Please try signing in again.',
            },
          }),
        },
      },
    }, state)

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        entryId: 'ses-probe:error',
        content: 'invalid_request_error: Your authentication token has been invalidated. Please try signing in again. (HTTP 401)',
        audience: 'ai',
        kind: 'error',
        source: 'model:openai/gpt-5.3-codex',
        modelId: 'openai/gpt-5.3-codex',
        sessionId: 'ses-probe',
        data: expect.objectContaining({
          errorDetails: expect.objectContaining({
            name: 'APIError',
            statusCode: 401,
            responseErrorType: 'invalid_request_error',
            responseErrorMessage: 'Your authentication token has been invalidated. Please try signing in again.',
          }),
        }),
      }),
    ]))
  })

  it('emits one canonical text row per assistant response when a session is reused', () => {
    const state = createOpenCodeStreamState()

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-4', {
      type: 'text',
      sessionId: 'ses-4',
      messageId: 'msg-4a',
      partId: 'part-4a',
      text: 'first response',
      streaming: true,
      complete: true,
    }, state)
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-4', {
      type: 'done',
      sessionId: 'ses-4',
    }, state)
    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'COUNCIL_DELIBERATING',
      'openai/gpt-5-mini',
      'ses-4',
      'draft',
      'first response',
      [
        {
          id: 'msg-4a',
          role: 'assistant',
          content: 'first response',
        },
      ],
      state,
    )

    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-4', {
      type: 'text',
      sessionId: 'ses-4',
      messageId: 'msg-4b',
      partId: 'part-4b',
      text: 'second response',
      streaming: true,
      complete: true,
    }, state)
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'COUNCIL_DELIBERATING', 'openai/gpt-5-mini', 'ses-4', {
      type: 'done',
      sessionId: 'ses-4',
    }, state)
    emitOpenCodeSessionLogs(
      '1:T-42',
      'T-42',
      'COUNCIL_DELIBERATING',
      'openai/gpt-5-mini',
      'ses-4',
      'draft',
      'second response',
      [
        {
          id: 'msg-4a',
          role: 'assistant',
          content: 'first response',
        },
        {
          id: 'user-4',
          role: 'user',
          content: 'Please continue.',
        },
        {
          id: 'msg-4b',
          role: 'assistant',
          content: 'second response',
        },
      ],
      state,
    )

    const textEntries = getPersistedTextEntries()
    expect(textEntries).toHaveLength(2)
    expect(textEntries.map((entry) => entry.entryId)).toEqual([
      'ses-4:msg-4a:text',
      'ses-4:msg-4b:text',
    ])
    expect(textEntries.map((entry) => entry.content)).toEqual([
      'first response',
      'second response',
    ])
    expect(getPersistedEntries().some((entry) => String(entry.entryId).includes('transcript-summary'))).toBe(false)
  })

  it('persists OpenCode tool input, output, and error details as model-attributed AI rows', () => {
    emitOpenCodeStreamEvent('1:T-42', 'T-42', 'CODING', 'openai/gpt-5.4', 'ses-tool', {
      type: 'tool',
      sessionId: 'ses-tool',
      messageId: 'msg-tool',
      partId: 'part-tool',
      tool: 'bash',
      callId: 'call-1',
      status: 'error',
      title: 'Run tests',
      input: {
        command: 'npm test -- --runInBand',
        cwd: '/tmp/worktree',
      },
      output: 'stdout line',
      error: 'stderr line',
      complete: true,
    }, createOpenCodeStreamState(), 'bead-1')

    expect(getPersistedEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'ses-tool:part-tool',
        source: 'model:openai/gpt-5.4',
        modelId: 'openai/gpt-5.4',
        beadId: 'bead-1',
        kind: 'tool',
        content: expect.stringContaining('[TOOL] bash error: Run tests'),
      }),
    ]))

    const toolEntry = getPersistedEntries().find((entry) => entry.entryId === 'ses-tool:part-tool')
    expect(toolEntry?.content).toContain('Input:')
    expect(toolEntry?.content).toContain('"command": "npm test -- --runInBand"')
    expect(toolEntry?.content).toContain('Output:\nstdout line')
    expect(toolEntry?.content).toContain('Error:\nstderr line')
  })
})
