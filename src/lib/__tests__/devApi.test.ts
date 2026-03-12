import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('devApi', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState({}, '', 'http://localhost:5173/workspace')
  })

  it('keeps default API URLs on the frontend origin', async () => {
    const { getApiUrl } = await import('../devApi')

    expect(getApiUrl('/api/stream')).toBe('http://localhost:5173/api/stream')
    expect(getApiUrl('/api/stream', { directInDevelopment: true })).toBe('http://localhost:5173/api/stream')
  })

  it('builds direct backend URLs for the readiness probe helper', async () => {
    const { __devApiForTests } = await import('../devApi')

    expect(__devApiForTests.getDirectDevApiUrl('/api/health')).toBe('http://localhost:3000/api/health')
  })
})
