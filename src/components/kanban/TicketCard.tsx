import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Loader2, AlertTriangle, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import { useUI } from '@/context/UIContext'
import { STATUS_DESCRIPTIONS, STATUS_ORDER, STATUS_TO_PHASE, getStatusUserLabel } from '@/lib/workflowMeta'

interface TicketCardProps {
  ticket: {
    id: number
    externalId: string
    title: string
    priority: number
    status: string
    updatedAt: string
    projectId: number
    currentBead?: number | null
    totalBeads?: number | null
    errorMessage?: string | null
  }
  projectColor?: string
  projectIcon?: string
  projectName?: string
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
    case 'VERIFYING_INTERVIEW_COVERAGE':
    case 'CODING':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
    case 'WAITING_MANUAL_VERIFICATION':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
    case 'PRE_FLIGHT_CHECK':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
    case 'RUNNING_FINAL_TEST':
      return 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300'
    case 'INTEGRATING_CHANGES':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
    case 'CLEANING_ENV':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
    case 'COMPLETED':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    case 'CANCELED':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    case 'BLOCKED_ERROR':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function PriorityArrows({ priority }: { priority: number }) {
  switch (priority) {
    case 1:
      return (
        <span className="flex flex-col items-center -space-y-1 text-red-600" title="Very High">
          <ChevronUp className="h-3 w-3" strokeWidth={3} />
          <ChevronUp className="h-3 w-3" strokeWidth={3} />
        </span>
      )
    case 2:
      return (
        <span className="inline-flex items-center text-orange-500" title="High">
          <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )
    case 3:
      return (
        <span className="inline-flex items-center text-gray-400" title="Normal">
          <Minus className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )
    case 4:
      return (
        <span className="inline-flex items-center text-blue-400" title="Low">
          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )
    case 5:
      return (
        <span className="flex flex-col items-center -space-y-1 text-blue-400" title="Very Low">
          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center text-gray-400" title="Normal">
          <Minus className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )
  }
}

function getStatusProgress(status: string): number | null {
  if (status === 'BLOCKED_ERROR') return null
  if (STATUS_TO_PHASE[status] === 'todo' || STATUS_TO_PHASE[status] === 'done') return null
  const idx = STATUS_ORDER.indexOf(status)
  if (idx === -1) return null
  return Math.round(((idx + 1) / STATUS_ORDER.length) * 100)
}

function getStatusRingColor(status: string): string {
  switch (status) {
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
    case 'VERIFYING_INTERVIEW_COVERAGE':
    case 'CODING':
      return 'text-blue-500'
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
    case 'WAITING_MANUAL_VERIFICATION':
      return 'text-yellow-500'
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return 'text-indigo-500'
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return 'text-purple-500'
    case 'PRE_FLIGHT_CHECK':
      return 'text-cyan-500'
    case 'RUNNING_FINAL_TEST':
      return 'text-teal-500'
    case 'INTEGRATING_CHANGES':
      return 'text-emerald-500'
    case 'CLEANING_ENV':
      return 'text-slate-500'
    default:
      return 'text-blue-500'
  }
}

function ProgressRing({ percent, size = 20, stroke = 2.5, colorClass = 'text-blue-500' }: { percent: number; size?: number; stroke?: number; colorClass?: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted-foreground/20" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={colorClass}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

export function TicketCard({ ticket, projectColor, projectIcon, projectName }: TicketCardProps) {
  const { dispatch } = useUI()
  const isError = ticket.status === 'BLOCKED_ERROR'
  const isTerminal = ticket.status === 'COMPLETED' || ticket.status === 'CANCELED'
  const isInProgress = !isTerminal && STATUS_TO_PHASE[ticket.status] === 'in_progress'
  const progress = getStatusProgress(ticket.status)
  const ringColor = getStatusRingColor(ticket.status)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: ticket.currentBead,
    totalBeads: ticket.totalBeads,
    errorMessage: ticket.errorMessage,
  })

  // Track "seen" state for BLOCKED_ERROR — stop flashing after first open
  const [errorSeen, setErrorSeen] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`error-seen-${ticket.id}`) === '1'
    }
    return false
  })

  useEffect(() => {
    if (!isError && errorSeen) {
      localStorage.removeItem(`error-seen-${ticket.id}`)
      setErrorSeen(false)
    }
  }, [isError, ticket.id, errorSeen])

  const handleClick = () => {
    if (isError && !errorSeen) {
      localStorage.setItem(`error-seen-${ticket.id}`, '1')
      setErrorSeen(true)
    }
    dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
  }

  return (
    <Card
      className={cn(
        'cursor-pointer p-3 transition-all hover:shadow-md',
        isError && !errorSeen && 'animate-pulse border-destructive border-2 ring-2 ring-red-400/60 bg-red-50/40 dark:bg-red-950/20 shadow-[0_0_0_1px_rgba(239,68,68,0.45),0_10px_20px_rgba(239,68,68,0.25)]',
        isError && errorSeen && 'border-destructive border-2 bg-red-50/20 dark:bg-red-950/10',
      )}
      style={{ borderLeftWidth: '4px', borderLeftColor: projectColor ?? '#3b82f6' }}
      onClick={handleClick}
      title={`Open ticket ${ticket.externalId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-mono text-muted-foreground">{ticket.externalId}</span>
        <div className="flex items-center gap-1">
          <PriorityArrows priority={ticket.priority} />
          {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {isError && <AlertTriangle className="h-3 w-3 text-destructive" />}
        </div>
      </div>
      <p className="mt-1 text-sm font-medium leading-tight">{ticket.title}</p>
      <div className="mt-2 flex items-center gap-1.5">
        {projectIcon && (projectIcon.startsWith('data:') ? <img src={projectIcon} className="h-4 w-4 rounded" alt="" /> : <span className="text-xs">{projectIcon}</span>)}
        {projectName && <span className="text-xs text-muted-foreground">{projectName}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={cn('text-xs truncate max-w-[180px]', getStatusColor(ticket.status))}>
                {statusLabel}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{STATUS_DESCRIPTIONS[ticket.status] ?? statusLabel}</TooltipContent>
          </Tooltip>
          {progress !== null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0" title="Workflow progress">
              <ProgressRing percent={progress} colorClass={ringColor} />
              <span className={ringColor}>{progress}%</span>
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0" title={new Date(ticket.updatedAt).toLocaleString()}>
          {getRelativeTime(ticket.updatedAt)}
        </span>
      </div>
    </Card>
  )
}

export { STATUS_TO_PHASE, getStatusColor }
