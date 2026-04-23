import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from '../AppShell'
import { UIContext, type UIContextValue } from '@/context/uiContextDef'
import { renderWithProviders } from '@/test/renderHelpers'

const uiValue: UIContextValue = {
  state: {
    selectedTicketId: null,
    selectedTicketExternalId: null,
    sidebarOpen: true,
    activeView: 'kanban',
    logPanelHeight: 300,
    filters: {
      projectId: null,
      status: null,
      search: '',
    },
    theme: 'system',
  },
  dispatch: vi.fn(),
}

describe('AppShell', () => {
  it('renders a docs link that opens in a new tab', () => {
    renderWithProviders(
      <UIContext.Provider value={uiValue}>
        <AppShell>
          <div>Dashboard</div>
        </AppShell>
      </UIContext.Provider>,
    )

    const docsLink = screen.getByRole('link', { name: /docs/i })
    expect(docsLink).toHaveAttribute('href', __LOOPTROOP_DOCS_ORIGIN__)
    expect(docsLink).toHaveAttribute('target', '_blank')
    expect(docsLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})
