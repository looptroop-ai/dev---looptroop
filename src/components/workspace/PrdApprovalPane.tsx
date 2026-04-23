import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QUERY_STALE_TIME_5M } from '@/lib/constants'
import { LoadingText } from '@/components/ui/LoadingText'
import { CascadeWarning } from '@/components/editor/CascadeWarning'
import { YamlEditor } from '@/components/editor/YamlEditor'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { CoverageApprovalWarning, resolveCoverageApprovalWarning } from './CoverageApprovalWarning'
import { PrdApprovalEditor } from './PrdApprovalEditor'
import { PrdDocumentView } from './PrdDocumentView'
import { clearTicketArtifactsCache, useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { useSaveTicketUIState, useTicketUIState, type Ticket } from '@/hooks/useTickets'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'
import {
  type PrdApprovalDraft,
  type PrdDocument,
  PRD_APPROVAL_FOCUS_EVENT,
  buildPrdApprovalDraft,
  buildPrdDocumentFromDraft,
  normalizePrdApprovalDraft,
  normalizePrdDocumentLike,
  parsePrdDocument,
  parsePrdDocumentContent,
} from '@/lib/prdDocument'
import {
  useApprovalDraftReset,
  useApprovalFocusAnchor,
  useDebouncedApprovalUiState,
} from './approvalHooks'

type EditTab = 'structured' | 'yaml'

interface PrdApprovalUiState {
  isEditMode?: boolean
  editTab?: EditTab
  yamlDraft?: string
  structuredDraft?: PrdApprovalDraft
}

type DiscardTarget =
  | { type: 'close' }
  | { type: 'switch-tab'; tab: EditTab }
  | null

export function PrdApprovalPane({ ticket, phase = 'WAITING_PRD_APPROVAL' }: { ticket: Ticket; phase?: string }) {
  const queryClient = useQueryClient()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const uiStateScope = 'approval_prd'
  const cascadeWarningMessage = useMemo(
    () => getCascadeEditWarningMessage(ticket.status, 'prd', ticket.previousStatus),
    [ticket.status, ticket.previousStatus],
  )
  const { data: persistedUiState } = useTicketUIState<PrdApprovalUiState>(ticket.id, uiStateScope, true)
  const { data: fetchedContent, isLoading, isFetching } = useQuery({
    queryKey: ['artifact', ticket.id, 'prd'],
    queryFn: async () => {
      const response = await fetch(`/api/files/${ticket.id}/prd`)
      if (!response.ok) {
        throw new Error('Failed to load PRD')
      }
      const payload = await response.json() as { content?: string }
      return payload.content ?? ''
    },
    staleTime: QUERY_STALE_TIME_5M,
  })
  const { artifacts } = useTicketArtifacts(ticket.id)

  const prdDocument = useMemo(
    () => normalizePrdDocumentLike(parsePrdDocument(fetchedContent) ?? parsePrdDocumentContent(fetchedContent ?? '').document),
    [fetchedContent],
  )
  const rawContent = fetchedContent ?? ''
  const isPreparingStructuredPrd = !prdDocument && Boolean(rawContent) && isFetching

  const [isEditMode, setIsEditMode] = useState(false)
  const [editTab, setEditTab] = useState<EditTab>('structured')
  const [structuredDraft, setStructuredDraft] = useState<PrdApprovalDraft | null>(null)
  const [yamlDraft, setYamlDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [showCascadeWarning, setShowCascadeWarning] = useState(false)
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const containerRef = useRef<HTMLDivElement>(null)

  const baseStructuredDraft = useMemo(
    () => (prdDocument ? buildPrdApprovalDraft(prdDocument) : null),
    [prdDocument],
  )

  const hasStructuredChanges = useMemo(
    () => structuredDraft !== null && baseStructuredDraft !== null && JSON.stringify(structuredDraft) !== JSON.stringify(baseStructuredDraft),
    [baseStructuredDraft, structuredDraft],
  )
  const hasYamlChanges = yamlDraft !== rawContent
  const structuredEditorUnavailable = editTab === 'structured' && structuredDraft === null
  const hasUnsavedChanges = editTab === 'structured' ? hasStructuredChanges : hasYamlChanges
  const yamlValidation = editTab === 'yaml' ? parsePrdDocumentContent(yamlDraft) : null
  const coverageWarning = useMemo(
    () => resolveCoverageApprovalWarning(artifacts, 'prd'),
    [artifacts],
  )

  useApprovalDraftReset(ticket.id, restoredDraftRef, lastSavedSnapshotRef)

  useEffect(() => {
    if (isLoading || restoredDraftRef.current || !prdDocument) return

    const persisted = persistedUiState?.data
    const nextEditMode = Boolean(persisted?.isEditMode)
    const nextEditTab: EditTab = persisted?.editTab === 'yaml' ? 'yaml' : 'structured'
    const nextStructuredDraft = normalizePrdApprovalDraft(persisted?.structuredDraft, prdDocument)
    const nextYamlDraft = typeof persisted?.yamlDraft === 'string' ? persisted.yamlDraft : rawContent

    setIsEditMode(nextEditMode)
    setEditTab(nextEditTab)
    setStructuredDraft(nextStructuredDraft)
    setYamlDraft(nextYamlDraft)

    const snapshot = JSON.stringify({
      isEditMode: nextEditMode,
      editTab: nextEditTab,
      yamlDraft: nextYamlDraft,
      structuredDraft: nextStructuredDraft,
    })
    lastSavedSnapshotRef.current = snapshot
    restoredDraftRef.current = true
  }, [isLoading, persistedUiState, prdDocument, rawContent])

  useApprovalFocusAnchor(ticket.id, PRD_APPROVAL_FOCUS_EVENT)

  useDebouncedApprovalUiState({
    enabled: !isLoading && restoredDraftRef.current && structuredDraft !== null,
    snapshot: {
      isEditMode,
      editTab,
      yamlDraft,
      structuredDraft,
    },
    ticketId: ticket.id,
    scope: uiStateScope,
    saveUiState,
    lastSavedSnapshotRef,
  })

  function resetDraftsFromSaved(nextTab: EditTab = 'structured') {
    startTransition(() => {
      setStructuredDraft(baseStructuredDraft)
      setYamlDraft(rawContent)
      setEditTab(nextTab === 'structured' && baseStructuredDraft === null ? 'yaml' : nextTab)
      setSaveError(null)
      setApproveError(null)
    })
  }

  function openFriendlyEditor() {
    resetDraftsFromSaved(baseStructuredDraft ? 'structured' : 'yaml')
    setIsEditMode(true)
  }

  async function handleSave() {
    if (!prdDocument || structuredDraft === null) return

    if (editTab === 'yaml' && yamlValidation?.error) {
      setSaveError(yamlValidation.error)
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const response = await fetch(`/api/files/${ticket.id}/prd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editTab === 'structured'
            ? { document: buildPrdDocumentFromDraft(prdDocument, structuredDraft) }
            : { content: yamlDraft },
        ),
      })

      const payload = await response.json() as { content?: string; error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Save failed')
      }

      const nextRaw = payload.content ?? ''
      queryClient.setQueryData(['artifact', ticket.id, 'prd'], nextRaw)
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'prd'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      clearTicketArtifactsCache(ticket.id)

      const savedDocument = parsePrdDocument(nextRaw)
      setStructuredDraft(savedDocument ? buildPrdApprovalDraft(savedDocument) : null)
      setYamlDraft(nextRaw)
      setIsEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleApprove() {
    setIsApproving(true)
    setApproveError(null)

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/approve-prd`, {
        method: 'POST',
      })
      const payload = await response.json() as { error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to approve PRD')
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'prd'] })
      clearTicketArtifactsCache(ticket.id)
      setIsEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : 'Failed to approve PRD')
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

    if (cascadeWarningMessage) {
      setShowCascadeWarning(true)
      return
    }

    openFriendlyEditor()
  }

  function handleConfirmCascade() {
    setShowCascadeWarning(false)
    openFriendlyEditor()
  }

  function handleConfirmDiscard() {
    const target = discardTarget
    setDiscardTarget(null)
    if (!target) return

    if (target.type === 'close') {
      resetDraftsFromSaved(baseStructuredDraft ? 'structured' : 'yaml')
      setIsEditMode(false)
      return
    }

    resetDraftsFromSaved(target.tab)
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      <CascadeWarning
        message={cascadeWarningMessage ?? ''}
        open={showCascadeWarning}
        onConfirm={handleConfirmCascade}
        onCancel={() => setShowCascadeWarning(false)}
      />

      <Dialog open={discardTarget !== null} onOpenChange={(open) => !open && setDiscardTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Discard unsaved PRD edits?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Switching editors or leaving edit mode resets the current draft back to the last saved PRD artifact.
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

      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Product Requirements Document</span>
          <span className="flex-1 text-xs text-muted-foreground">Review the final PRD, edit it if needed, then approve it before Beads drafting begins.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleEdit}
            disabled={isPreparingStructuredPrd}
            className="text-xs shrink-0"
          >
            {isEditMode ? 'View' : 'Edit'}
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isApproving || isSaving || (isEditMode && (hasUnsavedChanges || structuredEditorUnavailable)) || !prdDocument || ticket.status !== phase}
            className="text-xs shrink-0"
          >
            {isApproving ? 'Approving…' : 'Approve'}
          </Button>
        </div>

        {isEditMode ? (
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
                onClick={() => requestTabChange('yaml')}
                className={editTab === 'yaml'
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
              >
                YAML
              </button>
            </div>

            <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges || structuredEditorUnavailable}
            >
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
          {coverageWarning ? <CoverageApprovalWarning warning={coverageWarning} /> : null}
          {isLoading || isPreparingStructuredPrd ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <div className="text-center space-y-2">
                <LoadingText text={isPreparingStructuredPrd ? 'Preparing PRD approval view' : 'Loading PRD'} className="text-sm font-medium animate-pulse" />
                <p className="text-[10px]">
                  {isPreparingStructuredPrd
                    ? 'Building the structured approval view.'
                    : 'Fetching the latest PRD artifact.'}
                </p>
              </div>
            </div>
          ) : isEditMode ? (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
              {editTab === 'yaml' ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
                    YAML mode gives full control over the canonical PRD artifact. Saving rewrites it into the server&apos;s canonical form and clears PRD approval metadata.
                  </div>
                  <YamlEditor value={yamlDraft} onChange={setYamlDraft} className="min-h-[520px] rounded-xl border border-border bg-background" />
                  {yamlValidation?.error ? (
                    <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                      {yamlValidation.error}
                    </div>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
                      YAML looks structurally valid. Saving will canonicalize the document.
                    </div>
                  )}
                </div>
              ) : structuredDraft ? (
                <PrdApprovalEditor
                  draft={structuredDraft}
                  disabled={isSaving}
                  onChange={setStructuredDraft}
                />
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                  The final PRD artifact could not be parsed. Switch to YAML mode to inspect the raw document.
                </div>
              )}
            </div>
          ) : prdDocument ? (
            <PrdDocumentView document={prdDocument as PrdDocument} />
          ) : rawContent ? (
            <div className="rounded-xl border border-border bg-background p-4">
              <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] font-mono">{rawContent}</pre>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No PRD artifact available yet.</div>
          )}
        </div>
      </div>

      <CollapsiblePhaseLogSection
        phase={phase}
        ticket={ticket}
        defaultExpanded={false}
        variant="bottom"
        className="px-4 pb-4"
        resizeContainerRef={containerRef}
      />
    </div>
  )
}
