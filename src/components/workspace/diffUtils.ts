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

export interface FileDiff {
  filename: string
  additions: number
  deletions: number
  lines: string[]
}

export function parseFileDiffs(diff: string): FileDiff[] {
  const result: FileDiff[] = []
  let current: FileDiff | null = null

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/)
      current = { filename: match?.[1] ?? 'unknown', additions: 0, deletions: 0, lines: [line] }
      result.push(current)
    } else if (current) {
      current.lines.push(line)
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++
      else if (line.startsWith('-') && !line.startsWith('---')) current.deletions++
    }
  }

  return result
}
