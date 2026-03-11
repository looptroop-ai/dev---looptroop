import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'

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

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase="COMPLETED" />
      </div>
    </div>
  )
}
