import type { TextDiffSegment } from './textDiffSegments'

function highlightClassName(tone: 'added' | 'removed'): string {
  return tone === 'removed'
    ? 'rounded-[0.2rem] bg-red-300/80 px-0.5 text-inherit dark:bg-red-500/40'
    : 'rounded-[0.2rem] bg-green-300/80 px-0.5 text-inherit dark:bg-green-500/40'
}

export function renderWordDiffSegments(segments: TextDiffSegment[], tone: 'added' | 'removed') {
  const wordHighlightClassName = highlightClassName(tone)

  return segments.map((segment, index) => (
    segment.changed && segment.text.trim()
      ? <mark key={`${tone}-${index}`} className={wordHighlightClassName}>{segment.text}</mark>
      : <span key={`${tone}-${index}`}>{segment.text}</span>
  ))
}

export function renderUnifiedDiffLineText(text: string, segments?: TextDiffSegment[]) {
  if (!segments || segments.length === 0) return text || '\u00A0'

  const prefix = text.slice(0, 1)
  const tone = prefix === '+'
    ? 'added'
    : prefix === '-'
      ? 'removed'
      : null

  if (!tone) return text || '\u00A0'

  return (
    <>
      <span>{prefix}</span>
      {renderWordDiffSegments(segments, tone)}
    </>
  )
}
