import { createElement, useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLogLine, LogProvider, useLogs } from '@/context/LogContext'

let latestLogApi: ReturnType<typeof useLogs> = null

function createJsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

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

  it('dedupes a live append log when polling returns the same entry id with a newer timestamp', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => createJsonResponse([]))
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await flushMicrotasks()

      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('log-count')).toHaveTextContent('1')
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
