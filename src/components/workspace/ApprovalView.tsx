import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useTicketAction, useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { YamlEditor } from '@/components/editor/YamlEditor'
import type { Ticket } from '@/hooks/useTickets'
import { InterviewApprovalPane } from './InterviewApprovalPane'
import { PrdApprovalPane } from './PrdApprovalPane'
import { BeadsDraftView } from './ArtifactContentViewer'
import { CoverageApprovalWarning, resolveCoverageApprovalWarning } from './CoverageApprovalWarning'

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
  const { artifacts } = useTicketArtifacts(ticket.id)

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
  const coverageWarning = useMemo(
    () => resolveCoverageApprovalWarning(artifacts, 'beads'),
    [artifacts],
  )

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
        <div className="space-y-3">
          {coverageWarning ? <CoverageApprovalWarning warning={coverageWarning} /> : null}
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Loading artifacts…</div>
          ) : editMode ? (
            <YamlEditor value={editedContent} onChange={setEditedContent} className="border rounded-md" />
          ) : fileContent ? (
            <BeadsDraftView content={fileContent} />
          ) : null}
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

  return <GenericApprovalView ticket={ticket} />
}
