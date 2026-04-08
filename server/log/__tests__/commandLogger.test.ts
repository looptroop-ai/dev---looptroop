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
    expect(logs[0]).toContain('[CMD]')
    expect(logs[0]).toContain('$ git')
    expect(logs[0]).toContain('STDOUT:\non branch main')
  })

  it('emits multiline format with [CMD] prefix', () => {
    const logs: Array<{ phase: string; type: string; content: string }> = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['worktree', 'add', '/tmp/wt', 'BR-1'], { ok: true, stdout: 'Preparing worktree' })
        logCommand('git', ['rev-parse', '--show-toplevel'], { ok: true })
        logCommand('git', ['push'], { ok: false, error: 'remote rejected' })
      },
      (phase, type, content) => { logs.push({ phase, type, content }) },
    )

    expect(logs).toHaveLength(3)

    // Success with stdout — multiline with STDOUT: header
    expect(logs[0]!.type).toBe('info')
    expect(logs[0]!.content).toBe('[CMD] $ git worktree add /tmp/wt BR-1\nSTDOUT:\nPreparing worktree')

    // Success without stdout — arrow format
    expect(logs[1]!.type).toBe('info')
    expect(logs[1]!.content).toBe('[CMD] $ git rev-parse --show-toplevel  →  ok')

    // Failure — multiline with error header
    expect(logs[2]!.type).toBe('error')
    expect(logs[2]!.content).toBe('[CMD] $ git push  →  error:\nremote rejected')
  })

  it('emits stderr-only output with STDERR header', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['worktree', 'add', '/tmp/wt', 'BRANCH'], {
          ok: true,
          stderr: 'Preparing worktree (new branch \'BRANCH\')',
        })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('STDERR:\nPreparing worktree')
    expect(logs[0]).not.toContain('STDOUT:')
  })

  it('shows both stdout and stderr with separate headers', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['commit', '-m', 'msg'], { ok: true, stdout: 'abc1234', stderr: '1 file changed' })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('STDOUT:\nabc1234')
    expect(logs[0]).toContain('STDERR:\n1 file changed')
  })

  it('preserves multi-line output in STDOUT block', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['status', '--porcelain'], {
          ok: true,
          stdout: 'M  file1.ts\nA  file2.ts\nD  file3.ts',
        })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('STDOUT:\nM  file1.ts\nA  file2.ts\nD  file3.ts')
  })

  it('uses globalThis singleton so separate module loads share the context', () => {
    // The globalThis singleton ensures that even if commandLogger is loaded
    // separately (via require() in production), the AsyncLocalStorage is shared.
    // Verify the store key exists on globalThis after import.
    const storeKey = Symbol.for('looptroop:commandLogStore')
    const g = globalThis as unknown as Record<symbol, unknown>
    expect(g[storeKey]).toBeDefined()

    // Verify logCommand within withCommandLogging still works as before
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['status'], { ok: true, stdout: 'all clean' })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('[CMD]')
    expect(logs[0]).toContain('all clean')
  })

  it('truncates output at 2500 characters', () => {
    const logs: string[] = []
    const longOutput = 'x'.repeat(3000)
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['diff'], { ok: true, stdout: longOutput })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('… (truncated)')
    // The full content = "[CMD] $ git diff" prefix + "\nSTDOUT:\n" + truncated output
    // The output portion (including \nSTDOUT:\n header) is truncated to 2500 chars
    const prefix = '[CMD] $ git diff'
    expect(logs[0]!.length).toBeLessThan(prefix.length + 2500 + 20)
  })
})
