import { useCallback, useRef, useState, useEffect } from 'react'
import { FolderOpen, Copy, Check as CheckIcon, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUI } from '@/context/useUI'
import { useTicketAction, useUpdateTicket } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProfile } from '@/hooks/useProfile'
import { useProjects } from '@/hooks/useProjects'
import { getStatusUserLabel } from '@/lib/workflowMeta'
import { getStatusProgress, getStatusRingColor } from '@/components/kanban/ticketCardUtils'
import { ProgressRing } from '@/components/kanban/ProgressRing'
import { EffortBadge } from '@/components/shared/EffortBadge'
import { TicketActions } from './TicketActions'
import { ErrorBanner } from './ErrorBanner'
import { COPY_SUCCESS_DISPLAY_MS } from '@/lib/constants'

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

function CopyablePathRow({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_SUCCESS_DISPLAY_MS)
    })
  }
  return (
    <div className="col-span-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-0.5 flex items-center gap-1.5 group">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <code className="text-xs font-mono text-muted-foreground truncate flex-1" title={path}>{path}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-muted"
          title="Copy path"
        >
          {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>
    </div>
  )
}

function CopyableDescription({ description }: { description: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(description).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_SUCCESS_DISPLAY_MS)
    })
  }

  return (
    <div className="col-span-2 border-t-[2px] border-border/70 pt-2 mt-1">
      <div className="flex items-center justify-between group">
        <span className="text-xs font-medium text-muted-foreground">Description</span>
        <button
          type="button"
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded hover:bg-muted"
          title="Copy description"
        >
          {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>
      <div className="mt-1 rounded-md border border-border/50 bg-muted/30 p-3">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function DashboardHeader({ ticket }: DashboardHeaderProps) {
  const { dispatch } = useUI()
  const { mutate: performAction, isPending } = useTicketAction()
  const { mutateAsync: updateTicket } = useUpdateTicket()
  const { data: profile } = useProfile()
  const [showDetails, setShowDetails] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(ticket.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleDraft(ticket.title)
  }, [ticket.title])

  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditingTitle])

  const handleSaveTitle = async () => {
    if (titleDraft.trim() && titleDraft !== ticket.title) {
      try {
        await updateTicket({ id: ticket.id, title: titleDraft.trim() })
      } catch {
        setTitleDraft(ticket.title)
      }
    } else {
      setTitleDraft(ticket.title)
    }
    setIsEditingTitle(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSaveTitle()
    if (e.key === 'Escape') {
      setTitleDraft(ticket.title)
      setIsEditingTitle(false)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowBottomFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }, [])
  const detailsScrollInit = useCallback(() => {
    setShowBottomFade(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => handleScroll())
    })
  }, [handleScroll])
  const canCancel = ticket.availableActions.includes('cancel')
  const canDelete = NON_CANCELABLE.includes(ticket.status)
  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === ticket.projectId)
  const statusLabel = getStatusUserLabel(ticket.status, {
    currentBead: ticket.runtime.currentBead,
    totalBeads: ticket.runtime.totalBeads,
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
          {isEditingTitle ? (
            <input
              ref={inputRef}
              className="text-base font-semibold truncate w-full max-w-[400px] bg-transparent border-b border-primary outline-none focus:ring-0 px-0.5 py-0"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveTitle}
            />
          ) : (
            <div className="flex items-center gap-1.5 group min-w-0">
              <h2 className="text-base font-semibold truncate max-w-[400px]">{ticket.title}</h2>
              {ticket.status === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded shrink-0"
                  aria-label="Edit title"
                  title="Edit Title"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
          <Badge variant="outline" className={`text-xs shrink-0 ${getStatusBadgeClasses(ticket.status)}`} title="Current workflow phase">
            {statusLabel}
          </Badge>
        </div>
        <TicketActions
          ticket={ticket}
          canCancel={canCancel}
          canDelete={canDelete}
          isPending={isPending}
          onShowDetails={() => setShowDetails(true)}
          onCancelConfirm={() => setShowCancelConfirm(true)}
          onClose={() => dispatch({ type: 'CLOSE_TICKET' })}
        />
      </div>

      <Dialog open={showDetails} onOpenChange={(open) => { setShowDetails(open); if (open) detailsScrollInit() }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Ticket Details</DialogTitle>
          </DialogHeader>
          <div className="relative flex-1 min-h-0 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="grid grid-cols-2 gap-3 text-sm overflow-y-auto pr-1 max-h-[calc(80vh-6rem)] [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:var(--border)_transparent]"
          >
            <div className="col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Title</span>
              <p className="mt-0.5 font-medium">{ticket.title}</p>
            </div>
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
            {ticket.startedAt && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Duration</span>
                <p className="mt-0.5">{(() => {
                  const start = new Date(ticket.startedAt).getTime()
                  const end = ['COMPLETED', 'CANCELED', 'BLOCKED_ERROR'].includes(ticket.status)
                    ? new Date(ticket.updatedAt).getTime()
                    // eslint-disable-next-line react-hooks/purity
                    : Date.now()
                  const diffMs = end - start
                  const mins = Math.floor(diffMs / 60000)
                  if (mins < 60) return `${mins}m`
                  const hrs = Math.floor(mins / 60)
                  return `${hrs}h ${mins % 60}m`
                })()}</p>
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
            {(() => {
              const isDraft = ticket.status === 'DRAFT'
              const mainModel = isDraft ? profile?.mainImplementer ?? null : ticket.lockedMainImplementer
              const mainVariant = isDraft ? (profile?.mainImplementerVariant ?? null) : ticket.lockedMainImplementerVariant
              const rawCouncilVariants = isDraft
                ? (profile?.councilMemberVariants ? JSON.parse(profile.councilMemberVariants) as Record<string, string> : {})
                : (ticket.lockedCouncilMemberVariants ?? {})
              const rawMembers: string[] = isDraft
                ? (profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [])
                : ticket.lockedCouncilMembers
              const otherMembers = (rawMembers.length > 0 && rawMembers[0] === mainModel) ? rawMembers.slice(1) : rawMembers
              if (!mainModel && otherMembers.length === 0) return null
              return (
                <div className="col-span-2 border-t-[4px] border-border pt-2 mt-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isDraft ? 'Current Council' : 'Models Selected'}
                  </span>
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {mainModel && (
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col space-y-1">
                          <span>Main Implementer</span>
                          <span>Council Member A</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {mainVariant && <EffortBadge variant={mainVariant} />}
                          <span className="font-mono text-right">{mainModel}</span>
                        </div>
                      </div>
                    )}
                    {otherMembers.length > 0 && (
                      <>
                        <div className="my-2 border-t-[2px] border-border/70" />
                        {otherMembers.map((member, index) => (
                          <div key={member} className="flex justify-between">
                            <span>Council Member {String.fromCharCode(66 + index)}</span>
                            <div className="flex items-center gap-2">
                              {rawCouncilVariants[member] && <EffortBadge variant={rawCouncilVariants[member]} />}
                              <span className="font-mono">{member}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )
            })()}
            {ticket.branchName && (
              <div className="col-span-2 border-t-[4px] border-border pt-2 mt-1 flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-muted-foreground">Branch / Worktree</span>
                  <p className="font-mono mt-0.5 break-all">{ticket.branchName}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs font-medium text-muted-foreground">Base Branch</span>
                  <p className="font-mono mt-0.5">{ticket.runtime.baseBranch}</p>
                </div>
              </div>
            )}
            {ticket.runtime.totalBeads > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Beads</span>
                <p className="mt-0.5">{ticket.runtime.currentBead} / {ticket.runtime.totalBeads}</p>
              </div>
            )}
            {ticket.runtime.totalBeads > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Completion</span>
                <p className="mt-0.5">{Math.round(ticket.runtime.percentComplete)}%</p>
              </div>
            )}
            {ticket.runtime.iterationCount > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Iterations</span>
                <p className="mt-0.5">
                  {ticket.runtime.iterationCount}
                  {ticket.runtime.maxIterations && ticket.runtime.maxIterations > 0 ? ` / ${ticket.runtime.maxIterations}` : ''}
                </p>
              </div>
            )}
            {!ticket.branchName && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Base Branch</span>
                <p className="font-mono mt-0.5">{ticket.runtime.baseBranch}</p>
              </div>
            )}
            {ticket.runtime.candidateCommitSha && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Candidate Commit</span>
                <p className="font-mono mt-0.5">{ticket.runtime.candidateCommitSha}</p>
              </div>
            )}
            {ticket.errorMessage && (
              <ErrorBanner errorMessage={ticket.errorMessage} />
            )}
            {project && ticket.status !== 'DRAFT' && (
              <div className="col-span-2 border-t-[2px] border-border/70 pt-2 mt-1">
                <CopyablePathRow label="Artifacts Location" path={ticket.runtime.artifactRoot || `${project.folderPath}/.looptroop/worktrees/${ticket.externalId}`} />
              </div>
            )}
            {ticket.description && (
              <CopyableDescription description={ticket.description} />
            )}
          </div>
          {showBottomFade && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
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
