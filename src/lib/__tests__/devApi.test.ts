import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('devApi', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps default API URLs on the frontend origin', async () => {
    const { getApiUrl } = await import('../devApi')

    expect(getApiUrl('/api/stream')).toBe(`${window.location.origin}/api/stream`)
    expect(getApiUrl('/api/stream', { directInDevelopment: true })).toBe(`${window.location.origin}/api/stream`)
  })

  it('builds same-origin readiness probe URLs for development', async () => {
    const { __devApiForTests } = await import('../devApi')

    expect(__devApiForTests.getDevReadyProbeUrl('/api/health')).toBe(`${window.location.origin}/api/health`)
  })
})
