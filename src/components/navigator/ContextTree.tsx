import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowMeta } from '@/hooks/useWorkflowMeta'
import type { WorkflowContextKey, WorkflowContextSection } from '@shared/workflowMeta'

interface ContextTreeProps {
  selectedPhase: string
  ticketId: string
}

interface ContextItem {
  id: string
  label: string
  icon: string
  description: string
}

const CONTEXT_LABELS: Record<string, ContextItem> = {
  ticket_details: {
    id: 'ticket_details',
    label: 'Ticket Details',
    icon: '📋',
    description: 'Title, description, and ticket metadata.',
  },
  relevant_files: {
    id: 'relevant_files',
    label: 'Relevant Files',
    icon: '📂',
    description: 'Source file contents identified as relevant to this ticket by AI analysis.',
  },
  drafts: {
    id: 'drafts',
    label: 'Competing Drafts',
    icon: '📝',
    description: 'Alternative model drafts used for voting/refinement.',
  },
  interview: {
    id: 'interview',
    label: 'Interview Results',
    icon: '💬',
    description: 'Interview question/answer artifact content.',
  },
  full_answers: {
    id: 'full_answers',
    label: 'Full Answers',
    icon: '🧠',
    description: 'Model-specific interview results with skipped questions filled in by AI.',
  },
  user_answers: {
    id: 'user_answers',
    label: 'User Answers',
    icon: '✍️',
    description: 'Collected user responses during interview loop.',
  },
  votes: {
    id: 'votes',
    label: 'Council Votes',
    icon: '🗳️',
    description: 'Scoring/vote output from council phase.',
  },
  prd: {
    id: 'prd',
    label: 'PRD',
    icon: '📄',
    description: 'Product requirements artifact.',
  },
  beads: {
    id: 'beads',
    label: 'Beads Plan',
    icon: '🔗',
    description: 'Current beads artifact, including semantic blueprint content during coverage and execution-ready graph data after expansion.',
  },
  beads_draft: {
    id: 'beads_draft',
    label: 'Semantic Blueprint',
    icon: '🧩',
    description: 'Refined semantic beads blueprint used as the source for the final expansion step.',
  },
  tests: {
    id: 'tests',
    label: 'Verification Tests',
    icon: '🧪',
    description: 'Coverage/final test context and test intent.',
  },
  bead_data: {
    id: 'bead_data',
    label: 'Current Bead Data',
    icon: '⚙️',
    description: 'Active bead specification and acceptance criteria.',
  },
  bead_notes: {
    id: 'bead_notes',
    label: 'Bead Notes',
    icon: '📓',
    description: 'Iteration notes and prior-attempt context.',
  },
  error_context: {
    id: 'error_context',
    label: 'Error Context',
    icon: '❌',
    description: 'Failure context from previous blocked iteration.',
  },
}

function getAllowedContextItems(keys: WorkflowContextKey[]): ContextItem[] {
  return keys
    .map(key => CONTEXT_LABELS[key])
    .filter((item): item is ContextItem => Boolean(item))
}

function getAllowedContextSections(
  sections: readonly WorkflowContextSection[] | undefined,
  fallbackKeys: WorkflowContextKey[],
): Array<{ label?: string; description?: string; items: ContextItem[] }> {
  if (!sections || sections.length === 0) {
    return [{ items: getAllowedContextItems(fallbackKeys) }]
  }

  return sections.map((section) => ({
    label: section.label,
    description: section.description,
    items: getAllowedContextItems([...section.keys]),
  }))
}

function ContextRow({ item }: { item: ContextItem }) {
  return (
    <div
      className="w-full flex items-center gap-2 py-1 px-2 rounded-md text-xs hover:bg-accent transition-colors"
      title={item.description}
    >
      <span className="text-sm leading-none" aria-hidden>{item.icon}</span>
      <span className="truncate font-medium">{item.label}</span>
    </div>
  )
}

export function ContextTree({ selectedPhase }: ContextTreeProps) {
  const { phaseMap } = useWorkflowMeta()
  const [collapsed, setCollapsed] = useState(true)
  const phaseMeta = phaseMap[selectedPhase]
  const sections = getAllowedContextSections(
    phaseMeta?.contextSections,
    phaseMeta?.contextSummary ?? ['ticket_details'],
  )
  const usesParts = sections.length > 1
  const summaryText = usesParts
    ? `${sections.length} parts`
    : `${sections[0]?.items.length ?? 0}`

  return (
    <div className="p-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5 hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', !collapsed && 'rotate-90')} />
        Allowed Context
        <span className="ml-auto text-[10px] font-normal normal-case">{summaryText}</span>
      </button>
      {!collapsed && (
        <ScrollArea className="max-h-[250px]">
          <div className="space-y-2">
            {sections.map((section, index) => (
              <div
                key={`${section.label ?? 'context'}-${index}`}
                className={cn(index > 0 && 'border-t border-border/40 pt-2')}
              >
                {section.label ? (
                  <div className="px-2 pb-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] font-semibold text-foreground/80">{section.label}</span>
                      {section.description ? (
                        <span className="text-[11px] text-muted-foreground">- {section.description}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-0.5">
                  {section.items.map(item => (
                    <ContextRow key={`${section.label ?? 'context'}:${item.id}`} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
