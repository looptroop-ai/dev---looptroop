import { createElement, useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLogLine, mergeEntry, type LogEntry } from '@/context/logUtils'
import { LogProvider } from '@/context/LogContext'
import { useLogs } from '@/context/useLogContext'
import { createJsonResponse } from '@/test/renderHelpers'

let latestLogApi: ReturnType<typeof useLogs> = null

function LogHarness() {
  const logApi = useLogs()
  const logs = logApi?.getLogsForPhase('CODING') ?? []

  useEffect(() => {
    latestLogApi = logApi
  }, [logApi])

  return createElement('div', { 'data-testid': 'log-count' }, logs.length)
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('formatLogLine', () => {
  it('keeps reasoning content unprefixed so the UI can render THINKING tags', () => {
    expect(formatLogLine({
      type: 'model_output',
      kind: 'reasoning',
      content: '**Planning phased question strategy**',
      source: 'model:openai/gpt-5.1-codex',
      audience: 'ai',
    }).line).toBe('**Planning phased question strategy**')
  })

  it('continues to prefix non-reasoning model output with MODEL tags', () => {
    expect(formatLogLine({
      type: 'model_output',
      kind: 'text',
      content: 'phase: discovery',
      source: 'model:openai/gpt-5.1-codex',
      audience: 'ai',
    }).line).toBe('[MODEL] phase: discovery')
  })
})

describe('LogProvider', () => {
  afterEach(() => {
    latestLogApi = null
    vi.restoreAllMocks()
  })

  it('dedupes SSE-delivered logs against the initial server fetch', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => createJsonResponse([{
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        source: 'system',
        content: 'Polling caught up.',
        entryId: 'log:polling-sync',
        timestamp: '2026-03-13T10:00:01.000Z',
      }]))

    try {
      render(createElement(
        LogProvider,
        {
          ticketId: '1:T-42',
          currentStatus: 'CODING',
          children: createElement(LogHarness),
        },
      ))

      await flushMicrotasks()
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)

      // Simulate SSE delivering the same log entry — should be deduped
      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'info',
          phase: 'CODING',
          status: 'CODING',
          source: 'system',
          content: 'Polling caught up.',
          entryId: 'log:polling-sync',
          timestamp: '2026-03-13T10:00:00.000Z',
        })
        await vi.advanceTimersByTimeAsync(250)
      })

      expect(screen.getByTestId('log-count')).toHaveTextContent('1')

      // Verify no additional fetches happen (polling removed)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

describe('mergeEntry', () => {
  it('stops streaming when a terminal fallback append arrives for an AI text row', () => {
    const streamingUpsert: LogEntry = {
      id: 'ses-1:msg-1:text',
      entryId: 'ses-1:msg-1:text',
      line: '[MODEL] artifact: interview',
      source: 'model:openai/gpt-5-mini',
      status: 'DRAFTING_PRD',
      timestamp: '2026-03-13T10:00:00.000Z',
      audience: 'ai',
      kind: 'text',
      modelId: 'openai/gpt-5-mini',
      sessionId: 'ses-1',
      streaming: true,
      op: 'upsert',
    }
    const fallbackAppend: LogEntry = {
      ...streamingUpsert,
      timestamp: '2026-03-13T10:00:01.000Z',
      streaming: false,
      op: 'append',
    }

    const merged = mergeEntry([streamingUpsert], fallbackAppend)

    expect(merged).toEqual([
      expect.objectContaining({
        entryId: 'ses-1:msg-1:text',
        op: 'append',
        streaming: false,
        timestamp: '2026-03-13T10:00:01.000Z',
      }),
    ])
  })

  it('dedupes repeated low-value git probe entries with near-identical timestamps', () => {
    const first: LogEntry = {
      id: 'draft:system:2026-03-13T10:00:00.000Z:[CMD] $ git rev-parse --abbrev-ref HEAD  →  master',
      entryId: 'draft:system:2026-03-13T10:00:00.000Z:[CMD] $ git rev-parse --abbrev-ref HEAD  →  master',
      line: '[CMD] $ git rev-parse --abbrev-ref HEAD  →  master',
      source: 'system',
      status: 'DRAFT',
      timestamp: '2026-03-13T10:00:00.000Z',
      audience: 'all',
      kind: 'milestone',
      streaming: false,
      op: 'append',
    }
    const duplicate: LogEntry = {
      ...first,
      id: 'draft:system:2026-03-13T10:00:00.900Z:[CMD] $ git rev-parse --abbrev-ref HEAD  →  master',
      entryId: 'draft:system:2026-03-13T10:00:00.900Z:[CMD] $ git rev-parse --abbrev-ref HEAD  →  master',
      timestamp: '2026-03-13T10:00:00.900Z',
    }

    const merged = mergeEntry([first], duplicate)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(first)
  })

  it('dedupes append entries with matching fingerprints', () => {
    const first: LogEntry = {
      id: 'entry-1',
      entryId: 'session-1:question:req-1:replied',
      fingerprint: 'opencode-question:session-1:req-1:replied',
      line: '[QUESTION] AI question answered.',
      source: 'model:openai/gpt-5-mini',
      status: 'CODING',
      timestamp: '2026-04-20T10:00:00.000Z',
      audience: 'ai',
      kind: 'session',
      streaming: false,
      op: 'append',
    }
    const duplicate: LogEntry = {
      ...first,
      id: 'entry-2',
      entryId: 'different-entry-id',
      timestamp: '2026-04-20T10:00:01.000Z',
    }

    const merged = mergeEntry([first], duplicate)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(first)
  })
})
