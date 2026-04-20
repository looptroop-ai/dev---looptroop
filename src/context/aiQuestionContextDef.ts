import { createContext } from 'react'

export interface AIQuestionContextValue {
  getPendingCount: (ticketId: string) => number
  openQueue: () => void
}

export const AIQuestionContext = createContext<AIQuestionContextValue>({
  getPendingCount: () => 0,
  openQueue: () => undefined,
})
