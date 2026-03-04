import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CascadeWarningProps {
  artifactType: 'interview' | 'prd' | 'beads'
  onConfirm: () => void
  onCancel: () => void
}

const CASCADE_MESSAGES: Record<string, string> = {
  interview: 'Editing Interview Results will restart the PRD and Beads phases. All previous PRD and Beads data will be lost.',
  prd: 'Editing the PRD will restart the Beads phase. All previous Beads data will be lost.',
  beads: 'Editing Beads will not affect other phases.',
}

export function CascadeWarning({ artifactType, onConfirm, onCancel }: CascadeWarningProps) {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <Card className="max-w-md mx-auto border-yellow-500">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2 text-yellow-600">
          <AlertTriangle className="h-4 w-4" />
          Cascading Edit Warning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {CASCADE_MESSAGES[artifactType]}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="rounded"
          />
          I understand the consequences
        </label>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm} disabled={!confirmed && artifactType !== 'beads'}>
            Proceed with Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
