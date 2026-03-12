import { describe, expect, it } from 'vitest'
import { parseLockedDisableAnalogies } from '../persistence'

describe('parseLockedDisableAnalogies', () => {
  it('preserves null for legacy tickets so live profile fallback can still apply', () => {
    expect(parseLockedDisableAnalogies(null)).toBeNull()
    expect(parseLockedDisableAnalogies(undefined)).toBeNull()
  })

  it('coerces stored numeric and boolean values without collapsing false into null', () => {
    expect(parseLockedDisableAnalogies(1)).toBe(true)
    expect(parseLockedDisableAnalogies(0)).toBe(false)
    expect(parseLockedDisableAnalogies(true)).toBe(true)
    expect(parseLockedDisableAnalogies(false)).toBe(false)
  })
})
