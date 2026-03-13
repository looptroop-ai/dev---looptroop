import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingText } from '@/components/ui/LoadingText'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTicketAction } from '@/hooks/useTickets'
import type { Ticket } from '@/hooks/useTickets'
import { useProjects } from '@/hooks/useProjects'
import { useProfile } from '@/hooks/useProfile'
import { CalendarDays } from 'lucide-react'

const PRIORITY_LABELS: Record<number, string> = { 1: 'Very High', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Very Low' }
const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  3: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  4: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  5: 'bg-blue-50 text-blue-500 dark:bg-blue-900/20 dark:text-blue-300',
}

interface DraftViewProps {
  ticket: Ticket
}

function parseConfiguredCouncilMembers(raw: string | null | undefined): string[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const unique = new Set<string>()
    const members: string[] = []

    for (const value of parsed) {
      const memberId = typeof value === 'string' ? value.trim() : ''
      if (!memberId || unique.has(memberId)) continue
      unique.add(memberId)
      members.push(memberId)
    }

    return members
  } catch {
    return []
  }
}

function resolveCurrentCouncilMembers(
  mainImplementer: string | null | undefined,
  rawCouncilMembers: string | null | undefined,
): string[] {
  const resolved = new Set<string>()
  const members: string[] = []
  const normalizedMainImplementer = typeof mainImplementer === 'string' ? mainImplementer.trim() : ''

  if (normalizedMainImplementer) {
    resolved.add(normalizedMainImplementer)
    members.push(normalizedMainImplementer)
  }

  for (const memberId of parseConfiguredCouncilMembers(rawCouncilMembers)) {
    if (resolved.has(memberId)) continue
    resolved.add(memberId)
    members.push(memberId)
  }

  return members
}

function formatStartErrorMessage(message: string) {
  const trimmed = message.trim() || 'Failed to start ticket.'
  if (trimmed.includes('configured in OpenCode')) {
    return `${trimmed} Update Configuration to choose currently available models, then try again.`
  }
  return trimmed
}

export function DraftView({ ticket }: DraftViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const { data: projects = [] } = useProjects()
  const { data: profile, isLoading: isProfileLoading } = useProfile()
  const [startError, setStartError] = useState<string | null>(null)
  const project = projects.find(p => p.id === ticket.projectId)
  const mainImplementer = typeof profile?.mainImplementer === 'string'
    ? profile.mainImplementer.trim()
    : ''
  const currentCouncilMembers = resolveCurrentCouncilMembers(
    mainImplementer,
    project?.councilMembers ?? profile?.councilMembers ?? null,
  )
  const highlightedMainImplementer = mainImplementer || currentCouncilMembers[0] || ''
  const shouldShowCouncilMembers = currentCouncilMembers.length > 0 || !isProfileLoading

  const handleStart = () => {
    setStartError(null)
    performAction(
      { id: ticket.id, action: 'start' },
      {
        onSuccess: () => setStartError(null),
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Failed to start ticket.'
          setStartError(formatStartErrorMessage(message))
        },
      },
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <div className="flex flex-col items-center gap-4 max-w-lg mx-auto">
          <div className="text-center">
            <h3 className="text-lg font-semibold">Ready to Start</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Click Start to begin the AI-driven interview process. This may take hours — LoopTroop optimizes for correctness.
            </p>
          </div>

          {/* Ticket metadata: priority, creation date, project */}
          <div className="w-full flex flex-wrap items-center justify-center gap-3 text-xs">
            <Badge variant="outline" className={PRIORITY_COLORS[ticket.priority] ?? PRIORITY_COLORS[3]}>
              P{ticket.priority} — {PRIORITY_LABELS[ticket.priority] ?? 'Normal'}
            </Badge>
            <span className="flex items-center gap-1 text-muted-foreground" title={new Date(ticket.createdAt).toLocaleString()}>
              <CalendarDays className="h-3.5 w-3.5" />
              Created {new Date(ticket.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {project && (
              <span className="flex items-center gap-1 text-muted-foreground">
                {project.icon && (project.icon.startsWith('data:') ? <img src={project.icon} className="h-3.5 w-3.5 rounded" alt="" /> : <span>{project.icon}</span>)}
                {project.name}
              </span>
            )}
          </div>

          {shouldShowCouncilMembers && (
            <div className="w-full flex justify-center">
              <div className="inline-flex max-w-full flex-col items-center gap-1 rounded-md border border-dashed border-border/70 bg-muted/25 px-2.5 py-1.5 text-center">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    Current Council Members
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border/70 text-[8px] font-semibold leading-none text-muted-foreground transition-colors hover:bg-muted/60"
                        aria-label="Council member info"
                      >
                        i
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-56 text-[11px] leading-snug">
                      If you start this ticket now, these council members will stay fixed for the entire ticket lifecycle. To change the models, go to Configuration first.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {currentCouncilMembers.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-1">
                    {currentCouncilMembers.map((memberId) => (
                      <Badge
                        key={memberId}
                        variant={memberId === highlightedMainImplementer ? 'default' : 'secondary'}
                        className="h-auto max-w-full gap-1 px-1.5 py-0.5 text-[9px] leading-tight whitespace-normal"
                      >
                        {memberId === highlightedMainImplementer && (
                          <span className="rounded-sm bg-background/20 px-1 py-px text-[8px] font-semibold uppercase tracking-[0.14em]">
                            Main Implementer
                          </span>
                        )}
                        <span className="font-mono break-all">{memberId}</span>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    No council members are configured yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {ticket.description && (
            <div className="w-full rounded-md border border-border p-3 max-h-96 overflow-y-auto overflow-x-hidden">
              <h4 className="text-xs font-medium mb-1">Description</h4>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{ticket.description}</p>
            </div>
          )}

          <Button
            size="lg"
            onClick={handleStart}
            disabled={isPending}
          >
            {isPending ? <LoadingText text="Starting" /> : '🚀 Start Ticket'}
          </Button>

          {startError && (
            <p role="alert" aria-live="polite" className="max-w-md text-center text-xs text-destructive">
              {startError}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
