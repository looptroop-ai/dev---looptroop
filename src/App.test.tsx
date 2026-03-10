import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { UIProvider } from '@/context/UIContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'

function renderShell(props: Partial<{
  onOpenProfile: () => void
  onOpenProject: () => void
  onOpenTicket: () => void
}> = {}) {
  window.localStorage.clear()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <TooltipProvider>
          <AppShell
            onOpenProfile={props.onOpenProfile}
            onOpenProject={props.onOpenProject}
            onOpenTicket={props.onOpenTicket}
          >
            <div>Child Content</div>
          </AppShell>
        </TooltipProvider>
      </UIProvider>
    </QueryClientProvider>
  )
}

describe('AppShell', () => {
  it('renders the LoopTroop header and resets the path when the home button is clicked', () => {
    window.history.pushState(null, '', '/ticket/LOOP-1')

    renderShell()

    expect(screen.getByText('LoopTroop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /looptroop/i }))
    expect(window.location.pathname).toBe('/')
  })

  it('calls the top-level open handlers from the header actions', () => {
    const onOpenProfile = vi.fn()
    const onOpenProject = vi.fn()
    const onOpenTicket = vi.fn()

    renderShell({ onOpenProfile, onOpenProject, onOpenTicket })

    fireEvent.click(screen.getByRole('button', { name: /new ticket/i }))
    fireEvent.click(screen.getByRole('button', { name: /projects/i }))
    fireEvent.click(screen.getByRole('button', { name: /configuration/i }))

    expect(onOpenTicket).toHaveBeenCalledTimes(1)
    expect(onOpenProject).toHaveBeenCalledTimes(1)
    expect(onOpenProfile).toHaveBeenCalledTimes(1)
  })
})
