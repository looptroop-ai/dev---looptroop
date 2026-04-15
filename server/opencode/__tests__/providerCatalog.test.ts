import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProviderCatalog } from '../providerCatalog'

describe('fetchProviderCatalog', () => {
  beforeEach(() => {
    delete process.env.LOOPTROOP_OPENCODE_MODE
    delete process.env.LOOPTROOP_OPENCODE_BASE_URL
    delete process.env.OPENCODE_SERVER_USERNAME
    delete process.env.OPENCODE_SERVER_PASSWORD
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.LOOPTROOP_OPENCODE_MODE
    delete process.env.LOOPTROOP_OPENCODE_BASE_URL
    delete process.env.OPENCODE_SERVER_USERNAME
    delete process.env.OPENCODE_SERVER_PASSWORD
  })

  it('includes basic auth when the OpenCode server is protected', async () => {
    process.env.OPENCODE_SERVER_USERNAME = 'dev-user'
    process.env.OPENCODE_SERVER_PASSWORD = 'dev-secret'

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        all: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-5': {
                id: 'gpt-5',
                name: 'GPT-5',
              },
            },
          },
        ],
        connected: ['openai'],
        default: { openai: 'gpt-5' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const catalog = await fetchProviderCatalog()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4096/provider',
      expect.objectContaining({
        headers: {
          Authorization: 'Basic ZGV2LXVzZXI6ZGV2LXNlY3JldA==',
        },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(catalog).toEqual({
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
            },
          },
        },
      ],
      connected: ['openai'],
      default: { openai: 'gpt-5' },
    })
  })

  it('falls back to /config/providers when the legacy /provider endpoint is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              models: {
                'gpt-5': {
                  id: 'gpt-5',
                  name: 'GPT-5',
                },
              },
            },
          ],
          default: { openai: 'gpt-5' },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const catalog = await fetchProviderCatalog()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4096/provider',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4096/config/providers',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
    expect(catalog).toEqual({
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
            },
          },
        },
      ],
      connected: ['openai'],
      default: { openai: 'gpt-5' },
    })
  })
})
