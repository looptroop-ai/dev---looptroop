import { useId, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getStatusUserLabel, WORKFLOW_GROUPS } from '@/lib/workflowMeta'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/hooks/useTickets'
import type { WorkflowContextKey } from '@shared/workflowMeta'
import { getWorkflowPhaseMeta } from '@shared/workflowMeta'

const CONTEXT_KEY_LABELS: Record<WorkflowContextKey, { label: string; description: string }> = {
  ticket_details: { label: 'Ticket Details', description: 'Title, description, and ticket metadata.' },
  relevant_files: { label: 'Relevant Files', description: 'Source file contents identified as relevant to this ticket by AI analysis.' },
  drafts: { label: 'Competing Drafts', description: 'Alternative model drafts used for voting/refinement.' },
  interview: { label: 'Interview Results', description: 'Interview question/answer artifact content.' },
  full_answers: { label: 'Full Answers', description: 'Model-specific interview results with skipped questions filled in by AI.' },
  user_answers: { label: 'User Answers', description: 'Collected user responses during interview loop.' },
  votes: { label: 'Council Votes', description: 'Scoring/vote output from council phase.' },
  prd: { label: 'PRD', description: 'Product requirements artifact.' },
  beads: { label: 'Beads Plan', description: 'Current beads artifact, including semantic blueprint content during coverage and execution-ready graph data after expansion.' },
  beads_draft: { label: 'Semantic Blueprint', description: 'Refined semantic beads blueprint used as the source for the final expansion step.' },
  tests: { label: 'Verification Tests', description: 'Coverage/final test context and test intent.' },
  bead_data: { label: 'Current Bead Data', description: 'Active bead specification and acceptance criteria.' },
  bead_notes: { label: 'Bead Notes', description: 'Iteration notes and prior-attempt context.' },
  error_context: { label: 'Error Context', description: 'Failure context from previous blocked iteration.' },
}

const KANBAN_PHASE_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  needs_input: 'Needs Input',
  done: 'Done',
}

interface WorkspacePhaseSummaryProps {
  phase: string
  ticket: Ticket
  errorMessage?: string | null
}

function DetailsList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function WorkspacePhaseSummary({ phase, ticket, errorMessage }: WorkspacePhaseSummaryProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const phaseMeta = getWorkflowPhaseMeta(phase)
  const descriptionId = useId()

  const phaseLabel = useMemo(() => getStatusUserLabel(phase, {
    currentBead: ticket.runtime.currentBead,
    totalBeads: ticket.runtime.totalBeads,
    errorMessage,
  }), [errorMessage, phase, ticket.runtime.currentBead, ticket.runtime.totalBeads])

  if (!phaseMeta) return null

  return (
    <>
      <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={descriptionId}
          className="flex items-center gap-1 py-1 text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
          <span>{phaseLabel}</span>
        </button>
        {expanded ? (
          <p id={descriptionId} className="mt-1 ml-5 text-[11px] text-muted-foreground">
            {phaseMeta.description}
            {' '}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpen(true)
                  }}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                  aria-label={`Show detailed explanation for ${phaseLabel}`}
                >
                  (details)
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">See a full breakdown of what happens in this status.</TooltipContent>
            </Tooltip>
          </p>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeButtonVariant="dashboard" className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{phaseLabel}</DialogTitle>
            <DialogDescription>{phaseMeta.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto pr-2">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Overview</h3>
              <p className="text-sm leading-6 text-muted-foreground">{phaseMeta.details.overview}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Step by Step</h3>
              <DetailsList items={phaseMeta.details.steps} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Outputs</h3>
              <DetailsList items={phaseMeta.details.outputs} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Transitions</h3>
              <DetailsList items={phaseMeta.details.transitions} />
            </section>

            {phaseMeta.details.notes && phaseMeta.details.notes.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Notes</h3>
                <DetailsList items={phaseMeta.details.notes} />
              </section>
            ) : null}

            {phaseMeta.contextSummary.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Context</h3>
                <p className="text-sm text-muted-foreground">Data and artifacts the AI receives in this phase:</p>
                {phaseMeta.contextSections && phaseMeta.contextSections.length > 0 ? (
                  <div className="space-y-3">
                    {phaseMeta.contextSections.map((section) => (
                      <div key={section.label} className="space-y-1">
                        <h4 className="text-sm font-medium text-foreground">
                          {section.label}
                          {section.description ? <span className="font-normal text-muted-foreground">{` — ${section.description}`}</span> : null}
                        </h4>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {section.keys.map((key) => {
                            const info = CONTEXT_KEY_LABELS[key]
                            return (
                              <li key={key}>
                                <span className="font-medium text-foreground">{info.label}</span>
                                {` — ${info.description}`}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {phaseMeta.contextSummary.map((key) => {
                      const info = CONTEXT_KEY_LABELS[key]
                      return (
                        <li key={key}>
                          <span className="font-medium text-foreground">{info.label}</span>
                          {` — ${info.description}`}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Workflow Info</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Kanban Phase</dt>
                <dd className="text-foreground">{KANBAN_PHASE_LABELS[phaseMeta.kanbanPhase] ?? phaseMeta.kanbanPhase}</dd>
                <dt className="text-muted-foreground">Group</dt>
                <dd className="text-foreground">{WORKFLOW_GROUPS.find((g) => g.id === phaseMeta.groupId)?.label ?? phaseMeta.groupId}</dd>
                <dt className="text-muted-foreground">UI View</dt>
                <dd className="text-foreground capitalize">{phaseMeta.uiView}</dd>
                <dt className="text-muted-foreground">Editable</dt>
                <dd className="text-foreground">{phaseMeta.editable ? 'Yes' : 'No'}</dd>
                <dt className="text-muted-foreground">Multi-Model</dt>
                <dd className="text-foreground">{phaseMeta.multiModelLogs ? 'Yes' : 'No'}</dd>
                {phaseMeta.progressKind ? (
                  <>
                    <dt className="text-muted-foreground">Progress Tracking</dt>
                    <dd className="text-foreground capitalize">{phaseMeta.progressKind}</dd>
                  </>
                ) : null}
                {phaseMeta.reviewArtifactType ? (
                  <>
                    <dt className="text-muted-foreground">Review Artifact</dt>
                    <dd className="text-foreground capitalize">{phaseMeta.reviewArtifactType}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
