import { describe, it, expect } from 'vitest'
import { isAllowedFile } from '../../phases/execution/gitOps'

describe('File Allowlist Edge Cases', () => {
  it('blocks .env files', () => expect(isAllowedFile('.env')).toBe(false))
  it('blocks binary files', () => expect(isAllowedFile('image.png')).toBe(false))
  it('allows config files', () => expect(isAllowedFile('tsconfig.json')).toBe(true))
  it('blocks deep runtime paths', () => expect(isAllowedFile('.ticket/runtime/session/abc')).toBe(false))
})
