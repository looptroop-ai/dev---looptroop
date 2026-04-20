import { useContext } from 'react'
import { AIQuestionContext } from './aiQuestionContextDef'

export function useAIQuestions() {
  return useContext(AIQuestionContext)
}
