import { Separator } from '@/components/ui/separator'
import { PhaseTimeline } from '@/components/navigator/PhaseTimeline'
import { ContextTree } from '@/components/navigator/ContextTree'
import { InterviewNavigator } from '@/components/navigator/InterviewNavigator'

interface NavigatorPanelProps {
  ticketId: string
  currentStatus: string
  selectedPhase: string
  canceledFromStatus?: string
  previousStatus?: string
  onSelectPhase: (phase: string | null) => void
}

export function NavigatorPanel({ ticketId, currentStatus, selectedPhase, canceledFromStatus, previousStatus, onSelectPhase }: NavigatorPanelProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <PhaseTimeline
            currentStatus={currentStatus}
            canceledFromStatus={canceledFromStatus}
            previousStatus={previousStatus}
            onSelectPhase={(phase) => onSelectPhase(phase === currentStatus ? null : phase)}
            selectedPhase={selectedPhase}
          />
        </div>
        {selectedPhase !== currentStatus && (
          <div className="sticky bottom-0 border-t border-border bg-background p-2">
            <button
              onClick={() => onSelectPhase(null)}
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
          {selectedPhase === 'WAITING_INTERVIEW_ANSWERS'
            ? <InterviewNavigator ticketId={ticketId} />
            : (
              <ContextTree
                selectedPhase={selectedPhase}
                ticketId={ticketId}
              />
            )}
        </>
      )}
    </div>
  )
}
