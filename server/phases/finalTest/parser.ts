import { normalizeFinalTestCommandsOutput } from '../../structuredOutput'
import type { StructuredRetryDiagnostic } from '@shared/structuredRetryDiagnostics'
import { unwrapTaggedStructuredOutput } from '../parserTaggedStructuredOutput'

export const FINAL_TEST_COMMANDS_MARKER = '<FINAL_TEST_COMMANDS>'
export const FINAL_TEST_COMMANDS_END = '</FINAL_TEST_COMMANDS>'

export interface FinalTestCommandPlan {
  markerFound: boolean
  commands: string[]
  summary: string | null
  testFiles: string[]
  modifiedFiles: string[]
  testsCount: number | null
  errors: string[]
  repairApplied?: boolean
  repairWarnings?: string[]
  validationError?: string
  retryDiagnostic?: StructuredRetryDiagnostic
}

export function parseFinalTestCommands(output: string): FinalTestCommandPlan {
  const parsed = unwrapTaggedStructuredOutput(
    output,
    normalizeFinalTestCommandsOutput(output),
    { missingMarkerError: 'No final test command marker found' },
  )

  if (!parsed.ok) {
    return {
      markerFound: parsed.markerFound,
      commands: [],
      summary: null,
      testFiles: [],
      modifiedFiles: [],
      testsCount: null,
      errors: parsed.errors,
      repairApplied: parsed.repairApplied,
      repairWarnings: parsed.repairWarnings,
      validationError: parsed.validationError,
      retryDiagnostic: parsed.retryDiagnostic,
    }
  }

  return {
    markerFound: parsed.markerFound,
    commands: parsed.value.commands,
    summary: parsed.value.summary,
    testFiles: parsed.value.testFiles,
    modifiedFiles: parsed.value.modifiedFiles,
    testsCount: parsed.value.testsCount,
    errors: [],
    repairApplied: parsed.repairApplied,
    repairWarnings: parsed.repairWarnings,
  }
}
