import { describe, expect, it } from 'vitest'
import { resolveOpenCodeBaseUrl } from '../scripts/opencode-dev-base-url'

describe('resolveOpenCodeBaseUrl', () => {
  it('reuses an already running OpenCode instance on the requested port', async () => {
    const result = await resolveOpenCodeBaseUrl({
      requestedBaseUrl: 'http://127.0.0.1:4096',
      hasExplicitBaseUrl: false,
      deps: {
        isOpenCodeResponding: async () => true,
        canConnect: async () => false,
        canListen: async () => true,
      },
    })

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:4096',
      note: 'OpenCode already reachable at http://127.0.0.1:4096; reusing it.',
      status: 'already-running',
    })
  })

  it('falls back to the next free port when the default port is occupied by another app', async () => {
    const result = await resolveOpenCodeBaseUrl({
      requestedBaseUrl: 'http://127.0.0.1:4096',
      hasExplicitBaseUrl: false,
      deps: {
        isOpenCodeResponding: async () => false,
        canConnect: async (_hostname, port) => port === 4096,
        canListen: async (_hostname, port) => port === 4097,
      },
    })

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:4097',
      note: 'Port 4096 is occupied by another app on 127.0.0.1; using http://127.0.0.1:4097 for OpenCode instead.',
      status: 'ready-to-start',
    })
  })

  it('rejects an explicit conflicting base URL instead of silently moving it', async () => {
    await expect(resolveOpenCodeBaseUrl({
      requestedBaseUrl: 'http://127.0.0.1:5001',
      hasExplicitBaseUrl: true,
      deps: {
        isOpenCodeResponding: async () => false,
        canConnect: async () => true,
        canListen: async () => true,
      },
    })).rejects.toThrow(
      'Configured OpenCode URL http://127.0.0.1:5001 is occupied by a non-OpenCode process on 127.0.0.1.',
    )
  })

  it('skips local startup for remote hosts', async () => {
    const result = await resolveOpenCodeBaseUrl({
      requestedBaseUrl: 'https://example.com/opencode/',
      hasExplicitBaseUrl: true,
    })

    expect(result).toEqual({
      baseUrl: 'https://example.com/opencode',
      note: 'Using remote OpenCode at https://example.com/opencode.',
      status: 'remote',
    })
  })
})
