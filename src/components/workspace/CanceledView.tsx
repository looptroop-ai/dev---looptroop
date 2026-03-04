import { PhaseLogPanel } from './PhaseLogPanel'

export function CanceledView() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Canceled</h3>
          <p className="text-xs text-muted-foreground">This ticket was canceled. No further actions can be taken.</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <PhaseLogPanel phase="CANCELED" />
      </div>
    </div>
  )
}
