import type { TicketContext } from './types'

export const guards = {
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
