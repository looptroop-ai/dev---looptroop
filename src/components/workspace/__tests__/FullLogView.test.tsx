import type { ReactNode, Ref } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

const getAllLogsMock = vi.fn(() => [] as LogEntry[])
const getLogsForPhaseMock = vi.fn(() => [] as LogEntry[])

vi.mock('@/context/useLogContext', () => ({
  useLogs: () => ({
    logsByPhase: {},
    activePhase: null,
    isLoadingLogs: false,
    addLog: vi.fn(),
    addLogRecord: vi.fn(),
    getLogsForPhase: getLogsForPhaseMock,
    getAllLogs: getAllLogsMock,
    setActivePhase: vi.fn(),
    clearLogs: vi.fn(),
  }),
}))

import { FullLogView } from '../FullLogView'

const writeTextMock = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())

function makeLog(id: string, line: string, status: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    entryId: id,
    line,
    source: 'system',
    status,
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
    value: { writeText: writeTextMock },
  })

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
  })

  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: () => {},
  })
})

beforeEach(() => {
  getAllLogsMock.mockReset()
  getLogsForPhaseMock.mockReset()
  writeTextMock.mockClear()
})

describe('FullLogView', () => {
  it('renders empty state when there are no logs', () => {
    getAllLogsMock.mockReturnValue([])
    renderWithTooltipProvider(<FullLogView />)
    expect(screen.getByText(/no log entries yet/i)).toBeTruthy()
  })

  it('renders the header with "Full Log" title', () => {
    getAllLogsMock.mockReturnValue([])
    renderWithTooltipProvider(<FullLogView />)
    expect(screen.getByText('Full Log')).toBeTruthy()
  })

  it('renders phase delimiters when status changes between entries', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[SYS] Scanning files', 'SCANNING_RELEVANT_FILES'),
      makeLog('2', '[SYS] Starting council', 'COUNCIL_DELIBERATING'),
      makeLog('3', '[MODEL] Draft output', 'COUNCIL_DELIBERATING'),
    ])
    renderWithTooltipProvider(<FullLogView />)

    expect(screen.getByText('Scanning Relevant Files')).toBeTruthy()
    expect(screen.getByText('AI Council Thinking')).toBeTruthy()
  })

  it('renders a second delimiter when the same status reappears after another', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[SYS] First coding run', 'CODING'),
      makeLog('2', '[ERROR] Blocked', 'BLOCKED_ERROR'),
      makeLog('3', '[SYS] Retry coding', 'CODING'),
    ])
    renderWithTooltipProvider(<FullLogView />)

    const codingDelimiters = screen.getAllByText(/Implementing/)
    expect(codingDelimiters).toHaveLength(2)
  })

  it('renders all filter tabs', () => {
    getAllLogsMock.mockReturnValue([])
    renderWithTooltipProvider(<FullLogView />)

    for (const tab of ['ALL', 'SYS', 'AI', 'ERROR', 'DEBUG']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    }
  })

  it('filters logs when a tab is selected', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[SYS] System event', 'CODING', { source: 'system', audience: 'all', kind: 'milestone' }),
      makeLog('2', '[ERROR] Something failed', 'CODING', { source: 'error', audience: 'all', kind: 'error' }),
      makeLog('3', '[SYS] Another event', 'CODING', { source: 'system', audience: 'all', kind: 'milestone' }),
    ])
    renderWithTooltipProvider(<FullLogView />)

    fireEvent.click(screen.getByRole('button', { name: 'ERROR' }))
    expect(screen.getByText('1 entries')).toBeTruthy()
  })

  it('shows non-error command chatter only in SYS in the full log view', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('probe', '[CMD] $ git rev-parse --abbrev-ref HEAD  →  master', 'DRAFT', {
        source: 'system',
      }),
      makeLog('worktree', '[CMD] $ git worktree add /tmp/wt LTL-5  →  Preparing worktree', 'DRAFT', {
        source: 'system',
      }),
      makeLog('sys', '[SYS] Start requested.', 'DRAFT'),
    ])

    renderWithTooltipProvider(<FullLogView />)

    expect(screen.queryByText(/rev-parse --abbrev-ref HEAD/i)).toBeNull()
    expect(screen.queryByText(/worktree add/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show commands' }))
    fireEvent.click(screen.getByRole('button', { name: 'CMD' }))

    expect(screen.getByText(/rev-parse --abbrev-ref HEAD/i)).toBeTruthy()
    expect(screen.getByText(/worktree add/i)).toBeTruthy()
  })

  it('shows real command failures in ALL and ERROR while keeping benign probe misses out of ERROR in the full log view', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('probe-error', '[CMD] $ git symbolic-ref --quiet --short refs/remotes/origin/HEAD  →  origin/HEAD not set', 'DRAFT', {
        source: 'system',
        kind: 'error',
      }),
      makeLog('real-cmd-error', '[CMD] $ git merge --no-edit LTL-5  →  error: merge conflict', 'DRAFT', {
        source: 'error',
        kind: 'error',
      }),
    ])

    renderWithTooltipProvider(<FullLogView />)

    expect(screen.getByText(/merge --no-edit/i)).toBeTruthy()
    expect(screen.queryByText(/origin\/HEAD not set/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'ERROR' }))

    expect(screen.queryByText(/origin\/HEAD not set/i)).toBeNull()
    expect(screen.getByText(/merge --no-edit/i)).toBeTruthy()
  })

  it('shows model tabs from the AI tab and filters by selected model', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[MODEL] First output', 'CODING', {
        source: 'model:openai/gpt-5.4',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5.4',
      }),
      makeLog('2', '[MODEL] Second output', 'DRAFTING_PRD', {
        source: 'model:anthropic/claude-sonnet-4',
        audience: 'ai',
        kind: 'text',
        modelId: 'anthropic/claude-sonnet-4',
      }),
    ])

    renderWithTooltipProvider(<FullLogView />)

    fireEvent.click(screen.getByTitle('Show models'))
    fireEvent.click(screen.getByRole('button', { name: /gpt-5\.4/i }))

    expect(screen.getByText('1 entries')).toBeTruthy()
    expect(screen.getByText(/First output/)).toBeTruthy()
    expect(screen.queryByText(/Second output/)).toBeNull()
  })

  it('collapses single-model AI tabs into one combined AI model tab', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[MODEL] First output', 'CODING', {
        source: 'model:openai/gpt-5.4',
        audience: 'ai',
        kind: 'text',
        modelId: 'openai/gpt-5.4',
      }),
    ])

    renderWithTooltipProvider(<FullLogView />)

    expect(screen.getByRole('button', { name: 'AI > gpt-5.4' })).toBeTruthy()
    expect(screen.queryByTitle('Show models')).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'AI > gpt-5.4' }))
    expect(screen.getByText(/First output/)).toBeTruthy()
  })

  it('shows the correct total entry count', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[SYS] Event 1', 'CODING'),
      makeLog('2', '[SYS] Event 2', 'CODING'),
      makeLog('3', '[SYS] Event 3', 'DRAFTING_PRD'),
    ])
    renderWithTooltipProvider(<FullLogView />)

    expect(screen.getByText('3 entries')).toBeTruthy()
  })

  it('renders log entries using LogEntryRow with sequential indices', () => {
    getAllLogsMock.mockReturnValue([
      makeLog('a', '[SYS] First', 'SCANNING_RELEVANT_FILES'),
      makeLog('b', '[SYS] Second', 'COUNCIL_DELIBERATING'),
    ])
    renderWithTooltipProvider(<FullLogView />)

    // LogEntryRow renders index+1 padded to 3 chars
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('includes status name in copy text', async () => {
    getAllLogsMock.mockReturnValue([
      makeLog('1', '[SYS] Start', 'CODING', { timestamp: '2026-03-10T10:00:00.000Z' }),
    ])
    renderWithTooltipProvider(<FullLogView />)

    await act(async () => {
      fireEvent.click(screen.getByTitle('Copy all logs'))
      await Promise.resolve()
    })
    expect(writeTextMock).toHaveBeenCalledTimes(1)
    const copiedText = writeTextMock.mock.calls[0]![0] as string
    expect(copiedText).toContain('[CODING]')
    expect(copiedText).toContain('[SYS] Start')
  })
})
