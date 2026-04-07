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
    // Verify single-line format (no embedded newlines)
    expect(logs[0]).not.toContain('\n')
  })

  it('emits single-line format with [CMD] prefix', () => {
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

    // Success with stdout
    expect(logs[0]!.type).toBe('info')
    expect(logs[0]!.content).toBe('[CMD] $ git worktree add /tmp/wt BR-1  →  Preparing worktree')

    // Success without stdout
    expect(logs[1]!.type).toBe('info')
    expect(logs[1]!.content).toBe('[CMD] $ git rev-parse --show-toplevel  →  ok')

    // Failure
    expect(logs[2]!.type).toBe('error')
    expect(logs[2]!.content).toBe('[CMD] $ git push  →  error: remote rejected')

    // All entries are single-line
    for (const log of logs) {
      expect(log.content).not.toContain('\n')
    }
  })

  it('combines stdout and stderr on success', () => {
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
    expect(logs[0]).toContain('Preparing worktree')
    expect(logs[0]).not.toContain('\n')
  })

  it('shows both stdout and stderr separated by | when both present', () => {
    const logs: string[] = []
    withCommandLogging(
      'test-ticket', 'TEST-1', 'DRAFT',
      () => {
        logCommand('git', ['commit', '-m', 'msg'], { ok: true, stdout: 'abc1234', stderr: '1 file changed' })
      },
      (_phase, _type, content) => { logs.push(content) },
    )
    expect(logs[0]).toContain('abc1234 | 1 file changed')
  })

  it('normalizes multi-line output to single line', () => {
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
    expect(logs[0]).not.toContain('\n')
    expect(logs[0]).toContain('file1.ts')
  })
})
