import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContextTreeProps {
  selectedPhase: string
  ticketId: number
}

interface TreeItem {
  id: string
  label: string
  icon: React.ReactNode
  children?: TreeItem[]
}

function getContextItems(phase: string): TreeItem[] {
  switch (phase) {
    case 'DRAFT':
      return [
        { id: 'meta', label: 'Ticket Metadata', icon: <span className="text-sm leading-none">📋</span> },
      ]
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
      return [
        { id: 'council', label: 'Council Activity', icon: <span className="text-sm leading-none">🤖</span>,
          children: [
            { id: 'drafts', label: 'Competing Drafts', icon: <span className="text-xs leading-none">📝</span> },
          ],
        },
      ]
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'VERIFYING_INTERVIEW_COVERAGE':
      return [
        { id: 'interview', label: 'Interview Q&A', icon: <span className="text-sm leading-none">💬</span>,
          children: [
            { id: 'questions', label: 'Questions', icon: <span className="text-xs leading-none">❓</span> },
            { id: 'answers', label: 'Answers', icon: <span className="text-xs leading-none">💬</span> },
          ],
        },
      ]
    case 'WAITING_INTERVIEW_APPROVAL':
      return [
        { id: 'interview-results', label: 'Interview Results', icon: <span className="text-sm leading-none">📋</span> },
      ]
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return [
        { id: 'prd-council', label: 'PRD Council', icon: <span className="text-sm leading-none">🤖</span>,
          children: [
            { id: 'drafts', label: 'Competing Drafts', icon: <span className="text-xs leading-none">📝</span> },
            { id: 'votes', label: 'Vote Results', icon: <span className="text-xs leading-none">🗳️</span> },
            { id: 'refinement', label: 'Refinement Notes', icon: <span className="text-xs leading-none">✏️</span> },
          ],
        },
      ]
    case 'WAITING_PRD_APPROVAL':
      return [
        { id: 'prd', label: 'PRD Document', icon: <span className="text-sm leading-none">📄</span>,
          children: [
            { id: 'epics', label: 'Epics & Stories', icon: <span className="text-xs leading-none">📋</span> },
          ],
        },
      ]
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return [
        { id: 'beads-council', label: 'Beads Council', icon: <span className="text-sm leading-none">🤖</span>,
          children: [
            { id: 'drafts', label: 'Competing Drafts', icon: <span className="text-xs leading-none">📝</span> },
            { id: 'votes', label: 'Vote Results', icon: <span className="text-xs leading-none">🗳️</span> },
            { id: 'refinement', label: 'Refinement Notes', icon: <span className="text-xs leading-none">✏️</span> },
          ],
        },
      ]
    case 'WAITING_BEADS_APPROVAL':
      return [
        { id: 'beads', label: 'Task Breakdown', icon: <span className="text-sm leading-none">🔗</span>,
          children: [
            { id: 'bead-list', label: 'Beads List', icon: <span className="text-xs leading-none">📋</span> },
          ],
        },
      ]
    case 'PRE_FLIGHT_CHECK':
    case 'CODING':
    case 'RUNNING_FINAL_TEST':
    case 'INTEGRATING_CHANGES':
    case 'CLEANING_ENV':
      return [
        { id: 'beads-nav', label: 'Bead Navigator', icon: <span className="text-sm leading-none">🔗</span>,
          children: [
            { id: 'active-bead', label: 'Active Bead', icon: <span className="text-xs leading-none">⚡</span> },
            { id: 'completed', label: 'Completed', icon: <span className="text-xs leading-none">✅</span> },
            { id: 'pending', label: 'Pending', icon: <span className="text-xs leading-none">⏳</span> },
          ],
        },
      ]
    case 'WAITING_MANUAL_VERIFICATION':
      return [
        { id: 'beads-nav', label: 'Bead Navigator', icon: <span className="text-sm leading-none">🔗</span>,
          children: [
            { id: 'active-bead', label: 'Active Bead', icon: <span className="text-xs leading-none">⚡</span> },
            { id: 'completed', label: 'Completed', icon: <span className="text-xs leading-none">✅</span> },
            { id: 'pending', label: 'Pending', icon: <span className="text-xs leading-none">⏳</span> },
          ],
        },
        { id: 'test-results', label: 'Test Results', icon: <span className="text-sm leading-none">🧪</span> },
      ]
    case 'COMPLETED':
    case 'CANCELED':
      return [
        { id: 'summary', label: 'Lifecycle Summary', icon: <span className="text-sm leading-none">📊</span>,
          children: [
            { id: 'phases', label: 'All Phases', icon: <span className="text-xs leading-none">📋</span> },
            { id: 'beads', label: 'Beads', icon: <span className="text-xs leading-none">🔗</span> },
          ],
        },
      ]
    case 'BLOCKED_ERROR':
      return [
        { id: 'error', label: 'Error Context', icon: <span className="text-sm leading-none">❌</span> },
        { id: 'phase-context', label: 'Phase Context', icon: <span className="text-sm leading-none">📋</span> },
      ]
    default:
      return [
        { id: 'meta', label: 'Ticket Metadata', icon: <span className="text-sm leading-none">📋</span> },
      ]
  }
}

function TreeNode({ item, depth = 0 }: { item: TreeItem; depth?: number }) {
  return (
    <>
      <button
        className={cn(
          'w-full flex items-center gap-1.5 py-1 rounded-md text-xs hover:bg-accent transition-colors text-left',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {item.children && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
        <span>{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </button>
      {item.children?.map(child => (
        <TreeNode key={child.id} item={child} depth={depth + 1} />
      ))}
    </>
  )
}

export function ContextTree({ selectedPhase }: ContextTreeProps) {
  const items = getContextItems(selectedPhase)

  return (
    <div className="p-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
        Context
      </h4>
      <ScrollArea className="max-h-[250px]">
        <div className="space-y-0">
          {items.map(item => (
            <TreeNode key={item.id} item={item} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
