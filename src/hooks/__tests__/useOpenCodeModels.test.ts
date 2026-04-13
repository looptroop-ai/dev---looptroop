import { createElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createTestQueryClient } from '@/test/renderHelpers'
import {
  clearOpenCodeModelsQuery,
  fetchModelsApi,
  OPENCODE_MODELS_QUERY_KEY,
  refetchOpenCodeModelsQuery,
  useAllOpenCodeModels,
  useOpenCodeModels,
} from '../useOpenCodeModels'

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
    const queryClient = createTestQueryClient()

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

  it('treats a response with a message field as an error (opencode not ready)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [],
        allModels: [],
        connectedProviders: [],
        defaultModels: {},
        message: 'OpenCode server is not reachable. Start it with `opencode serve`.',
      }),
    })))

    await expect(fetchModelsApi()).rejects.toThrow(/not reachable/i)
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
