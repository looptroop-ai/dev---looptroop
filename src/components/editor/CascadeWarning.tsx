import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CascadeWarningProps {
  message: string
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function CascadeWarning({ message, open, onConfirm, onCancel }: CascadeWarningProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md border-yellow-500">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            Cascading Edit Warning
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-sm text-muted-foreground">
          {message}
        </DialogDescription>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm}>Proceed with Edit</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
