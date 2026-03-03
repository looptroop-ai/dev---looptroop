import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { UIProvider } from '@/context/UIContext'
import { DoneView } from '../DoneView'
import { CanceledView } from '../CanceledView'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>{ui}</UIProvider>
    </QueryClientProvider>
  )
}

describe('Workspace Views', () => {
  it('DoneView shows completion message', () => {
    renderWithProviders(<DoneView />)
    expect(screen.getByText('Completed Successfully')).toBeInTheDocument()
  })

  it('CanceledView shows cancellation message', () => {
    renderWithProviders(<CanceledView />)
    expect(screen.getByText('Canceled')).toBeInTheDocument()
  })
})
