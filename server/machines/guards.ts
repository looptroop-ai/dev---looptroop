import type { TicketContext } from './types'

export const guards = {
  hasReachedMaxIterations: ({ context }: { context: TicketContext }) => {
    return context.maxIterations > 0 && context.iterationCount >= context.maxIterations
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
