import { buildTextDiffSegments, type TextDiffSegment } from './textDiffSegments'

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

export interface HighlightedDiffLineInfo extends DiffLineInfo {
  wordDiffSegments?: TextDiffSegment[]
}

export interface FileDiff {
  filename: string
  additions: number
  deletions: number
  lines: string[]
}

function isAdditionLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++')
}

function isRemovalLine(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('---')
}

function hasChangedSegments(segments: TextDiffSegment[]): boolean {
  return segments.some((segment) => segment.changed)
}

function applyWordDiffPair(lines: HighlightedDiffLineInfo[], removedIndex: number, addedIndex: number) {
  const diff = buildTextDiffSegments(lines[removedIndex]?.text.slice(1), lines[addedIndex]?.text.slice(1))

  if (hasChangedSegments(diff.before)) {
    lines[removedIndex]!.wordDiffSegments = diff.before
  }
  if (hasChangedSegments(diff.after)) {
    lines[addedIndex]!.wordDiffSegments = diff.after
  }
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

export function computeLineNumbersWithWordDiff(lines: string[]): HighlightedDiffLineInfo[] {
  const numbered = computeLineNumbers(lines).map((line) => ({ ...line }))
  let index = 0

  while (index < numbered.length) {
    if (!numbered[index]?.text.startsWith('@@')) {
      index += 1
      continue
    }

    index += 1

    while (index < numbered.length) {
      const currentLine = numbered[index]?.text ?? ''
      if (currentLine.startsWith('@@') || currentLine.startsWith('diff --git')) break

      if (!isRemovalLine(currentLine) && !isAdditionLine(currentLine)) {
        index += 1
        continue
      }

      const removedIndices: number[] = []
      const addedIndices: number[] = []

      while (index < numbered.length) {
        const line = numbered[index]?.text ?? ''
        if (isRemovalLine(line)) {
          removedIndices.push(index)
          index += 1
          continue
        }
        if (isAdditionLine(line)) {
          addedIndices.push(index)
          index += 1
          continue
        }
        break
      }

      const pairCount = Math.min(removedIndices.length, addedIndices.length)
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        applyWordDiffPair(numbered, removedIndices[pairIndex]!, addedIndices[pairIndex]!)
      }
    }
  }

  return numbered
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
