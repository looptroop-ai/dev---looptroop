import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'

export function CanceledView() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Canceled</h3>
          <p className="text-xs text-muted-foreground">This ticket was canceled. No further actions can be taken.</p>
        </div>
      </div>

      <CollapsiblePhaseLogSection phase="CANCELED" className="px-4 pb-4" />
    </div>
  )
}
