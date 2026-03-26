const TRANSCRIPT_PREFIX_PATTERN = /^\s*\[(?:assistant|user|system|sys|tool|model|error)(?:\/[^\]]+)?\](?:\s*\[[^\]]+\])?\s*/i

const COMMON_PROMPT_ECHO_MARKERS = [
  'CRITICAL OUTPUT RULE:',
  'CONTEXT REFRESH:',
  '## System Role',
  '## Task',
  '## Instructions',
  '## Expected Output Format',
  '## Context',
]

const HARD_PROMPT_ECHO_MARKERS = [
  'CRITICAL OUTPUT RULE:',
  'CONTEXT REFRESH:',
]

export function stripPromptEchoTranscriptPrefixes(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(TRANSCRIPT_PREFIX_PATTERN, ''))
    .join('\n')
    .trim()
}

export function looksLikePromptEcho(content: string, extraMarkers: string[] = []): boolean {
  const normalized = stripPromptEchoTranscriptPrefixes(content)
  if (!normalized) return false

  const allMarkers = [...COMMON_PROMPT_ECHO_MARKERS, ...extraMarkers]
  let totalHits = 0
  let hardHits = 0

  for (const marker of allMarkers) {
    if (!normalized.includes(marker)) continue
    totalHits += 1
    if (HARD_PROMPT_ECHO_MARKERS.includes(marker)) {
      hardHits += 1
    }
  }

  return hardHits >= 1 && totalHits >= 2
}
