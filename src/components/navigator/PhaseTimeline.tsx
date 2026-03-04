import { useState, useMemo, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { StatusIndicator } from './StatusIndicator'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_DESCRIPTIONS, getStatusUserLabel } from '@/lib/workflowMeta'

interface PhaseTimelineProps {
  currentStatus: string
  onSelectPhase?: (phase: string) => void
  selectedPhase?: string | null
}

interface PhaseGroup {
  id: string
  label: string
  phases: Array<{ id: string }>
}

const PHASE_GROUPS: PhaseGroup[] = [
  {
    id: 'todo',
    label: 'To Do',
    phases: [{ id: 'DRAFT' }],
  },
  {
    id: 'interview',
    label: 'Interview',
    phases: [
      { id: 'COUNCIL_DELIBERATING' },
      { id: 'COUNCIL_VOTING_INTERVIEW' },
      { id: 'COMPILING_INTERVIEW' },
      { id: 'WAITING_INTERVIEW_ANSWERS' },
      { id: 'VERIFYING_INTERVIEW_COVERAGE' },
      { id: 'WAITING_INTERVIEW_APPROVAL' },
    ],
  },
  {
    id: 'prd',
    label: 'Specs (PRD)',
    phases: [
      { id: 'DRAFTING_PRD' },
      { id: 'COUNCIL_VOTING_PRD' },
      { id: 'REFINING_PRD' },
      { id: 'VERIFYING_PRD_COVERAGE' },
      { id: 'WAITING_PRD_APPROVAL' },
    ],
  },
  {
    id: 'beads',
    label: 'Blueprint (Beads)',
    phases: [
      { id: 'DRAFTING_BEADS' },
      { id: 'COUNCIL_VOTING_BEADS' },
      { id: 'REFINING_BEADS' },
      { id: 'VERIFYING_BEADS_COVERAGE' },
      { id: 'WAITING_BEADS_APPROVAL' },
    ],
  },
  {
    id: 'execution',
    label: 'Execution',
    phases: [
      { id: 'PRE_FLIGHT_CHECK' },
      { id: 'CODING' },
      { id: 'RUNNING_FINAL_TEST' },
      { id: 'INTEGRATING_CHANGES' },
      { id: 'WAITING_MANUAL_VERIFICATION' },
      { id: 'CLEANING_ENV' },
      { id: 'BLOCKED_ERROR' },
    ],
  },
  {
    id: 'done',
    label: 'Done',
    phases: [{ id: 'COMPLETED' }, { id: 'CANCELED' }],
  },
]

const ALL_PHASE_IDS = PHASE_GROUPS.flatMap(g => g.phases.map(p => p.id))

function getPhaseIndicatorStatus(phaseId: string, currentStatus: string): 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled' {
  if (currentStatus === 'BLOCKED_ERROR') {
    if (phaseId === 'BLOCKED_ERROR') return 'error'
    return 'pending'
  }

  if (phaseId === 'DRAFT' && currentStatus === 'DRAFT') {
    return 'pending'
  }

  if (currentStatus === 'CANCELED') {
    if (phaseId === 'CANCELED') return 'canceled'
    return 'pending'
  }

  if (currentStatus === 'COMPLETED' && phaseId === 'COMPLETED') return 'completed-final'
  if (phaseId === currentStatus) return 'active'

  const currentIndex = ALL_PHASE_IDS.indexOf(currentStatus)
  const phaseIndex = ALL_PHASE_IDS.indexOf(phaseId)

  if (currentIndex === -1 || phaseIndex === -1) return 'pending'
  return phaseIndex < currentIndex ? 'completed' : 'pending'
}

function getGroupStatus(group: PhaseGroup, currentStatus: string): 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled' {
  const statuses = group.phases.map(p => getPhaseIndicatorStatus(p.id, currentStatus))

  if (group.id === 'todo' && currentStatus === 'DRAFT') {
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

export function PhaseTimeline({ currentStatus, onSelectPhase, selectedPhase }: PhaseTimelineProps) {
  const activeGroupIndex = useMemo(() => {
    return PHASE_GROUPS.findIndex(g => g.phases.some(p => p.id === currentStatus))
  }, [currentStatus])

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set([Math.max(0, activeGroupIndex)]))

  // Auto-collapse previous group and expand new active group when status changes
  useEffect(() => {
    const newActiveGroupIndex = PHASE_GROUPS.findIndex(g => g.phases.some(p => p.id === currentStatus))
    if (newActiveGroupIndex >= 0) {
      setExpandedGroups(new Set([newActiveGroupIndex]))
    }
  }, [currentStatus])

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
        {PHASE_GROUPS.map((group, gi) => {
          const groupStatus = getGroupStatus(group, currentStatus)
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
                    const indicatorStatus = getPhaseIndicatorStatus(phase.id, currentStatus)
                    const isSelected = selectedPhase === phase.id
                    const isPast = indicatorStatus === 'completed'
                    const isFuture = indicatorStatus === 'pending'
                    const isCurrent = phase.id === currentStatus
                    const isSelectable = !isFuture || isCurrent

                    const phaseLabel = getStatusUserLabel(phase.id)

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
                            <span className="truncate">{phaseLabel}</span>
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
      </div>
    </ScrollArea>
  )
}
