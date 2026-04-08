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

export interface DiffLineInfo {
  text: string
  oldNum: number | null
  newNum: number | null
}

export interface FileDiff {
  filename: string
  additions: number
  deletions: number
  lines: string[]
}

/** Parse hunk header like "@@ -10,5 +12,7 @@" into starting line numbers */
function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!m) return null
  return { oldStart: parseInt(m[1]!, 10), newStart: parseInt(m[2]!, 10) }
}

/** Compute per-line old/new line numbers from a list of raw diff lines */
export function computeLineNumbers(lines: string[]): DiffLineInfo[] {
  let oldNum = 0
  let newNum = 0
  return lines.map((line) => {
    if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ')) {
      return { text: line, oldNum: null, newNum: null }
    }
    if (line.startsWith('@@')) {
      const hunk = parseHunkHeader(line)
      if (hunk) {
        oldNum = hunk.oldStart
        newNum = hunk.newStart
      }
      return { text: line, oldNum: null, newNum: null }
    }
    if (line.startsWith('+')) {
      const info: DiffLineInfo = { text: line, oldNum: null, newNum: newNum }
      newNum++
      return info
    }
    if (line.startsWith('-')) {
      const info: DiffLineInfo = { text: line, oldNum: oldNum, newNum: null }
      oldNum++
      return info
    }
    // context line
    const info: DiffLineInfo = { text: line, oldNum: oldNum, newNum: newNum }
    oldNum++
    newNum++
    return info
  })
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
