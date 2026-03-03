import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Users, CheckCircle2, Clock, ChevronDown, ChevronRight, Trophy } from 'lucide-react'

interface PhaseArtifactsPanelProps {
  phase: string
  isCompleted: boolean
  ticketId?: number
  councilMemberCount?: number
  councilMemberNames?: string[]
}

interface ArtifactDef {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

interface DBartifact {
  id: number
  ticketId: number
  phase: string
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
}

function getModelIcon(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('claude')) return '🟣'
  if (n.includes('gpt')) return '🟢'
  if (n.includes('gemini')) return '🔵'
  return '⚪'
}

function getModelDisplayName(id: string): string {
  return id.split('/').pop() ?? id
}

// Try to parse content as JSON CouncilResult
function tryParseCouncilResult(content: string): any | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed && (parsed.drafts || parsed.votes || parsed.winnerId)) return parsed
    return null
  } catch {
    return null
  }
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium hover:bg-accent/50 transition-colors text-left">
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 text-xs">{children}</div>}
    </div>
  )
}

// Render interview draft: Q&A pairs
function InterviewDraftView({ content }: { content: string }) {
  const lines = content.split('\n')
  const questions: { q: string; section?: string }[] = []
  let currentSection = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      currentSection = trimmed.replace(/^#+\s*/, '')
    } else if (/^\d+[\.\)]\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\*\*Q\d/i.test(trimmed) || trimmed.endsWith('?')) {
      const q = trimmed.replace(/^[-*\d\.\)]+\s*/, '').replace(/^\*\*/,'').replace(/\*\*$/,'')
      if (q.length > 5) questions.push({ q, section: currentSection })
    }
  }
  if (questions.length === 0) return null
  const grouped = questions.reduce<Record<string, string[]>>((acc, { q, section }) => {
    const key = section || 'Questions'
    ;(acc[key] ??= []).push(q)
    return acc
  }, {})
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-2">{questions.length} questions total</div>
      {Object.entries(grouped).map(([section, qs]) => (
        <CollapsibleSection key={section} title={<span>{section} <span className="text-muted-foreground">({qs.length})</span></span>} defaultOpen>
          <ol className="list-decimal list-inside space-y-1.5">
            {qs.map((q, i) => <li key={i} className="text-xs">{q}</li>)}
          </ol>
        </CollapsibleSection>
      ))}
    </div>
  )
}

// Render PRD draft: epics/user stories in collapsible sections
function PrdDraftView({ content }: { content: string }) {
  const lines = content.split('\n')
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('##') || (trimmed.startsWith('**Epic') || trimmed.startsWith('**User Story'))) {
      if (current) sections.push(current)
      current = { title: trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, ''), items: [] }
    } else if (current && trimmed) {
      current.items.push(trimmed.replace(/^[-*]\s*/, ''))
    }
  }
  if (current) sections.push(current)
  if (sections.length === 0) return null
  return (
    <div className="space-y-2">
      {sections.map((s, i) => (
        <CollapsibleSection key={i} title={s.title} defaultOpen={i === 0}>
          <div className="space-y-1">
            {s.items.map((item, j) => <div key={j} className="text-xs">• {item}</div>)}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

// Render beads draft: bead list with details
function BeadsDraftView({ content }: { content: string }) {
  const lines = content.split('\n')
  const beads: { title: string; details: string[] }[] = []
  let current: { title: string; details: string[] } | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    const beadMatch = trimmed.match(/^(?:##?\s*)?(?:Bead|Issue)\s*#?\d+[:\s-]*(.*)/i)
    if (beadMatch) {
      if (current) beads.push(current)
      current = { title: beadMatch[1] || trimmed, details: [] }
    } else if (current && trimmed) {
      current.details.push(trimmed.replace(/^[-*]\s*/, ''))
    }
  }
  if (current) beads.push(current)
  if (beads.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-2">{beads.length} beads</div>
      {beads.map((b, i) => (
        <CollapsibleSection key={i} title={<span className="flex items-center gap-1.5"><span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">#{i + 1}</span> {b.title}</span>}>
          <div className="space-y-1">
            {b.details.map((d, j) => <div key={j} className="text-xs">• {d}</div>)}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

// Render voting results with score table and winner
function VotingResultsView({ data }: { data: any }) {
  const votes = data.votes as Array<{ voterId: string; draftId: string; scores: Array<{ category: string; score: number }>; totalScore: number }>
  const winnerId = data.winnerId as string
  if (!votes || votes.length === 0) return <div className="text-xs text-muted-foreground italic">No voting data available</div>

  // Get unique drafts and voters
  const draftIds = [...new Set(votes.map(v => v.draftId))]
  const voterIds = [...new Set(votes.map(v => v.voterId))]
  const categories = votes[0]?.scores?.map(s => s.category) ?? []

  // Aggregate scores per draft
  const draftScores = draftIds.map(draftId => {
    const draftVotes = votes.filter(v => v.draftId === draftId)
    const total = draftVotes.reduce((sum, v) => sum + v.totalScore, 0)
    const categoryAvgs = categories.map(cat => {
      const scores = draftVotes.map(v => v.scores.find(s => s.category === cat)?.score ?? 0)
      return { category: cat, avg: scores.reduce((a, b) => a + b, 0) / (scores.length || 1) }
    })
    return { draftId, total, categoryAvgs, isWinner: draftId === winnerId }
  }).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-3">
      {/* Rankings */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold mb-1">Rankings</div>
        {draftScores.map((d, rank) => (
          <div key={d.draftId} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${d.isWinner ? 'bg-yellow-50 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-700' : 'bg-background border border-border'}`}>
            <span className="font-mono w-5 text-center">{rank === 0 ? '🏆' : `#${rank + 1}`}</span>
            <span className="text-sm">{getModelIcon(d.draftId)}</span>
            <span className="font-medium">{getModelDisplayName(d.draftId)}</span>
            <span className="ml-auto font-mono font-semibold">{d.total}</span>
            {d.isWinner && <Trophy className="h-3.5 w-3.5 text-yellow-600" />}
          </div>
        ))}
      </div>

      {/* Score table */}
      {categories.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-xs font-semibold mb-1">Score Breakdown</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Model</th>
                {categories.map(cat => (
                  <th key={cat} className="text-center py-1 px-1 font-medium text-muted-foreground" title={cat}>
                    {cat.length > 20 ? cat.slice(0, 18) + '…' : cat}
                  </th>
                ))}
                <th className="text-center py-1 pl-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {draftScores.map(d => (
                <tr key={d.draftId} className={`border-b border-border/50 ${d.isWinner ? 'bg-yellow-50/50 dark:bg-yellow-950/30' : ''}`}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <span className="mr-1">{getModelIcon(d.draftId)}</span>
                    {getModelDisplayName(d.draftId)}
                  </td>
                  {d.categoryAvgs.map(ca => (
                    <td key={ca.category} className="text-center py-1 px-1 font-mono">{ca.avg.toFixed(1)}</td>
                  ))}
                  <td className="text-center py-1 pl-2 font-mono font-semibold">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-voter breakdown */}
      <CollapsibleSection title={<span>Voter Details <span className="text-muted-foreground">({voterIds.length} voters)</span></span>}>
        <div className="space-y-2">
          {voterIds.map(voterId => (
            <div key={voterId} className="space-y-1">
              <div className="font-medium flex items-center gap-1">{getModelIcon(voterId)} {getModelDisplayName(voterId)}</div>
              {votes.filter(v => v.voterId === voterId).map(v => (
                <div key={v.draftId} className="ml-4 flex items-center gap-2 text-muted-foreground">
                  <span>→ {getModelDisplayName(v.draftId)}</span>
                  <span className="font-mono">{v.totalScore}pts</span>
                  {v.draftId === winnerId && <span className="text-yellow-600 text-[10px]">winner</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function getPhaseArtifacts(phase: string, councilMemberCount: number = 3, councilMemberNames?: string[]): ArtifactDef[] {
  const memberLabel = (i: number) => {
    const raw = councilMemberNames?.[i]
    if (!raw) return `Model ${i + 1}`
    return raw.includes('/') ? raw.split('/').pop()! : raw
  }
  if (phase === 'COUNCIL_DELIBERATING') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `draft-${i + 1}`,
      label: `Interview Draft — ${memberLabel(i)}`,
      description: 'Independent question set draft',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_INTERVIEW') {
    return [{ id: 'votes', label: 'Voting Results', description: 'Weighted scoring rubric results', icon: <Users className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'COMPILING_INTERVIEW') {
    return [{ id: 'final-interview', label: 'Final Interview Questions', description: 'Compiled question set', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_INTERVIEW_ANSWERS' || phase === 'VERIFYING_INTERVIEW_COVERAGE') {
    return [{ id: 'interview-answers', label: 'Interview Answers', description: 'User responses', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_INTERVIEW_APPROVAL') {
    return [{ id: 'interview-yaml', label: 'interview.yaml', description: 'Final interview artifact', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'DRAFTING_PRD') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `prd-draft-${i + 1}`,
      label: `PRD Draft — ${memberLabel(i)}`,
      description: 'Independent PRD draft',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_PRD') {
    return [{ id: 'prd-votes', label: 'PRD Voting Results', description: 'Weighted scoring results', icon: <Users className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'REFINING_PRD' || phase === 'VERIFYING_PRD_COVERAGE') {
    return [{ id: 'refined-prd', label: 'Refined PRD', description: 'Winning draft with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_PRD_APPROVAL') {
    return [{ id: 'prd-yaml', label: 'prd.yaml', description: 'Final PRD artifact', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'DRAFTING_BEADS') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `beads-draft-${i + 1}`,
      label: `Beads Draft — ${memberLabel(i)}`,
      description: 'Independent beads breakdown',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_BEADS') {
    return [{ id: 'beads-votes', label: 'Beads Voting Results', description: 'Weighted scoring results', icon: <Users className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'REFINING_BEADS' || phase === 'VERIFYING_BEADS_COVERAGE') {
    return [{ id: 'refined-beads', label: 'Refined Beads', description: 'Winning beads with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_BEADS_APPROVAL') {
    return [{ id: 'beads-jsonl', label: 'issues.jsonl', description: 'Final beads artifact', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'PRE_FLIGHT_CHECK') {
    return [{ id: 'diagnostics', label: 'Doctor Diagnostics', description: 'Pre-flight validation report', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'CODING') {
    return [{ id: 'bead-commits', label: 'Bead Commits', description: 'Per-bead git commits', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'RUNNING_FINAL_TEST') {
    return [{ id: 'test-results', label: 'Test Results', description: 'Full test suite results', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'INTEGRATING_CHANGES') {
    return [{ id: 'commit-summary', label: 'Commit Summary', description: 'Squashed commit history', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'CLEANING_ENV') {
    return [{ id: 'cleanup-report', label: 'Cleanup Report', description: 'Resource cleanup', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  return []
}

function ArtifactContent({ content, artifactId }: { content: string; artifactId?: string }) {
  // Try structured rendering for CouncilResult JSON
  const councilResult = tryParseCouncilResult(content)
  if (councilResult) {
    const isVotes = artifactId?.includes('vote')
    if (isVotes) return <VotingResultsView data={councilResult} />

    // For individual draft views, extract the specific draft
    const draftIndex = artifactId?.match(/(\d+)$/)?.[1]
    const draftIdx = draftIndex ? parseInt(draftIndex, 10) - 1 : -1
    const draft = draftIdx >= 0 && councilResult.drafts?.[draftIdx]
    const draftContent = draft?.content ?? councilResult.refinedContent ?? councilResult.winnerContent ?? ''

    if (draftContent) {
      const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
      const isPrd = artifactId?.includes('prd')
      const isBeads = artifactId?.includes('beads')

      // Show model info header for individual drafts
      const header = draft ? (
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
          <span className="text-lg">{getModelIcon(draft.memberId)}</span>
          <div>
            <div className="text-xs font-medium">{getModelDisplayName(draft.memberId)}</div>
            <div className="text-[10px] text-muted-foreground">
              {draft.outcome === 'completed' ? '✅ Completed' : draft.outcome === 'timed_out' ? '⏰ Timed out' : '❌ Invalid output'}
              {draft.duration ? ` · ${(draft.duration / 1000).toFixed(1)}s` : ''}
              {draft.memberId === councilResult.winnerId && <span className="ml-1 text-yellow-600">🏆 Winner</span>}
            </div>
          </div>
        </div>
      ) : null

      const structured = isInterview ? <InterviewDraftView content={draftContent} />
        : isPrd ? <PrdDraftView content={draftContent} />
        : isBeads ? <BeadsDraftView content={draftContent} />
        : null

      if (structured) return <>{header}{structured}</>
      // Fall through to raw rendering with header
      return <>{header}<RawContentView content={draftContent} /></>
    }
  }

  return <RawContentView content={content} />
}

function RawContentView({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="text-sm space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-bold mt-3 mb-1">{line.slice(2)}</h2>
        if (line.startsWith('## ')) return <h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-semibold mt-2">{line.slice(4)}</h4>
        if (line.startsWith('✅')) return <div key={i} className="flex items-center gap-1 text-green-600"><span>{line}</span></div>
        if (line.startsWith('⚠️')) return <div key={i} className="flex items-center gap-1 text-yellow-600"><span>{line}</span></div>
        if (line.startsWith('❌')) return <div key={i} className="flex items-center gap-1 text-red-600"><span>{line}</span></div>
        if (line.startsWith('|')) return <div key={i} className="font-mono text-xs">{line}</div>
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="ml-4">• {line.slice(2)}</div>
        if (line.match(/^\d+\./)) return <div key={i} className="ml-4">{line}</div>
        if (line.startsWith('**') && line.endsWith('**')) return <div key={i} className="font-semibold">{line.replace(/\*\*/g, '')}</div>
        if (line.trim() === '') return <div key={i} className="h-2" />
        return <div key={i}>{line}</div>
      })}
    </div>
  )
}

export function PhaseArtifactsPanel({ phase, isCompleted, ticketId, councilMemberCount = 3, councilMemberNames }: PhaseArtifactsPanelProps) {
  const artifacts = getPhaseArtifacts(phase, councilMemberCount, councilMemberNames)
  const [viewingArtifact, setViewingArtifact] = useState<ArtifactDef | null>(null)
  const [dbArtifacts, setDbArtifacts] = useState<DBartifact[]>([])

  useEffect(() => {
    if (!ticketId) return
    fetch(`/api/tickets/${ticketId}/artifacts`)
      .then(r => r.ok ? r.json() : [])
      .then(setDbArtifacts)
      .catch(() => {})
  }, [ticketId, phase])

  if (artifacts.length === 0) return null

  // Match a UI artifact def to the closest DB artifact for this phase
  function findDbContent(artifactDef: ArtifactDef): string | null {
    const prefix = artifactDef.id.split('-')[0] ?? ''
    // Try matching by artifactType first, then fall back to phase-only match
    const match = dbArtifacts.find(a => a.phase === phase && a.artifactType?.toLowerCase().includes(prefix))
      ?? dbArtifacts.find(a => a.phase === phase && a.content)
    return match?.content ?? null
  }

  return (
    <>
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Artifacts</span>
        <div className="flex flex-row flex-wrap gap-2 mt-1">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => setViewingArtifact(artifact)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent/50 cursor-pointer transition-colors text-xs whitespace-nowrap"
            >
              <span className="text-muted-foreground">{artifact.icon}</span>
              <span className="font-medium">{artifact.label}</span>
              {isCompleted ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <Dialog open={!!viewingArtifact} onOpenChange={(open) => !open && setViewingArtifact(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              {viewingArtifact?.icon}
              {viewingArtifact?.label}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="bg-muted rounded-md p-4">
              <ArtifactContent
                artifactId={viewingArtifact?.id}
                content={viewingArtifact ? (findDbContent(viewingArtifact) || `# ${viewingArtifact.label}\n\n${viewingArtifact.description}\n\nNo content available yet — artifact will be generated during this phase.`) : ''}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
