import { describe, expect, it } from 'vitest'
import { getOpenCodeBasicAuthConfig, getOpenCodeBasicAuthHeader } from '../opencodeAuth'

describe('opencode auth helpers', () => {
  it('returns nullish auth values when no password is configured', () => {
    expect(getOpenCodeBasicAuthConfig({})).toBeNull()
    expect(getOpenCodeBasicAuthHeader({})).toBeUndefined()
  })

  it('builds a basic auth header with the default username', () => {
    expect(getOpenCodeBasicAuthConfig({ OPENCODE_SERVER_PASSWORD: 'secret' })).toEqual({
      username: 'opencode',
      password: 'secret',
    })
    expect(getOpenCodeBasicAuthHeader({ OPENCODE_SERVER_PASSWORD: 'secret' })).toBe('Basic b3BlbmNvZGU6c2VjcmV0')
  })

  it('uses an explicit username when provided', () => {
    expect(getOpenCodeBasicAuthHeader({
      OPENCODE_SERVER_USERNAME: 'looptroop',
      OPENCODE_SERVER_PASSWORD: 'secret',
    })).toBe('Basic bG9vcHRyb29wOnNlY3JldA==')
  })
})
