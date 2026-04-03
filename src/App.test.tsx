import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { UIProvider } from '@/context/UIContext'
import { WELCOME_DISCLAIMER_STORAGE_KEY } from '@/components/shared/WelcomeDisclaimer'
import type { StartupStatus } from '@/hooks/useStartupStatus'

const mockState = vi.hoisted(() => ({
  startupStatus: null as StartupStatus | null,
  dismissMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('@/components/kanban/KanbanBoard', () => ({
  KanbanBoard: () => <div>Kanban Board</div>,
}))

vi.mock('@/components/ticket/TicketDashboard', () => ({
  TicketDashboard: () => <div>Ticket Dashboard</div>,
}))

vi.mock('@/components/shared/CenteredModal', () => ({
  CenteredModal: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}))

vi.mock('@/components/config/ProfileSetup', () => ({
  ProfileSetup: () => <div>Profile Setup</div>,
}))

vi.mock('@/components/project/ProjectsPanel', () => ({
  ProjectsPanel: () => <div>Projects Panel</div>,
}))

vi.mock('@/components/ticket/TicketForm', () => ({
  TicketForm: () => <div>Ticket Form</div>,
}))

vi.mock('@/components/shared/KeyboardShortcuts', () => ({
  KeyboardShortcuts: () => null,
}))

vi.mock('@/hooks/useTickets', () => ({
  useTickets: () => ({ data: [] }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: null }),
}))

vi.mock('@/hooks/useStartupStatus', () => ({
  useStartupStatus: () => ({ data: mockState.startupStatus }),
  useDismissStartupRestoreNotice: () => mockState.dismissMutation,
}))

function makeStartupStatus(overrides: Partial<StartupStatus['storage']> = {}): StartupStatus {
  return {
    storage: {
      kind: 'restored',
      dbPath: '/home/liviu/.config/looptroop/app.sqlite',
      configDir: '/home/liviu/.config/looptroop',
      source: 'default',
      profileRestored: true,
      restoredProjectCount: 1,
      restoredProjects: [
        {
          name: 'Restored Project',
          shortname: 'RST',
          folderPath: '/home/liviu/RestoredProject',
        },
      ],
      ...overrides,
    },
    ui: {
      restoreNotice: {
        shouldShow: true,
        dismissedAt: null,
      },
    },
  }
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <App />
      </UIProvider>
    </QueryClientProvider>,
  )
}

describe('App startup notices', () => {
  beforeEach(() => {
    mockState.dismissMutation.isPending = false
    mockState.dismissMutation.mutate.mockReset()
    localStorage.clear()
  })

  it('does not show the restore popup for fresh startup state', () => {
    localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')
    mockState.startupStatus = makeStartupStatus({
      kind: 'fresh',
      profileRestored: false,
      restoredProjectCount: 0,
      restoredProjects: [],
    })
    mockState.startupStatus.ui.restoreNotice.shouldShow = false

    renderApp()

    expect(screen.queryByText('Existing Local Data Found')).not.toBeInTheDocument()
  })

  it('does not show the restore popup for empty existing startup state', () => {
    localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')
    mockState.startupStatus = makeStartupStatus({
      kind: 'empty_existing',
      profileRestored: false,
      restoredProjectCount: 0,
      restoredProjects: [],
    })
    mockState.startupStatus.ui.restoreNotice.shouldShow = false

    renderApp()

    expect(screen.queryByText('Existing Local Data Found')).not.toBeInTheDocument()
  })

  it('waits for the welcome disclaimer to be dismissed before showing the restore popup', async () => {
    mockState.startupStatus = makeStartupStatus()

    renderApp()

    expect(screen.getByText('Welcome to LoopTroop')).toBeInTheDocument()
    expect(screen.queryByText('Existing Local Data Found')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /got it, let's go!/i }))

    expect(await screen.findByText('Existing Local Data Found')).toBeInTheDocument()
  })

  it('adapts restore popup copy for profile-only, project-only, and combined restores', async () => {
    localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')

    mockState.startupStatus = makeStartupStatus({
      profileRestored: true,
      restoredProjectCount: 2,
      restoredProjects: [
        {
          name: 'Alpha',
          shortname: 'ALP',
          folderPath: '/work/alpha',
        },
        {
          name: 'Beta',
          shortname: 'BET',
          folderPath: '/work/beta',
        },
      ],
    })
    const { rerender } = renderApp()
    expect(screen.getByText('Restored your saved LoopTroop profile and 2 projects.')).toBeInTheDocument()

    mockState.startupStatus = makeStartupStatus({
      profileRestored: true,
      restoredProjectCount: 0,
      restoredProjects: [],
    })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <UIProvider>
          <App />
        </UIProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Restored your saved LoopTroop profile.')).toBeInTheDocument()

    mockState.startupStatus = makeStartupStatus({
      profileRestored: false,
      restoredProjectCount: 3,
      restoredProjects: [
        {
          name: 'Alpha',
          shortname: 'ALP',
          folderPath: '/work/alpha',
        },
        {
          name: 'Beta',
          shortname: 'BET',
          folderPath: '/work/beta',
        },
        {
          name: 'Gamma',
          shortname: 'GAM',
          folderPath: '/work/gamma',
        },
      ],
    })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <UIProvider>
          <App />
        </UIProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Restored 3 projects from existing local LoopTroop data.')).toBeInTheDocument()
    expect(screen.getByText('/home/liviu/.config/looptroop/app.sqlite')).toBeInTheDocument()
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
    expect(screen.getByText(/Gamma/)).toBeInTheDocument()
    expect(screen.getByText('/work/alpha')).toBeInTheDocument()
    expect(screen.getByText('/work/beta')).toBeInTheDocument()
    expect(screen.getByText('/work/gamma')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('This notice is stored with your local LoopTroop app data and will not appear again after dismissal.')).toBeInTheDocument()
    })
  })

  it('closes the restore popup after a successful dismissal', async () => {
    localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')
    mockState.startupStatus = makeStartupStatus()
    mockState.dismissMutation.mutate.mockImplementation((_: undefined, options?: {
      onSuccess?: () => void
    }) => {
      options?.onSuccess?.()
    })

    renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(screen.queryByText('Existing Local Data Found')).not.toBeInTheDocument()
    })
  })

  it('keeps the popup open and shows a toast when dismissal fails', async () => {
    localStorage.setItem(WELCOME_DISCLAIMER_STORAGE_KEY, 'true')
    mockState.startupStatus = makeStartupStatus()
    mockState.dismissMutation.mutate.mockImplementation((_: undefined, options?: {
      onError?: (error: Error) => void
    }) => {
      options?.onError?.(new Error('Failed to dismiss restore notice'))
    })

    renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Existing Local Data Found')).toBeInTheDocument()
    expect(await screen.findByText('Failed to dismiss restore notice')).toBeInTheDocument()
  })
})
