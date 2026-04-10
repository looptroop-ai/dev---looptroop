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
    expect(logs[0]).toContain('on branch main')
  })

  it('emits compact single-line command logs with [CMD] prefix', () => {
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

    // Success with stdout — compact arrow format
    expect(logs[0]!.type).toBe('info')
    expect(logs[0]!.content).toBe('[CMD] $ git worktree add /tmp/wt BR-1  →  Preparing worktree')

    // Success without stdout — arrow format
    expect(logs[1]!.type).toBe('info')
    expect(logs[1]!.content).toBe('[CMD] $ git rev-parse --show-toplevel  →  ok')

    // Failure — compact error format
    expect(logs[2]!.type).toBe('error')
    expect(logs[2]!.content).toBe('[CMD] $ git push  →  error: remote rejected')
  })

  it('emits stderr-only output in compact form', () => {
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
    expect(logs[0]).toContain('STDERR: Preparing worktree')
    expect(logs[0]).not.toContain('\n')
  })

  it('shows both stdout and stderr in compact form', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['commit', '-m', 'msg'], { ok: true, stdout: 'abc1234', stderr: '1 file changed' })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('STDOUT: abc1234')
    expect(logs[0]).toContain('STDERR: 1 file changed')
  })

  it('collapses multi-line output into a single visual line', () => {
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
    expect(logs[0]).toContain('M  file1.ts | A  file2.ts | D  file3.ts')
    expect(logs[0]).not.toContain('\n')
  })

  it('downgrades missing origin/HEAD probes to info', () => {
    const logs: Array<{ type: string; content: string }> = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
          ok: false,
          error: 'exit code 1',
        })
      },
      (_phase, type, content) => { logs.push({ type, content }) },
    )

    expect(logs).toEqual([
      {
        type: 'info',
        content: '[CMD] $ git symbolic-ref --quiet --short refs/remotes/origin/HEAD  →  origin/HEAD not set',
      },
    ])
  })

  it('downgrades missing ref probes to info', () => {
    const logs: Array<{ type: string; content: string }> = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['show-ref', '--verify', '--quiet', 'refs/heads/LTL-5'], {
          ok: false,
          error: 'exit code 1',
        })
      },
      (_phase, type, content) => { logs.push({ type, content }) },
    )

    expect(logs).toEqual([
      {
        type: 'info',
        content: '[CMD] $ git show-ref --verify --quiet refs/heads/LTL-5  →  ref not found',
      },
    ])
  })

  it('downgrades staged diff probes to info', () => {
    const logs: Array<{ type: string; content: string }> = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'CODING',
      () => {
        logCommand('git', ['-C', '/tmp/worktrees/POBA-1', 'diff', '--cached', '--quiet'], {
          ok: false,
          error: 'exit code 1',
        })
      },
      (_phase, type, content) => { logs.push({ type, content }) },
    )

    expect(logs).toEqual([
      {
        type: 'info',
        content: '[CMD] $ git -C worktrees/POBA-1 diff --cached --quiet  →  staged changes present',
      },
    ])
  })

  it('keeps real staged diff probe failures as errors', () => {
    const logs: Array<{ type: string; content: string }> = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'CODING',
      () => {
        logCommand('git', ['diff', '--cached', '--quiet'], {
          ok: false,
          error: 'fatal: unable to read index',
        })
      },
      (_phase, type, content) => { logs.push({ type, content }) },
    )

    expect(logs).toEqual([
      {
        type: 'error',
        content: '[CMD] $ git diff --cached --quiet  →  error: fatal: unable to read index',
      },
    ])
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
    // The full content = "[CMD] $ git diff  →  " prefix + truncated output.
    const prefix = '[CMD] $ git diff'
    expect(logs[0]!.length).toBeLessThan(prefix.length + 2500 + 20)
  })
})
