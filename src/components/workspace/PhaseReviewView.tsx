import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Eye } from 'lucide-react'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useProfile } from '@/hooks/useProfile'
import type { Ticket } from '@/hooks/useTickets'

interface PhaseReviewViewProps {
  phase: string
  ticket: Ticket
}

const PHASE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  COUNCIL_DELIBERATING: 'Council Deliberating — Interview',
  COUNCIL_VOTING_INTERVIEW: 'Council Voting — Interview',
  COMPILING_INTERVIEW: 'Compiling Interview',
  WAITING_INTERVIEW_ANSWERS: 'Interview Q&A',
  VERIFYING_INTERVIEW_COVERAGE: 'Verifying Interview Coverage',
  WAITING_INTERVIEW_APPROVAL: 'Interview Approval',
  DRAFTING_PRD: 'Council Drafting — PRD',
  COUNCIL_VOTING_PRD: 'Council Voting — PRD',
  REFINING_PRD: 'Refining PRD',
  VERIFYING_PRD_COVERAGE: 'Verifying PRD Coverage',
  WAITING_PRD_APPROVAL: 'PRD Approval',
  DRAFTING_BEADS: 'Council Drafting — Beads',
  COUNCIL_VOTING_BEADS: 'Council Voting — Beads',
  REFINING_BEADS: 'Refining Beads',
  VERIFYING_BEADS_COVERAGE: 'Verifying Beads Coverage',
  WAITING_BEADS_APPROVAL: 'Beads Approval',
  PRE_FLIGHT_CHECK: 'Pre-flight Check',
  CODING: 'Coding',
  RUNNING_FINAL_TEST: 'Final Test',
  INTEGRATING_CHANGES: 'Integration',
  WAITING_MANUAL_VERIFICATION: 'Manual Verification',
  CLEANING_ENV: 'Cleanup',
  COMPLETED: 'Completed',
  CANCELED: 'Canceled',
}

export function PhaseReviewView({ phase, ticket }: PhaseReviewViewProps) {
  const label = PHASE_LABELS[phase] ?? phase.replace(/_/g, ' ')
  const { data: profile } = useProfile()
  const councilMemberNames = useMemo(() => {
    try { return profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [] }
    catch { return [] }
  }, [profile?.councilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 text-muted-foreground" />
            {label}
          </div>
          <Badge variant="secondary" className="text-xs gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            Completed
          </Badge>
        </div>

        <PhaseArtifactsPanel phase={phase} isCompleted={true} ticketId={ticket.id} councilMemberCount={councilMemberCount} councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined} />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase={phase} />
      </div>
    </div>
  )
}
