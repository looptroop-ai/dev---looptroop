import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { StatusIndicator } from './StatusIndicator'
import { ActiveBeadCountdown } from './ActiveBeadCountdown'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_DESCRIPTIONS, getStatusUserLabel } from '@/lib/workflowMeta'
import { useWorkflowMeta } from '@/hooks/useWorkflowMeta'
import type { Ticket } from '@/hooks/useTickets'

interface PhaseTimelineProps {
  currentStatus: string
  reviewCutoffStatus?: string
  previousStatus?: string
  onSelectPhase?: (phase: string) => void
  selectedPhase?: string | null
  showBlockedErrorPhase?: boolean
  footer?: ReactNode
  ticket?: Ticket
}

type PhaseIndicatorStatus = 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled'

function getPhaseIndicatorStatus(
  phaseId: string,
  currentStatus: string,
  phaseOrder: string[],
  reviewCutoffStatus?: string,
  previousStatus?: string,
): PhaseIndicatorStatus {
  if (currentStatus === 'BLOCKED_ERROR') {
    if (phaseId === 'BLOCKED_ERROR') return 'error'
    if (previousStatus) {
      const prevIndex = phaseOrder.indexOf(previousStatus)
      const phaseIndex = phaseOrder.indexOf(phaseId)
      if (prevIndex >= 0 && phaseIndex >= 0) {
        if (phaseIndex < prevIndex) return 'completed'
        if (phaseIndex === prevIndex) return 'error'
      }
    }
    return 'pending'
  }

  if (phaseId === 'DRAFT' && currentStatus === 'DRAFT') {
    return 'pending'
  }

  if (currentStatus === 'CANCELED') {
    if (phaseId === 'CANCELED') return 'canceled'
    if (previousStatus === 'BLOCKED_ERROR') {
      if (phaseId === 'BLOCKED_ERROR') return 'error'
      if (reviewCutoffStatus) {
        const cutoffIndex = phaseOrder.indexOf(reviewCutoffStatus)
        const phaseIndex = phaseOrder.indexOf(phaseId)
        if (cutoffIndex >= 0 && phaseIndex >= 0) {
          if (phaseId === reviewCutoffStatus) return 'error'
          if (phaseIndex < cutoffIndex) return 'completed'
        }
      }
      return 'pending'
    }
    if (reviewCutoffStatus) {
      const cutoffIndex = phaseOrder.indexOf(reviewCutoffStatus)
      const phaseIndex = phaseOrder.indexOf(phaseId)
      if (cutoffIndex >= 0 && phaseIndex >= 0 && phaseIndex <= cutoffIndex) {
        return 'completed'
      }
    }
    return 'pending'
  }

  if (currentStatus === 'COMPLETED' && phaseId === 'COMPLETED') return 'completed-final'
  if (phaseId === currentStatus) return 'active'

  const currentIndex = phaseOrder.indexOf(currentStatus)
  const phaseIndex = phaseOrder.indexOf(phaseId)

  if (currentIndex === -1 || phaseIndex === -1) return 'pending'
  return phaseIndex < currentIndex ? 'completed' : 'pending'
}

function getGroupStatus(
  group: { id: string; phases: Array<{ id: string }> },
  currentStatus: string,
  phaseOrder: string[],
  reviewCutoffStatus?: string,
  previousStatus?: string,
): PhaseIndicatorStatus {
  const statuses = group.phases.map(p => getPhaseIndicatorStatus(p.id, currentStatus, phaseOrder, reviewCutoffStatus, previousStatus))

  if (group.id === 'todo' && currentStatus === 'DRAFT') {
    return 'pending'
  }

  if (currentStatus === 'CANCELED') {
    if (statuses.some(s => s === 'error')) return 'error'
    if (statuses.some(s => s === 'canceled')) return 'canceled'
    if (statuses.some(s => s === 'completed-final')) return 'completed-final'
    if (statuses.some(s => s === 'completed')) return 'completed'
    return 'pending'
  }

  if (statuses.some(s => s === 'completed-final')) return 'completed-final'
  if (statuses.some(s => s === 'active')) return 'active'
  if (statuses.some(s => s === 'error')) return 'error'
  if (statuses.every(s => s === 'canceled')) return 'canceled'
  if (statuses.every(s => s === 'completed')) return 'completed'
  if (statuses.some(s => s === 'completed')) return 'active'
  return 'pending'
}

function getPhaseTooltip(phaseId: string): string {
  return STATUS_DESCRIPTIONS[phaseId] ?? phaseId.replace(/_/g, ' ')
}

export function PhaseTimeline({
  currentStatus,
  reviewCutoffStatus,
  previousStatus,
  onSelectPhase,
  selectedPhase,
  showBlockedErrorPhase = currentStatus === 'BLOCKED_ERROR',
  footer,
  ticket,
}: PhaseTimelineProps) {
  const { groups, phases } = useWorkflowMeta()
  const visiblePhases = useMemo(
    () => phases.filter((phase) => showBlockedErrorPhase || phase.id !== 'BLOCKED_ERROR'),
    [phases, showBlockedErrorPhase],
  )
  const currentTimelineStatus = useMemo(() => {
    if (showBlockedErrorPhase || currentStatus !== 'BLOCKED_ERROR') return currentStatus
    return previousStatus ?? currentStatus
  }, [currentStatus, previousStatus, showBlockedErrorPhase])
  const phaseGroups = useMemo(() => groups.map((group) => ({
    id: group.id,
    label: group.label,
    phases: visiblePhases.filter((phase) => phase.groupId === group.id).map((phase) => ({ id: phase.id })),
  })), [groups, visiblePhases])
  const phaseOrder = useMemo(() => visiblePhases.map((phase) => phase.id), [visiblePhases])
  const activeGroupIndex = useMemo(() => {
    return phaseGroups.findIndex(group => group.phases.some((phase) => phase.id === currentTimelineStatus))
  }, [currentTimelineStatus, phaseGroups])

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set([Math.max(0, activeGroupIndex)]))

  // Auto-collapse previous group and expand new active group when status changes
  useEffect(() => {
    const newActiveGroupIndex = phaseGroups.findIndex(group => group.phases.some((phase) => phase.id === currentTimelineStatus))
    if (newActiveGroupIndex >= 0) {
      setExpandedGroups(new Set([newActiveGroupIndex]))
    }
  }, [currentTimelineStatus, phaseGroups])

  const toggleGroup = (idx: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {phaseGroups.map((group, gi) => {
          const groupStatus = getGroupStatus(group, currentStatus, phaseOrder, reviewCutoffStatus, previousStatus)
          const isExpanded = expandedGroups.has(gi)

          return (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(gi)}
                className={cn(
                  'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors text-left',
                  groupStatus === 'active' && 'text-primary',
                  groupStatus === 'completed' && 'text-green-600',
                  groupStatus === 'error' && 'text-destructive',
                  groupStatus === 'pending' && 'text-muted-foreground',
                  'hover:bg-accent/50',
                )}
                title={`Toggle ${group.label} phases`}
              >
                <ChevronRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
                <StatusIndicator status={groupStatus} />
                <span>{group.label}</span>
              </button>

              {isExpanded && (
                <div className="ml-3 space-y-0.5 mt-0.5">
                  {group.phases.map(phase => {
                    const indicatorStatus = getPhaseIndicatorStatus(phase.id, currentStatus, phaseOrder, reviewCutoffStatus, previousStatus)
                    const isSelected = selectedPhase === phase.id
                    const isPast = indicatorStatus === 'completed'
                    const isFuture = indicatorStatus === 'pending'
                    const isCurrent = phase.id === currentStatus
                    const isSelectable = !isFuture || isCurrent

                    const phaseLabel = getStatusUserLabel(phase.id, {
                      currentBead: ticket?.runtime?.currentBead ?? ticket?.currentBead,
                      totalBeads: ticket?.runtime?.totalBeads ?? ticket?.totalBeads,
                    })

                    const activeBead = ticket?.runtime?.beads?.find(b => b.id === ticket?.runtime?.activeBeadId)
                    const showCountdown = phase.id === 'CODING' 
                      && isCurrent 
                      && activeBead?.status === 'in_progress'
                      && activeBead?.startedAt 
                      && ticket?.runtime?.perIterationTimeoutMs

                    return (
                      <Tooltip key={phase.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => isSelectable && onSelectPhase?.(phase.id)}
                            disabled={!isSelectable}
                            className={cn(
                              'w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors text-left',
                              isSelected && 'bg-accent',
                              isCurrent && !isSelected && 'bg-accent/50 font-medium',
                              isPast && 'cursor-pointer hover:bg-accent',
                              !isSelectable && 'opacity-40 cursor-default',
                            )}
                          >
                            <StatusIndicator status={indicatorStatus} />
                            <span className="truncate flex-1 flex items-center">
                              <span className="truncate">{phaseLabel}</span>
                              {showCountdown && activeBead?.startedAt && ticket?.runtime?.perIterationTimeoutMs ? (
                                <ActiveBeadCountdown 
                                  startedAt={activeBead.startedAt} 
                                  perIterationTimeoutMs={ticket.runtime.perIterationTimeoutMs} 
                                />
                              ) : null}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{getPhaseTooltip(phase.id)}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {footer ? <div className="pt-2">{footer}</div> : null}
      </div>
    </ScrollArea>
  )
}
