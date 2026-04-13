import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingText } from '@/components/ui/LoadingText'
import { CascadeWarning } from '@/components/editor/CascadeWarning'
import { YamlEditor } from '@/components/editor/YamlEditor'
import { InterviewDocumentView } from './InterviewDocumentView'
import { InterviewApprovalAnswerEditor } from './InterviewApprovalAnswerEditor'
import { CollapsiblePhaseLogSection } from './CollapsiblePhaseLogSection'
import { clearTicketArtifactsCache } from '@/hooks/useTicketArtifacts'
import { useInterviewQuestions, useSaveTicketUIState, useTicketUIState, type Ticket } from '@/hooks/useTickets'
import type { InterviewAnswerUpdate, InterviewDocument } from '@shared/interviewArtifact'
import {
  buildInterviewAnswerDrafts,
  hasSkippedInterviewAnswers,
  INTERVIEW_APPROVAL_FOCUS_EVENT,
  normalizeInterviewDocumentLike,
  parseInterviewDocument,
  parseInterviewDocumentContent,
} from '@/lib/interviewDocument'
import { getCascadeEditWarningMessage } from '@/lib/workflowMeta'

const SKIPPED_QUESTIONS_NOTICE = 'Some interview questions were skipped. That is OK — they will still be handled during PRD drafting. Each PRD council model will use the ticket context, codebase analysis, and best practices to make a best-effort decision for those gaps, and you can still edit the interview now before approving if you want to replace any skipped item with your own answer.'

type EditTab = 'answers' | 'yaml'

interface InterviewApprovalUiState {
  editMode?: boolean
  editTab?: EditTab
  yamlDraft?: string
  answerDrafts?: Record<string, InterviewAnswerUpdate['answer']>
}

type DiscardTarget =
  | { type: 'close' }
  | { type: 'switch-tab'; tab: EditTab }
  | null

function normalizePersistedAnswerDrafts(
  value: unknown,
  document: InterviewDocument,
): Record<string, InterviewAnswerUpdate['answer']> {
  const baseDrafts = buildInterviewAnswerDrafts(document)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return baseDrafts

  const record = value as Record<string, unknown>
  for (const question of document.questions) {
    const draft = record[question.id]
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) continue
    const answerDraft = draft as Record<string, unknown>
    baseDrafts[question.id] = {
      skipped: answerDraft.skipped === true,
      selected_option_ids: Array.isArray(answerDraft.selected_option_ids)
        ? answerDraft.selected_option_ids.filter((item): item is string => typeof item === 'string')
        : [],
      free_text: typeof answerDraft.free_text === 'string' ? answerDraft.free_text : '',
    }
  }

  return baseDrafts
}

export function InterviewApprovalPane({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const uiStateScope = 'approval_interview'
  const cascadeWarningMessage = useMemo(
    () => getCascadeEditWarningMessage(ticket.status, 'interview', ticket.previousStatus),
    [ticket.status, ticket.previousStatus],
  )
  const { data: persistedUiState } = useTicketUIState<InterviewApprovalUiState>(ticket.id, uiStateScope, true)
  const { data: interviewData, isLoading, isFetching } = useInterviewQuestions(ticket.id)

  const interviewDocument = useMemo(
    () => normalizeInterviewDocumentLike(interviewData?.document) ?? parseInterviewDocument(interviewData?.raw),
    [interviewData?.document, interviewData?.raw],
  )
  const rawContent = interviewData?.raw ?? ''
  const showSkippedQuestionsNotice = hasSkippedInterviewAnswers(interviewDocument)
  const isPreparingStructuredInterview = !interviewDocument && Boolean(rawContent) && isFetching

  const [editMode, setEditMode] = useState(false)
  const [editTab, setEditTab] = useState<EditTab>('answers')
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, InterviewAnswerUpdate['answer']>>({})
  const [yamlDraft, setYamlDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [showCascadeWarning, setShowCascadeWarning] = useState(false)
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null)
  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const containerRef = useRef<HTMLDivElement>(null)

  const baseAnswerDrafts = useMemo(
    () => (interviewDocument ? buildInterviewAnswerDrafts(interviewDocument) : {}),
    [interviewDocument],
  )

  const hasAnswerChanges = useMemo(
    () => JSON.stringify(answerDrafts) !== JSON.stringify(baseAnswerDrafts),
    [answerDrafts, baseAnswerDrafts],
  )
  const hasYamlChanges = yamlDraft !== rawContent
  const hasUnsavedChanges = editTab === 'answers' ? hasAnswerChanges : hasYamlChanges
  const yamlValidation = editTab === 'yaml' ? parseInterviewDocumentContent(yamlDraft) : null

  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id])

  useEffect(() => {
    if (isLoading || restoredDraftRef.current || !interviewDocument) return

    const persisted = persistedUiState?.data
    const nextEditMode = Boolean(persisted?.editMode)
    const nextEditTab: EditTab = persisted?.editTab === 'yaml' ? 'yaml' : 'answers'
    const nextAnswerDrafts = normalizePersistedAnswerDrafts(persisted?.answerDrafts, interviewDocument)
    const nextYamlDraft = typeof persisted?.yamlDraft === 'string' ? persisted.yamlDraft : rawContent

    setEditMode(nextEditMode)
    setEditTab(nextEditTab)
    setAnswerDrafts(nextAnswerDrafts)
    setYamlDraft(nextYamlDraft)

    const snapshot = JSON.stringify({
      editMode: nextEditMode,
      editTab: nextEditTab,
      yamlDraft: nextYamlDraft,
      answerDrafts: nextAnswerDrafts,
    })
    lastSavedSnapshotRef.current = snapshot
    restoredDraftRef.current = true
  }, [interviewDocument, isLoading, persistedUiState, rawContent])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: string; anchorId?: string }>).detail
      if (!detail?.anchorId || String(detail.ticketId) !== String(ticket.id)) return

      const target = document.getElementById(detail.anchorId)
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    window.addEventListener(INTERVIEW_APPROVAL_FOCUS_EVENT, handler as EventListener)
    return () => window.removeEventListener(INTERVIEW_APPROVAL_FOCUS_EVENT, handler as EventListener)
  }, [ticket.id])

  useEffect(() => {
    if (isLoading || !restoredDraftRef.current) return

    const snapshot = {
      editMode,
      editTab,
      yamlDraft,
      answerDrafts,
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
  }, [answerDrafts, editMode, editTab, isLoading, saveUiState, ticket.id, uiStateScope, yamlDraft])

  function resetDraftsFromSaved(nextTab: EditTab = 'answers') {
    startTransition(() => {
      setAnswerDrafts(baseAnswerDrafts)
      setYamlDraft(rawContent)
      setEditTab(nextTab)
      setSaveError(null)
      setApproveError(null)
    })
  }

  function openFriendlyEditor() {
    resetDraftsFromSaved('answers')
    setEditMode(true)
  }

  async function handleSave() {
    if (!interviewDocument) return

    if (editTab === 'yaml' && yamlValidation?.error) {
      setSaveError(yamlValidation.error)
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const response = await fetch(
        editTab === 'answers'
          ? `/api/tickets/${ticket.id}/interview-answers`
          : `/api/tickets/${ticket.id}/interview`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            editTab === 'answers'
              ? {
                questions: interviewDocument.questions.map((question) => ({
                  id: question.id,
                  answer: answerDrafts[question.id] ?? baseAnswerDrafts[question.id],
                })),
              }
              : { content: yamlDraft },
          ),
        },
      )

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Save failed')
      }

      queryClient.setQueryData(['interview', ticket.id], payload)
      queryClient.setQueryData(['artifact', ticket.id, 'interview'], payload.raw ?? '')
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      clearTicketArtifactsCache(ticket.id)

      const savedDocument = normalizeInterviewDocumentLike(payload.document) ?? parseInterviewDocument(payload.raw)
      setAnswerDrafts(savedDocument ? buildInterviewAnswerDrafts(savedDocument) : {})
      setYamlDraft(payload.raw ?? '')
      setEditMode(false)
      setEditTab('answers')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    setApproveError(null)

    try {
      const response = await fetch(`/api/tickets/${ticket.id}/approve-interview`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to approve interview')
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] })
      queryClient.invalidateQueries({ queryKey: ['interview', ticket.id] })
      clearTicketArtifactsCache(ticket.id)
      setEditMode(false)
      setEditTab('answers')
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : 'Failed to approve interview')
    } finally {
      setApproving(false)
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
    if (editMode) {
      if (hasUnsavedChanges) {
        setDiscardTarget({ type: 'close' })
        return
      }
      resetDraftsFromSaved('answers')
      setEditMode(false)
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
      resetDraftsFromSaved('answers')
      setEditMode(false)
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
            <DialogTitle className="text-sm">Discard unsaved interview edits?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Switching editors or leaving edit mode resets the current draft back to the last saved interview artifact.
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
          <span className="font-semibold">Interview Results</span>
          <span className="flex-1 text-xs text-muted-foreground">Review the final interview artifact, edit recorded answers if needed, then approve it.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleEdit}
            disabled={isPreparingStructuredInterview}
            className="text-xs shrink-0"
          >
            {editMode ? 'View' : 'Edit'}
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approving || saving || (editMode && hasUnsavedChanges) || !interviewDocument || ticket.status !== 'WAITING_INTERVIEW_APPROVAL'}
            className="text-xs shrink-0"
          >
            {approving ? 'Approving…' : 'Approve'}
          </Button>
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

        {editMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => requestTabChange('answers')}
                className={editTab === 'answers'
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
              >
                Answers
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

      <div className="flex-1 min-h-0 px-4 pb-2 overflow-auto">
        {isLoading || isPreparingStructuredInterview ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <div className="text-center space-y-2">
              <LoadingText text={isPreparingStructuredInterview ? 'Preparing interview results' : 'Loading interview results'} className="text-sm font-medium animate-pulse" />
              <p className="text-[10px]">
                {isPreparingStructuredInterview
                  ? 'Building the structured approval view.'
                  : 'Fetching the latest interview artifact.'}
              </p>
            </div>
          </div>
        ) : editMode ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
            {editTab === 'yaml' ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground">
                  YAML mode gives full control over the canonical interview artifact. Saving rewrites it into the server's canonical form and clears interview approval metadata.
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
            ) : interviewDocument ? (
              <InterviewApprovalAnswerEditor
                document={interviewDocument}
                drafts={answerDrafts}
                disabled={saving}
                onAnswerChange={(questionId, answer) => {
                  setAnswerDrafts((current) => ({
                    ...current,
                    [questionId]: answer,
                  }))
                }}
              />
            ) : (
              <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                The final interview artifact could not be parsed. Switch to YAML mode to inspect the raw document.
              </div>
            )}
          </div>
        ) : interviewDocument ? (
          <InterviewDocumentView document={interviewDocument} hideAiAnswerBadge />
        ) : rawContent ? (
          <div className="rounded-xl border border-border bg-background p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] font-mono">{rawContent}</pre>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No interview artifact available yet.</div>
        )}
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
