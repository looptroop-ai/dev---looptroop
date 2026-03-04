export interface PRDEpic {
  id: string
  title: string
  description: string
  userStories: PRDUserStory[]
}

export interface PRDUserStory {
  id: string
  epicId: string
  title: string
  description: string
  acceptanceCriteria: string[]
  implementationNotes: string
}

export interface PRD {
  overview: string
  epics: PRDEpic[]
  constraints: string[]
  assumptions: string[]
  outOfScope: string[]
}
