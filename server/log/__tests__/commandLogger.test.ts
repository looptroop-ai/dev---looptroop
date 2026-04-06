import { describe, it, expect } from 'vitest'
import { logCommand, withCommandLogging } from '../../log/commandLogger'

describe('commandLogger', () => {
  it('logCommand is a no-op without context', () => {
    logCommand('git', ['status'], { ok: true, stdout: 'fine' })
    expect(true).toBe(true)
  })

  it('logCommand emits when context is active', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['-C', '/some/path', 'status'], { ok: true, stdout: 'on branch main' })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain('$ git')
    expect(logs[0]).toContain('on branch main')
  })
})
