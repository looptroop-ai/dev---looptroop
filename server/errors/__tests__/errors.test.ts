import { describe, it, expect } from 'vitest'
import { createError } from '../handler'
import { CircuitBreaker } from '../circuitBreaker'
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

describe('Circuit Breaker', () => {
  it('trips after max failures', () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure('key')
    cb.recordFailure('key')
    expect(cb.isTripped('key')).toBe(false)
    cb.recordFailure('key')
    expect(cb.isTripped('key')).toBe(true)
  })

  it('resets on success', () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure('key')
    cb.recordFailure('key')
    cb.recordSuccess('key')
    expect(cb.isTripped('key')).toBe(false)
    expect(cb.getFailureCount('key')).toBe(0)
  })
})

describe('Crash Recovery', () => {
  it('runs recovery without errors', () => {
    initializeDatabase()
    const report = recoverFromCrash()
    expect(report.errors.length).toBe(0)
  })
})
