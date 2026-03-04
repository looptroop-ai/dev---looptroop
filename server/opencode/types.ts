export interface Session {
  id: string
  slug?: string
  projectPath?: string
  createdAt?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface PromptPart {
  type: 'text' | 'system'
  content: string
}

export interface StreamEvent {
  type: 'text_delta' | 'message_complete' | 'error' | 'done'
  data: string
}

export interface HealthStatus {
  available: boolean
  version?: string
  models?: string[]
  error?: string
}
