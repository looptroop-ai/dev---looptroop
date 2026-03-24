import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'

export function DoneView() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎉</span>
          <div>
            <h3 className="text-sm font-semibold text-green-600">Completed Successfully</h3>
            <p className="text-xs text-muted-foreground">
              Fully implemented, tested, verified, and cleaned up.
            </p>
          </div>
        </div>
        <PhaseArtifactsPanel phase="COMPLETED" isCompleted={true} />
      </div>

      <CollapsiblePhaseLogSection phase="COMPLETED" className="px-4 pb-4" />
    </div>
  )
}
