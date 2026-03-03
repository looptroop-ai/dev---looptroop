import type { DraftResult } from './types'

export function checkQuorum(
  results: DraftResult[],
  minQuorum: number = 2,
): { passed: boolean; validCount: number; message: string } {
  const validCount = results.filter(r => r.outcome === 'completed' && r.content).length

  if (validCount >= minQuorum) {
    return { passed: true, validCount, message: `Quorum met: ${validCount} valid responses` }
  }

  return {
    passed: false,
    validCount,
    message: `Quorum not met: ${validCount}/${minQuorum} required valid responses`,
  }
}
