import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/context/LogContext'
import { filterEntries } from '../logFormat'

function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'provider-error',
    entryId: 'provider-error',
    line: 'Your authentication token has been invalidated. Please try signing in again. (HTTP 401, requestModel=gpt-5.3-codex)',
    source: 'model:openai/gpt-5.3-codex',
    status: 'PRE_FLIGHT_CHECK',
    timestamp: '2026-04-29T15:25:08.000Z',
    audience: 'ai',
    kind: 'error',
    modelId: 'openai/gpt-5.3-codex',
    sessionId: 'ses-probe',
    streaming: false,
    op: 'append',
    ...overrides,
  }
}

describe('logFormat filtering', () => {
  it('shows provider API errors in ALL and ERROR tabs', () => {
    const providerError = makeLog()

    expect(filterEntries([providerError], 'ALL')).toContain(providerError)
    expect(filterEntries([providerError], 'ERROR')).toContain(providerError)
  })
})
