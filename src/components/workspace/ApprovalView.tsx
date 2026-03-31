import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useTicketAction, useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { YamlEditor } from '@/components/editor/YamlEditor'
import type { Ticket } from '@/hooks/useTickets'
import { InterviewApprovalPane } from './InterviewApprovalPane'
import { PrdApprovalPane } from './PrdApprovalPane'
import { CollapsibleSection } from './ArtifactContentViewer'

interface ApprovalViewProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
}

function beadsArrayToJsonl(beads: unknown[]): string {
  return beads.map((b) => JSON.stringify(b)).join('\n') + '\n'
}

function jsonlToBeadsArray(jsonl: string): unknown[] {
  return jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

function BeadsStructuredView({ content }: { content: string }) {
  let beads: Array<Record<string, unknown>> = []
  try { beads = jsonlToBeadsArray(content) as Array<Record<string, unknown>> } catch { /* ignore */ }
  if (beads.length === 0) return <div className="text-xs text-muted-foreground italic p-4">No beads to display</div>
  return (
    <div className="bg-muted rounded-md p-3 font-mono text-xs space-y-2">
      <div className="text-xs text-muted-foreground mb-2">{beads.length} beads</div>
      {beads.map((bead, i) => (
        <CollapsibleSection
          key={String(bead.id ?? i)}
          title={(
            <span className="flex items-center gap-2 min-w-0 w-full">
              <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">#{bead.priority != null ? String(bead.priority) : String(i + 1)}</span>
              <span className="min-w-0 truncate">{String(bead.title ?? `Bead ${i + 1}`)}</span>
              {bead.status ? <span className="ml-auto text-muted-foreground text-[10px]">{String(bead.status)}</span> : null}
            </span>
          )}
        >
          <div className="space-y-1.5">
            {bead.description ? <div><span className="text-blue-600 dark:text-blue-400">description</span>: {String(bead.description)}</div> : null}
            {bead.acceptance_criteria ? <div><span className="text-blue-600 dark:text-blue-400">acceptance_criteria</span>: {String(bead.acceptance_criteria)}</div> : null}
            {bead.prd_references ? <div><span className="text-blue-600 dark:text-blue-400">prd_references</span>: {String(bead.prd_references)}</div> : null}
            {Array.isArray(bead.target_files) && <div><span className="text-blue-600 dark:text-blue-400">target_files</span>: {(bead.target_files as string[]).join(', ')}</div>}
            {bead.context_guidance && typeof bead.context_guidance === 'object' && !Array.isArray(bead.context_guidance) ? (
              <div className="border-l-2 border-violet-400 dark:border-violet-600 pl-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">context_guidance</span>
                {Array.isArray((bead.context_guidance as Record<string, unknown>).patterns) && ((bead.context_guidance as Record<string, unknown>).patterns as string[]).length > 0 && (
                  <div className="pl-2 mt-0.5"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">patterns</span>: {((bead.context_guidance as Record<string, unknown>).patterns as string[]).join('; ')}</div>
                )}
                {Array.isArray((bead.context_guidance as Record<string, unknown>).anti_patterns) && ((bead.context_guidance as Record<string, unknown>).anti_patterns as string[]).length > 0 && (
                  <div className="pl-2 mt-0.5"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">anti_patterns</span>: {((bead.context_guidance as Record<string, unknown>).anti_patterns as string[]).join('; ')}</div>
                )}
              </div>
            ) : null}
            {(Array.isArray(bead.tests) && (bead.tests as string[]).length > 0) || (Array.isArray(bead.test_commands) && (bead.test_commands as string[]).length > 0) ? (
              <div className="border-l-2 border-amber-400 dark:border-amber-600 pl-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">tests</span>
                {Array.isArray(bead.tests) && (bead.tests as string[]).length > 0 && (
                  <div className="mt-0.5">{(bead.tests as string[]).join('; ')}</div>
                )}
                {Array.isArray(bead.test_commands) && (bead.test_commands as string[]).length > 0 && (
                  <div className="mt-0.5"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">test_commands</span>: {(bead.test_commands as string[]).join('; ')}</div>
                )}
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

function GenericApprovalView({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient()
  const { mutate: performAction, isPending } = useTicketAction()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const uiStateScope = 'approval_beads'
  const { data: persistedUiState } = useTicketUIState<{
    editMode?: boolean
    editedContent?: string
  }>(ticket.id, uiStateScope, true)
  const councilMemberNames = useMemo(
    () => ticket.lockedCouncilMembers.filter((memberId) => memberId.trim().length > 0),
    [ticket.lockedCouncilMembers],
  )
  const councilMemberCount = councilMemberNames.length || 3

  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['artifact', ticket.id, 'beads'],
    queryFn: async () => {
      const r = await fetch(`/api/tickets/${ticket.id}/beads`)
      if (!r.ok) throw new Error('Failed to load')
      const data = await r.json()
      return Array.isArray(data) ? beadsArrayToJsonl(data) : ''
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache to prevent flashes
  })

  const fileContent = fetchedContent ?? ''
  const [editedContent, setEditedContent] = useState<string>('')
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id])

  useEffect(() => {
    if (isLoading || restoredDraftRef.current || fetchedContent === undefined) return

    const persisted = persistedUiState?.data
    const nextEditMode = Boolean(persisted?.editMode)
    const nextEditedContent = typeof persisted?.editedContent === 'string'
      ? persisted.editedContent
      : fileContent

    setEditMode(nextEditMode)
    setEditedContent(nextEditedContent)
    lastSavedSnapshotRef.current = JSON.stringify({
      editMode: nextEditMode,
      editedContent: nextEditedContent,
    })
    restoredDraftRef.current = true
  }, [isLoading, fetchedContent, persistedUiState, fileContent])

  const handleToggleEdit = useCallback(() => {
    if (editMode) {
      // Exiting edit mode — discard changes
      setEditedContent(fileContent)
      setEditMode(false)
      return
    }
    setEditMode(true)
  }, [editMode, fileContent])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const beadsArray = jsonlToBeadsArray(editedContent)
      const res = await fetch(`/api/tickets/${ticket.id}/beads`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beadsArray),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      queryClient.setQueryData(['artifact', ticket.id, 'beads'], editedContent)
      setEditMode(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editedContent, ticket.id, queryClient])

  const hasChanges = editedContent !== fileContent

  useEffect(() => {
    if (isLoading || !restoredDraftRef.current) return

    const snapshot = { editMode, editedContent }
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
  }, [isLoading, editMode, editedContent, saveUiState, ticket.id, uiStateScope])

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Beads Breakdown</span>
          <span className="text-xs text-muted-foreground">— Review the implementation beads with tests and dependencies.</span>
        </div>

        <PhaseArtifactsPanel
          phase={ticket.status}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={councilMemberCount}
          councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined}
          prefixElement={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleToggleEdit} className="text-xs shrink-0">
                {editMode ? '📄 View' : '✏️ Edit'}
              </Button>
              <Button
                size="sm"
                onClick={() => performAction({ id: ticket.id, action: 'approve' })}
                disabled={isPending || (editMode && hasChanges) || ticket.status !== 'WAITING_BEADS_APPROVAL'}
                className="text-xs shrink-0"
              >
                {isPending ? 'Approving…' : '✅ Approve'}
              </Button>
            </div>
          }
        />

        {/* Action buttons */}
        {editMode && (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving…' : '💾 Save'}
            </Button>
          </div>
        )}
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
      </div>

      {/* Artifact content */}
      <div className="flex-1 min-h-0 px-4 pb-2 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Loading artifacts…</div>
        ) : editMode ? (
          <YamlEditor value={editedContent} onChange={setEditedContent} className="border rounded-md" />
        ) : fileContent ? (
          <BeadsStructuredView content={fileContent} />
        ) : null}
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

  return <GenericApprovalView ticket={ticket} />
}
