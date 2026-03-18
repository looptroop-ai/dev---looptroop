import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useTicketAction, useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import { PhaseLogPanel } from './PhaseLogPanel'
import { VerticalResizeHandle } from './VerticalResizeHandle'
import { PhaseArtifactsPanel, InterviewAnswersView, PrdDraftView } from './PhaseArtifactsPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'

import { StructuredViewer } from '@/components/editor/StructuredViewer'
import { YamlEditor } from '@/components/editor/YamlEditor'
import { CascadeWarning } from '@/components/editor/CascadeWarning'
import type { Ticket } from '@/hooks/useTickets'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'

interface ApprovalViewProps {
  ticket: Ticket
  artifactType: 'interview' | 'prd' | 'beads'
}

const LABELS: Record<string, { title: string; description: string }> = {
  interview: { title: 'Interview Results', description: 'Review the interview questions and answers.' },
  prd: { title: 'Product Requirements Document', description: 'Review the generated PRD with epics and user stories.' },
  beads: { title: 'Beads Breakdown', description: 'Review the implementation beads with tests and dependencies.' },
}

const SKIPPED_QUESTIONS_NOTICE = 'Some interview questions were skipped. That is OK — they will still be handled during PRD drafting. Each PRD council model will use the ticket context, codebase analysis, and best practices to make a best-effort decision for those gaps, and you can still edit the interview now before approving if you want to replace any skipped item with your own answer.'

interface InterviewApprovalArtifactData {
  artifact?: string
  questions?: Array<{
    answer?: {
      skipped?: boolean
    }
  }>
}

function hasSkippedInterviewQuestions(content: string): boolean {
  if (!content.trim()) return false

  let parsed: unknown = null

  try {
    parsed = JSON.parse(content)
  } catch {
    try {
      parsed = jsYaml.load(content)
    } catch {
      return false
    }
  }

  if (!parsed || typeof parsed !== 'object') return false

  const artifact = parsed as InterviewApprovalArtifactData
  if (artifact.artifact !== 'interview' || !Array.isArray(artifact.questions)) return false

  return artifact.questions.some((question) => question?.answer?.skipped === true)
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
  const queryClient = useQueryClient()
  const { mutate: performAction, isPending } = useTicketAction()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const config = LABELS[artifactType] ?? { title: 'Review', description: '' }
  const uiStateScope = `approval_${artifactType}`
  const cascadeWarningMessage = useMemo(
    () => getCascadeEditWarningMessage(ticket.status, artifactType),
    [ticket.status, artifactType],
  )
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
    queryKey: ['artifact', ticket.id, artifactType],
    queryFn: async () => {
      const url = artifactType === 'beads'
        ? `/api/tickets/${ticket.id}/beads`
        : `/api/files/${ticket.id}/${artifactType}`
      const r = await fetch(url)
      if (!r.ok) throw new Error('Failed to load')
      const data = await r.json()
      return artifactType === 'beads'
        ? (Array.isArray(data) ? beadsArrayToJsonl(data) : '')
        : (data.content ?? '')
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache to prevent flashes
  })

  // Show loading only on true initial load (no cached data), not on background refetch
  const loading = isLoading

  const fileContent = fetchedContent ?? ''
  const showSkippedQuestionsNotice = useMemo(
    () => artifactType === 'interview' && hasSkippedInterviewQuestions(fileContent),
    [artifactType, fileContent],
  )

  const [editedContent, setEditedContent] = useState<string>('')
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showCascadeWarning, setShowCascadeWarning] = useState(false)
  const [logExpanded, setLogExpanded] = useState(false)
  const [logHeight, setLogHeight] = useState(200)
  const containerRef = useRef<HTMLDivElement>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id, artifactType])

  useEffect(() => {
    if (loading || restoredDraftRef.current || fetchedContent === undefined) return

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
  }, [loading, fetchedContent, persistedUiState, fileContent])

  const handleToggleEdit = useCallback(() => {
    if (editMode) {
      // Exiting edit mode — discard changes
      setEditedContent(fileContent)
      setEditMode(false)
      return
    }
    if (cascadeWarningMessage) {
      setShowCascadeWarning(true)
    } else {
      setEditMode(true)
    }
  }, [editMode, fileContent, cascadeWarningMessage])

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
      queryClient.setQueryData(['artifact', ticket.id, artifactType], editedContent)
      setEditMode(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editedContent, ticket.id, artifactType, queryClient])

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
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      <CascadeWarning
        message={cascadeWarningMessage ?? ''}
        open={showCascadeWarning}
        onConfirm={handleCascadeConfirm}
        onCancel={() => setShowCascadeWarning(false)}
      />

      <div className="p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{config.title}</span>
          <span className="text-xs text-muted-foreground">— {config.description}</span>
        </div>

        {showSkippedQuestionsNotice && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
            <p>{SKIPPED_QUESTIONS_NOTICE}</p>
          </div>
        )}

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
                disabled={isPending || (editMode && hasChanges)}
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
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Loading artifacts…</div>
        ) : editMode ? (
          <YamlEditor value={editedContent} onChange={setEditedContent} className="border rounded-md" />
        ) : fileContent ? (
          artifactType === 'beads' ? <BeadsStructuredView content={fileContent} /> :
            artifactType === 'interview' ? <InterviewAnswersView content={fileContent} /> :
              artifactType === 'prd' ? <PrdDraftView content={fileContent} /> :
                <StructuredViewer content={fileContent} />
        ) : null}
      </div>

      {logExpanded && <VerticalResizeHandle onResize={setLogHeight} containerRef={containerRef} />}
      <div className="shrink-0 px-4 pb-4 flex flex-col" style={logExpanded ? { height: logHeight, minHeight: 0 } : undefined}>
        <button
          type="button"
          onClick={() => setLogExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider py-1 hover:text-foreground transition-colors"
        >
          <span className="inline-block transition-transform" style={{ transform: logExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Log
        </button>
        {logExpanded && <PhaseLogPanel phase={ticket.status} ticket={ticket} />}
      </div>
    </div>
  )
}
