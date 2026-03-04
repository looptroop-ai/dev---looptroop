import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTicketAction, useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useProfile } from '@/hooks/useProfile'
import { StructuredViewer } from '@/components/editor/StructuredViewer'
import { YamlEditor } from '@/components/editor/YamlEditor'
import { CascadeWarning } from '@/components/editor/CascadeWarning'
import type { Ticket } from '@/hooks/useTickets'

interface ApprovalViewProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
}

const LABELS: Record<string, { title: string; description: string }> = {
  interview: { title: 'Interview Results', description: 'Review the interview questions and answers.' },
  prd: { title: 'Product Requirements Document', description: 'Review the generated PRD with epics and user stories.' },
  beads: { title: 'Beads Breakdown', description: 'Review the implementation beads with tests and dependencies.' },
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
        <details key={String(bead.id ?? i)} className="border border-border rounded-md">
          <summary className="px-3 py-2 cursor-pointer hover:bg-accent/50 text-xs font-medium flex items-center gap-2">
            <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">#{bead.priority != null ? String(bead.priority) : String(i + 1)}</span>
            <span>{String(bead.title ?? `Bead ${i + 1}`)}</span>
            {bead.status ? <span className="ml-auto text-muted-foreground text-[10px]">{String(bead.status)}</span> : null}
          </summary>
          <div className="px-3 pb-3 text-xs space-y-1">
            {bead.description ? <div><span className="text-blue-600 dark:text-blue-400">description</span>: {String(bead.description)}</div> : null}
            {bead.acceptance_criteria ? <div><span className="text-blue-600 dark:text-blue-400">acceptance_criteria</span>: {String(bead.acceptance_criteria)}</div> : null}
            {bead.prd_references ? <div><span className="text-blue-600 dark:text-blue-400">prd_references</span>: {String(bead.prd_references)}</div> : null}
            {Array.isArray(bead.target_files) && <div><span className="text-blue-600 dark:text-blue-400">target_files</span>: {(bead.target_files as string[]).join(', ')}</div>}
            {Array.isArray(bead.tests) && <div><span className="text-blue-600 dark:text-blue-400">tests</span>: {(bead.tests as string[]).join('; ')}</div>}
          </div>
        </details>
      ))}
    </div>
  )
}

export function ApprovalView({ ticket, artifactType }: ApprovalViewProps) {
  const { mutate: performAction, isPending } = useTicketAction()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const config = LABELS[artifactType] ?? { title: 'Review', description: '' }
  const uiStateScope = `approval_${artifactType}`
  const { data: persistedUiState } = useTicketUIState<{
    editMode?: boolean
    editedContent?: string
  }>(ticket.id, uiStateScope, true)
  const { data: profile } = useProfile()
  const councilMemberNames = useMemo(() => {
    try { return profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [] }
    catch { return [] }
  }, [profile?.councilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  const [fileContent, setFileContent] = useState<string>('')
  const [editedContent, setEditedContent] = useState<string>('')
  const [editMode, setEditMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showCascadeWarning, setShowCascadeWarning] = useState(false)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id, artifactType])

  // Load artifact file from server
  useEffect(() => {
    setLoading(true)
    setSaveError(null)

    const url = artifactType === 'beads'
      ? `/api/tickets/${ticket.id}/beads`
      : `/api/files/${ticket.id}/${artifactType}`

    fetch(url)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load')))
      .then((data) => {
        const content = artifactType === 'beads'
          ? (Array.isArray(data) ? beadsArrayToJsonl(data) : '')
          : (data.content ?? '')
        setFileContent(content)
        setEditedContent(content)
        setEditMode(false)
      })
      .catch(() => {
        setFileContent('')
        setEditedContent('')
        setEditMode(false)
      })
      .finally(() => setLoading(false))
  }, [ticket.id, artifactType])

  useEffect(() => {
    if (loading || restoredDraftRef.current) return

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
  }, [loading, persistedUiState, fileContent])

  const handleToggleEdit = useCallback(() => {
    if (editMode) {
      // Exiting edit mode — discard changes
      setEditedContent(fileContent)
      setEditMode(false)
      return
    }
    // Entering edit mode — show cascade warning for interview/prd
    if (artifactType !== 'beads') {
      setShowCascadeWarning(true)
    } else {
      setEditMode(true)
    }
  }, [editMode, fileContent, artifactType])

  const handleCascadeConfirm = useCallback(() => {
    setShowCascadeWarning(false)
    setEditMode(true)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      if (artifactType === 'beads') {
        const beadsArray = jsonlToBeadsArray(editedContent)
        const res = await fetch(`/api/tickets/${ticket.id}/beads`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(beadsArray),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      } else {
        const res = await fetch(`/api/files/${ticket.id}/${artifactType}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editedContent }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      }
      setFileContent(editedContent)
      setEditMode(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editedContent, ticket.id, artifactType])

  const hasChanges = editedContent !== fileContent

  useEffect(() => {
    if (loading || !restoredDraftRef.current) return

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
  }, [loading, editMode, editedContent, saveUiState, ticket.id, uiStateScope])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <CascadeWarning
        artifactType={artifactType}
        open={showCascadeWarning}
        onConfirm={handleCascadeConfirm}
        onCancel={() => setShowCascadeWarning(false)}
      />

      <div className="p-4 space-y-3 shrink-0">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{config.title}</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-muted-foreground">{config.description}</p>
          </CardContent>
        </Card>

        <PhaseArtifactsPanel
          phase={ticket.status}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={councilMemberCount}
          councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined}
          prefixElement={
            <Button variant="outline" size="sm" onClick={handleToggleEdit} className="text-xs shrink-0">
              {editMode ? '📄 View' : '✏️ Edit'}
            </Button>
          }
        />

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2">
          {editMode && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving…' : '💾 Save'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'cancel' })}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => performAction({ id: ticket.id, action: 'approve' })}
            disabled={isPending || (editMode && hasChanges)}
          >
            {isPending ? 'Approving…' : '✅ Approve'}
          </Button>
        </div>
        {saveError && <p className="text-xs text-red-500">{saveError}</p>}
      </div>

      {/* Artifact content */}
      <div className="flex-1 min-h-0 px-4 pb-2 overflow-auto">
        {loading ? (
          <div className="text-xs text-muted-foreground italic p-4">Loading artifact…</div>
        ) : editMode ? (
          <YamlEditor value={editedContent} onChange={setEditedContent} className="border rounded-md" />
        ) : fileContent ? (
          artifactType === 'beads'
            ? <BeadsStructuredView content={fileContent} />
            : <StructuredViewer content={fileContent} />
        ) : null}
      </div>

      <div className="shrink-0 min-h-0 px-4 pb-4 flex flex-col" style={{ maxHeight: '30%' }}>
        <PhaseLogPanel phase={ticket.status} />
      </div>
    </div>
  )
}
