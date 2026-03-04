import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CascadeWarningProps {
  artifactType: 'interview' | 'prd' | 'beads'
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

const CASCADE_MESSAGES: Record<string, string> = {
  interview: 'Editing Interview Results will restart the PRD and Beads phases. All previous PRD and Beads data will be lost.',
  prd: 'Editing the PRD will restart the Beads phase. All previous Beads data will be lost.',
  beads: 'Editing Beads will not affect other phases.',
}

export function CascadeWarning({ artifactType, open, onConfirm, onCancel }: CascadeWarningProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md border-yellow-500">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            Cascading Edit Warning
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {CASCADE_MESSAGES[artifactType]}
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm}>Proceed with Edit</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
