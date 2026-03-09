import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { UIProvider } from '@/context/UIContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'

function renderApp() {
  window.localStorage.clear()
  window.localStorage.setItem('looptroop-welcome-seen', 'true')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </UIProvider>
    </QueryClientProvider>
  )
}

describe('App', () => {
  it('renders the LoopTroop header', () => {
    renderApp()
    expect(screen.getByText('LoopTroop')).toBeInTheDocument()
  })

  it('renders all 4 kanban columns', () => {
    renderApp()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Needs Input')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })
})
