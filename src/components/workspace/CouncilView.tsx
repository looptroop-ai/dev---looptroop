import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { PhaseAttemptSelector } from './PhaseAttemptSelector'
import { useTicketPhaseAttempts } from '@/hooks/useTicketPhaseAttempts'

import type { Ticket } from '@/hooks/useTickets'

interface CouncilViewProps {
  phase: string
  ticket: Ticket
}

function getCouncilStepLabel(phase: string): string {
  if (phase === 'SCANNING_RELEVANT_FILES') return 'Scanning'
  if (phase === 'EXPANDING_BEADS') return 'Expanding'
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
  const isExpanding = step === 'Expanding'
  const { data: attempts = [] } = useTicketPhaseAttempts(ticket.id, phase)
  const [manualSelectedAttemptNumber, setManualSelectedAttemptNumber] = useState<number | null>(null)
  const selectedAttemptNumber = useMemo(() => {
    if (manualSelectedAttemptNumber != null && attempts.some((attempt) => attempt.attemptNumber === manualSelectedAttemptNumber)) {
      return manualSelectedAttemptNumber
    }
    return (attempts.find((attempt) => attempt.state === 'active') ?? attempts[0])?.attemptNumber ?? null
  }, [attempts, manualSelectedAttemptNumber])
  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.attemptNumber === selectedAttemptNumber)
      ?? attempts.find((attempt) => attempt.state === 'active')
      ?? attempts[0]
      ?? null,
    [attempts, selectedAttemptNumber],
  )
  const archivedAttemptNumber = selectedAttempt?.state === 'archived' ? selectedAttempt.attemptNumber : undefined
  const { artifacts: phaseArtifacts } = useTicketArtifacts(ticket.id, archivedAttemptNumber != null
    ? {
        phase,
        phaseAttempt: archivedAttemptNumber,
      }
    : undefined)
  const councilMemberNames = useMemo(
    () => ticket.lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0),
    [ticket.lockedCouncilMembers],
  )
  const councilMemberCount = councilMemberNames.length || 3

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        {attempts.length > 1 ? (
          <PhaseAttemptSelector
            attempts={attempts}
            value={selectedAttempt?.attemptNumber ?? attempts[0]!.attemptNumber}
            onChange={setManualSelectedAttemptNumber}
          />
        ) : null}

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {archivedAttemptNumber == null ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
              {isExpanding && 'Winning model expands the validated implementation plan into execution-ready bead records.'}
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

      <CollapsiblePhaseLogSection
        phase={phase}
        phaseAttempt={archivedAttemptNumber}
        ticket={ticket}
        className="px-4 pb-4"
      />
    </div>
  )
}
