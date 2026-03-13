import { normalizeFinalTestCommandsOutput } from '../../structuredOutput'

export const FINAL_TEST_COMMANDS_MARKER = '<FINAL_TEST_COMMANDS>'
export const FINAL_TEST_COMMANDS_END = '</FINAL_TEST_COMMANDS>'

export interface FinalTestCommandPlan {
  markerFound: boolean
  commands: string[]
  summary: string | null
  errors: string[]
  repairApplied?: boolean
  repairWarnings?: string[]
  validationError?: string
}

export function parseFinalTestCommands(output: string): FinalTestCommandPlan {
  const normalized = normalizeFinalTestCommandsOutput(output)
  if (!normalized.ok) {
    return {
      markerFound: normalized.error !== 'No final test command marker found',
      commands: [],
      summary: null,
      errors: [normalized.error],
      repairApplied: normalized.repairApplied,
      repairWarnings: normalized.repairWarnings,
      validationError: normalized.error,
    }
  }

  return {
    markerFound: true,
    commands: normalized.value.commands,
    summary: normalized.value.summary,
    errors: [],
    repairApplied: normalized.repairApplied,
    repairWarnings: normalized.repairWarnings,
  }
}
