import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useLogs } from '@/context/useLogContext'
import { useQuery } from '@tanstack/react-query'
import { QUERY_STALE_TIME_5M } from '@/lib/constants'
import { Loader2, CheckCircle2, Circle, Play, Eye, FileCode2, List, Brain, Clock, GitCommit, Tag, Link2, ArrowRight, ArrowUpToLine, ArrowDownToLine, Copy, Check } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { BeadDiffViewer } from './BeadDiffViewer'
import { LogEntryRow } from './LogLine'
import { filterBeadLogEntries } from './logFormat'
import { VerificationSummaryPanel } from './VerificationSummaryPanel'
import type { Ticket } from '@/hooks/useTickets'
import { useTicketAction } from '@/hooks/useTickets'
import { cn } from '@/lib/utils'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { parsePrdDocument, parsePrdDocumentContent, normalizePrdDocumentLike } from '@/lib/prdDocument'
import type { PrdDocument } from '@/lib/prdDocument'
import { isStatusAtOrPast } from '@shared/workflowMeta'

interface CodingViewProps {
  ticket: Ticket
  readOnly?: boolean
}

interface TicketBead {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  iteration: number
  priority: number
  issueType: string
  externalRef: string
  labels: string[]
  prdRefs: string[]
  acceptanceCriteria: string[]
  tests: string[]
  testCommands: string[]
  targetFiles: string[]
  contextGuidance: { patterns: string[]; anti_patterns: string[] }
  dependencies: { blocked_by: string[]; blocks: string[] }
  notes: string
  createdAt: string
  updatedAt: string
  completedAt: string
  startedAt: string
  beadStartCommit: string | null
}

function resolveCodingReviewStatus(ticket: Pick<Ticket, 'status' | 'previousStatus' | 'reviewCutoffStatus'>): string | null {
  if (ticket.status === 'BLOCKED_ERROR') {
    return ticket.previousStatus ?? ticket.reviewCutoffStatus ?? null
  }

  if (ticket.status === 'CANCELED') {
    if (ticket.reviewCutoffStatus) return ticket.reviewCutoffStatus
    return ticket.previousStatus && ticket.previousStatus !== 'BLOCKED_ERROR'
      ? ticket.previousStatus
      : null
  }

  return ticket.status
}

function shouldShowCompletedCodingState(
  ticket: Pick<Ticket, 'status' | 'previousStatus' | 'reviewCutoffStatus'>,
  readOnly?: boolean,
): boolean {
  if (ticket.status === 'COMPLETED') return true
  if (!readOnly) return false

  const reviewStatus = resolveCodingReviewStatus(ticket)
  return reviewStatus ? isStatusAtOrPast(reviewStatus, 'RUNNING_FINAL_TEST') : false
}

function normalizeNotes(input: unknown): string {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join('\n\n---\n\n')
  }
  return ''
}

function splitRenderedNotes(notes: string): string[] {
  const normalized = notes.trim()
  if (!normalized) return []
  return normalized
    .split(/\n\s*---\s*\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatTimestamp(iso: string): React.ReactNode {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    
    const timeString = d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    
    const ms = d.getMilliseconds().toString().padStart(3, '0')
    
    return (
      <>
        {timeString}.<span className="opacity-40">{ms}</span>
      </>
    )
  } catch {
    return iso
  }
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const diff = Date.now() - d.getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

function normalizeBead(input: {
  id: string
  title: string
  status: string
  iteration: number
  description?: string
  priority?: number
  issueType?: string
  externalRef?: string
  labels?: string[]
  prdRefs?: string[]
  acceptanceCriteria?: string[]
  tests?: string[]
  testCommands?: string[]
  targetFiles?: string[]
  contextGuidance?: { patterns?: string[]; anti_patterns?: string[] }
  dependencies?: { blocked_by?: string[]; blocks?: string[] }
  notes?: string | string[]
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  startedAt?: string | null
  beadStartCommit?: string | null
}): TicketBead {
  const STATUS_MAP: Record<string, TicketBead['status']> = {
    done: 'completed',
    error: 'failed',
  }
  const allowedStatuses: TicketBead['status'][] = ['pending', 'in_progress', 'completed', 'failed', 'skipped']
  const mappedStatus = STATUS_MAP[input.status] ?? input.status
  const status = allowedStatuses.includes(mappedStatus as TicketBead['status'])
    ? mappedStatus as TicketBead['status']
    : 'pending'

  const cg = input.contextGuidance
  const contextGuidance = cg && typeof cg === 'object' && !Array.isArray(cg)
    ? { patterns: Array.isArray(cg.patterns) ? cg.patterns : [], anti_patterns: Array.isArray(cg.anti_patterns) ? cg.anti_patterns : [] }
    : { patterns: [], anti_patterns: [] }

  const deps = input.dependencies
  const dependencies = deps && typeof deps === 'object' && !Array.isArray(deps)
    ? { blocked_by: Array.isArray(deps.blocked_by) ? deps.blocked_by : [], blocks: Array.isArray(deps.blocks) ? deps.blocks : [] }
    : { blocked_by: [], blocks: [] }

  return {
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    status,
    iteration: input.iteration ?? 0,
    priority: input.priority ?? 0,
    issueType: input.issueType ?? '',
    externalRef: input.externalRef ?? '',
    labels: Array.isArray(input.labels) ? input.labels : [],
    prdRefs: Array.isArray(input.prdRefs) ? input.prdRefs : [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    tests: input.tests ?? [],
    testCommands: input.testCommands ?? [],
    targetFiles: Array.isArray(input.targetFiles) ? input.targetFiles : [],
    contextGuidance,
    dependencies,
    notes: normalizeNotes(input.notes),
    createdAt: input.createdAt ?? '',
    updatedAt: input.updatedAt ?? '',
    completedAt: input.completedAt ?? '',
    startedAt: input.startedAt ?? '',
    beadStartCommit: input.beadStartCommit ?? null,
  }
}

function mergeBeadRuntimeOverlay(
  beads: TicketBead[],
  runtimeBeads: Ticket['runtime']['beads'] | undefined,
): TicketBead[] {
  if (!Array.isArray(runtimeBeads) || runtimeBeads.length === 0) return beads

  const runtimeById = new Map(
    runtimeBeads
      .filter((bead): bead is NonNullable<Ticket['runtime']['beads']>[number] =>
        Boolean(bead && typeof bead.id === 'string' && bead.id.length > 0),
      )
      .map((bead) => [bead.id, normalizeBead(bead)]),
  )

  const seen = new Set<string>()
  const merged = beads.map((bead) => {
    const runtimeBead = runtimeById.get(bead.id)
    if (!runtimeBead) return bead
    seen.add(bead.id)

    if (
      bead.title === runtimeBead.title
      && bead.status === runtimeBead.status
      && bead.iteration === runtimeBead.iteration
      && bead.notes === runtimeBead.notes
    ) {
      return bead
    }

    return {
      ...bead,
      title: runtimeBead.title || bead.title,
      status: runtimeBead.status,
      iteration: runtimeBead.iteration,
      notes: runtimeBead.notes,
    }
  })

  for (const runtimeBead of runtimeById.values()) {
    if (seen.has(runtimeBead.id)) continue
    merged.push(runtimeBead)
  }

  return merged
}

async function fetchTicketBeads(ticketId: string): Promise<TicketBead[]> {
  const response = await fetch(`/api/tickets/${ticketId}/beads`)
  if (!response.ok) return []
  const payload = await response.json()
  return Array.isArray(payload)
    ? payload
        .filter((item): item is {
          id: string
          title: string
          status: string
          iteration: number
          description?: string
          priority?: number
          issueType?: string
          externalRef?: string
          labels?: string[]
          prdRefs?: string[]
          acceptanceCriteria?: string[]
          tests?: string[]
          testCommands?: string[]
          targetFiles?: string[]
          contextGuidance?: { patterns?: string[]; anti_patterns?: string[] }
          dependencies?: { blocked_by?: string[]; blocks?: string[] }
          notes?: string | string[]
          createdAt?: string
          updatedAt?: string
          completedAt?: string
          startedAt?: string
          beadStartCommit?: string | null
        } =>
          Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { title?: unknown }).title === 'string'),
        )
        .map((item) => normalizeBead(item))
    : []
}

function statusIcon(status: TicketBead['status']) {
  switch (status) {
    case 'completed':
    case 'skipped':
      return <CheckCircle2 className="h-3 w-3 text-green-600" />
    case 'in_progress':
      return <Play className="h-3 w-3 text-primary fill-primary" />
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />
  }
}

const COMPACT_THRESHOLD = 15

function usePrdDocument(ticketId: string): { prd: PrdDocument | null; isLoading: boolean; isError: boolean } {
  const { data: fetchedContent, isLoading, isError } = useQuery({
    queryKey: ['artifact', ticketId, 'prd'],
    queryFn: async () => {
      const response = await fetch(`/api/files/${ticketId}/prd`)
      if (!response.ok) throw new Error(`PRD fetch failed: ${response.status}`)
      const payload = await response.json() as { content?: string }
      return payload.content ?? ''
    },
    staleTime: QUERY_STALE_TIME_5M,
  })
  const prd = useMemo(
    () => fetchedContent ? normalizePrdDocumentLike(parsePrdDocument(fetchedContent) ?? parsePrdDocumentContent(fetchedContent).document) : null,
    [fetchedContent],
  )
  return { prd, isLoading, isError }
}

function lookupPrdRef(prd: PrdDocument | null, ref: string): { type: 'epic'; title: string; objective: string } | { type: 'story'; title: string; epicTitle: string; acceptanceCriteria: string[] } | null {
  if (!prd) return null
  // Extract embedded IDs from composite refs like "EPIC-1 / US-1.1"
  const ids = ref.match(/\b(?:EPIC|US)-[A-Za-z0-9.-]+\b/gi) ?? [ref]
  for (const id of ids) {
    for (const epic of prd.epics) {
      if (epic.id === id) {
        return { type: 'epic', title: epic.title, objective: epic.objective }
      }
      for (const story of epic.user_stories) {
        if (story.id === id) {
          return { type: 'story', title: story.title, epicTitle: epic.title, acceptanceCriteria: story.acceptance_criteria }
        }
      }
    }
  }
  return null
}

function PrdRefHoverCard({ refId, prd, isLoading, isError }: { refId: string; prd: PrdDocument | null; isLoading: boolean; isError: boolean }) {
  const match = lookupPrdRef(prd, refId)

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <code className="text-[10px] bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded font-mono cursor-help">{refId}</code>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72">
        {match ? (
          match.type === 'epic' ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">Epic</Badge>
                <span className="text-xs font-medium truncate">{match.title}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{match.objective}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">Story</Badge>
                <span className="text-xs font-medium truncate">{match.title}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Epic: {match.epicTitle}</div>
              {match.acceptanceCriteria.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground mb-0.5">Acceptance Criteria</div>
                  <ul className="text-[11px] space-y-0.5 pl-2 max-h-[200px] overflow-y-auto">
                    {match.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="text-muted-foreground leading-snug">- {ac}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="text-xs text-muted-foreground italic">
            {isLoading ? 'Loading PRD…' : isError ? 'PRD unavailable' : prd ? 'Reference not found in PRD' : 'PRD not loaded'}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function LabelHoverCard({ label, beads, currentBeadId, onSelectBead }: {
  label: string
  beads: TicketBead[]
  currentBeadId: string
  onSelectBead: (id: string) => void
}) {
  const matching = useMemo(
    () => beads.filter((b) => b.id !== currentBeadId && b.labels.includes(label)),
    [beads, label, currentBeadId],
  )

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="inline-flex cursor-help">
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{label}</Badge>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72">
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Beads with "{label}"
          </div>
          {matching.length > 0 ? (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {matching.map((bead) => (
                <button
                  key={bead.id}
                  type="button"
                  onClick={() => onSelectBead(bead.id)}
                  className="w-full text-left rounded-md border border-border/70 bg-background px-2 py-1 transition-colors hover:bg-accent/30"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {statusIcon(bead.status)}
                    <span className="text-[11px] truncate flex-1">{bead.title}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] h-3.5 px-1 shrink-0',
                        bead.status === 'completed' && 'border-green-600/40 text-green-700 dark:text-green-400',
                        bead.status === 'in_progress' && 'border-primary/40 text-primary',
                        bead.status === 'failed' && 'border-red-600/40 text-red-700 dark:text-red-400',
                      )}
                    >
                      {bead.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground italic">No other beads share this label.</div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function BeadRefHoverCard({ beadId, beads, onSelectBead }: {
  beadId: string
  beads: TicketBead[]
  onSelectBead: (id: string) => void
}) {
  const bead = useMemo(() => beads.find((b) => b.id === beadId), [beads, beadId])

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <code
          className="text-[10px] bg-orange-500/10 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded font-mono mr-1 cursor-help"
        >
          {beadId}
        </code>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72">
        {bead ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              {statusIcon(bead.status)}
              <span className="text-xs font-medium truncate flex-1">{bead.title}</span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] h-3.5 px-1 shrink-0',
                  bead.status === 'completed' && 'border-green-600/40 text-green-700 dark:text-green-400',
                  bead.status === 'in_progress' && 'border-primary/40 text-primary',
                  bead.status === 'failed' && 'border-red-600/40 text-red-700 dark:text-red-400',
                )}
              >
                {bead.status.replace('_', ' ')}
              </Badge>
            </div>
            {bead.description && (
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">{bead.description}</p>
            )}
            {bead.iteration > 0 && (
              <div className="text-[10px] text-muted-foreground">Iteration: {bead.iteration}</div>
            )}
            <button
              type="button"
              onClick={() => onSelectBead(bead.id)}
              className="text-[10px] text-primary hover:underline"
            >
              View bead →
            </button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">Bead not found</div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function TargetFileRow({ file }: { file: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback: select text if clipboard API not available
    }
  }

  return (
    <div className="group flex items-center gap-1">
      <code className="block text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono truncate flex-1" title={file}>{file}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
        title="Copy path"
      >
        {copied
          ? <Check className="h-3 w-3 text-green-500" />
          : <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />}
      </button>
    </div>
  )
}

function BeadProgressSummary({ beads }: { beads: TicketBead[] }) {
  const done = beads.filter((b) => b.status === 'completed' || b.status === 'skipped').length
  const active = beads.find((b) => b.status === 'in_progress')
  const failed = beads.filter((b) => b.status === 'failed').length
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{done}/{beads.length}</span>
      <span>done</span>
      {active && (
        <>
          <span>•</span>
          <span className="text-primary font-medium truncate max-w-[200px]">{active.title}</span>
        </>
      )}
      {failed > 0 && (
        <>
          <span>•</span>
          <span className="text-red-600 dark:text-red-400">{failed} failed</span>
        </>
      )}
    </div>
  )
}

function BeadGrid({
  beads,
  viewingBeadId,
  onSelect,
}: {
  beads: TicketBead[]
  viewingBeadId: string | null
  onSelect: (id: string | null) => void
}) {
  const compact = beads.length > COMPACT_THRESHOLD

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <BeadProgressSummary beads={beads} />
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(28px, 1fr))` }}
        >
          {beads.map((bead, index) => (
            <button
              key={bead.id}
              onClick={() => onSelect(viewingBeadId === bead.id ? null : bead.id)}
              title={`#${index + 1}: ${bead.title}${bead.iteration > 0 ? ` (${bead.iteration}x)` : ''}`}
              className={cn(
                'h-7 w-full rounded text-[10px] font-mono font-medium transition-colors',
                bead.status === 'completed' || bead.status === 'skipped'
                  ? 'bg-green-500/20 text-green-700 dark:text-green-400 border border-green-600/20'
                  : bead.status === 'in_progress'
                    ? 'bg-primary/20 text-primary border border-primary/40 animate-pulse'
                    : bead.status === 'failed'
                      ? 'bg-red-500/20 text-red-700 dark:text-red-400 border border-red-600/20'
                      : 'bg-muted text-muted-foreground border border-border opacity-60',
                viewingBeadId === bead.id && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              )}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BeadProgressSummary beads={beads} />
      <div className="flex flex-wrap gap-1.5">
        {beads.map((bead, index) => (
          <button
            key={bead.id}
            onClick={() => onSelect(viewingBeadId === bead.id ? null : bead.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors',
              bead.status === 'in_progress' && 'border-primary bg-primary/10 font-medium animate-pulse',
              (bead.status === 'completed' || bead.status === 'skipped') && 'border-green-600/30 bg-green-50 dark:bg-green-900/20',
              bead.status === 'failed' && 'border-red-600/30 bg-red-50 dark:bg-red-900/20',
              bead.status === 'pending' && 'border-border opacity-70',
              viewingBeadId === bead.id && 'ring-2 ring-primary',
            )}
            title={bead.title}
          >
            {statusIcon(bead.status)}
            <span>{bead.title || `Bead ${index + 1}`}</span>
            {bead.iteration > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                {bead.iteration}x
              </Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CodingView({ ticket, readOnly }: CodingViewProps) {
  const [viewingBeadId, setViewingBeadId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'details' | 'changes' | 'model'>('details')
  const phaseForView = readOnly ? 'CODING' : ticket.status
  const showBeadControls = phaseForView === 'CODING'
  
  // -- Auto-scroll state for the model log tab --
  const viewportRef = useRef<HTMLDivElement>(null)
  const autoScrollEnabledRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isAtTop, setIsAtTop] = useState(true)

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const scroll = () => {
      const el = viewportRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
    }
    if (behavior === 'auto') {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      scroll()
      return
    }
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scroll()
    })
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distanceFromBottom <= 50
      autoScrollEnabledRef.current = atBottom
      setIsAutoScroll((prev) => (prev !== atBottom ? atBottom : prev))
      const atTop = el.scrollTop <= 50
      setIsAtTop((prev) => (prev !== atTop ? atTop : prev))
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [detailTab]) // re-bind when tab swaps in case the node remounts

  useEffect(() => {
    if (detailTab === 'model') {
      if (autoScrollEnabledRef.current) {
        scheduleScrollToBottom('auto')
      }
    }
  }, [detailTab, scheduleScrollToBottom]) // wait, we also need to trigger on new logs

  const logCtx = useLogs()
  const { mutate: performAction, isPending } = useTicketAction()
  const { data: fetchedBeads = [] } = useQuery({
    queryKey: ['ticket-beads', ticket.id],
    queryFn: () => fetchTicketBeads(ticket.id),
    enabled: showBeadControls && ticket.runtime.totalBeads > 0,
    placeholderData: showBeadControls
      ? (ticket.runtime.beads ?? []).map((bead) => normalizeBead(bead))
      : [],
    staleTime: 5000,
    refetchOnMount: false,
  })
  const beads = useMemo(
    () => showBeadControls
      ? mergeBeadRuntimeOverlay(fetchedBeads, ticket.runtime.beads)
      : [],
    [fetchedBeads, showBeadControls, ticket.runtime.beads],
  )

  const total = ticket.runtime.totalBeads || beads.length
  const current = ticket.runtime.currentBead
  const percent = ticket.runtime.percentComplete
  const activeIteration = ticket.runtime.activeBeadIteration
  const maxIterationsPerBead = ticket.runtime.maxIterationsPerBead
  const activeBead = ticket.runtime.activeBeadId
    ? beads.find((bead) => bead.id === ticket.runtime.activeBeadId)
    : null
  const phaseLabel = getStatusUserLabel(phaseForView, {
    currentBead: current,
    totalBeads: total,
    errorMessage: ticket.errorMessage,
  })
  const isCompleted = shouldShowCompletedCodingState(ticket, readOnly)
  const isAwaitingManualVerification = !readOnly && ticket.status === 'WAITING_PR_REVIEW'
  const viewedBead = useMemo(
    () => beads.find((bead) => bead.id === viewingBeadId) ?? null,
    [beads, viewingBeadId],
  )
  const { prd, isLoading: prdLoading, isError: prdError } = usePrdDocument(ticket.id)
  const beadLogEntries = useMemo(() => {
    if (!viewedBead) return []
    const phaseLogs = logCtx?.getLogsForPhase(phaseForView) ?? []
    const beadLogs = phaseLogs.filter((entry) => entry.beadId === viewedBead.id)
    return filterBeadLogEntries(beadLogs)
  }, [logCtx, phaseForView, viewedBead])
  
  useEffect(() => {
    if (detailTab === 'model' && autoScrollEnabledRef.current) {
      scheduleScrollToBottom('smooth')
    }
  }, [beadLogEntries.length, detailTab, scheduleScrollToBottom])

  const isViewingOther = viewedBead !== null

  useEffect(() => {
    if (!showBeadControls && viewingBeadId) {
      setViewingBeadId(null)
    }
  }, [showBeadControls, viewingBeadId])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
        {isCompleted
          ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          : <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
        <span className="text-sm font-medium">
          {isCompleted ? 'Completed Successfully' : phaseLabel}
        </span>
        {showBeadControls && (
          <>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all duration-500', isCompleted ? 'bg-green-600' : 'bg-primary')}
                style={{ width: `${isCompleted ? 100 : percent}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              {isCompleted ? `${Math.max(total, 0)}/${Math.max(total, 0)}` : `${current}/${Math.max(total, 0)}`}
            </span>
          </>
        )}
        {showBeadControls && activeIteration && activeIteration > 0 && (
          <span className="text-[11px] text-muted-foreground shrink-0">
            {activeBead?.title ?? ticket.runtime.activeBeadId ?? 'Bead'} · Iteration {activeIteration}
            {maxIterationsPerBead && maxIterationsPerBead > 0 ? `/${maxIterationsPerBead}` : ''}
          </span>
        )}
      </div>

      {isAwaitingManualVerification && (
        <VerificationSummaryPanel
          ticket={ticket}
          onMerge={() => performAction({ id: ticket.id, action: 'merge' })}
          onCloseUnmerged={() => performAction({ id: ticket.id, action: 'close_unmerged' })}
          isPending={isPending}
        />
      )}

      {isViewingOther && viewedBead && (
        <div className="px-4 py-1.5 border-b border-border bg-accent/50 flex items-center gap-2 shrink-0">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Viewing <span className="font-medium text-foreground">{viewedBead.title}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewingBeadId(null)}
            className="text-xs h-6 px-2 mx-auto"
          >
            {readOnly || isCompleted ? 'Close' : 'Back to live'}
          </Button>
        </div>
      )}

      {showBeadControls && beads.length > 0 && (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <BeadGrid beads={beads} viewingBeadId={viewingBeadId} onSelect={setViewingBeadId} />
        </div>
      )}

      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <PhaseArtifactsPanel phase={phaseForView} isCompleted={isCompleted} ticketId={ticket.id} />
      </div>

      <div className="flex-1 min-h-0 px-2 py-2 flex flex-col">
        {viewedBead ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-muted/30 overflow-hidden">
            <div className="flex items-center border-b border-border shrink-0">
              <button
                onClick={() => setDetailTab('details')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                  detailTab === 'details'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <List className="h-3 w-3" />
                Details
              </button>
              <button
                onClick={() => setDetailTab('changes')}
                disabled={viewedBead.status !== 'completed' && viewedBead.status !== 'skipped'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                  detailTab === 'changes'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                  (viewedBead.status !== 'completed' && viewedBead.status !== 'skipped') && 'opacity-40 cursor-not-allowed',
                )}
              >
                <FileCode2 className="h-3 w-3" />
                Changes
              </button>
              <button
                onClick={() => setDetailTab('model')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                  detailTab === 'model'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Brain className="h-3 w-3" />
                Log
              </button>
            </div>

            {detailTab === 'model' ? (
              <div className="relative flex-1 min-h-0 flex flex-col">
                <ScrollArea className="flex-1 min-h-0 h-full" viewportRef={viewportRef}>
                  <div className="font-mono text-xs bg-muted rounded-md p-3 min-h-[100px] w-full max-w-full">
                    {beadLogEntries.length > 0 ? (
                      beadLogEntries.map((entry, i) => (
                        <LogEntryRow key={entry.entryId} entry={entry} index={i} showModelName />
                      ))
                    ) : (
                      <span className="text-muted-foreground/50 italic">No logs for this bead.</span>
                    )}
                  </div>
                </ScrollArea>
                {beadLogEntries.length > 0 && !isAtTop && (
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => viewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="absolute top-4 right-6 p-2 bg-background/20 hover:bg-background backdrop-blur-sm border border-border/40 hover:border-border rounded-full shadow-sm hover:shadow pointer-events-auto text-muted-foreground hover:text-foreground transition-all z-10 opacity-40 hover:opacity-100"
                      >
                        <ArrowUpToLine className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">Go to top</TooltipContent>
                  </Tooltip>
                )}
                {beadLogEntries.length > 0 && !isAutoScroll && (
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          autoScrollEnabledRef.current = true
                          setIsAutoScroll(true)
                          scheduleScrollToBottom('smooth')
                        }}
                        className="absolute bottom-4 right-6 p-2 bg-background/20 hover:bg-background backdrop-blur-sm border border-border/40 hover:border-border rounded-full shadow-sm hover:shadow pointer-events-auto text-muted-foreground hover:text-foreground transition-all z-10 opacity-40 hover:opacity-100"
                      >
                        <ArrowDownToLine className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">Back to bottom</TooltipContent>
                  </Tooltip>
                )}
              </div>
            ) : detailTab === 'changes' && (viewedBead.status === 'completed' || viewedBead.status === 'skipped') ? (
              <div className="flex-1 min-h-0 overflow-auto">
                <BeadDiffViewer ticketId={ticket.id} beadId={viewedBead.id} />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
                {/* Header: title + ID */}
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {viewedBead.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">{viewedBead.id}</code>
                    {viewedBead.priority > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="font-medium text-foreground">#{viewedBead.priority}</span> priority
                      </span>
                    )}
                    {viewedBead.issueType && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">{viewedBead.issueType}</Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] h-4 px-1.5',
                        viewedBead.status === 'completed' && 'border-green-600/40 text-green-700 dark:text-green-400',
                        viewedBead.status === 'in_progress' && 'border-primary/40 text-primary',
                        viewedBead.status === 'failed' && 'border-red-600/40 text-red-700 dark:text-red-400',
                      )}
                    >
                      {viewedBead.status.replace('_', ' ')}
                    </Badge>
                    {viewedBead.iteration > 0 && (
                      <span>iteration {viewedBead.iteration}</span>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm whitespace-pre-wrap">{viewedBead.description || 'No bead description available.'}</p>

                {/* Timestamps */}
                {(viewedBead.createdAt || viewedBead.startedAt || viewedBead.updatedAt || viewedBead.completedAt) && (
                  <div className="border-l-2 border-sky-300 dark:border-sky-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Timeline
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {viewedBead.createdAt && (
                        <>
                          <span className="text-muted-foreground">Created</span>
                          <span>{formatTimestamp(viewedBead.createdAt)} <span className="text-muted-foreground/60">({relativeTime(viewedBead.createdAt)})</span></span>
                        </>
                      )}
                      {viewedBead.startedAt && (
                        <>
                          <span className="text-muted-foreground">Started</span>
                          <span>{formatTimestamp(viewedBead.startedAt)} <span className="text-muted-foreground/60">({relativeTime(viewedBead.startedAt)})</span></span>
                        </>
                      )}
                      {viewedBead.updatedAt && (
                        <>
                          <span className="text-muted-foreground">Updated</span>
                          <span>{formatTimestamp(viewedBead.updatedAt)} <span className="text-muted-foreground/60">({relativeTime(viewedBead.updatedAt)})</span></span>
                        </>
                      )}
                      {viewedBead.completedAt && (
                        <>
                          <span className="text-muted-foreground">Completed</span>
                          <span>{formatTimestamp(viewedBead.completedAt)} <span className="text-muted-foreground/60">({relativeTime(viewedBead.completedAt)})</span></span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* External Ref + Bead Start Commit */}
                {(viewedBead.externalRef || viewedBead.beadStartCommit) && (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {viewedBead.externalRef && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Link2 className="h-3 w-3" /> Ref: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">{viewedBead.externalRef}</code>
                      </span>
                    )}
                    {viewedBead.beadStartCommit && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <GitCommit className="h-3 w-3" /> Start commit: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">{viewedBead.beadStartCommit.slice(0, 8)}</code>
                      </span>
                    )}
                  </div>
                )}

                {/* PRD Refs */}
                {viewedBead.prdRefs.length > 0 && (
                  <div className="border-l-2 border-indigo-300 dark:border-indigo-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-1">PRD References</div>
                    <div className="flex flex-wrap gap-1">
                      {viewedBead.prdRefs.map((ref, i) => (
                        <PrdRefHoverCard key={`prd-${ref}-${i}`} refId={ref} prd={prd} isLoading={prdLoading} isError={prdError} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Labels */}
                {viewedBead.labels.length > 0 && (
                  <div className="border-l-2 border-pink-300 dark:border-pink-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-pink-600 dark:text-pink-400 mb-1 flex items-center gap-1">
                      <Tag className="h-3 w-3" /> Labels
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {viewedBead.labels.map((label, i) => (
                        <LabelHoverCard key={`label-${label}-${i}`} label={label} beads={beads} currentBeadId={viewedBead.id} onSelectBead={setViewingBeadId} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Dependencies */}
                {(viewedBead.dependencies.blocked_by.length > 0 || viewedBead.dependencies.blocks.length > 0) && (
                  <div className="border-l-2 border-orange-300 dark:border-orange-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1 flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" /> Dependencies
                    </div>
                    {viewedBead.dependencies.blocked_by.length > 0 && (
                      <div className="mt-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Blocked by: </span>
                        {viewedBead.dependencies.blocked_by.map((dep, i) => (
                          <BeadRefHoverCard key={`bb-${dep}-${i}`} beadId={dep} beads={beads} onSelectBead={setViewingBeadId} />
                        ))}
                      </div>
                    )}
                    {viewedBead.dependencies.blocks.length > 0 && (
                      <div className="mt-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Blocks: </span>
                        {viewedBead.dependencies.blocks.map((dep, i) => (
                          <BeadRefHoverCard key={`bl-${dep}-${i}`} beadId={dep} beads={beads} onSelectBead={setViewingBeadId} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Target Files */}
                {viewedBead.targetFiles.length > 0 && (
                  <div className="border-l-2 border-cyan-300 dark:border-cyan-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-cyan-600 dark:text-cyan-400 mb-1 flex items-center gap-1">
                      <FileCode2 className="h-3 w-3" /> Target Files
                    </div>
                    <div className="space-y-0.5">
                      {viewedBead.targetFiles.map((file, i) => (
                        <TargetFileRow key={`file-${file}-${i}`} file={file} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Context Guidance */}
                {(viewedBead.contextGuidance.patterns.length > 0 || viewedBead.contextGuidance.anti_patterns.length > 0) && (
                  <div className="border-l-2 border-violet-300 dark:border-violet-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400 mb-1">Context Guidance</div>
                    {viewedBead.contextGuidance.patterns.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Patterns</div>
                        <ul className="text-xs space-y-0.5 pl-3">
                          {viewedBead.contextGuidance.patterns.map((pattern) => (
                            <li key={pattern}>- {pattern}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {viewedBead.contextGuidance.anti_patterns.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Anti-patterns</div>
                        <ul className="text-xs space-y-0.5 pl-3">
                          {viewedBead.contextGuidance.anti_patterns.map((ap) => (
                            <li key={ap}>- {ap}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Acceptance Criteria */}
                {viewedBead.acceptanceCriteria.length > 0 && (
                  <div className="border-l-2 border-green-300 dark:border-green-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-green-600 dark:text-green-400 mb-1">Acceptance Criteria</div>
                    <ul className="text-xs space-y-1">
                      {viewedBead.acceptanceCriteria.map((criterion) => (
                        <li key={criterion}>- {criterion}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Tests */}
                {(viewedBead.tests.length > 0 || viewedBead.testCommands.length > 0) && (
                  <div className="border-l-2 border-amber-300 dark:border-amber-700 pl-2 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Tests</div>
                    {viewedBead.tests.length > 0 && (
                      <ul className="text-xs space-y-1">
                        {viewedBead.tests.map((test) => (
                          <li key={test}>- {test}</li>
                        ))}
                      </ul>
                    )}
                    {viewedBead.testCommands.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Test Commands</div>
                        <div className="space-y-1">
                          {viewedBead.testCommands.map((command) => (
                            <code key={command} className="block text-xs rounded bg-background border border-border px-2 py-1 font-mono">{command}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Notes */}
                {splitRenderedNotes(viewedBead.notes).length > 0 && (
                  <div className="border-l-2 border-rose-300 dark:border-rose-700 pl-2">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1">Notes</div>
                    <div className="text-xs space-y-2">
                      {splitRenderedNotes(viewedBead.notes).map((note, i) => {
                        const headerMatch = note.match(/^\[Iteration (\d+)\s*[—–-]\s*(.+?)\]\n([\s\S]*)$/)
                        const iterNum = headerMatch?.[1]
                        const timestamp = headerMatch?.[2]
                        const body = headerMatch ? headerMatch[3] : note
                        return (
                          <div key={i} className="bg-muted/50 rounded px-2 py-1.5 border border-border/50">
                            {iterNum && (
                              <div className="flex items-center gap-2 mb-1 text-[10px] text-muted-foreground/70">
                                <Badge variant="outline" className="text-[9px] px-1 py-0">Iteration {iterNum}</Badge>
                                {timestamp && <span title={timestamp}>{formatTimestamp(timestamp)}</span>}
                              </div>
                            )}
                            <div className="whitespace-pre-wrap">{body}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <CollapsiblePhaseLogSection phase={phaseForView} ticket={ticket} />
        )}
      </div>
    </div>
  )
}
