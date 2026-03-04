import type { TicketContext } from './types'

export const guards = {
  hasReachedMaxIterations: ({ context }: { context: TicketContext }) => {
    return context.iterationCount >= context.maxIterations
  },
  isPreFlightPassing: (_: { context: TicketContext }) => {
    return true // Stub — will check actual pre-flight results
  },
  allBeadsComplete: ({ context }: { context: TicketContext }) => {
    return (
      context.beadProgress.completed >= context.beadProgress.total &&
      context.beadProgress.total > 0
    )
  },
  hasError: ({ context }: { context: TicketContext }) => {
    return context.error !== null
  },
}
