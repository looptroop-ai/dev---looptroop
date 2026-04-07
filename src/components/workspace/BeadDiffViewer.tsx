import { useQuery } from '@tanstack/react-query'
import { Loader2, FileCode2 } from 'lucide-react'

interface BeadDiffViewerProps {
  ticketId: string
  beadId: string
}

interface DiffResponse {
  diff: string
  captured: boolean
}

async function fetchBeadDiff(ticketId: string, beadId: string): Promise<DiffResponse> {
  const response = await fetch(`/api/tickets/${ticketId}/beads/${beadId}/diff`)
  if (!response.ok) return { diff: '', captured: false }
  return response.json()
}

function parseDiffStats(diff: string): { files: number; additions: number; deletions: number } {
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

function DiffContent({ diff }: { diff: string }) {
  const lines = diff.split('\n')

  return (
    <pre className="text-xs font-mono leading-relaxed overflow-auto">
      {lines.map((line, i) => {
        let className = 'px-3 py-px block'
        if (line.startsWith('diff --git')) {
          className += ' text-foreground font-semibold bg-muted/50 mt-2 first:mt-0 border-t border-border pt-1'
        } else if (line.startsWith('@@')) {
          className += ' text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          className += ' text-green-700 dark:text-green-400 bg-green-50/60 dark:bg-green-950/20'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          className += ' text-red-700 dark:text-red-400 bg-red-50/60 dark:bg-red-950/20'
        } else if (line.startsWith('---') || line.startsWith('+++')) {
          className += ' text-muted-foreground font-medium'
        } else {
          className += ' text-muted-foreground'
        }
        return (
          <span key={i} className={className}>
            {line || '\u00A0'}
          </span>
        )
      })}
    </pre>
  )
}

export function BeadDiffViewer({ ticketId, beadId }: BeadDiffViewerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['bead-diff', ticketId, beadId],
    queryFn: () => fetchBeadDiff(ticketId, beadId),
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading diff…
      </div>
    )
  }

  if (!data?.captured) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <FileCode2 className="h-4 w-4" />
        Diff not yet captured for this bead.
      </div>
    )
  }

  if (!data.diff.trim()) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <FileCode2 className="h-4 w-4" />
        No code changes in this bead.
      </div>
    )
  }

  const stats = parseDiffStats(data.diff)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-xs text-muted-foreground shrink-0">
        <span>{stats.files} file{stats.files !== 1 ? 's' : ''}</span>
        <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
        <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <DiffContent diff={data.diff} />
      </div>
    </div>
  )
}

export { parseDiffStats }
