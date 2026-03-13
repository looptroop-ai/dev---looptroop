import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import {
  clearOpenCodeModelsQuery,
  OPENCODE_MODELS_QUERY_KEY,
  refetchOpenCodeModelsQuery,
  useAllOpenCodeModels,
  useOpenCodeModels,
} from '../useOpenCodeModels'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  })
}

function Probe() {
  useOpenCodeModels()
  useAllOpenCodeModels()
  return createElement('div')
}

describe('useOpenCodeModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ fullId: 'openai/gpt-5.3-codex' }],
        allModels: [{ fullId: 'openai/gpt-5.3-codex' }, { fullId: 'google/gemini-2.5-pro' }],
        connectedProviders: ['openai'],
        defaultModels: {},
      }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares one cached query for connected and all models', async () => {
    const queryClient = createQueryClient()

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe),
      ),
    )

    await waitFor(() => {
      expect(queryClient.getQueryData(OPENCODE_MODELS_QUERY_KEY)).toEqual({
        models: [{ fullId: 'openai/gpt-5.3-codex' }],
        allModels: [{ fullId: 'openai/gpt-5.3-codex' }, { fullId: 'google/gemini-2.5-pro' }],
        connectedProviders: ['openai'],
        defaultModels: {},
      })
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/models', { signal: expect.any(AbortSignal) })
  })

  it('clears the cached models query before configuration opens', () => {
    const removeQueries = vi.fn()

    clearOpenCodeModelsQuery({ removeQueries })

    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: OPENCODE_MODELS_QUERY_KEY,
      exact: true,
    })
  })

  it('refetches the active models query after OpenCode connects', () => {
    const refetchQueries = vi.fn()

    refetchOpenCodeModelsQuery({ refetchQueries })

    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: OPENCODE_MODELS_QUERY_KEY,
      exact: true,
      type: 'active',
    })
  })
})
