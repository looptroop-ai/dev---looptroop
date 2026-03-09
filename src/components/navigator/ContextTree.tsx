import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  codebase_map: {
    id: 'codebase_map',
    label: 'Codebase Map',
    icon: '🗺️',
    description: 'Generated codebase map and structural context.',
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
    label: 'Beads Graph',
    icon: '🔗',
    description: 'Bead tasks, dependencies, and status graph.',
  },
  beads_draft: {
    id: 'beads_draft',
    label: 'Refined Beads Draft',
    icon: '🧩',
    description: 'Refined beads draft before expansion.',
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

const STATUS_ALLOWED_CONTEXT: Record<string, string[]> = {
  DRAFT: ['ticket_details'],
  COUNCIL_DELIBERATING: ['codebase_map', 'ticket_details'],
  COUNCIL_VOTING_INTERVIEW: ['codebase_map', 'ticket_details', 'drafts'],
  COMPILING_INTERVIEW: ['codebase_map', 'ticket_details', 'drafts'],
  WAITING_INTERVIEW_ANSWERS: ['codebase_map', 'ticket_details', 'interview', 'user_answers'],
  VERIFYING_INTERVIEW_COVERAGE: ['ticket_details', 'user_answers', 'interview'],
  WAITING_INTERVIEW_APPROVAL: ['interview', 'user_answers'],
  DRAFTING_PRD: ['codebase_map', 'ticket_details', 'interview'],
  COUNCIL_VOTING_PRD: ['codebase_map', 'ticket_details', 'interview', 'drafts'],
  REFINING_PRD: ['codebase_map', 'ticket_details', 'interview', 'drafts'],
  VERIFYING_PRD_COVERAGE: ['interview', 'prd'],
  WAITING_PRD_APPROVAL: ['prd', 'interview'],
  DRAFTING_BEADS: ['codebase_map', 'ticket_details', 'prd'],
  COUNCIL_VOTING_BEADS: ['codebase_map', 'ticket_details', 'prd', 'drafts'],
  REFINING_BEADS: ['codebase_map', 'ticket_details', 'prd', 'drafts'],
  VERIFYING_BEADS_COVERAGE: ['prd', 'beads', 'tests'],
  WAITING_BEADS_APPROVAL: ['beads', 'prd'],
  PRE_FLIGHT_CHECK: ['codebase_map', 'ticket_details'],
  CODING: ['bead_data', 'bead_notes'],
  RUNNING_FINAL_TEST: ['ticket_details', 'interview', 'prd', 'beads'],
  INTEGRATING_CHANGES: ['ticket_details', 'prd', 'beads', 'tests'],
  WAITING_MANUAL_VERIFICATION: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  CLEANING_ENV: ['ticket_details', 'beads'],
  COMPLETED: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  CANCELED: ['ticket_details'],
  BLOCKED_ERROR: ['bead_data', 'error_context'],
}

function getAllowedContextItems(phase: string): ContextItem[] {
  const keys = STATUS_ALLOWED_CONTEXT[phase] ?? ['ticket_details']
  return keys
    .map(key => CONTEXT_LABELS[key])
    .filter((item): item is ContextItem => Boolean(item))
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
  const [collapsed, setCollapsed] = useState(true)
  const items = getAllowedContextItems(selectedPhase)

  return (
    <div className="p-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5 hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', !collapsed && 'rotate-90')} />
        Allowed Context
        <span className="ml-auto text-[10px] font-normal normal-case">{items.length}</span>
      </button>
      {!collapsed && (
        <ScrollArea className="max-h-[250px]">
          <div className="space-y-0.5">
            {items.map(item => (
              <ContextRow key={item.id} item={item} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
