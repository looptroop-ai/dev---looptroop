import { useId, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLogs } from '@/context/useLogContext'
import { getStatusUserLabel, WORKFLOW_GROUPS } from '@/lib/workflowMeta'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/hooks/useTickets'
import { type DBartifact, useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { findLatestArtifactByType, findLatestCompanionArtifact, parseArtifactCompanionPayload } from '@/components/workspace/artifactCompanionUtils'
import { buildCoverageArtifactContent, parseCoverageArtifact } from '@/components/workspace/phaseArtifactTypes'
import type { WorkflowContextKey } from '@shared/workflowMeta'
import { getWorkflowPhaseMeta } from '@shared/workflowMeta'

const CONTEXT_KEY_LABELS: Record<WorkflowContextKey, { label: string; description: string }> = {
  ticket_details: { label: 'Ticket Details', description: 'The ticket title, full description text, priority level, project metadata, and any user-supplied implementation notes. This is the root context that every planning phase receives.' },
  relevant_files: { label: 'Relevant Files', description: 'Source file contents identified as relevant by the AI scan phase. Includes file paths, content excerpts, relevance ratings, and rationales explaining why each file matters to this ticket.' },
  drafts: { label: 'Competing Drafts', description: 'The set of independently generated candidate drafts from each council member. Used during voting to compare approaches side-by-side and during refinement to merge the strongest ideas from losing drafts into the winner.' },
  interview: { label: 'Interview Results', description: 'The canonical interview artifact containing the finalized questions, user answers, skip decisions, and any follow-up rounds. This is the approved version that downstream phases treat as authoritative.' },
  full_answers: { label: 'Full Answers', description: 'Model-generated interview results where skipped questions have been filled in by the AI. Created during the PRD drafting phase so the council has a complete working basis even when some interview questions were skipped by the user.' },
  user_answers: { label: 'User Answers', description: 'The raw user responses collected during the interview loop, including answer text, skip/unskip decisions, and batch submission history across initial and follow-up rounds.' },
  votes: { label: 'Council Votes', description: 'Structured vote payloads from each council member, including rubric scores, rankings, and outcome metadata. Used to select the winning draft and provide audit transparency.' },
  prd: { label: 'PRD', description: 'The product requirements document artifact — either the latest coverage-checked candidate or the user-approved version. Contains requirements, acceptance criteria, edge cases, and test intent.' },
  beads: { label: 'Beads Plan', description: 'The current beads artifact. During coverage phases this contains the semantic blueprint with task descriptions and acceptance criteria. After the expansion step, it contains execution-ready bead records with dependency graphs, commands, and runtime fields.' },
  beads_draft: { label: 'Semantic Blueprint', description: 'The refined semantic beads blueprint before final expansion. Contains high-level task decomposition, acceptance criteria, and test intent without execution-specific fields. Used as input to the expansion step that produces execution-ready bead records.' },
  tests: { label: 'Verification Tests', description: 'Coverage and final test context including test commands, expected outcomes, and test intent derived from the PRD and beads plan. Used during self-testing and integration phases.' },
  bead_data: { label: 'Current Bead Data', description: 'The active bead specification being executed, including its description, acceptance criteria, dependencies, file targets, and any retry/iteration context from previous attempts.' },
  bead_notes: { label: 'Bead Notes', description: 'Accumulated iteration notes and prior-attempt context for the current bead. Includes error messages, partial progress, and diagnostic hints from failed attempts to help the next retry succeed.' },
  error_context: { label: 'Error Context', description: 'Failure context from the most recent blocked error, including the error message, error codes, the phase where the failure occurred, occurrence timing, and diagnostic details to help with retry decisions.' },
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

type CoveragePhase = 'VERIFYING_PRD_COVERAGE' | 'VERIFYING_BEADS_COVERAGE'

const COVERAGE_PHASE_META: Record<CoveragePhase, {
  coverageArtifactType: 'prd_coverage' | 'beads_coverage'
  coverageInputArtifactType: 'prd_coverage_input' | 'beads_coverage_input'
  coverageRevisionArtifactType: 'prd_coverage_revision' | 'beads_coverage_revision'
  candidateLabel: 'PRD Candidate' | 'Implementation Plan'
}> = {
  VERIFYING_PRD_COVERAGE: {
    coverageArtifactType: 'prd_coverage',
    coverageInputArtifactType: 'prd_coverage_input',
    coverageRevisionArtifactType: 'prd_coverage_revision',
    candidateLabel: 'PRD Candidate',
  },
  VERIFYING_BEADS_COVERAGE: {
    coverageArtifactType: 'beads_coverage',
    coverageInputArtifactType: 'beads_coverage_input',
    coverageRevisionArtifactType: 'beads_coverage_revision',
    candidateLabel: 'Implementation Plan',
  },
}

function isCoveragePhase(phase: string): phase is CoveragePhase {
  return phase === 'VERIFYING_PRD_COVERAGE' || phase === 'VERIFYING_BEADS_COVERAGE'
}

function normalizeCandidateVersion(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : null
}

function isTimestampOnOrAfter(timestamp: string | undefined, minimumTimestamp: string | undefined): boolean {
  if (!minimumTimestamp) return true
  if (!timestamp) return false

  const timestampMs = Date.parse(timestamp)
  const minimumMs = Date.parse(minimumTimestamp)
  if (Number.isNaN(timestampMs) || Number.isNaN(minimumMs)) return true
  return timestampMs >= minimumMs
}

type ArtifactContentSource = Pick<DBartifact, 'content'>

function extractArtifactCandidateVersion(
  artifact: ArtifactContentSource | undefined,
  expectedBaseArtifactType?: string,
): number | null {
  const companionVersion = normalizeCandidateVersion(
    parseArtifactCompanionPayload(artifact?.content, expectedBaseArtifactType)?.candidateVersion,
  )
  if (companionVersion) return companionVersion

  if (!artifact?.content?.trim()) return null
  try {
    const parsed = JSON.parse(artifact.content) as Record<string, unknown>
    return normalizeCandidateVersion(parsed.candidateVersion ?? parsed.finalCandidateVersion)
  } catch {
    return null
  }
}

function extractCoverageVersionFromArtifacts(phase: CoveragePhase, artifacts: DBartifact[]): number | null {
  const meta = COVERAGE_PHASE_META[phase]
  const coverageArtifact = findLatestArtifactByType(artifacts, meta.coverageArtifactType, [phase])
  const coverageCompanion = findLatestCompanionArtifact(artifacts, meta.coverageArtifactType, [phase])
  const mergedCoverageContent = buildCoverageArtifactContent(coverageArtifact?.content, coverageCompanion?.content)
  const parsedCoverageArtifact = mergedCoverageContent ? parseCoverageArtifact(mergedCoverageContent) : null
  const coverageVersion = parsedCoverageArtifact?.finalCandidateVersion
    ?? parsedCoverageArtifact?.attempts?.[parsedCoverageArtifact.attempts.length - 1]?.candidateVersion
    ?? null

  const coverageInputVersion = extractArtifactCandidateVersion(
    findLatestCompanionArtifact(artifacts, meta.coverageInputArtifactType, [phase])
      ?? findLatestArtifactByType(artifacts, meta.coverageInputArtifactType, [phase]),
    meta.coverageInputArtifactType,
  )

  const coverageRevisionVersion = extractArtifactCandidateVersion(
    findLatestCompanionArtifact(artifacts, meta.coverageRevisionArtifactType, [phase])
      ?? findLatestArtifactByType(artifacts, meta.coverageRevisionArtifactType, [phase]),
    meta.coverageRevisionArtifactType,
  )

  return [coverageVersion, coverageInputVersion, coverageRevisionVersion]
    .filter((version): version is number => typeof version === 'number')
    .reduce<number | null>((highest, version) => (highest == null || version > highest ? version : highest), null)
}

function extractCoverageVersionFromLogs(phase: CoveragePhase, lines: string[]): number | null {
  const candidateLabel = COVERAGE_PHASE_META[phase].candidateLabel
  const escapedCandidateLabel = candidateLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const revisingPattern = new RegExp(`Coverage found .* ${escapedCandidateLabel} v(\\d+)\\. Revising candidate before the next audit pass\\.`, 'i')
  const revisedPattern = new RegExp(`Revised ${escapedCandidateLabel} v\\d+ into ${escapedCandidateLabel} v(\\d+)\\.`, 'i')
  const genericVersionPattern = new RegExp(`${escapedCandidateLabel} v(\\d+)`, 'i')

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    const revisingMatch = line.match(revisingPattern)
    if (revisingMatch) {
      const currentVersion = Number.parseInt(revisingMatch[1] ?? '', 10)
      return Number.isFinite(currentVersion) ? currentVersion + 1 : null
    }

    const revisedMatch = line.match(revisedPattern)
    if (revisedMatch) {
      const nextVersion = Number.parseInt(revisedMatch[1] ?? '', 10)
      return Number.isFinite(nextVersion) ? nextVersion : null
    }

    const genericMatch = line.match(genericVersionPattern)
    if (genericMatch) {
      const version = Number.parseInt(genericMatch[1] ?? '', 10)
      return Number.isFinite(version) ? version : null
    }
  }

  return null
}

function findLatestPhaseActivationTimestamp(phase: string, logLines: Array<{ line: string; timestamp?: string }>): string | undefined {
  for (let index = logLines.length - 1; index >= 0; index -= 1) {
    const entry = logLines[index]
    if (!entry) continue
    if (entry.line.includes(`-> ${phase}`) || entry.line.includes(`Status ${phase} is active.`)) {
      return entry.timestamp
    }
  }
  return undefined
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
  const logCtx = useLogs()
  const shouldTrackCoverageVersion = isCoveragePhase(phase)
  const { artifacts } = useTicketArtifacts(ticket.id, { skipFetch: !shouldTrackCoverageVersion })
  const phaseLogs = shouldTrackCoverageVersion && logCtx ? logCtx.getLogsForPhase(phase) : []
  const phaseActivationTimestamp = shouldTrackCoverageVersion
    ? findLatestPhaseActivationTimestamp(phase, phaseLogs)
    : undefined

  const basePhaseLabel = useMemo(() => getStatusUserLabel(phase, {
    currentBead: ticket.runtime.currentBead,
    totalBeads: ticket.runtime.totalBeads,
    errorMessage,
  }), [errorMessage, phase, ticket.runtime.currentBead, ticket.runtime.totalBeads])
  const coverageVersion = useMemo(() => {
    if (!shouldTrackCoverageVersion) return null

    const runArtifacts = phaseActivationTimestamp
      ? artifacts.filter((artifact) => artifact.phase !== phase || isTimestampOnOrAfter(artifact.createdAt, phaseActivationTimestamp))
      : artifacts
    const runLogs = phaseActivationTimestamp
      ? phaseLogs.filter((entry) => isTimestampOnOrAfter(entry.timestamp, phaseActivationTimestamp))
      : phaseLogs
    const artifactVersion = extractCoverageVersionFromArtifacts(phase, runArtifacts)
    const logVersion = extractCoverageVersionFromLogs(phase, runLogs.map((entry) => entry.line))

    return Math.max(artifactVersion ?? 1, logVersion ?? 1)
  }, [artifacts, phase, phaseActivationTimestamp, phaseLogs, shouldTrackCoverageVersion])
  const phaseLabel = shouldTrackCoverageVersion && coverageVersion
    ? `${basePhaseLabel} · ${ticket.status === phase ? 'Live ' : ''}v${coverageVersion}`
    : basePhaseLabel

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
        <DialogContent closeButtonVariant="dashboard" className="max-w-2xl max-h-[80vh] flex flex-col">
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

            {phaseMeta.details.equivalents && phaseMeta.details.equivalents.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Equivalent Steps in Other Phases</h3>
                <DetailsList items={phaseMeta.details.equivalents} />
              </section>
            ) : null}

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
                <dt className="text-muted-foreground">Status ID</dt>
                <dd className="font-mono text-foreground">{phase}</dd>
                <dt className="text-muted-foreground">Phase Type</dt>
                <dd className="text-foreground">{phaseMeta.kanbanPhase === 'needs_input' ? 'User Input' : 'AI-Driven'}</dd>
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
