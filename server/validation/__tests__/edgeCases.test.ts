import { describe, it, expect } from 'vitest'
import { isWithinScope, validateRunnerAccess } from '../../security/runnerScope'
import { isAllowedFile } from '../../phases/execution/gitOps'

describe('Runner Scope', () => {
  it('allows paths within scope', () => {
    expect(isWithinScope('/project/src/file.ts', '/project')).toBe(true)
  })

  it('blocks paths outside scope', () => {
    expect(isWithinScope('/other/file.ts', '/project')).toBe(false)
    expect(isWithinScope('../escape', '/project')).toBe(false)
  })

  it('validates runner access', () => {
    expect(validateRunnerAccess('/project/src/a.ts', '/project').allowed).toBe(true)
    expect(validateRunnerAccess('/etc/passwd', '/project').allowed).toBe(false)
  })
})

describe('File Allowlist Edge Cases', () => {
  it('blocks .env files', () => expect(isAllowedFile('.env')).toBe(false))
  it('blocks binary files', () => expect(isAllowedFile('image.png')).toBe(false))
  it('allows config files', () => expect(isAllowedFile('tsconfig.json')).toBe(true))
  it('blocks deep runtime paths', () => expect(isAllowedFile('.ticket/runtime/session/abc')).toBe(false))
})
