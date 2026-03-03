import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Loader2, AlertTriangle, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import { useUI } from '@/context/UIContext'

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
  }
  projectColor?: string
  projectIcon?: string
  projectName?: string
}

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Ticket is ready to be started',
  COUNCIL_DELIBERATING: 'AI models generate interview questions independently',
  COUNCIL_VOTING_INTERVIEW: 'AI models vote on best interview questions',
  COMPILING_INTERVIEW: 'Compiling winning interview questions',
  WAITING_INTERVIEW_ANSWERS: 'Waiting for your answers to interview questions',
  VERIFYING_INTERVIEW_COVERAGE: 'AI verifying interview coverage',
  WAITING_INTERVIEW_APPROVAL: 'Review and approve interview results',
  DRAFTING_PRD: 'AI models draft competing PRD versions',
  COUNCIL_VOTING_PRD: 'AI models vote on best PRD',
  REFINING_PRD: 'Winning model refines PRD with best ideas',
  VERIFYING_PRD_COVERAGE: 'AI verifying PRD covers all requirements',
  WAITING_PRD_APPROVAL: 'Review and approve the PRD',
  DRAFTING_BEADS: 'AI models draft task breakdown (beads)',
  COUNCIL_VOTING_BEADS: 'AI models vote on best task breakdown',
  REFINING_BEADS: 'Refining task breakdown',
  VERIFYING_BEADS_COVERAGE: 'Verifying beads cover all PRD items',
  WAITING_BEADS_APPROVAL: 'Review and approve the task breakdown',
  PRE_FLIGHT_CHECK: 'Running pre-flight diagnostics',
  CODING: 'AI implementing beads',
  RUNNING_FINAL_TEST: 'Running final test suite',
  INTEGRATING_CHANGES: 'Integrating changes to main branch',
  WAITING_MANUAL_VERIFICATION: 'Manual review of completed work',
  CLEANING_ENV: 'Cleaning up temporary resources',
  COMPLETED: 'Ticket is complete',
  CANCELED: 'Ticket was canceled',
  BLOCKED_ERROR: 'An error occurred and needs attention',
}

const STATUS_TO_PHASE: Record<string, string> = {
  DRAFT: 'todo',
  COUNCIL_DELIBERATING: 'in_progress',
  COUNCIL_VOTING_INTERVIEW: 'in_progress',
  COMPILING_INTERVIEW: 'in_progress',
  WAITING_INTERVIEW_ANSWERS: 'needs_input',
  VERIFYING_INTERVIEW_COVERAGE: 'in_progress',
  WAITING_INTERVIEW_APPROVAL: 'needs_input',
  DRAFTING_PRD: 'in_progress',
  COUNCIL_VOTING_PRD: 'in_progress',
  REFINING_PRD: 'in_progress',
  VERIFYING_PRD_COVERAGE: 'in_progress',
  WAITING_PRD_APPROVAL: 'needs_input',
  DRAFTING_BEADS: 'in_progress',
  COUNCIL_VOTING_BEADS: 'in_progress',
  REFINING_BEADS: 'in_progress',
  VERIFYING_BEADS_COVERAGE: 'in_progress',
  WAITING_BEADS_APPROVAL: 'needs_input',
  PRE_FLIGHT_CHECK: 'in_progress',
  CODING: 'in_progress',
  RUNNING_FINAL_TEST: 'in_progress',
  INTEGRATING_CHANGES: 'in_progress',
  WAITING_MANUAL_VERIFICATION: 'needs_input',
  CLEANING_ENV: 'in_progress',
  COMPLETED: 'done',
  CANCELED: 'done',
  BLOCKED_ERROR: 'needs_input',
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

function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function PriorityArrows({ priority }: { priority: number }) {
  switch (priority) {
    case 1:
      return (
        <span className="flex flex-col items-center -space-y-1.5 text-red-600" title="Very High">
          <ChevronUp className="h-4 w-4" strokeWidth={3} />
          <ChevronUp className="h-4 w-4" strokeWidth={3} />
        </span>
      )
    case 2:
      return (
        <span className="inline-flex items-center text-orange-500" title="High">
          <ChevronUp className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )
    case 3:
      return (
        <span className="inline-flex items-center text-gray-400" title="Normal">
          <Minus className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )
    case 4:
      return (
        <span className="inline-flex items-center text-blue-400" title="Low">
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )
    case 5:
      return (
        <span className="flex flex-col items-center -space-y-1.5 text-blue-400" title="Very Low">
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center text-gray-400" title="Normal">
          <Minus className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )
  }
}

const PHASE_ORDER = [
  'DRAFT', 'COUNCIL_DELIBERATING', 'COUNCIL_VOTING_INTERVIEW', 'COMPILING_INTERVIEW',
  'WAITING_INTERVIEW_ANSWERS', 'VERIFYING_INTERVIEW_COVERAGE', 'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD', 'COUNCIL_VOTING_PRD', 'REFINING_PRD', 'VERIFYING_PRD_COVERAGE', 'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS', 'COUNCIL_VOTING_BEADS', 'REFINING_BEADS', 'VERIFYING_BEADS_COVERAGE', 'WAITING_BEADS_APPROVAL',
  'PRE_FLIGHT_CHECK', 'CODING', 'RUNNING_FINAL_TEST', 'INTEGRATING_CHANGES',
  'WAITING_MANUAL_VERIFICATION', 'CLEANING_ENV', 'COMPLETED',
]

function getStatusProgress(status: string): number | null {
  if (STATUS_TO_PHASE[status] === 'todo' || STATUS_TO_PHASE[status] === 'done') return null
  const idx = PHASE_ORDER.indexOf(status)
  if (idx === -1) return null
  return Math.round(((idx + 1) / PHASE_ORDER.length) * 100)
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
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted-foreground/20" />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className={colorClass} transform={`rotate(-90 ${size/2} ${size/2})`} />
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

  // Track "seen" state for BLOCKED_ERROR — stop flashing after first open
  const [errorSeen, setErrorSeen] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`error-seen-${ticket.id}`) === '1'
    }
    return false
  })
  useEffect(() => {
    if (!isError) {
      if (errorSeen) {
        localStorage.removeItem(`error-seen-${ticket.id}`)
        setErrorSeen(false)
      }
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
        isError && !errorSeen && 'animate-pulse border-destructive border-2 shadow-red-500/30 shadow-lg ring-2 ring-red-400/50',
        isError && errorSeen && 'border-destructive border-2',
      )}
      style={{ borderLeftWidth: '4px', borderLeftColor: projectColor ?? '#3b82f6' }}
      onClick={handleClick}
      title={`Click to open ticket ${ticket.externalId}`}
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
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={cn('text-xs', getStatusColor(ticket.status))}>
                {getStatusLabel(ticket.status)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{STATUS_DESCRIPTIONS[ticket.status] ?? getStatusLabel(ticket.status)}</TooltipContent>
          </Tooltip>
          {progress !== null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ProgressRing percent={progress} colorClass={ringColor} />
              <span className={ringColor}>{progress}%</span>
            </span>
          )}
          {ticket.status === 'CODING' && ticket.currentBead && ticket.totalBeads && (
            <span className="text-xs text-muted-foreground">⚡ {ticket.currentBead}/{ticket.totalBeads}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground" title={new Date(ticket.updatedAt).toLocaleString()}>
          {getRelativeTime(ticket.updatedAt)}
        </span>
      </div>
    </Card>
  )
}

export { STATUS_TO_PHASE, getStatusColor }
