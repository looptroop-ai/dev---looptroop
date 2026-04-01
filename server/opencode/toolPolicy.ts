import type { PromptSessionOptions } from './types'

export type OpenCodeToolPolicy = 'default' | 'disabled'

export const OPENCODE_DISABLED_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({
  '*': false,
  bash: false,
  codesearch: false,
  doom_loop: false,
  edit: false,
  external_directory: false,
  glob: false,
  grep: false,
  list: false,
  lsp: false,
  question: false,
  read: false,
  skill: false,
  task: false,
  todoread: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
  write: false,
})

export function resolveOpenCodeTools(
  toolPolicy: OpenCodeToolPolicy = 'default',
): PromptSessionOptions['tools'] | undefined {
  return toolPolicy === 'disabled' ? OPENCODE_DISABLED_TOOLS : undefined
}
