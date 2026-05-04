import { createElement, useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLogLine, LOG_STORAGE_PREFIX, mergeEntry, serverLogCache, SERVER_LOG_REFRESH_EVENT, type LogEntry } from '@/context/logUtils'
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

function getCodingLogs() {
  return latestLogApi?.getLogsForPhase('CODING') ?? []
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
    localStorage.clear()
    serverLogCache.clear()
    vi.restoreAllMocks()
  })

  it('fetches only the visible status on mount and phase changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([]))

    const { rerender } = render(createElement(
      LogProvider,
      {
        ticketId: '1:T-scope',
        currentStatus: 'CODING',
        visiblePhase: 'CODING',
        children: createElement(LogHarness),
      },
    ))

    await flushMicrotasks()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/files/1:T-scope/logs?status=CODING')

    rerender(createElement(
      LogProvider,
      {
        ticketId: '1:T-scope',
        currentStatus: 'CODING',
        visiblePhase: 'DRAFTING_PRD',
        children: createElement(LogHarness),
      },
    ))

    await flushMicrotasks()
    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/files/1:T-scope/logs?status=DRAFTING_PRD')
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).not.toContain('/api/files/1:T-scope/logs')
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => !String(url).includes('tail='))).toBe(true)
  })

  it('requests phase debug logs through the debug channel only when asked', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([]))

    render(createElement(
      LogProvider,
      {
        ticketId: '1:T-debug-phase',
        currentStatus: 'CODING',
        children: createElement(LogHarness),
      },
    ))

    await flushMicrotasks()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/files/1:T-debug-phase/logs?status=CODING')

    await act(async () => {
      latestLogApi?.loadLogsForPhase?.('CODING', { channel: 'debug' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/files/1:T-debug-phase/logs?status=CODING&channel=debug')
  })

  it('requests phase AI detail logs through the AI channel and merges them into the phase bucket', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => createJsonResponse([]))
      .mockImplementationOnce(() => createJsonResponse([{
        type: 'model_output',
        phase: 'CODING',
        status: 'CODING',
        source: 'model:openai/gpt-5.4',
        audience: 'ai',
        kind: 'reasoning',
        content: 'Restored thinking row.',
        entryId: 'session-1:thinking',
        op: 'upsert',
        streaming: true,
        timestamp: '2026-03-13T10:00:03.000Z',
      }]))

    render(createElement(
      LogProvider,
      {
        ticketId: '1:T-ai-phase',
        currentStatus: 'CODING',
        children: createElement(LogHarness),
      },
    ))

    await flushMicrotasks()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/files/1:T-ai-phase/logs?status=CODING')

    await act(async () => {
      latestLogApi?.loadLogsForPhase?.('CODING', { channel: 'ai' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/files/1:T-ai-phase/logs?status=CODING&channel=ai')
    expect(getCodingLogs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryId: 'session-1:thinking',
        audience: 'ai',
        streaming: true,
        line: 'Restored thinking row.',
      }),
    ]))
  })

  it('ignores debug rows from normal server fetches but keeps live debug rows', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([{
      type: 'info',
      phase: 'CODING',
      status: 'CODING',
      source: 'system',
      content: 'Normal server row.',
      entryId: 'normal-row',
      timestamp: '2026-03-13T10:00:01.000Z',
    }, {
      type: 'debug',
      phase: 'CODING',
      status: 'CODING',
      source: 'debug',
      content: 'Legacy mixed debug row.',
      entryId: 'legacy-debug-row',
      timestamp: '2026-03-13T10:00:02.000Z',
    }]))

    try {
      render(createElement(
        LogProvider,
        {
          ticketId: '1:T-debug-filter',
          currentStatus: 'CODING',
          children: createElement(LogHarness),
        },
      ))

      await flushMicrotasks()
      expect(screen.getByTestId('log-count')).toHaveTextContent('1')

      await act(async () => {
        latestLogApi?.addLog('CODING', '[DEBUG] live state_change payload', {
          source: 'debug',
          audience: 'debug',
          kind: 'session',
          entryId: 'live-debug-row',
          timestamp: '2026-03-13T10:00:03.000Z',
        })
        await vi.advanceTimersByTimeAsync(250)
      })

      expect(screen.getByTestId('log-count')).toHaveTextContent('2')
      const stored = JSON.parse(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-debug-filter-CODING`) ?? '[]') as LogEntry[]
      expect(stored.map((entry) => entry.entryId)).toEqual(['normal-row'])
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('renders live SSE log records immediately while delaying localStorage persistence', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([]))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    try {
      render(createElement(
        LogProvider,
        {
          ticketId: '1:T-live-immediate',
          currentStatus: 'CODING',
          children: createElement(LogHarness),
        },
      ))

      await flushMicrotasks()
      localStorage.clear()
      setItemSpy.mockClear()

      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'info',
          phase: 'CODING',
          status: 'CODING',
          source: 'system',
          audience: 'all',
          kind: 'milestone',
          content: 'Live row arrived.',
          entryId: 'log:live-row',
          op: 'append',
          streaming: false,
          timestamp: '2026-03-13T10:00:03.000Z',
        })
      })

      expect(screen.getByTestId('log-count')).toHaveTextContent('2')
      expect(getCodingLogs().map((entry) => entry.entryId)).toContain('log:live-row')
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-live-immediate-CODING`)).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      const stored = JSON.parse(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-live-immediate-CODING`) ?? '[]') as LogEntry[]
      expect(stored.map((entry) => entry.entryId)).toContain('log:live-row')
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('caches streaming AI updates locally and replaces them when a final row arrives', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([]))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    try {
      render(createElement(
        LogProvider,
        {
          ticketId: '1:T-streaming',
          currentStatus: 'CODING',
          children: createElement(LogHarness),
        },
      ))

      await flushMicrotasks()
      localStorage.clear()
      setItemSpy.mockClear()

      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'model_output',
          phase: 'CODING',
          status: 'CODING',
          source: 'model:openai/gpt-5-mini',
          audience: 'ai',
          kind: 'text',
          content: 'partial response',
          entryId: 'session-1:message-1:text',
          op: 'upsert',
          streaming: true,
          timestamp: '2026-03-13T10:00:03.000Z',
        })
      })

      expect(screen.getByTestId('log-count')).toHaveTextContent('2')
      expect(getCodingLogs().find((entry) => entry.entryId === 'session-1:message-1:text')?.line).toContain('partial response')
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-streaming-CODING`)).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      const storedPartial = JSON.parse(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-streaming-CODING`) ?? '[]') as LogEntry[]
      expect(storedPartial).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entryId: 'session-1:message-1:text',
          streaming: true,
          op: 'upsert',
          line: expect.stringContaining('partial response'),
        }),
      ]))
      setItemSpy.mockClear()

      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'model_output',
          phase: 'CODING',
          status: 'CODING',
          source: 'model:openai/gpt-5-mini',
          audience: 'ai',
          kind: 'text',
          content: 'partial response extended',
          entryId: 'session-1:message-1:text',
          op: 'upsert',
          streaming: true,
          timestamp: '2026-03-13T10:00:03.250Z',
        })
      })

      const streamingRows = getCodingLogs().filter((entry) => entry.entryId === 'session-1:message-1:text')
      expect(screen.getByTestId('log-count')).toHaveTextContent('2')
      expect(streamingRows).toHaveLength(1)
      expect(streamingRows[0]?.line).toContain('partial response extended')
      expect(setItemSpy).not.toHaveBeenCalled()

      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'model_output',
          phase: 'CODING',
          status: 'CODING',
          source: 'model:openai/gpt-5-mini',
          audience: 'ai',
          kind: 'text',
          content: 'final response',
          entryId: 'session-1:message-1:text',
          op: 'finalize',
          streaming: false,
          timestamp: '2026-03-13T10:00:04.000Z',
        })
        await vi.advanceTimersByTimeAsync(500)
      })

      const stored = JSON.parse(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-streaming-CODING`) ?? '[]') as LogEntry[]
      const finalizedRows = getCodingLogs().filter((entry) => entry.entryId === 'session-1:message-1:text')
      expect(finalizedRows).toHaveLength(1)
      expect(finalizedRows[0]?.line).toContain('final response')
      expect(finalizedRows[0]?.streaming).toBe(false)
      expect(stored).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entryId: 'session-1:message-1:text',
          streaming: false,
          op: 'finalize',
        }),
      ]))
      expect(stored.some((entry) => entry.streaming || entry.op === 'upsert')).toBe(false)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('flushes pending streaming cache entries when the provider unmounts', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => createJsonResponse([]))

    try {
      const rendered = render(createElement(
        LogProvider,
        {
          ticketId: '1:T-close-cache',
          currentStatus: 'CODING',
          children: createElement(LogHarness),
        },
      ))

      await flushMicrotasks()
      localStorage.clear()

      await act(async () => {
        latestLogApi?.addLogRecord('CODING', {
          type: 'model_output',
          phase: 'CODING',
          status: 'CODING',
          source: 'model:openai/gpt-5-mini',
          audience: 'ai',
          kind: 'text',
          content: 'partial response before close',
          entryId: 'session-close:message-1:text',
          op: 'upsert',
          streaming: true,
          timestamp: '2026-03-13T10:00:03.000Z',
        })
      })

      expect(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-close-cache-CODING`)).toBeNull()

      rendered.unmount()

      const stored = JSON.parse(localStorage.getItem(`${LOG_STORAGE_PREFIX}1:T-close-cache-CODING`) ?? '[]') as LogEntry[]
      expect(stored).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entryId: 'session-close:message-1:text',
          streaming: true,
          op: 'upsert',
          line: expect.stringContaining('partial response before close'),
        }),
      ]))
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
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

  it('remerges server logs when a stream recovery refresh event arrives', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => createJsonResponse([{
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        source: 'system',
        content: 'Initial log.',
        entryId: 'log:initial',
        timestamp: '2026-03-13T10:00:01.000Z',
      }]))
      .mockImplementationOnce(() => createJsonResponse([{
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        source: 'system',
        content: 'Initial log.',
        entryId: 'log:initial',
        timestamp: '2026-03-13T10:00:01.000Z',
      }, {
        type: 'info',
        phase: 'CODING',
        status: 'CODING',
        source: 'system',
        content: 'Recovered log.',
        entryId: 'log:recovered',
        timestamp: '2026-03-13T10:00:02.000Z',
      }]))

    render(createElement(
      LogProvider,
      {
        ticketId: '1:T-99',
        currentStatus: 'CODING',
        children: createElement(LogHarness),
      },
    ))

    await flushMicrotasks()
    expect(screen.getByTestId('log-count')).toHaveTextContent('1')

    await act(async () => {
      window.dispatchEvent(new CustomEvent(SERVER_LOG_REFRESH_EVENT, { detail: { ticketId: '1:T-99' } }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('log-count')).toHaveTextContent('2')
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
