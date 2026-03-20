import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Loader2, AlertTriangle, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import { useUI } from '@/context/useUI'
import { STATUS_DESCRIPTIONS, STATUS_TO_PHASE, getStatusUserLabel } from '@/lib/workflowMeta'
import {
  clearErrorTicketSeen,
  getErrorTicketSignature,
  markErrorTicketSeen,
  readErrorTicketSeen,
} from '@/lib/errorTicketSeen'
import { getStatusColor, getRelativeTime, getStatusProgress, getStatusRingColor } from './ticketCardUtils'
import { ProgressRing } from './ProgressRing'


interface TicketCardProps {
  ticket: {
    id: string
    externalId: string
    title: string
    priority: number
    status: string
    updatedAt: string
    projectId: number
    currentBead?: number | null
    totalBeads?: number | null
    errorMessage?: string | null
    errorSeenSignature?: string | null
  }
  projectColor?: string
  projectIcon?: string
  projectName?: string
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
  const errorSignature = getErrorTicketSignature(ticket)

  // Track "seen" state for BLOCKED_ERROR — stop flashing after first open
  const [errorSeen, setErrorSeen] = useState(() =>
    readErrorTicketSeen(ticket.id, errorSignature, ticket.errorSeenSignature),
  )

  useEffect(() => {
    if (!isError && errorSeen) {
      clearErrorTicketSeen(ticket.id)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setErrorSeen(false)
    }
  }, [isError, ticket.id, errorSeen])

  const handleClick = () => {
    if (isError && !errorSeen) {
      markErrorTicketSeen(ticket.id, errorSignature)
      setErrorSeen(true)
    }
    dispatch({ type: 'SELECT_TICKET', ticketId: ticket.id, externalId: ticket.externalId })
  }

  return (
    <Card
      className={cn(
        'cursor-pointer p-3 transition-all hover:shadow-md',
        isError && !errorSeen && 'animate-pulse border-destructive border-2 ring-4 ring-red-500/70 bg-red-50/60 dark:bg-red-950/30 shadow-[0_0_0_2px_rgba(239,68,68,0.6),0_0_20px_rgba(239,68,68,0.4),0_10px_30px_rgba(239,68,68,0.3)]',
      )}
      style={{ borderLeftWidth: '4px', borderLeftColor: projectColor ?? '#3b82f6' }}
      onClick={handleClick}
      aria-label={`Open ticket ${ticket.externalId}`}
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

