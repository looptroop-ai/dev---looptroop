import { describe, expect, it } from 'vitest'
import { parseDiffStats } from '../diffUtils'

describe('parseDiffStats', () => {
  it('counts files, additions and deletions from a unified diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5',
      'diff --git a/src/bar.ts b/src/bar.ts',
      'index abc1234..def5678 100644',
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1,2 +1,1 @@',
      '-old line',
      ' kept line',
    ].join('\n')

    const stats = parseDiffStats(diff)
    expect(stats.files).toBe(2)
    expect(stats.additions).toBe(2)
    expect(stats.deletions).toBe(2)
  })

  it('returns zeros for empty diff', () => {
    expect(parseDiffStats('')).toEqual({ files: 0, additions: 0, deletions: 0 })
  })

  it('does not count --- and +++ header lines', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-removed',
      '+added',
    ].join('\n')

    const stats = parseDiffStats(diff)
    expect(stats.additions).toBe(1)
    expect(stats.deletions).toBe(1)
  })
})
