import type { TicketContext } from './types'

export const guards = {
  hasReachedMaxIterations: ({ context }: { context: TicketContext }) => {
    return context.maxIterations > 0 && context.iterationCount >= context.maxIterations
  },
  // TODO: Stub — always returns true. When implemented, this should inspect
  // context.preFlightResult (or equivalent) to verify that all pre-flight
  // checks (e.g. environment validation, dependency availability, branch
  // cleanliness) actually passed before allowing the machine to proceed.
  isPreFlightPassing: (_: { context: TicketContext }) => {
    return true
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
