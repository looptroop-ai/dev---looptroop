import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFixtureRepoManager } from '../../../test/fixtureRepo'
import { prepareSquashCandidate, pushSquashedCandidate } from '../squash'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-squash-',
  files: {
    'README.md': 'base\n',
  },
})

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim()
}

afterAll(() => {
  repoManager.cleanup()
})

describe('prepareSquashCandidate', () => {
  it('squashes multiple commits into one', () => {
    const repoDir = repoManager.createRepo()

    git(repoDir, ['checkout', '-b', 'TICKET-1'])
    writeFileSync(resolve(repoDir, 'a.txt'), 'aaa\n')
    git(repoDir, ['add', 'a.txt'])
    git(repoDir, ['commit', '-m', 'add a'])
    writeFileSync(resolve(repoDir, 'b.txt'), 'bbb\n')
    git(repoDir, ['add', 'b.txt'])
    git(repoDir, ['commit', '-m', 'add b'])
    writeFileSync(resolve(repoDir, 'c.txt'), 'ccc\n')
    git(repoDir, ['add', 'c.txt'])
    git(repoDir, ['commit', '-m', 'add c'])

    const result = prepareSquashCandidate(repoDir, 'main', 'Add features', 'TICKET-1')

    expect(result.success).toBe(true)
    expect(result.commitCount).toBe(3)
    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(result.message).toContain('TICKET-1')

    const commitMsg = git(repoDir, ['log', '-1', '--pretty=%s'])
    expect(commitMsg).toBe('TICKET-1: Add features')
  })

  it('returns failure when no changes exist relative to base', () => {
    const repoDir = repoManager.createRepo()

    git(repoDir, ['checkout', '-b', 'TICKET-2'])

    const result = prepareSquashCandidate(repoDir, 'main', 'Empty', 'TICKET-2')

    expect(result.success).toBe(false)
    expect(result.message).toContain('No candidate changes')
  })

  it('returns failure for an invalid worktree path', () => {
    const result = prepareSquashCandidate('/nonexistent/path', 'main', 'title', 'TICKET-3')

    expect(result.success).toBe(false)
  })

  it('squashes a single commit', () => {
    const repoDir = repoManager.createRepo()

    git(repoDir, ['checkout', '-b', 'TICKET-4'])
    writeFileSync(resolve(repoDir, 'only.txt'), 'only\n')
    git(repoDir, ['add', 'only.txt'])
    git(repoDir, ['commit', '-m', 'only commit'])

    const result = prepareSquashCandidate(repoDir, 'main', 'Single change', 'TICKET-4')

    expect(result.success).toBe(true)
    expect(result.commitCount).toBe(1)
    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)

    const commitMsg = git(repoDir, ['log', '-1', '--pretty=%s'])
    expect(commitMsg).toBe('TICKET-4: Single change')
  })
})

describe('pushSquashedCandidate', () => {
  it('returns failure when no remote is configured', () => {
    const repoDir = repoManager.createRepo()

    const result = pushSquashedCandidate(repoDir)

    expect(result.pushed).toBe(false)
    expect(result.error).toMatch(/push failed/i)
  })
})
