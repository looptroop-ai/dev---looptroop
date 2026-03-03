export interface Bead {
  // Subset fields (draft phase)
  id: string
  title: string
  prdRefs: string[]
  description: string
  contextGuidance: string
  acceptanceCriteria: string[]
  tests: string[]
  testCommands: string[]

  // Expanded fields (expansion phase)
  priority: number
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  labels: string[]
  dependencies: string[]
  targetFiles: string[]
  notes: string[]
  iteration: number
  createdAt: string
  updatedAt: string
  beadStartCommit: string | null
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex'
  epicId: string
  storyId: string
}

export type BeadSubset = Pick<Bead, 'id' | 'title' | 'prdRefs' | 'description' | 'contextGuidance' | 'acceptanceCriteria' | 'tests' | 'testCommands'>
