export function parseDiffStats(diff: string): { files: number; additions: number; deletions: number } {
  let files = 0
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) files++
    else if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { files, additions, deletions }
}
