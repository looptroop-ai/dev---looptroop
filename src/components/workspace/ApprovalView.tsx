import { startTransition, useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import { useTicketArtifacts, clearTicketArtifactsCache } from '@/hooks/useTicketArtifacts'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QUERY_STALE_TIME_5M } from '@/lib/constants'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { YamlEditor } from '@/components/editor/YamlEditor'
import type { Ticket } from '@/hooks/useTickets'
import { InterviewApprovalPane } from './InterviewApprovalPane'
import { PrdApprovalPane } from './PrdApprovalPane'
import { BeadsDraftView } from './ArtifactContentViewer'
import { BeadsApprovalEditor, type ParsedBead } from './BeadsApprovalEditor'
import { CoverageApprovalWarning, resolveCoverageApprovalWarning } from './CoverageApprovalWarning'
import { BEADS_APPROVAL_FOCUS_EVENT } from '@/lib/beadsDocument'
import { ExecutionSetupPlanApprovalPane } from './ExecutionSetupPlanApprovalPane'

interface ApprovalViewProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads' | 'execution_setup_plan'
}

type EditTab = 'structured' | 'jsonl'
type DiscardTarget = { type: 'close' } | { type: 'switch-tab'; tab: EditTab } | null

interface BeadsApprovalUiState {
  editMode?: boolean
  editTab?: EditTab
  jsonlDraft?: string
  structuredDraft?: ParsedBead[]
}

function beadsArrayToJsonl(beads: unknown[]): string {
  return beads.map((b) => JSON.stringify(b)).join('\n') + '\n'
}

function jsonlToBeadsArray(jsonl: string): unknown[] {
  return jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

function validateJsonl(jsonl: string): string | null {
  const lines = jsonl.split('\n').filter((l) => l.trim())
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return `Line ${i + 1}: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
      }
    } catch {
      return `Line ${i + 1}: invalid JSON — ${line.substring(0, 60)}…`
    }
  }
  return null
}

function normalizeBeadForEditor(bead: Record<string, unknown>): ParsedBead {
  const getStringArray = (record: Record<string, unknown>, keys: string[]): string[] => {
    for (const key of keys) {
      if (Array.isArray(record[key])) return (record[key] as unknown[]).filter((v): v is string => typeof v === 'string')
    }
    return []
  }
  const getString = (record: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
      if (typeof record[key] === 'string') return record[key] as string
    }
    return ''
  }
  const deps = (bead.dependencies ?? {}) as Record<string, unknown>
  const guidance = (bead.contextGuidance ?? bead.context_guidance ?? {}) as Record<string, unknown>
  return {
    ...bead,
    id: getString(bead, ['id']),
    title: getString(bead, ['title']),
    description: getString(bead, ['description']),
    prdRefs: getStringArray(bead, ['prdRefs', 'prd_refs', 'prd_references']),
    acceptanceCriteria: getStringArray(bead, ['acceptanceCriteria', 'acceptance_criteria']),
    tests: getStringArray(bead, ['tests']),
    testCommands: getStringArray(bead, ['testCommands', 'test_commands']),
    targetFiles: getStringArray(bead, ['targetFiles', 'target_files']),
    contextGuidance: {
      patterns: getStringArray(guidance, ['patterns']),
      anti_patterns: getStringArray(guidance, ['anti_patterns', 'antiPatterns']),
    },
    dependencies: {
      blocked_by: getStringArray(deps, ['blocked_by', 'blockedBy']),
      blocks: getStringArray(deps, ['blocks']),
    },
  }
}

function parseBeadsForEditor(data: unknown[]): ParsedBead[] {
  return data.map((item) => normalizeBeadForEditor(item as Record<string, unknown>))
}

/** Build a canonical bead object for saving — merges editor fields back into the original, keeping read-only fields intact. */
function buildBeadForSave(bead: ParsedBead): Record<string, unknown> {
  const { contextGuidance, dependencies, acceptanceCriteria, testCommands, targetFiles, prdRefs, ...rest } = bead
  return {
    ...rest,
    acceptanceCriteria,
    testCommands,
    targetFiles,
    prdRefs,
    contextGuidance: {
      patterns: contextGuidance.patterns,
      anti_patterns: contextGuidance.anti_patterns,
    },
    dependencies: {
      blocked_by: dependencies.blocked_by,
      blocks: dependencies.blocks,
    },
  }
}

function BeadsApprovalPane({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const uiStateScope = 'approval_beads'
  const { data: persistedUiState } = useTicketUIState<BeadsApprovalUiState>(ticket.id, uiStateScope, true)
  const councilMemberNames = useMemo(
    () => ticket.lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0),
    [ticket.lockedCouncilMembers],
  )
  const councilMemberCount = councilMemberNames.length || 3
  const { artifacts } = useTicketArtifacts(ticket.id)

  // Cache stores array form (matching navigator expectations)
  const { data: fetchedBeads, isLoading } = useQuery({
    queryKey: ['artifact', ticket.id, 'beads'],
    queryFn: async () => {
      const r = await fetch(`/api/tickets/${ticket.id}/beads`)
      if (!r.ok) throw new Error('Failed to load')
      const data = await r.json()
      return Array.isArray(data) ? data as unknown[] : []
    },
    staleTime: QUERY_STALE_TIME_5M,
  })

  const beadsArray = useMemo(() => fetchedBeads ?? [], [fetchedBeads])
  const rawJsonl = useMemo(() => beadsArray.length > 0 ? beadsArrayToJsonl(beadsArray) : '', [beadsArray])

  const [editMode, setEditMode] = useState(false)
  const [editTab, setEditTab] = useState<EditTab>('structured')
  const [structuredDraft, setStructuredDraft] = useState<ParsedBead[] | null>(null)
  const [jsonlDraft, setJsonlDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const containerRef = useRef<HTMLDivElement>(null)

  const baseStructuredDraft = useMemo(
    () => beadsArray.length > 0 ? parseBeadsForEditor(beadsArray) : null,
    [beadsArray],
  )

  const hasStructuredChanges = useMemo(
    () => structuredDraft !== null && baseStructuredDraft !== null && JSON.stringify(structuredDraft) !== JSON.stringify(baseStructuredDraft),
    [baseStructuredDraft, structuredDraft],
  )
  const hasJsonlChanges = jsonlDraft !== rawJsonl
  const hasUnsavedChanges = editTab === 'structured' ? hasStructuredChanges : hasJsonlChanges
  const jsonlValidation = editTab === 'jsonl' ? validateJsonl(jsonlDraft) : null
  const coverageWarning = useMemo(
    () => resolveCoverageApprovalWarning(artifacts, 'beads'),
    [artifacts],
  )

  // Reset on ticket change
  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id])

  // Restore persisted UI state
  useEffect(() => {
    if (isLoading || restoredDraftRef.current || fetchedBeads === undefined) return

    const persisted = persistedUiState?.data
    const nextEditMode = Boolean(persisted?.editMode)
    const nextEditTab: EditTab = persisted?.editTab === 'jsonl' ? 'jsonl' : 'structured'
    const nextStructuredDraft = Array.isArray(persisted?.structuredDraft) && persisted.structuredDraft.length > 0
      ? persisted.structuredDraft
      : baseStructuredDraft
    const nextJsonlDraft = typeof persisted?.jsonlDraft === 'string' ? persisted.jsonlDraft : rawJsonl

    setEditMode(nextEditMode)
    setEditTab(nextEditTab)
    setStructuredDraft(nextStructuredDraft)
    setJsonlDraft(nextJsonlDraft)

    const snapshot = JSON.stringify({
      editMode: nextEditMode,
      editTab: nextEditTab,
      jsonlDraft: nextJsonlDraft,
      structuredDraft: nextStructuredDraft,
    })
    lastSavedSnapshotRef.current = snapshot
    restoredDraftRef.current = true
  }, [isLoading, fetchedBeads, persistedUiState, baseStructuredDraft, rawJsonl])

  // Scroll anchoring for BEADS_APPROVAL_FOCUS_EVENT
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: string; anchorId?: string }>).detail
      if (!detail?.anchorId || String(detail.ticketId) !== String(ticket.id)) return
      const target = document.getElementById(detail.anchorId)
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener(BEADS_APPROVAL_FOCUS_EVENT, handler as EventListener)
    return () => window.removeEventListener(BEADS_APPROVAL_FOCUS_EVENT, handler as EventListener)
  }, [ticket.id])

  // Persist UI state
  useEffect(() => {
    if (isLoading || !restoredDraftRef.current) return

    const snapshot = {
      editMode,
      editTab,
      jsonlDraft,
      structuredDraft,
    }
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSavedSnapshotRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedSnapshotRef.current = serialized
      saveUiState({
        ticketId: ticket.id,
        scope: uiStateScope,
        data: snapshot,
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [editMode, editTab, isLoading, saveUiState, structuredDraft, jsonlDraft, ticket.id, uiStateScope])

  function resetDraftsFromSaved(nextTab: EditTab = 'structured') {
    startTransition(() => {
      setStructuredDraft(baseStructuredDraft)
      setJsonlDraft(rawJsonl)
      setEditTab(nextTab)
      setSaveError(null)
      setApproveError(null)
    })
  }

  function openEditor() {
    resetDraftsFromSaved('structured')
    setEditMode(true)
  }

  const handleSave = useCallback(async () => {
    if (editTab === 'jsonl') {
      const error = validateJsonl(jsonlDraft)
      if (error) {
        setSaveError(error)
        return
      }
    }

    setSaving(true)
    setSaveError(null)

    try {
      const beadsToSave = editTab === 'structured' && structuredDraft
        ? structuredDraft.map(buildBeadForSave)
        : jsonlToBeadsArray(jsonlDraft)

      const response = await fetch(`/api/tickets/${ticket.id}/beads`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beadsToSave),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; details?: string }
        throw new Error(payload.details || payload.error || 'Save failed')
      }

      // Update cache with the saved array (API returns { success: true })
      queryClient.setQueryData(['artifact', ticket.id, 'beads'], beadsToSave)
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'beads'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      clearTicketArtifactsCache(ticket.id)

      setEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editTab, jsonlDraft, structuredDraft, ticket.id, queryClient])

  const handleApprove = useCallback(async () => {
    setApproving(true)
    setApproveError(null)

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/approve-beads`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; details?: string }
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to approve beads')
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      queryClient.invalidateQueries({ queryKey: ['artifact', ticket.id, 'beads'] })
      clearTicketArtifactsCache(ticket.id)
      setEditMode(false)
      setEditTab('structured')
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : 'Failed to approve beads')
    } finally {
      setApproving(false)
    }
  }, [ticket.id, queryClient])

  function requestTabChange(nextTab: EditTab) {
    if (nextTab === editTab) return
    if (hasUnsavedChanges) {
      setDiscardTarget({ type: 'switch-tab', tab: nextTab })
      return
    }
    resetDraftsFromSaved(nextTab)
  }

  function handleToggleEdit() {
    if (editMode) {
      if (hasUnsavedChanges) {
        setDiscardTarget({ type: 'close' })
        return
      }
      resetDraftsFromSaved('structured')
      setEditMode(false)
      return
    }
    openEditor()
  }

  function handleConfirmDiscard() {
    const target = discardTarget
    setDiscardTarget(null)
    if (!target) return

    if (target.type === 'close') {
      resetDraftsFromSaved('structured')
      setEditMode(false)
      return
    }

    resetDraftsFromSaved(target.tab)
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      <Dialog open={discardTarget !== null} onOpenChange={(open) => !open && setDiscardTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Discard unsaved beads edits?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Switching editors or leaving edit mode resets the current draft back to the last saved beads artifact.
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
          <span className="font-semibold">Beads Breakdown</span>
          <span className="flex-1 text-xs text-muted-foreground">Review the implementation beads with tests and dependencies, edit if needed, then approve.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleEdit}
            className="text-xs shrink-0"
          >
            {editMode ? 'View' : 'Edit'}
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approving || saving || (editMode && hasUnsavedChanges) || beadsArray.length === 0 || ticket.status !== 'WAITING_BEADS_APPROVAL'}
            className="text-xs shrink-0"
          >
            {approving ? 'Approving…' : 'Approve'}
          </Button>
        </div>

        <PhaseArtifactsPanel
          phase={ticket.status}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={councilMemberCount}
          councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined}
        />

        {editMode ? (
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
                onClick={() => requestTabChange('jsonl')}
                className={editTab === 'jsonl'
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
              >
                JSONL
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : null}

        {saveError ? <p className="text-xs text-red-500">{saveError}</p> : null}
        {approveError ? <p className="text-xs text-red-500">{approveError}</p> : null}
      </div>

      {/* Artifact content */}
      <div className="flex-1 min-h-0 px-4 pb-2 overflow-auto">
        <div className="space-y-3">
          {coverageWarning ? <CoverageApprovalWarning warning={coverageWarning} /> : null}
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Loading beads…</div>
          ) : editMode ? (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
              {editTab === 'jsonl' ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
                    JSONL mode gives full control over the beads artifact. Each line is one bead as a JSON object.
                  </div>
                  <YamlEditor value={jsonlDraft} onChange={setJsonlDraft} className="min-h-[520px] rounded-xl border border-border bg-background" />
                  {jsonlValidation ? (
                    <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                      {jsonlValidation}
                    </div>
                  ) : (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
                      JSONL looks structurally valid.
                    </div>
                  )}
                </div>
              ) : structuredDraft && structuredDraft.length > 0 ? (
                <BeadsApprovalEditor
                  beads={structuredDraft}
                  disabled={saving}
                  onChange={setStructuredDraft}
                />
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                  No beads data available to edit. Switch to JSONL mode to create beads from scratch.
                </div>
              )}
            </div>
          ) : beadsArray.length > 0 ? (
            <BeadsDraftView content={beadsArrayToJsonl(beadsArray)} />
          ) : (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No beads artifact available yet.</div>
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

export function ApprovalView({ ticket, artifactType }: ApprovalViewProps) {
  if (artifactType === 'interview') {
    return <InterviewApprovalPane ticket={ticket} />
  }

  if (artifactType === 'prd') {
    return <PrdApprovalPane ticket={ticket} />
  }

  if (artifactType === 'execution_setup_plan') {
    return <ExecutionSetupPlanApprovalPane ticket={ticket} />
  }

  return <BeadsApprovalPane ticket={ticket} />
}
