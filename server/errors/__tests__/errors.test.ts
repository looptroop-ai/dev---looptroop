import { describe, it, expect } from 'vitest'
import { createError } from '../handler'
import { recoverFromCrash } from '../recovery'
import { initializeDatabase } from '../../db/init'

describe('Error Handler', () => {
  it('creates typed error with correct severity', () => {
    const error = createError('OPENCODE_UNREACHABLE', 'preflight', 'Cannot connect')
    expect(error.severity).toBe('critical')
    expect(error.code).toBe('OPENCODE_UNREACHABLE')
    expect(error.remediation).toContain('opencode serve')
  })

  it('handles unknown error codes', () => {
    const error = createError('UNKNOWN', 'test', 'test error')
    expect(error.severity).toBe('recoverable')
  })
})

describe('Crash Recovery', () => {
  it('runs recovery without errors', () => {
    initializeDatabase()
    const report = recoverFromCrash()
    expect(report.errors.length).toBe(0)
  })
})
