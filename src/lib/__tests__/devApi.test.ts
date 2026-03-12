import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendOrigin } from '@shared/appConfig'

describe('devApi', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps default API URLs on the frontend origin', async () => {
    const { getApiUrl } = await import('../devApi')

    expect(getApiUrl('/api/stream')).toBe(`${window.location.origin}/api/stream`)
    expect(getApiUrl('/api/stream', { directInDevelopment: true })).toBe(`${window.location.origin}/api/stream`)
  })

  it('builds direct backend URLs for the readiness probe helper', async () => {
    const { __devApiForTests } = await import('../devApi')

    expect(__devApiForTests.getDirectDevApiUrl('/api/health')).toBe(`${getBackendOrigin()}/api/health`)
  })
})
