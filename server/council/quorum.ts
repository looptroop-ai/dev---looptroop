import type { DraftResult } from './types'

export function checkQuorum(
  results: DraftResult[],
  minQuorum: number = 2,
): { passed: boolean; validCount: number; message: string } {
  const validCount = results.filter(r => r.outcome === 'completed' && r.content).length

  if (validCount >= minQuorum) {
    return { passed: true, validCount, message: `Quorum met: ${validCount} valid responses` }
  }

  // Collect failure reasons for diagnostics
  const failures = results
    .filter(r => r.outcome !== 'completed')
    .map(r => {
      const reason = r.content.startsWith('error: ') ? r.content.slice(7) : r.outcome
      return `${r.memberId}: ${reason}`
    })
  const failureDetail = failures.length > 0 ? ` Failures: ${failures.join('; ')}` : ''

  return {
    passed: false,
    validCount,
    message: `Quorum not met: ${validCount}/${minQuorum} required valid responses.${failureDetail}`,
  }
}
