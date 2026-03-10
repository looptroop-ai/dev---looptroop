import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PhaseLogPanel } from '../PhaseLogPanel'
import type { LogEntry } from '@/context/LogContext'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: () => undefined,
  })

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
})

describe('PhaseLogPanel', () => {
  it('shows important AI summary lines in ALL while keeping generic AI details in the AI tab', () => {
    const logs: LogEntry[] = [
      {
        id: 'sys-1',
        entryId: 'sys-1',
        line: '[SYS] Interview council drafting started.',
        source: 'system',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:00.000Z',
        audience: 'all',
        kind: 'milestone',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-1',
        entryId: 'ai-1',
        line: '[MODEL] Questions received from openai/gpt-5-mini (2 total):\n- [foundation] What problem are we solving?\n- [structure] Which users should be supported first?',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-mini',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-2',
        entryId: 'ai-2',
        line: '[MODEL] Session status: running.',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.500Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5-mini',
        streaming: false,
        op: 'append',
      },
      {
        id: 'debug-1',
        entryId: 'debug-1',
        line: '[DEBUG] raw provider payload',
        source: 'debug',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:02.000Z',
        audience: 'debug',
        kind: 'session',
        streaming: false,
        op: 'append',
      },
    ]

    render(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

    expect(screen.getByText(/Interview council drafting started/i)).toBeInTheDocument()
    expect(screen.getByText(/Questions received from openai\/gpt-5-mini/i)).toBeInTheDocument()
    expect(screen.queryByText(/Session status: running/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/raw provider payload/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/Session status: running/i)).toBeInTheDocument()
    expect(screen.getByText(/Questions received from openai\/gpt-5-mini/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DEBUG' }))

    expect(screen.getByText(/raw provider payload/i)).toBeInTheDocument()
  })
})
