import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFixtureRepoManager } from '../../../test/fixtureRepo'
import { completeManualVerificationMerge } from '../manual'

vi.mock('../../../git/push', () => ({
  pushBranchRef: () => ({ pushed: true }),
}))

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-manual-verification-',
  files: {
    'README.md': 'base\n',
  },
})

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim()
}

describe('completeManualVerificationMerge', () => {
  afterAll(() => {
    repoManager.cleanup()
  })

  it('merges the ticket branch into the configured base branch', () => {
    const repoDir = repoManager.createRepo()
    const readmePath = resolve(repoDir, 'README.md')

    git(repoDir, ['checkout', '-b', 'TEST-1'])
    writeFileSync(readmePath, 'ticket change\n')
    git(repoDir, ['add', 'README.md'])
    git(repoDir, ['commit', '-m', 'ticket change'])
    git(repoDir, ['checkout', 'main'])

    const report = completeManualVerificationMerge({
      projectPath: repoDir,
      baseBranch: 'main',
      ticketBranch: 'TEST-1',
    })

    expect(report.success).toBe(true)
    expect(report.baseBranch).toBe('main')
    expect(readFileSync(readmePath, 'utf8')).toBe('ticket change\n')
  })

  it('returns a merge-conflict error when the base branch cannot absorb the candidate cleanly', () => {
    const repoDir = repoManager.createRepo()
    const readmePath = resolve(repoDir, 'README.md')

    git(repoDir, ['checkout', '-b', 'TEST-2'])
    writeFileSync(readmePath, 'ticket branch change\n')
    git(repoDir, ['add', 'README.md'])
    git(repoDir, ['commit', '-m', 'ticket branch change'])

    git(repoDir, ['checkout', 'main'])
    writeFileSync(readmePath, 'main branch change\n')
    git(repoDir, ['add', 'README.md'])
    git(repoDir, ['commit', '-m', 'main branch change'])

    const report = completeManualVerificationMerge({
      projectPath: repoDir,
      baseBranch: 'main',
      ticketBranch: 'TEST-2',
    })

    expect(report.success).toBe(false)
    expect(report.errorCode).toBe('VERIFICATION_MERGE_CONFLICT')
    expect(git(repoDir, ['status', '--porcelain'])).toBe('')
  })
})
