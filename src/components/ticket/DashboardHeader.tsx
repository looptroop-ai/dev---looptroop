import { useState } from 'react'
import { X, Ban, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUI } from '@/context/UIContext'
import { useTicketAction } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { getStatusUserLabel, STATUS_ORDER, STATUS_TO_PHASE } from '@/lib/workflowMeta'

function getStatusProgress(status: string): number | null {
  if (status === 'BLOCKED_ERROR') return null
  if (STATUS_TO_PHASE[status] === 'todo' || STATUS_TO_PHASE[status] === 'done') return null
  const idx = STATUS_ORDER.indexOf(status)
  if (idx === -1) return null
  return Math.round(((idx + 1) / STATUS_ORDER.length) * 100)
}

function getStatusRingColor(status: string): string {
  switch (status) {
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
    case 'VERIFYING_INTERVIEW_COVERAGE':
    case 'CODING':
      return 'text-blue-500'
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
    case 'WAITING_MANUAL_VERIFICATION':
      return 'text-yellow-500'
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return 'text-indigo-500'
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return 'text-purple-500'
    case 'PRE_FLIGHT_CHECK':
      return 'text-cyan-500'
    case 'RUNNING_FINAL_TEST':
      return 'text-teal-500'
    case 'INTEGRATING_CHANGES':
      return 'text-emerald-500'
    case 'CLEANING_ENV':
      return 'text-slate-500'
    default:
      return 'text-blue-500'
  }
}

function ProgressRing({ percent, size = 20, stroke = 2.5, colorClass = 'text-blue-500' }: { percent: number; size?: number; stroke?: number; colorClass?: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted-foreground/20" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={colorClass}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

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
  const progress = getStatusProgress(ticket.status)
  const ringColor = getStatusRingColor(ticket.status)
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
          {ticket.status !== 'DRAFT' && (
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
          )}
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
              <span className="text-xs font-medium text-muted-foreground">Created</span>
              <p className="mt-0.5">{new Date(ticket.createdAt).toLocaleString()}</p>
            </div>
            {ticket.status !== 'DRAFT' ? (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Last Updated</span>
                <p className="mt-0.5">{ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : 'N/A'}</p>
              </div>
            ) : <div />}
            {ticket.status !== 'DRAFT' && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Started At</span>
                <p className="mt-0.5">{ticket.startedAt ? new Date(ticket.startedAt).toLocaleString() : '—'}</p>
              </div>
            )}
            <div className="col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={ticket.status !== 'DRAFT' ? getStatusBadgeClasses(ticket.status).replace('bg-', 'text-').split(' ').filter(c => c.startsWith('text-')).join(' ') : ''}>
                  {statusLabel}
                </span>
                {ticket.status !== 'DRAFT' && progress !== null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0" title="Workflow progress">
                    <ProgressRing percent={progress} colorClass={ringColor} />
                    <span className={ringColor}>{progress}%</span>
                  </span>
                )}
              </div>
            </div>
            {ticket.description && (
              <div className="col-span-2 border-t-[2px] border-border/70 pt-2 mt-1">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <div className="mt-1 max-h-48 overflow-y-auto overflow-x-hidden rounded-md border border-border/50 bg-muted/30 p-3">
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">{ticket.description}</p>
                </div>
              </div>
            )}
            {ticket.status !== 'DRAFT' && (ticket.lockedMainImplementer || ticket.lockedCouncilMembers) && (
              <div className="col-span-2 border-t-[4px] border-border pt-2 mt-1">
                <span className="text-xs font-medium text-muted-foreground">Models Selected</span>
                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(() => {
                    try {
                      const mainModel = ticket.lockedMainImplementer
                      const members: string[] = ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) : []
                      const otherMembers = (members.length > 0 && members[0] === mainModel) ? members.slice(1) : members

                      return (
                        <>
                          {mainModel && (
                            <div className="flex justify-between items-center">
                              <div className="flex flex-col space-y-1">
                                <span>Main Implementer</span>
                                <span>Council Member A</span>
                              </div>
                              <span className="font-mono text-right">{mainModel}</span>
                            </div>
                          )}
                          {otherMembers.length > 0 && (
                            <>
                              <div className="my-2 border-t-[2px] border-border/70" />
                              {otherMembers.map((m, i) => (
                                <div key={i} className="flex justify-between"><span>Council Member {String.fromCharCode(66 + i)}</span><span className="font-mono">{m}</span></div>
                              ))}
                            </>
                          )}
                        </>
                      )
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
