import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTicketAction } from '@/hooks/useTickets'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useProfile } from '@/hooks/useProfile'
import type { Ticket } from '@/hooks/useTickets'

interface ApprovalViewProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
}

const LABELS: Record<string, { title: string; description: string }> = {
  interview: { title: 'Interview Results', description: 'Review the interview questions and answers.' },
  prd: { title: 'Product Requirements Document', description: 'Review the generated PRD with epics and user stories.' },
  beads: { title: 'Beads Breakdown', description: 'Review the implementation beads with tests and dependencies.' },
}

export function ApprovalView({ ticket, artifactType }: ApprovalViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const config = LABELS[artifactType] ?? { title: 'Review', description: '' }
  const { data: profile } = useProfile()
  const councilMemberNames = useMemo(() => {
    try { return profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [] }
    catch { return [] }
  }, [profile?.councilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{config.title}</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-muted-foreground">{config.description}</p>
          </CardContent>
        </Card>

        <PhaseArtifactsPanel phase={ticket.status} isCompleted={false} ticketId={ticket.id} councilMemberCount={councilMemberCount} councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined} />

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'cancel' })}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'approve' })}
            disabled={isPending}
          >
            {isPending ? 'Approving…' : '✅ Approve'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase={ticket.status} />
      </div>
    </div>
  )
}
