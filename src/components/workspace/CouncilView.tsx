import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'

import type { Ticket } from '@/hooks/useTickets'

interface CouncilViewProps {
  phase: string
  ticket: Ticket
}

function getCouncilStepLabel(phase: string): string {
  if (phase === 'SCANNING_RELEVANT_FILES') return 'Scanning'
  if (phase.includes('DELIBERATING') || phase.includes('DRAFTING')) return 'Drafting'
  if (phase.includes('VOTING')) return 'Voting'
  if (phase.includes('COMPILING') || phase.includes('REFINING')) return 'Refining'
  if (phase.includes('VERIFYING')) return 'Verifying Coverage'
  return 'Processing'
}

function getCouncilDomain(phase: string): string {
  if (phase === 'SCANNING_RELEVANT_FILES') return 'Relevant Files'
  if (phase.includes('INTERVIEW') || phase === 'COUNCIL_DELIBERATING' || phase === 'COMPILING_INTERVIEW' || phase === 'VERIFYING_INTERVIEW_COVERAGE') return 'Interview'
  if (phase.includes('PRD')) return 'PRD'
  if (phase.includes('BEADS')) return 'Beads'
  return ''
}

export function CouncilView({ phase, ticket }: CouncilViewProps) {
  const step = getCouncilStepLabel(phase)
  const domain = getCouncilDomain(phase)
  const isDrafting = step === 'Drafting'
  const isVoting = step === 'Voting'
  const isVerifying = step === 'Verifying Coverage'
  const { artifacts: phaseArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticket.id)
  const councilMemberNames = useMemo(
    () => ticket.lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0),
    [ticket.lockedCouncilMembers],
  )
  const councilMemberCount = councilMemberNames.length || 3

  if (isLoadingArtifacts) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading phase data…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI Council — {domain} {step}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <p className="text-xs text-muted-foreground">
              {phase === 'SCANNING_RELEVANT_FILES' && 'AI is reading relevant source files to build richer context for council deliberation.'}
              {isDrafting && phase !== 'SCANNING_RELEVANT_FILES' && `Each council model is independently generating a ${domain.toLowerCase()} draft.`}
              {isVoting && `Council members are scoring all ${domain.toLowerCase()} drafts.`}
              {step === 'Refining' && `Winning model incorporates best ideas from other drafts.`}
              {isVerifying && `Winning model verifies ${domain.toLowerCase()} covers all requirements.`}
            </p>
          </CardContent>
        </Card>

        <PhaseArtifactsPanel
          phase={phase}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={councilMemberCount}
          councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined}
          preloadedArtifacts={phaseArtifacts}
        />
      </div>

      <CollapsiblePhaseLogSection phase={phase} ticket={ticket} className="px-4 pb-4" />
    </div>
  )
}
