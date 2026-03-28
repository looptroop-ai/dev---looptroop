import type { ReactNode, Ref } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@/context/LogContext'

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({
    children,
    viewportRef,
    className,
  }: {
    children: ReactNode
    viewportRef?: Ref<HTMLDivElement>
    className?: string
  }) => (
    <div className={className}>
      <div ref={viewportRef} data-testid="log-viewport">
        {children}
      </div>
    </div>
  ),
}))

import { PhaseLogPanel } from '../PhaseLogPanel'

const animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1
const scrollToMock = vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
  if (typeof options === 'object' && options && typeof options.top === 'number') {
    this.scrollTop = options.top
  }
})

function flushAnimationFrames() {
  act(() => {
    while (animationFrames.size > 0) {
      const pending = Array.from(animationFrames.entries())
      animationFrames.clear()
      for (const [, callback] of pending) {
        callback(0)
      }
    }
  })
}

function makeLog(id: string, line: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    entryId: id,
    line,
    source: 'system',
    status: 'CODING',
    timestamp: '2026-03-10T10:00:00.000Z',
    audience: 'all',
    kind: 'milestone',
    streaming: false,
    op: 'append',
    ...overrides,
  }
}

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    },
  })

  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (id: number) => {
      animationFrames.delete(id)
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return Number((this as HTMLElement).dataset.scrollHeight ?? 600)
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return Number((this as HTMLElement).dataset.clientHeight ?? 200)
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return Number((this as HTMLElement).dataset.scrollTop ?? 0)
    },
    set(value: number) {
      ;(this as HTMLElement).dataset.scrollTop = String(value)
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollToMock,
  })

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
})

beforeEach(() => {
  animationFrames.clear()
  nextAnimationFrameId = 1
  scrollToMock.mockClear()
})

describe('PhaseLogPanel', () => {
  it('shows canonical raw AI output in ALL while suppressing transcript and summary duplicates', () => {
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
        entryId: 'ses-1:msg-1:text',
        line: '[MODEL] questions:\n  - id: Q01\n    phase: foundation\n    question: "Confidence in timing?"',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-2',
        entryId: 'ses-1:transcript-summary',
        line: '[MODEL] [assistant] [2026-03-10T10:00:01.000Z] questions:\n  - id: Q01\n    phase: foundation\n    question: "Confidence in timing?"',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.100Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-3',
        entryId: 'ses-1:questions-preview',
        line: '[MODEL] Questions received from openai/gpt-5-mini (1 total):\n- [foundation] Timing confidence first?',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.200Z',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-4',
        entryId: 'ses-1:status',
        line: '[MODEL] Session status: running.',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.500Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
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
    expect(screen.getAllByText(/Confidence in timing\?/i)).toHaveLength(1)
    expect(screen.queryByText(/\[assistant\]/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Questions received from openai\/gpt-5-mini/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Session status: running/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/raw provider payload/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/Session status: running/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Confidence in timing\?/i)).toHaveLength(1)
    expect(screen.queryByText(/\[assistant\]/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Questions received from openai\/gpt-5-mini/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DEBUG' }))

    expect(screen.getByText(/raw provider payload/i)).toBeInTheDocument()
  })

  it('keeps AI error rows visible when legacy summary entry ids are reused for failures', () => {
    const logs: LogEntry[] = [
      {
        id: 'ai-text',
        entryId: 'ses-9:msg-1:text',
        line: '[MODEL] prd:\n  title: Canonical PRD',
        source: 'model:openai/gpt-5-codex',
        status: 'DRAFTING_PRD',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-codex',
        sessionId: 'ses-9',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-error',
        entryId: 'prd-full-answers-summary:openai/gpt-5-codex',
        line: '[ERROR] openai/gpt-5-codex failed to produce Full Answers.',
        source: 'model:openai/gpt-5-codex',
        status: 'DRAFTING_PRD',
        timestamp: '2026-03-10T10:00:02.000Z',
        audience: 'ai',
        kind: 'error',
        modelId: 'openai/gpt-5-codex',
        streaming: false,
        op: 'append',
      },
    ]

    render(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

    expect(screen.getByText(/Canonical PRD/i)).toBeInTheDocument()
    expect(screen.getByText(/failed to produce Full Answers/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/Canonical PRD/i)).toBeInTheDocument()
    expect(screen.getByText(/failed to produce Full Answers/i)).toBeInTheDocument()
  })

  it('shows model-aware MODEL and THINKING tags in aggregated log tabs', () => {
    const logs: LogEntry[] = [
      {
        id: 'ai-summary',
        entryId: 'ai-summary',
        line: '[MODEL] Questions received from openai/gpt-5-codex (2 total):\n- [foundation] What problem are we solving?\n- [structure] Which users should be supported first?',
        source: 'model:openai/gpt-5-codex',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5-codex',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-status',
        entryId: 'ai-status',
        line: '[MODEL] Session status: running.',
        source: 'model:openai/gpt-5-codex',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.500Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5-codex',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-thinking',
        entryId: 'ai-thinking',
        line: 'Checking whether the interview coverage is balanced.',
        source: 'model:openai/gpt-5-codex',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:02.000Z',
        audience: 'ai',
        kind: 'reasoning',
        modelId: 'openai/gpt-5-codex',
        streaming: false,
        op: 'append',
      },
    ]

    render(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

    expect(screen.getByText(/\[MODEL-gpt-5-codex\]/i)).toBeInTheDocument()
    expect(screen.queryByText(/\[THINKING-gpt-5-codex\]/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getAllByText(/\[MODEL-gpt-5-codex\]/i)).toHaveLength(2)
    expect(screen.getByText(/\[THINKING-gpt-5-codex\]/i)).toBeInTheDocument()
    expect(screen.getByText(/Checking whether the interview coverage is balanced/i)).toBeInTheDocument()
  })

  it('shows prompt entries in ALL and AI while keeping generic AI session details AI-only', () => {
    const logs: LogEntry[] = [
      {
        id: 'prompt-1',
        entryId: 'prompt-1',
        line: '[PROMPT] openai/gpt-5-mini prompt #1\n## System Role\nYou are an expert product manager.',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:00.000Z',
        audience: 'ai',
        kind: 'prompt',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
        streaming: false,
        op: 'append',
      },
      {
        id: 'session-1',
        entryId: 'session-1',
        line: '[MODEL] Session status: running.',
        source: 'model:openai/gpt-5-mini',
        status: 'COUNCIL_DELIBERATING',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5-mini',
        sessionId: 'ses-1',
        streaming: false,
        op: 'append',
      },
    ]

    render(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

    expect(screen.getByText(/openai\/gpt-5-mini prompt #1/i)).toBeInTheDocument()
    expect(screen.getByText(/You are an expert product manager/i)).toBeInTheDocument()
    expect(screen.queryByText(/Session status: running/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/openai\/gpt-5-mini prompt #1/i)).toBeInTheDocument()
    expect(screen.getByText(/Session status: running/i)).toBeInTheDocument()
  })

  it('shows Drafting PRD part 1 output in ALL once the final response is received', () => {
    const systemLog = makeLog('sys-1', '[SYS] PRD drafting started.', {
      status: 'DRAFTING_PRD',
      timestamp: '2026-03-10T10:00:00.000Z',
    })
    const streamingAiLog: LogEntry = {
      id: 'ses-7:msg-1:text',
      entryId: 'ses-7:msg-1:text',
      line: '[MODEL] prd:\n  title: Final PRD Title',
      source: 'model:openai/gpt-5-codex',
      status: 'DRAFTING_PRD',
      timestamp: '2026-03-10T10:00:01.000Z',
      audience: 'ai',
      kind: 'text',
      modelId: 'openai/gpt-5-codex',
      sessionId: 'ses-7',
      streaming: true,
      op: 'upsert',
    }
    const appendReceivedAiLog: LogEntry = {
      ...streamingAiLog,
      timestamp: '2026-03-10T10:00:01.500Z',
      op: 'append',
    }
    const finalizedAiLog: LogEntry = {
      ...streamingAiLog,
      streaming: false,
      op: 'finalize',
      timestamp: '2026-03-10T10:00:02.000Z',
    }

    const { rerender } = render(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, streamingAiLog]} />)

    expect(screen.getByText(/PRD drafting started/i)).toBeInTheDocument()
    expect(screen.queryByText(/Final PRD Title/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))

    expect(screen.queryByText(/Final PRD Title/i)).not.toBeInTheDocument()

    rerender(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, appendReceivedAiLog]} />)

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()

    rerender(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, finalizedAiLog]} />)

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()
  })

  it('pins the viewport to the latest logs by default and follows new visible entries', () => {
    const firstLog = makeLog('log-1', '[SYS] First visible log line')
    const secondLog = makeLog('log-2', '[SYS] Second visible log line', {
      timestamp: '2026-03-10T10:00:01.000Z',
    })

    const { rerender } = render(<PhaseLogPanel phase="CODING" logs={[firstLog]} />)

    flushAnimationFrames()

    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 600, behavior: 'auto' })

    scrollToMock.mockClear()

    rerender(<PhaseLogPanel phase="CODING" logs={[firstLog, secondLog]} />)

    flushAnimationFrames()

    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 600, behavior: 'smooth' })
  })

  it('jumps straight to the latest visible entry when logs arrive after an empty initial render', () => {
    const firstLog = makeLog('log-1', '[SYS] First visible log line')
    const secondLog = makeLog('log-2', '[SYS] Second visible log line', {
      timestamp: '2026-03-10T10:00:01.000Z',
    })

    const { rerender } = render(<PhaseLogPanel phase="CODING" logs={[]} />)

    flushAnimationFrames()
    scrollToMock.mockClear()

    rerender(<PhaseLogPanel phase="CODING" logs={[firstLog, secondLog]} />)

    flushAnimationFrames()

    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 600, behavior: 'auto' })
  })

  it('stops auto-scroll after the user scrolls away and resumes once they return to the bottom', () => {
    const firstLog = makeLog('log-1', '[SYS] First visible log line')
    const secondLog = makeLog('log-2', '[SYS] Second visible log line', {
      timestamp: '2026-03-10T10:00:01.000Z',
    })
    const thirdLog = makeLog('log-3', '[SYS] Third visible log line', {
      timestamp: '2026-03-10T10:00:02.000Z',
    })

    const { rerender } = render(<PhaseLogPanel phase="CODING" logs={[firstLog]} />)

    flushAnimationFrames()
    scrollToMock.mockClear()

    const viewport = screen.getByTestId('log-viewport')
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)

    rerender(<PhaseLogPanel phase="CODING" logs={[firstLog, secondLog]} />)

    flushAnimationFrames()

    expect(scrollToMock).not.toHaveBeenCalled()

    viewport.scrollTop = 360
    fireEvent.scroll(viewport)

    rerender(<PhaseLogPanel phase="CODING" logs={[firstLog, secondLog, thirdLog]} />)

    flushAnimationFrames()

    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 600, behavior: 'smooth' })
  })
})
