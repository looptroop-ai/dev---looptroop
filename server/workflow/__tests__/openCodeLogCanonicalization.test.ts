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
  worktreePath: '/tmp/test-worktree',
  ticketDir: '/tmp/test-ticket-dir',
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
})
