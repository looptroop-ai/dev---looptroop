import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import { dispatchPrdApprovalFocus, buildPrdApprovalOutline, getPrdInterviewJumpTargetForSection, parsePrdDocument } from '@/lib/prdDocument'
import { requestWorkspacePhaseNavigation } from '@/lib/workspaceNavigation'

function focusPrdAnchor(ticketId: string, anchorId: string) {
  dispatchPrdApprovalFocus(ticketId, anchorId)
}

function JumpToInterviewButton({
  ticketId,
  section,
  label,
}: {
  ticketId: string
  section: 'product' | 'scope' | 'technical_requirements' | 'risks' | 'epic' | 'user_story'
  label: string
}) {
  const target = getPrdInterviewJumpTargetForSection(section)

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 rounded-full px-2.5 text-[10px] uppercase tracking-wider"
      onClick={() => requestWorkspacePhaseNavigation({
        ticketId,
        phase: target.phase,
        anchorId: target.anchorId,
      })}
    >
      {label}
    </Button>
  )
}

function OutlineCard({
  ticketId,
  anchorId,
  title,
  description,
  interviewLabel,
  interviewSection,
  children,
}: {
  ticketId: string
  anchorId: string
  title: string
  description?: string
  interviewLabel?: string
  interviewSection?: 'product' | 'scope' | 'technical_requirements' | 'risks' | 'epic' | 'user_story'
  children?: ReactNode
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-2 py-2 transition-colors hover:bg-accent/30">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => focusPrdAnchor(ticketId, anchorId)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">{title}</span>
            {description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
          </div>
        </button>
        {interviewSection ? (
          <JumpToInterviewButton
            ticketId={ticketId}
            section={interviewSection}
            label={interviewLabel ?? 'Interview'}
          />
        ) : null}
      </div>
      {children ? <div className="mt-2 space-y-1.5 pl-3">{children}</div> : null}
    </div>
  )
}

export function PrdApprovalNavigator({ ticketId }: { ticketId: string }) {
  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['artifact', ticketId, 'prd'],
    queryFn: async () => {
      const response = await fetch(`/api/files/${ticketId}/prd`)
      if (!response.ok) throw new Error('Failed to load PRD')
      const payload = await response.json()
      return typeof payload?.content === 'string' ? payload.content : ''
    },
    staleTime: 5 * 60 * 1000,
  })

  const document = parsePrdDocument(fetchedContent ?? '')
  const outline = document ? buildPrdApprovalOutline(document) : null

  return (
    <div className="p-2">
      <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        PRD Approval
      </div>
      <ScrollArea className="max-h-[320px]">
        <div className="space-y-2 pr-2">
          {isLoading ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">Loading PRD outline…</div>
          ) : !outline ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">The PRD approval outline will appear once the canonical artifact is ready.</div>
          ) : (
            <>
              <OutlineCard
                ticketId={ticketId}
                anchorId={outline.product.anchorId}
                title={outline.product.label}
                description={outline.product.description}
                interviewLabel="Interview summary"
                interviewSection="product"
              />

              <OutlineCard
                ticketId={ticketId}
                anchorId={outline.scope.anchorId}
                title={outline.scope.label}
                description={outline.scope.description}
                interviewLabel="Foundation"
                interviewSection="scope"
              />

              <OutlineCard
                ticketId={ticketId}
                anchorId={outline.technicalRequirements.anchorId}
                title={outline.technicalRequirements.label}
                description={outline.technicalRequirements.description}
                interviewLabel="Structure"
                interviewSection="technical_requirements"
              />

              <OutlineCard
                ticketId={ticketId}
                anchorId={outline.risks.anchorId}
                title={outline.risks.label}
                description={outline.risks.description}
                interviewLabel="Interview summary"
                interviewSection="risks"
              />

              <div className="space-y-2 rounded-md border border-border/70 bg-background px-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">Epics</span>
                  <Badge variant="outline" className="h-4 text-[10px]">{outline.epics.length}</Badge>
                  <JumpToInterviewButton ticketId={ticketId} section="epic" label="Assembly" />
                </div>

                <div className="space-y-2">
                  {outline.epics.map((epic) => (
                    <OutlineCard
                      key={epic.id}
                      ticketId={ticketId}
                      anchorId={epic.anchorId}
                      title={`${epic.id} · ${epic.label}`}
                      description={epic.description || undefined}
                      interviewLabel="Assembly"
                      interviewSection="epic"
                    >
                      {epic.userStories.map((story) => (
                        <OutlineCard
                          key={story.id}
                          ticketId={ticketId}
                          anchorId={story.anchorId}
                          title={`${story.id} · ${story.title}`}
                          interviewLabel="Assembly"
                          interviewSection="user_story"
                        />
                      ))}
                    </OutlineCard>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
