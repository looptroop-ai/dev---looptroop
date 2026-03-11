export const FINAL_TEST_COMMANDS_MARKER = '<FINAL_TEST_COMMANDS>'
export const FINAL_TEST_COMMANDS_END = '</FINAL_TEST_COMMANDS>'

export interface FinalTestCommandPlan {
  markerFound: boolean
  commands: string[]
  summary: string | null
  errors: string[]
}

export function parseFinalTestCommands(output: string): FinalTestCommandPlan {
  const markerStart = output.lastIndexOf(FINAL_TEST_COMMANDS_MARKER)
  const markerEnd = output.lastIndexOf(FINAL_TEST_COMMANDS_END)

  if (markerStart === -1 || markerEnd === -1 || markerEnd < markerStart) {
    return {
      markerFound: false,
      commands: [],
      summary: null,
      errors: ['No final test command marker found'],
    }
  }

  const markerContent = output
    .slice(markerStart + FINAL_TEST_COMMANDS_MARKER.length, markerEnd)
    .trim()

  try {
    const parsed = JSON.parse(markerContent) as {
      commands?: unknown
      summary?: unknown
    }

    const commands = Array.isArray(parsed.commands)
      ? parsed.commands.filter((command): command is string => typeof command === 'string' && command.trim().length > 0)
      : []
    const errors = commands.length === 0
      ? ['No executable final test commands were provided']
      : []

    return {
      markerFound: true,
      commands,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      errors,
    }
  } catch {
    return {
      markerFound: true,
      commands: [],
      summary: null,
      errors: ['Invalid JSON in final test command marker'],
    }
  }
}
