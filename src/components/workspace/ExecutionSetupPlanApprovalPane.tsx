import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QUERY_STALE_TIME_5M } from '@/lib/constants'
import { YamlEditor } from '@/components/editor/YamlEditor'
import { CheckCircle2 } from 'lucide-react'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { ArtifactContent } from './ArtifactContentViewer'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { clearTicketArtifactsCache, useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { useSaveTicketUIState, useTicketUIState, type Ticket } from '@/hooks/useTickets'
import { parseExecutionSetupPlanReport } from './phaseArtifactTypes'
import {
  EXECUTION_SETUP_PLAN_APPROVAL_FOCUS_EVENT,
  parseExecutionSetupPlanContent,
  serializeExecutionSetupPlan,
  type ExecutionSetupPlan,
} from '@/lib/executionSetupPlan'
import { ExecutionSetupPlanEditor } from './ExecutionSetupPlanEditor'
import {
  useApprovalDraftReset,
  useApprovalFocusAnchor,
  useDebouncedApprovalUiState,
} from './approvalHooks'

type EditTab = 'structured' | 'raw'
type DiscardTarget = { type: 'close' } | { type: 'switch-tab'; tab: EditTab } | null

interface ExecutionSetupPlanApprovalResponse {
  exists: boolean
  raw: string | null
  plan: ExecutionSetupPlan | null
  updatedAt: string | null
}

interface ExecutionSetupPlanApprovalUiState {
  isEditMode?: boolean
  editTab?: EditTab
  rawDraft?: string
  structuredDraft?: ExecutionSetupPlan | null
  commentary?: string
}

interface ExecutionSetupApprovalReceipt {
  approved_by?: string
  approved_at?: string
  step_count?: number
  command_count?: number
}

function parseExecutionSetupApprovalReceipt(content?: string | null): ExecutionSetupApprovalReceipt | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return {
      approved_by: typeof record.approved_by === 'string' ? record.approved_by : undefined,
      approved_at: typeof record.approved_at === 'string' ? record.approved_at : undefined,
      step_count: typeof record.step_count === 'number' && Number.isFinite(record.step_count) ? record.step_count : undefined,
      command_count: typeof record.command_count === 'number' && Number.isFinite(record.command_count) ? record.command_count : undefined,
    }
  } catch {
    return null
  }
}

function formatReviewTimestamp(value?: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function ApprovedSetupPlanBanner({
  receipt,
  updatedAt,
  reportContent,
}: {
  receipt: ExecutionSetupApprovalReceipt | null
  updatedAt?: string | null
  reportContent?: string | null
}) {
  const approvedAtLabel = formatReviewTimestamp(receipt?.approved_at)
  const updatedAtLabel = formatReviewTimestamp(updatedAt)
  const report = reportContent ? parseExecutionSetupPlanReport(reportContent) : null
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN
  const generatedAtMs = report?.generatedAt ? Date.parse(report.generatedAt) : Number.NaN
  const editedAfterGeneration = Number.isFinite(updatedAtMs)
    && Number.isFinite(generatedAtMs)
    && updatedAtMs - generatedAtMs > 1000
  const sourceChips = [
    report?.source === 'regenerate'
      ? 'Regenerated before approval'
      : report?.source === 'auto'
        ? 'Initial generated draft'
        : report?.source
          ? 'Saved setup plan'
          : null,
    editedAfterGeneration ? 'Edited before approval' : null,
  ].filter((item): item is string => Boolean(item))
  const detailChips = [
    receipt?.approved_by ? `Approved by ${receipt.approved_by}` : 'Approved',
    approvedAtLabel ? `Approved at ${approvedAtLabel}` : null,
    typeof receipt?.step_count === 'number' ? `${receipt.step_count} step${receipt.step_count === 1 ? '' : 's'}` : null,
    typeof receipt?.command_count === 'number' ? `${receipt.command_count} command${receipt.command_count === 1 ? '' : 's'}` : null,
    ...sourceChips,
    updatedAtLabel ? `Saved at ${updatedAtLabel}` : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="rounded-md border border-green-300/70 bg-green-50/80 px-3 py-3 text-green-950 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-100">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Approved setup contract</div>
          <div className="mt-1 text-xs leading-5">
            This is the reviewed plan that was handed to Preparing Workspace Runtime. It is locked here for review only.
          </div>
          {detailChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {detailChips.map((chip) => (
                <span key={chip} className="rounded-full border border-green-300/70 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground dark:border-green-900/60">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ExecutionSetupPlanApprovalPane({ ticket, readOnly = false }: { ticket: Ticket; readOnly?: boolean }) {
  const queryClient = useQueryClient()
  const { mutateAsync: saveUiState } = useSaveTicketUIState()
  const uiStateScope = 'approval_execution_setup'
  const { data: persistedUiState } = useTicketUIState<ExecutionSetupPlanApprovalUiState>(ticket.id, uiStateScope, true)
  const { artifacts } = useTicketArtifacts(ticket.id)
  const { data: fetchedPlan, isLoading, isFetching } = useQuery({
    queryKey: ['artifact', ticket.id, 'execution-setup-plan'],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticket.id}/execution-setup-plan`)
      if (!response.ok) throw new Error('Failed to load execution setup plan')
      return response.json() as Promise<ExecutionSetupPlanApprovalResponse>
    },
    staleTime: QUERY_STALE_TIME_5M,
    refetchInterval: (query) => {
      const data = query.state.data as ExecutionSetupPlanApprovalResponse | undefined
      return ticket.status === 'WAITING_EXECUTION_SETUP_APPROVAL' && !data?.exists ? 2000 : false
    },
  })

  const rawContent = fetchedPlan?.raw ?? ''
  const plan = fetchedPlan?.plan ?? null
  const isPlanGenerating = ticket.status === 'WAITING_EXECUTION_SETUP_APPROVAL' && !plan && (isLoading || isFetching || !fetchedPlan?.exists)
  const executionSetupPlanReportContent = useMemo(() => {
    const matchingArtifact = [...artifacts].reverse().find((artifact) => (
      artifact.artifactType === 'execution_setup_plan_report'
      && artifact.phase === 'WAITING_EXECUTION_SETUP_APPROVAL'
    ))
      ?? [...artifacts].reverse().find((artifact) => artifact.artifactType === 'execution_setup_plan_report')
    return matchingArtifact?.content ?? null
  }, [artifacts])
  const approvalReceipt = useMemo(() => {
    const matchingArtifact = [...artifacts].reverse().find((artifact) => (
      artifact.artifactType === 'approval_receipt'
      && artifact.phase === 'WAITING_EXECUTION_SETUP_APPROVAL'
    ))
    return parseExecutionSetupApprovalReceipt(matchingArtifact?.content)
  }, [artifacts])
  const artifactPanelPhase = readOnly ? 'WAITING_EXECUTION_SETUP_APPROVAL' : ticket.status

  const [isEditMode, setIsEditMode] = useState(false)
  const [editTab, setEditTab] = useState<EditTab>('structured')
  const [structuredDraft, setStructuredDraft] = useState<ExecutionSetupPlan | null>(null)
  const [rawDraft, setRawDraft] = useState('')
  const [commentary, setCommentary] = useState('')
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const containerRef = useRef<HTMLDivElement>(null)

  const hasStructuredChanges = useMemo(
    () => structuredDraft !== null && plan !== null && JSON.stringify(structuredDraft) !== JSON.stringify(plan),
    [plan, structuredDraft],
  )
  const hasRawChanges = rawDraft !== rawContent
  const hasUnsavedChanges = editTab === 'structured' ? hasStructuredChanges : hasRawChanges
  const rawValidation = editTab === 'raw' && rawDraft.trim().length > 0 ? parseExecutionSetupPlanContent(rawDraft).error : null

  useApprovalDraftReset(ticket.id, restoredDraftRef, lastSavedSnapshotRef)

  useEffect(() => {
    if (restoredDraftRef.current || (!plan && !isPlanGenerating)) return

    const persisted = persistedUiState?.data
    const nextEditMode = Boolean(persisted?.isEditMode)
    const nextEditTab: EditTab = persisted?.editTab === 'raw' ? 'raw' : 'structured'
    const nextStructuredDraft = persisted?.structuredDraft ?? plan
    const nextRawDraft = typeof persisted?.rawDraft === 'string' ? persisted.rawDraft : rawContent
    const nextCommentary = typeof persisted?.commentary === 'string' ? persisted.commentary : ''

    setIsEditMode(!readOnly && nextEditMode && Boolean(plan))
    setEditTab(nextEditTab)
    setStructuredDraft(nextStructuredDraft ?? null)
    setRawDraft(nextRawDraft)
    setCommentary(nextCommentary)

    lastSavedSnapshotRef.current = JSON.stringify({
      isEditMode: nextEditMode,
      editTab: nextEditTab,
      rawDraft: nextRawDraft,
      structuredDraft: nextStructuredDraft,
      commentary: nextCommentary,
    })
    restoredDraftRef.current = true
  }, [isPlanGenerating, persistedUiState, plan, rawContent, readOnly])

  useEffect(() => {
    if (!readOnly) return
    setIsEditMode(false)
    setDiscardTarget(null)
    setShowRegenerateDialog(false)
  }, [readOnly])

  useApprovalFocusAnchor(ticket.id, EXECUTION_SETUP_PLAN_APPROVAL_FOCUS_EVENT)

  useDebouncedApprovalUiState({
    enabled: !readOnly && restoredDraftRef.current,
    snapshot: {
      isEditMode,
      editTab,
      rawDraft,
      structuredDraft,
      commentary,
    },
    ticketId: ticket.id,
    scope: uiStateScope,
    saveUiState,
    lastSavedSnapshotRef,
  })

  function resetDraftsFromSaved(nextTab: EditTab = 'structured') {
    startTransition(() => {
      setStructuredDraft(plan)
      setRawDraft(rawContent)
      setEditTab(nextTab)
      setSaveError(null)
      setApproveError(null)
      setRegenerateError(null)
    })
  }

  async function handleSave() {
    if (!plan && !structuredDraft) return
    if (editTab === 'raw' && rawValidation) {
      setSaveError(rawValidation)
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/execution-setup-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editTab === 'structured' && structuredDraft
            ? { plan: structuredDraft }
            : { content: rawDraft },
        ),
      })
      const payload = await response.json() as { raw?: string; plan?: ExecutionSetupPlan; error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to save execution setup plan')
      }

      const nextData: ExecutionSetupPlanApprovalResponse = {
        exists: Boolean(payload.plan),
        raw: payload.raw ?? rawDraft,
        plan: payload.plan ?? structuredDraft ?? null,
        updatedAt: new Date().toISOString(),
      }
      queryClient.setQueryData(['artifact', ticket.id, 'execution-setup-plan'], nextData)
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'execution-setup-plan'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      clearTicketArtifactsCache(ticket.id)
      setIsEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save execution setup plan')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRegenerate() {
    if (!commentary.trim()) {
      setRegenerateError('Add commentary before isRegenerating the setup plan.')
      return
    }

    setIsRegenerating(true)
    setRegenerateError(null)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/regenerate-execution-setup-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentary,
          ...(editTab === 'structured' && structuredDraft ? { plan: structuredDraft } : {}),
          ...(editTab === 'raw' && rawDraft.trim() ? { rawContent: rawDraft } : {}),
        }),
      })
      const payload = await response.json() as { raw?: string; plan?: ExecutionSetupPlan; error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to regenerate execution setup plan')
      }

      const nextData: ExecutionSetupPlanApprovalResponse = {
        exists: Boolean(payload.plan),
        raw: payload.raw ?? (payload.plan ? serializeExecutionSetupPlan(payload.plan) : rawDraft),
        plan: payload.plan ?? null,
        updatedAt: new Date().toISOString(),
      }
      queryClient.setQueryData(['artifact', ticket.id, 'execution-setup-plan'], nextData)
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'execution-setup-plan'] })
      clearTicketArtifactsCache(ticket.id)
      setCommentary('')
      setShowRegenerateDialog(false)
      setIsEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setRegenerateError(error instanceof Error ? error.message : 'Failed to regenerate execution setup plan')
    } finally {
      setIsRegenerating(false)
    }
  }

  async function handleApprove() {
    setIsApproving(true)
    setApproveError(null)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/approve-execution-setup-plan`, {
        method: 'POST',
      })
      const payload = await response.json() as { error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to approve execution setup plan')
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'execution-setup-plan'] })
      clearTicketArtifactsCache(ticket.id)
      setIsEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : 'Failed to approve execution setup plan')
    } finally {
      setIsApproving(false)
    }
  }

  function requestTabChange(nextTab: EditTab) {
    if (nextTab === editTab) return
    if (hasUnsavedChanges) {
      setDiscardTarget({ type: 'switch-tab', tab: nextTab })
      return
    }
    resetDraftsFromSaved(nextTab)
  }

  function handleToggleEdit() {
    if (isEditMode) {
      if (hasUnsavedChanges) {
        setDiscardTarget({ type: 'close' })
        return
      }
      resetDraftsFromSaved('structured')
      setIsEditMode(false)
      return
    }
    resetDraftsFromSaved('structured')
    setIsEditMode(true)
  }

  function handleConfirmDiscard() {
    const target = discardTarget
    setDiscardTarget(null)
    if (!target) return

    if (target.type === 'close') {
      resetDraftsFromSaved('structured')
      setIsEditMode(false)
      return
    }

    resetDraftsFromSaved(target.tab)
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      <Dialog open={!readOnly && discardTarget !== null} onOpenChange={(open) => !open && setDiscardTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Discard unsaved setup-plan edits?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Switching editors or leaving edit mode resets the current draft back to the last saved setup plan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDiscardTarget(null)}>
              Keep Editing
            </Button>
            <Button type="button" size="sm" onClick={handleConfirmDiscard}>
              Discard Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!readOnly && showRegenerateDialog} onOpenChange={(open) => {
        setShowRegenerateDialog(open)
        if (open) setRegenerateError(null)
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Regenerate setup plan</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Describe what should change in the readiness assessment or workspace-preparation plan. If you currently have unsaved edits open, LoopTroop uses that draft as the regenerate baseline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-foreground/60 mb-1">Commentary</div>
              <textarea
                value={commentary}
                onChange={(event) => {
                  setCommentary(event.target.value)
                  if (regenerateError) setRegenerateError(null)
                }}
                rows={6}
                placeholder="Describe what should change in the readiness assessment or setup plan..."
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-y"
              />
            </div>

            {regenerateError ? <p className="text-xs text-red-500">{regenerateError}</p> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowRegenerateDialog(false)} disabled={isRegenerating}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleRegenerate} disabled={isRegenerating || isSaving || isApproving || !commentary.trim()}>
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{readOnly ? 'Approved Execution Setup Plan' : 'Execution Setup Plan'}</span>
          {readOnly ? (
            <span className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-800 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-200">
              Approved
            </span>
          ) : null}
          <span className="flex-1 text-xs text-muted-foreground">
            {readOnly
              ? 'Review the approved workspace readiness audit and setup contract.'
              : 'Review the workspace readiness audit and any setup steps, edit if needed, regenerate with commentary, then approve.'}
          </span>
          {!readOnly ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRegenerateError(null)
                  setShowRegenerateDialog(true)
                }}
                className="text-xs shrink-0"
                disabled={isPlanGenerating || isSaving || isApproving || isRegenerating}
              >
                Regenerate ...
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleEdit}
                className="text-xs shrink-0"
                disabled={!plan}
              >
                {isEditMode ? 'View' : 'Edit'}
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isApproving || isSaving || isRegenerating || (isEditMode && hasUnsavedChanges) || !plan || ticket.status !== 'WAITING_EXECUTION_SETUP_APPROVAL'}
                className="text-xs shrink-0"
              >
                {isApproving ? 'Approving…' : 'Approve'}
              </Button>
            </>
          ) : null}
        </div>

        <PhaseArtifactsPanel
          phase={artifactPanelPhase}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={ticket.lockedCouncilMembers.length || 1}
          councilMemberNames={ticket.lockedCouncilMembers}
          preloadedArtifacts={artifacts}
        />

        {!readOnly && isEditMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => requestTabChange('structured')}
                className={editTab === 'structured'
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
              >
                Structured
              </button>
              <button
                type="button"
                onClick={() => requestTabChange('raw')}
                className={editTab === 'raw'
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
              >
                Raw
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleSave} disabled={isSaving || !hasUnsavedChanges}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : null}

        {saveError ? <p className="text-xs text-red-500">{saveError}</p> : null}
        {approveError ? <p className="text-xs text-red-500">{approveError}</p> : null}
      </div>

      <div className="flex-1 min-h-0 px-4 pb-2 overflow-auto">
        <div className="space-y-3">
          {readOnly ? (
            <ApprovedSetupPlanBanner
              receipt={approvalReceipt}
              updatedAt={fetchedPlan?.updatedAt}
              reportContent={executionSetupPlanReportContent}
            />
          ) : null}

          {isPlanGenerating ? (
            <div className="rounded-2xl border border-border bg-muted/20 p-6 text-sm">
              <div className="font-semibold">Building the setup plan.</div>
              <p className="mt-2 text-xs text-muted-foreground">
                LoopTroop is auditing workspace readiness and drafting any missing setup now. Live logs remain available below while the draft is being generated.
              </p>
            </div>
          ) : !readOnly && isEditMode ? (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
              {editTab === 'raw' ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
                    Raw mode lets you edit the full readiness-and-setup artifact as JSON or YAML.
                  </div>
                  <YamlEditor value={rawDraft} onChange={setRawDraft} className="min-h-[520px] rounded-xl border border-border bg-background" />
                  {rawValidation ? (
                    <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                      {rawValidation}
                    </div>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
                      Raw plan content looks structurally valid.
                    </div>
                  )}
                </div>
              ) : structuredDraft ? (
                <ExecutionSetupPlanEditor
                  plan={structuredDraft}
                  disabled={isSaving || isRegenerating}
                  onChange={setStructuredDraft}
                />
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                  No setup plan is available to edit yet.
                </div>
              )}
            </div>
          ) : rawContent ? (
            <div className="rounded-2xl border border-border bg-background p-4">
              <ArtifactContent
                artifactId="execution-setup-plan"
                content={rawContent}
                phase={ticket.status}
                reportContent={executionSetupPlanReportContent}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No setup plan artifact is available yet.</div>
          )}
        </div>
      </div>

      <CollapsiblePhaseLogSection
        phase={ticket.status}
        ticket={ticket}
        defaultExpanded={false}
        variant="bottom"
        className="px-4 pb-4"
        resizeContainerRef={containerRef}
      />
    </div>
  )
}
