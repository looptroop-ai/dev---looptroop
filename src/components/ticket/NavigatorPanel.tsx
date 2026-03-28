import { Separator } from '@/components/ui/separator'
import { PhaseTimeline } from '@/components/navigator/PhaseTimeline'
import { ContextTree } from '@/components/navigator/ContextTree'
import { ApprovalNavigator } from '@/components/navigator/ApprovalNavigator'
import { ErrorOccurrencesPanel } from '@/components/navigator/ErrorOccurrencesPanel'
import type { Ticket } from '@/hooks/useTickets'

interface NavigatorPanelProps {
  ticketId: string
  ticket: Ticket
  currentStatus: string
  selectedPhase: string
  selectedErrorOccurrenceId?: string | null
  reviewCutoffStatus?: string
  previousStatus?: string
  onSelectPhase: (phase: string | null) => void
  onSelectErrorOccurrence: (occurrenceId: string | null) => void
  contextPhase: string
}

export function NavigatorPanel({
  ticketId,
  ticket,
  currentStatus,
  selectedPhase,
  selectedErrorOccurrenceId,
  reviewCutoffStatus,
  previousStatus,
  onSelectPhase,
  onSelectErrorOccurrence,
  contextPhase,
}: NavigatorPanelProps) {
  const isApprovalNavigatorPhase = contextPhase === 'WAITING_INTERVIEW_APPROVAL' || contextPhase === 'WAITING_PRD_APPROVAL'

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ErrorOccurrencesPanel
            ticket={ticket}
            selectedErrorOccurrenceId={selectedErrorOccurrenceId}
            onSelectErrorOccurrence={onSelectErrorOccurrence}
          />
          <PhaseTimeline
            currentStatus={currentStatus}
            reviewCutoffStatus={reviewCutoffStatus}
            previousStatus={previousStatus}
            onSelectPhase={(phase) => onSelectPhase(phase === currentStatus ? null : phase)}
            selectedPhase={selectedPhase}
            showBlockedErrorPhase={false}
          />
          {isApprovalNavigatorPhase ? (
            <ApprovalNavigator ticketId={ticketId} phase={contextPhase} />
          ) : null}
        </div>
        {(selectedPhase !== currentStatus || Boolean(selectedErrorOccurrenceId)) && (
          <div className="sticky bottom-0 border-t border-border bg-background p-2">
            <button
              onClick={() => {
                onSelectPhase(null)
                onSelectErrorOccurrence(null)
              }}
              className="text-xs text-blue-500 hover:underline w-full text-center"
            >
              ← Back to live
            </button>
          </div>
        )}
      </div>
      {selectedPhase !== 'DRAFT' && currentStatus !== 'DRAFT' && (
        <>
          <Separator />
          <ContextTree
            selectedPhase={contextPhase}
            ticketId={ticketId}
          />
        </>
      )}
    </div>
  )
}
