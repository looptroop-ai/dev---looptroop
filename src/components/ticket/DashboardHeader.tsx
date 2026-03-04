import { useState } from 'react'
import { X, Ban, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUI } from '@/context/UIContext'
import { useTicketAction } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { getStatusUserLabel } from '@/lib/workflowMeta'

interface DashboardHeaderProps {
  ticket: Ticket
}

function getPriorityLabel(priority: number): string {
  const labels: Record<number, string> = { 1: 'Very High', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Very Low' }
  return labels[priority] ?? 'Normal'
}

function getStatusBadgeClasses(status: string): string {
  if (status === 'BLOCKED_ERROR') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
  if (['COMPLETED', 'CANCELED'].includes(status)) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700'
  if (status.startsWith('WAITING_')) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
  return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
}

const NON_CANCELABLE = ['COMPLETED', 'CANCELED']

export function DashboardHeader({ ticket }: DashboardHeaderProps) {
  const { dispatch } = useUI()
  const { mutate: performAction, isPending } = useTicketAction()
  const [showDetails, setShowDetails] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const canCancel = !NON_CANCELABLE.includes(ticket.status)
  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === ticket.projectId)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: ticket.currentBead,
    totalBeads: ticket.totalBeads,
    errorMessage: ticket.errorMessage,
  })

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            {project?.icon && (project.icon.startsWith('data:') ? <img src={project.icon} className="h-4 w-4 rounded" alt="" /> : <span className="text-sm">{project.icon}</span>)}
            <span className="font-mono text-sm font-semibold" style={{ color: project?.color ?? undefined }}>{ticket.externalId}</span>
          </div>
          <h2 className="text-base font-semibold truncate max-w-[400px]">{ticket.title}</h2>
          <Badge variant="outline" className={`text-xs shrink-0 ${getStatusBadgeClasses(ticket.status)}`} title="Current workflow phase">
            {statusLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(true)}
            className="gap-1 text-muted-foreground h-8 px-2"
            title="Ticket details"
          >
            <Info className="h-4 w-4" />
            <span className="text-xs">Details</span>
          </Button>
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCancelConfirm(true)}
              disabled={isPending}
              className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2"
              title="Cancel this ticket"
            >
              <Ban className="h-3.5 w-3.5" />
              <span className="text-xs">Cancel</span>
            </Button>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: 'CLOSE_TICKET' })}
            aria-label="Close dashboard"
            title="Close ticket view (Esc)"
            className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-muted text-foreground hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Ticket Details</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">External ID</span>
              <p className="font-mono mt-0.5">{ticket.externalId}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <p className="mt-0.5">P{ticket.priority} — {getPriorityLabel(ticket.priority)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <p className="mt-0.5">{statusLabel}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Created</span>
              <p className="mt-0.5">{new Date(ticket.createdAt).toLocaleString()}</p>
            </div>
            {ticket.description && (
              <div className="col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{ticket.description}</p>
              </div>
            )}
            {ticket.updatedAt && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Last Updated</span>
                <p className="mt-0.5">{new Date(ticket.updatedAt).toLocaleString()}</p>
              </div>
            )}
            {ticket.status !== 'DRAFT' && (ticket.lockedMainImplementer || ticket.lockedCouncilMembers) && (
              <div className="col-span-2 border-t border-border pt-2 mt-1">
                <span className="text-xs font-medium text-muted-foreground">Models Selected</span>
                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {ticket.lockedMainImplementer && (
                    <div className="flex justify-between"><span>Main Implementer</span><span className="font-mono">{ticket.lockedMainImplementer}</span></div>
                  )}
                  {(() => {
                    try {
                      const members: string[] = ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) : []
                      return members.map((m, i) => (
                        <div key={i} className="flex justify-between"><span>Council Member {String.fromCharCode(65 + i)}</span><span className="font-mono">{m}</span></div>
                      ))
                    } catch { return null }
                  })()}
                </div>
              </div>
            )}
            {ticket.branchName && (
              <div className="col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Branch</span>
                <p className="font-mono mt-0.5">{ticket.branchName}</p>
              </div>
            )}
            {ticket.totalBeads && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Beads</span>
                <p className="mt-0.5">{ticket.currentBead ?? 0} / {ticket.totalBeads}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Ticket</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel this ticket? This action cannot be undone. The ticket will be moved to the Done column with Canceled status.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setShowCancelConfirm(false)}>
              Keep Ticket
            </Button>
            <Button variant="destructive" size="sm" onClick={() => {
              performAction({ id: ticket.id, action: 'cancel' })
              setShowCancelConfirm(false)
            }}>
              Yes, Cancel Ticket
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
