import type { ReactNode, Ref } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@/context/LogContext'
import { TooltipProvider } from '@/components/ui/tooltip'

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
const writeTextMock = vi.fn(() => Promise.resolve())
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

function renderWithTooltipProvider(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
  })
}

beforeAll(() => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: writeTextMock,
    },
  })

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
})

beforeEach(() => {
  animationFrames.clear()
  nextAnimationFrameId = 1
  scrollToMock.mockClear()
  writeTextMock.mockClear()
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

    renderWithTooltipProvider(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

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

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

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

    renderWithTooltipProvider(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

    expect(screen.getByText(/\[MODEL-gpt-5-codex\]/i)).toBeInTheDocument()
    expect(screen.queryByText(/\[THINKING-gpt-5-codex\]/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getAllByText(/\[MODEL-gpt-5-codex\]/i)).toHaveLength(2)
    expect(screen.getByText(/\[THINKING-gpt-5-codex\]/i)).toBeInTheDocument()
    expect(screen.getByText(/Checking whether the interview coverage is balanced/i)).toBeInTheDocument()
  })

  it('shows model-aware ERROR tags anywhere an AI error row is visible', () => {
    const logs: LogEntry[] = [
      {
        id: 'ai-error',
        entryId: 'ses-retry:retry:1',
        line: '[ERROR] Session retry #1: <none>',
        source: 'model:opencode/minimax-m2.5-free',
        status: 'DRAFTING_PRD',
        timestamp: '2026-04-07T07:30:44.719Z',
        audience: 'ai',
        kind: 'error',
        modelId: 'opencode/minimax-m2.5-free',
        sessionId: 'ses-retry',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

    const errorTag = screen.getByText(/\[ERROR-minimax-m2.5-free\]/i)
    expect(errorTag).toBeInTheDocument()
    expect(errorTag).toHaveAttribute('title', 'opencode/minimax-m2.5-free')

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getByText(/\[ERROR-minimax-m2.5-free\]/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ERROR' }))
    expect(screen.getByText(/\[ERROR-minimax-m2.5-free\]/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Show models'))
    fireEvent.click(screen.getByRole('button', { name: /minimax-m2\.5-free/i }))
    expect(screen.getByText(/\[ERROR-minimax-m2.5-free\]/i)).toBeInTheDocument()
  })

  it('keeps plain ERROR tags for rows without model attribution', () => {
    const logs: LogEntry[] = [
      {
        id: 'plain-error',
        entryId: 'plain-error',
        line: '[ERROR] Something failed before model attribution was available.',
        source: 'error',
        status: 'DRAFTING_PRD',
        timestamp: '2026-04-07T07:30:44.719Z',
        audience: 'all',
        kind: 'error',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

    expect(screen.getByText('[ERROR]')).toBeInTheDocument()
    expect(screen.queryByText(/\[ERROR-/i)).not.toBeInTheDocument()
  })

  it('includes the full model id when copying a single AI error row', () => {
    const logs: LogEntry[] = [
      {
        id: 'ai-error',
        entryId: 'ses-retry:retry:1',
        line: '[ERROR] Session retry #1: <none>',
        source: 'model:opencode/minimax-m2.5-free',
        status: 'DRAFTING_PRD',
        timestamp: '2026-04-07T07:30:44.719Z',
        audience: 'ai',
        kind: 'error',
        modelId: 'opencode/minimax-m2.5-free',
        sessionId: 'ses-retry',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

    fireEvent.click(screen.getByTitle('Copy log entry'))

    expect(writeTextMock).toHaveBeenCalledWith(
      '[2026-04-07T07:30:44.719Z] [ERROR-minimax-m2.5-free] Session retry #1: <none> [model: opencode/minimax-m2.5-free]',
    )
  })

  it('includes full model ids when copying filtered ERROR logs', async () => {
    const logs: LogEntry[] = [
      {
        id: 'ai-error-1',
        entryId: 'ses-retry-1:retry:1',
        line: '[ERROR] Session retry #1: <none>',
        source: 'model:opencode/minimax-m2.5-free',
        status: 'DRAFTING_PRD',
        timestamp: '2026-04-07T07:30:44.719Z',
        audience: 'ai',
        kind: 'error',
        modelId: 'opencode/minimax-m2.5-free',
        sessionId: 'ses-retry-1',
        streaming: false,
        op: 'append',
      },
      {
        id: 'ai-error-2',
        entryId: 'ses-retry-2:retry:1',
        line: '[ERROR] Session retry #1: rate limited',
        source: 'model:openai/gpt-5-codex',
        status: 'DRAFTING_PRD',
        timestamp: '2026-04-07T07:31:44.719Z',
        audience: 'ai',
        kind: 'error',
        modelId: 'openai/gpt-5-codex',
        sessionId: 'ses-retry-2',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={logs} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ERROR' }))
      fireEvent.click(screen.getByTitle('Copy all logs'))
      await Promise.resolve()
    })

    expect(writeTextMock).toHaveBeenCalledWith([
      '[2026-04-07T07:30:44.719Z] [ERROR-minimax-m2.5-free] Session retry #1: <none> [model: opencode/minimax-m2.5-free]',
      '[2026-04-07T07:31:44.719Z] [ERROR-gpt-5-codex] Session retry #1: rate limited [model: openai/gpt-5-codex]',
    ].join('\n'))
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

    renderWithTooltipProvider(<PhaseLogPanel phase="COUNCIL_DELIBERATING" logs={logs} />)

    expect(screen.getByText(/openai\/gpt-5-mini prompt #1/i)).toBeInTheDocument()
    expect(screen.getByText(/You are an expert product manager/i)).toBeInTheDocument()
    expect(screen.queryByText(/Session status: running/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/openai\/gpt-5-mini prompt #1/i)).toBeInTheDocument()
    expect(screen.getByText(/Session status: running/i)).toBeInTheDocument()
  })

  it('collapses single-model AI tabs into one combined AI model tab', () => {
    const logs: LogEntry[] = [
      {
        id: 'coding-ai-1',
        entryId: 'coding-ai-1',
        line: '[MODEL] Session status: running.',
        source: 'model:openai/gpt-5.4',
        status: 'CODING',
        timestamp: '2026-03-10T10:00:01.000Z',
        audience: 'ai',
        kind: 'session',
        modelId: 'openai/gpt-5.4',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="CODING" logs={logs} />)

    expect(screen.getByRole('button', { name: 'AI > gpt-5.4' })).toBeInTheDocument()
    expect(screen.queryByTitle('Show models')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI > gpt-5.4' }))

    expect(screen.getByText(/Session status: running/i)).toBeInTheDocument()
  })

  it('shows system rows with modelId in the matching model tab without changing their color class', () => {
    const logs: LogEntry[] = [
      {
        id: 'sys-model-1',
        entryId: 'sys-model-1',
        line: '[SYS] OpenCode vote: openai/gpt-5.4 session=ses-1, messages=2, responseChars=622.',
        source: 'system',
        status: 'COUNCIL_VOTING_PRD',
        timestamp: '2026-03-10T10:00:00.000Z',
        audience: 'all',
        kind: 'milestone',
        modelId: 'openai/gpt-5.4',
        streaming: false,
        op: 'append',
      },
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="COUNCIL_VOTING_PRD" logs={logs} />)

    fireEvent.click(screen.getByTitle('Show models'))
    fireEvent.click(screen.getByTitle('openai/gpt-5.4'))

    const line = screen.getByText(/OpenCode vote: openai\/gpt-5\.4 session=ses-1/i)
    const lineContainer = line.closest('.whitespace-pre-wrap') ?? line

    expect(line).toBeInTheDocument()
    expect(lineContainer).toHaveClass('text-foreground')
    expect(lineContainer).not.toHaveClass('text-green-500')
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
      streaming: false,
      op: 'append',
    }
    const finalizedAiLog: LogEntry = {
      ...streamingAiLog,
      streaming: false,
      op: 'finalize',
      timestamp: '2026-03-10T10:00:02.000Z',
    }

    const { rerender } = renderWithTooltipProvider(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, streamingAiLog]} />)

    expect(screen.getByText(/PRD drafting started/i)).toBeInTheDocument()
    expect(screen.queryByText(/Final PRD Title/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()
    expect(screen.getByText('Stream')).toBeInTheDocument()
    expect(screen.getAllByText(/Final PRD Title/i)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))

    expect(screen.queryByText(/Final PRD Title/i)).not.toBeInTheDocument()

    rerender(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, appendReceivedAiLog]} />)

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()
    expect(screen.queryByText('Stream')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Final PRD Title/i)).toHaveLength(1)

    rerender(<PhaseLogPanel phase="DRAFTING_PRD" logs={[systemLog, finalizedAiLog]} />)

    expect(screen.getByText(/Final PRD Title/i)).toBeInTheDocument()
    expect(screen.queryByText('Stream')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Final PRD Title/i)).toHaveLength(1)
  })

  it('does not show a Stream badge for non-text AI status rows even if they are marked streaming', () => {
    const stepLog: LogEntry = {
      id: 'ses-9:step-1',
      entryId: 'ses-9:step-1',
      line: '[SYS] Step started.',
      source: 'model:openai/gpt-5.4',
      status: 'CODING',
      timestamp: '2026-03-10T10:00:00.000Z',
      audience: 'ai',
      kind: 'step',
      modelId: 'openai/gpt-5.4',
      sessionId: 'ses-9',
      streaming: true,
      op: 'append',
    }
    const sessionLog: LogEntry = {
      id: 'ses-9:status',
      entryId: 'ses-9:status',
      line: '[SYS] Session status: busy.',
      source: 'model:openai/gpt-5.4',
      status: 'CODING',
      timestamp: '2026-03-10T10:00:01.000Z',
      audience: 'ai',
      kind: 'session',
      modelId: 'openai/gpt-5.4',
      sessionId: 'ses-9',
      streaming: true,
      op: 'upsert',
    }

    renderWithTooltipProvider(<PhaseLogPanel phase="CODING" logs={[stepLog, sessionLog]} />)

    fireEvent.click(screen.getByRole('button', { name: 'AI > gpt-5.4' }))

    expect(screen.getByText(/Step started/i)).toBeInTheDocument()
    expect(screen.getByText(/Session status: busy/i)).toBeInTheDocument()
    expect(screen.queryByText('Stream')).not.toBeInTheDocument()
  })

  it('pins the viewport to the latest logs by default and follows new visible entries', () => {
    const firstLog = makeLog('log-1', '[SYS] First visible log line')
    const secondLog = makeLog('log-2', '[SYS] Second visible log line', {
      timestamp: '2026-03-10T10:00:01.000Z',
    })

    const { rerender } = renderWithTooltipProvider(<PhaseLogPanel phase="CODING" logs={[firstLog]} />)

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

    const { rerender } = renderWithTooltipProvider(<PhaseLogPanel phase="CODING" logs={[]} />)

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

    const { rerender } = renderWithTooltipProvider(<PhaseLogPanel phase="CODING" logs={[firstLog]} />)

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

  it('shows the log color legend when hovering the entry count', async () => {
    renderWithTooltipProvider(
      <PhaseLogPanel
        phase="CODING"
        logs={[
          makeLog('log-1', '[PROMPT] Prompt line', {
            source: 'model:openai/gpt-5-mini',
            audience: 'ai',
            kind: 'prompt',
          }),
          makeLog('log-2', '[SYS] System line', {
            timestamp: '2026-03-10T10:00:01.000Z',
          }),
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: '2 entries' })
    await act(async () => {
      fireEvent.focus(trigger)
    })

    const legends = screen.getAllByText('Log Colors Legend')
    expect(legends.length).toBeGreaterThan(0)
    expect(screen.getAllByText('Input (Prompt)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('System').length).toBeGreaterThan(0)
  })

  it('shows low-value git probe chatter in ALL and SYS tabs', () => {
    const logs: LogEntry[] = [
      makeLog('cmd-probe', '[CMD] $ git rev-parse --abbrev-ref HEAD  →  master', {
        status: 'DRAFT',
        source: 'system',
      }),
      makeLog('cmd-worktree', '[CMD] $ git worktree add /tmp/wt LTL-5  →  Preparing worktree', {
        status: 'DRAFT',
        source: 'system',
      }),
      makeLog('sys-1', '[SYS] Start requested.', {
        status: 'DRAFT',
      }),
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFT" logs={logs} />)

    expect(screen.getByText(/rev-parse --abbrev-ref HEAD/i)).toBeInTheDocument()
    expect(screen.getByText(/worktree add/i)).toBeInTheDocument()
    expect(screen.getByText(/Start requested/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SYS' }))

    expect(screen.getByText(/rev-parse --abbrev-ref HEAD/i)).toBeInTheDocument()
    expect(screen.getByText(/worktree add/i)).toBeInTheDocument()
  })

  it('keeps benign git probe failures out of the ERROR tab', () => {
    const logs: LogEntry[] = [
      makeLog('probe-error', '[CMD] $ git symbolic-ref --quiet --short refs/remotes/origin/HEAD  →  origin/HEAD not set', {
        status: 'DRAFT',
        source: 'system',
        kind: 'error',
      }),
      makeLog('real-error', '[ERROR] Worktree creation failed.', {
        status: 'DRAFT',
        source: 'error',
        kind: 'error',
      }),
    ]

    renderWithTooltipProvider(<PhaseLogPanel phase="DRAFT" logs={logs} />)

    fireEvent.click(screen.getByRole('button', { name: 'ERROR' }))

    expect(screen.queryByText(/origin\/HEAD not set/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Worktree creation failed/i)).toBeInTheDocument()
  })
})
