import { STATUS_ORDER, STATUS_TO_PHASE } from '@/lib/workflowMeta'

export function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
    case 'VERIFYING_INTERVIEW_COVERAGE':
    case 'CODING':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
    case 'WAITING_PR_REVIEW':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
    case 'PRE_FLIGHT_CHECK':
    case 'PREPARING_EXECUTION_ENV':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
    case 'RUNNING_FINAL_TEST':
      return 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300'
    case 'INTEGRATING_CHANGES':
    case 'CREATING_PULL_REQUEST':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
    case 'CLEANING_ENV':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300'
    case 'COMPLETED':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    case 'CANCELED':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    case 'BLOCKED_ERROR':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
}

export function getRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function getStatusProgress(status: string): number | null {
  if (status === 'BLOCKED_ERROR') return null
  if (STATUS_TO_PHASE[status] === 'todo' || STATUS_TO_PHASE[status] === 'done') return null
  const idx = STATUS_ORDER.indexOf(status)
  if (idx === -1) return null
  return Math.round(((idx + 1) / STATUS_ORDER.length) * 100)
}

export function getStatusRingColor(status: string): string {
  switch (status) {
    case 'COUNCIL_DELIBERATING':
    case 'COUNCIL_VOTING_INTERVIEW':
    case 'COMPILING_INTERVIEW':
    case 'VERIFYING_INTERVIEW_COVERAGE':
    case 'CODING':
      return 'text-blue-500'
    case 'WAITING_INTERVIEW_ANSWERS':
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
    case 'WAITING_PR_REVIEW':
      return 'text-yellow-500'
    case 'DRAFTING_PRD':
    case 'COUNCIL_VOTING_PRD':
    case 'REFINING_PRD':
    case 'VERIFYING_PRD_COVERAGE':
      return 'text-indigo-500'
    case 'DRAFTING_BEADS':
    case 'COUNCIL_VOTING_BEADS':
    case 'REFINING_BEADS':
    case 'VERIFYING_BEADS_COVERAGE':
      return 'text-purple-500'
    case 'PRE_FLIGHT_CHECK':
    case 'PREPARING_EXECUTION_ENV':
      return 'text-cyan-500'
    case 'RUNNING_FINAL_TEST':
      return 'text-teal-500'
    case 'INTEGRATING_CHANGES':
    case 'CREATING_PULL_REQUEST':
      return 'text-emerald-500'
    case 'CLEANING_ENV':
      return 'text-slate-500'
    default:
      return 'text-blue-500'
  }
}
