import { useState, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { StatusIndicator } from './StatusIndicator'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PhaseTimelineProps {
  currentStatus: string
  onSelectPhase?: (phase: string) => void
  selectedPhase?: string | null
}

const PHASE_TOOLTIPS: Record<string, string> = {
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

const PHASE_GROUPS = [
  {
    label: 'Planning',
    phases: [
      { id: 'DRAFT', label: 'Draft' },
      { id: 'COUNCIL_DELIBERATING', label: 'Council Deliberating' },
      { id: 'COUNCIL_VOTING_INTERVIEW', label: 'Voting (Interview)' },
      { id: 'COMPILING_INTERVIEW', label: 'Compiling Interview' },
      { id: 'WAITING_INTERVIEW_ANSWERS', label: 'Interview Q&A' },
      { id: 'VERIFYING_INTERVIEW_COVERAGE', label: 'Verifying Coverage' },
      { id: 'WAITING_INTERVIEW_APPROVAL', label: 'Interview Approval' },
    ],
  },
  {
    label: 'PRD',
    phases: [
      { id: 'DRAFTING_PRD', label: 'Drafting PRD' },
      { id: 'COUNCIL_VOTING_PRD', label: 'Voting (PRD)' },
      { id: 'REFINING_PRD', label: 'Refining PRD' },
      { id: 'VERIFYING_PRD_COVERAGE', label: 'PRD Coverage' },
      { id: 'WAITING_PRD_APPROVAL', label: 'PRD Approval' },
    ],
  },
  {
    label: 'Beads',
    phases: [
      { id: 'DRAFTING_BEADS', label: 'Drafting Beads' },
      { id: 'COUNCIL_VOTING_BEADS', label: 'Voting (Beads)' },
      { id: 'REFINING_BEADS', label: 'Refining Beads' },
      { id: 'VERIFYING_BEADS_COVERAGE', label: 'Beads Coverage' },
      { id: 'WAITING_BEADS_APPROVAL', label: 'Beads Approval' },
    ],
  },
  {
    label: 'Execution',
    phases: [
      { id: 'PRE_FLIGHT_CHECK', label: 'Pre-flight Check' },
      { id: 'CODING', label: 'Coding' },
      { id: 'RUNNING_FINAL_TEST', label: 'Final Test' },
      { id: 'INTEGRATING_CHANGES', label: 'Integration' },
      { id: 'WAITING_MANUAL_VERIFICATION', label: 'Manual Verification' },
      { id: 'CLEANING_ENV', label: 'Cleanup' },
    ],
  },
  {
    label: 'Terminal',
    phases: [
      { id: 'COMPLETED', label: 'Completed' },
      { id: 'CANCELED', label: 'Canceled' },
    ],
  },
]

const ALL_PHASE_IDS = PHASE_GROUPS.flatMap(g => g.phases.map(p => p.id))

function getPhaseIndicatorStatus(phaseId: string, currentStatus: string): 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled' {
  if (currentStatus === 'BLOCKED_ERROR') return phaseId === currentStatus ? 'error' : 'pending'
  if (currentStatus === 'CANCELED') return 'canceled'
  if (currentStatus === 'COMPLETED' && phaseId === 'COMPLETED') return 'completed-final'
  if (phaseId === currentStatus) return 'active'

  const currentIndex = ALL_PHASE_IDS.indexOf(currentStatus)
  const phaseIndex = ALL_PHASE_IDS.indexOf(phaseId)

  if (currentIndex === -1 || phaseIndex === -1) return 'pending'
  return phaseIndex < currentIndex ? 'completed' : 'pending'
}

function getGroupStatus(group: typeof PHASE_GROUPS[number], currentStatus: string): 'completed' | 'active' | 'pending' | 'error' | 'completed-final' | 'canceled' {
  const statuses = group.phases.map(p => getPhaseIndicatorStatus(p.id, currentStatus))
  if (statuses.some(s => s === 'completed-final')) return 'completed-final'
  if (statuses.some(s => s === 'active')) return 'active'
  if (statuses.some(s => s === 'error')) return 'error'
  if (statuses.every(s => s === 'canceled')) return 'canceled'
  if (statuses.every(s => s === 'completed')) return 'completed'
  if (statuses.some(s => s === 'completed')) return 'active'
  return 'pending'
}

export function PhaseTimeline({ currentStatus, onSelectPhase, selectedPhase }: PhaseTimelineProps) {
  // Find the group containing the current status
  const activeGroupIndex = useMemo(() => {
    return PHASE_GROUPS.findIndex(g => g.phases.some(p => p.id === currentStatus))
  }, [currentStatus])

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set([Math.max(0, activeGroupIndex)]))

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
            <div key={group.label}>
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
              >
                <ChevronRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
                <StatusIndicator status={groupStatus} />
                <span>{group.label}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 space-y-0.5 mt-0.5">
                  {group.phases.map(phase => {
                    const indicatorStatus = getPhaseIndicatorStatus(phase.id, currentStatus)
                    // DRAFT is a passive "to do" state — show a gray circle, not a spinner
                    const isDraftCurrent = phase.id === 'DRAFT' && indicatorStatus === 'active'
                    const displayStatus = isDraftCurrent ? 'pending' : indicatorStatus
                    const isSelected = selectedPhase === phase.id
                    const isPast = indicatorStatus === 'completed'
                    const isFuture = indicatorStatus === 'pending'

                    return (
                      <Tooltip key={phase.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => !isFuture && onSelectPhase?.(phase.id)}
                            disabled={isFuture}
                            className={cn(
                              'w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors text-left',
                              isSelected && 'bg-accent',
                              (indicatorStatus === 'active') && !isSelected && 'bg-accent/50 font-medium',
                              isPast && 'cursor-pointer hover:bg-accent',
                              isFuture && 'opacity-40 cursor-default',
                            )}
                          >
                            <StatusIndicator status={displayStatus} />
                            <span className="truncate">{phase.label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{PHASE_TOOLTIPS[phase.id]}</TooltipContent>
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
