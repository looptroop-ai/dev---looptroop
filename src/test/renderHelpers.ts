import React from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: {
    queryClient?: QueryClient
    withTooltip?: boolean
  },
) {
  const queryClient = options?.queryClient ?? createTestQueryClient()
  const withTooltip = options?.withTooltip ?? true

  let wrapped = ui
  if (withTooltip) {
    wrapped = React.createElement(TooltipProvider, null, wrapped)
  }
  wrapped = React.createElement(QueryClientProvider, { client: queryClient }, wrapped)

  return { ...render(wrapped), queryClient }
}
