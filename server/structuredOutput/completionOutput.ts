import type { BeadChecks } from '../phases/execution/completionSchema'
import { looksLikePromptEcho } from '../lib/promptEcho'
import type { BeadCompletionPayload, FinalTestCommandPayload, StructuredOutputResult } from './types'
import {
  isRecord,
  normalizeKey,
  collectTaggedCandidates,
  maybeUnwrapRecord,
  unwrapExplicitWrapperRecord,
  parseYamlOrJsonCandidate,
  toStringArray,
  toOptionalString,
  getValueByAliases,
  getRequiredString,
} from './yamlUtils'

const COMPLETION_NESTED_MAPPING_CHILDREN = {
  checks: ['tests', 'lint', 'typecheck', 'qualitative'],
} as const

function normalizeCompletionStatus(value: unknown): 'done' | 'error' {
  const raw = getRequiredString({ status: value }, ['status'], 'status')
  const normalized = normalizeKey(raw)
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(normalized)) {
    return 'done'
  }
  if (['failed', 'fail', 'error'].includes(normalized)) {
    return 'error'
  }
  throw new Error(`Invalid completion status: ${raw}`)
}

function normalizeCompletionCheckValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'pass' : 'fail'
  if (typeof value === 'number') {
    if (value === 1) return 'pass'
    if (value === 0) return 'fail'
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Completion marker check value must be a non-empty string')
  }

  const normalized = normalizeKey(value)
  if (['pass', 'passed', 'ok', 'success', 'true', 'complete', 'completed'].includes(normalized)) {
    return 'pass'
  }
  if (['fail', 'failed', 'false', 'error', 'timeout', 'timedout', 'notrun', 'skipped', 'pending'].includes(normalized)) {
    return 'fail'
  }
  return value.trim().toLowerCase()
}

function normalizeCompletionChecks(value: unknown): BeadChecks {
  if (!isRecord(value)) throw new Error('Completion marker missing checks object')

  const tests = getValueByAliases(value, ['tests', 'test'])
  const lint = getValueByAliases(value, ['lint', 'linter'])
  const typecheck = getValueByAliases(value, ['typecheck', 'type_check', 'type-check', 'typechecks', 'typescript'])
  const qualitative = getValueByAliases(value, ['qualitative', 'quality', 'qualitativereview', 'qualitative_review', 'review'])

  if (tests === undefined) throw new Error('Missing quality gate: tests')
  if (lint === undefined) throw new Error('Missing quality gate: lint')
  if (typecheck === undefined) throw new Error('Missing quality gate: typecheck')
  if (qualitative === undefined) throw new Error('Missing quality gate: qualitative')

  return {
    tests: normalizeCompletionCheckValue(tests),
    lint: normalizeCompletionCheckValue(lint),
    typecheck: normalizeCompletionCheckValue(typecheck),
    qualitative: normalizeCompletionCheckValue(qualitative),
  }
}

export function normalizeBeadCompletionMarkerOutput(rawContent: string): StructuredOutputResult<BeadCompletionPayload> {
  const repairWarnings: string[] = []
  const rawTrimmed = rawContent.trim()
  const candidates = collectTaggedCandidates(rawContent, 'BEAD_STATUS')
  let lastError = 'No completion marker found'

  if (candidates.length === 0) {
    return {
      ok: false,
      error: looksLikePromptEcho(rawContent)
        ? 'Completion marker output echoed the prompt instead of returning a <BEAD_STATUS> artifact'
        : lastError,
      repairApplied: false,
      repairWarnings,
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = maybeUnwrapRecord(parseYamlOrJsonCandidate(candidate, {
        nestedMappingChildren: COMPLETION_NESTED_MAPPING_CHILDREN,
      }), [
        'beadstatus',
        'bead_status',
        'statusmarker',
        'marker',
        'result',
        'output',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('Completion marker payload is not a YAML/JSON object')

      const beadId = getRequiredString(parsed, ['beadid', 'bead_id', 'id'], 'bead_id')
      const status = normalizeCompletionStatus(getValueByAliases(parsed, ['status']))
      const checks = normalizeCompletionChecks(getValueByAliases(parsed, ['checks', 'gates', 'qualitygates', 'quality_gates']))
      const reason = toOptionalString(getValueByAliases(parsed, ['reason', 'details', 'message']))

      return {
        ok: true,
        value: {
          beadId,
          status,
          checks,
          ...(reason ? { reason } : {}),
        },
        normalizedContent: JSON.stringify({
          bead_id: beadId,
          status,
          checks,
          ...(reason ? { reason } : {}),
        }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: looksLikePromptEcho(rawContent)
      ? 'Completion marker output echoed the prompt instead of returning a <BEAD_STATUS> artifact'
      : lastError,
    repairApplied: false,
    repairWarnings,
  }
}

export function normalizeFinalTestCommandsOutput(rawContent: string): StructuredOutputResult<FinalTestCommandPayload> {
  const repairWarnings: string[] = []
  const rawTrimmed = rawContent.trim()
  const candidates = collectTaggedCandidates(rawContent, 'FINAL_TEST_COMMANDS')
  let lastError = 'No final test command marker found'

  if (candidates.length === 0) {
    return {
      ok: false,
      error: looksLikePromptEcho(rawContent)
        ? 'Final test command output echoed the prompt instead of returning a <FINAL_TEST_COMMANDS> artifact'
        : lastError,
      repairApplied: false,
      repairWarnings,
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'finaltestcommands',
        'final_test_commands',
        'commandplan',
        'command_plan',
        'plan',
        'result',
        'output',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('Final test command payload is not a YAML/JSON object')

      const commands = toStringArray(getValueByAliases(parsed, ['commands', 'commandlist', 'command_list', 'cmds', 'cmd']))
      if (commands.length === 0) {
        throw new Error('No executable final test commands were provided')
      }

      const summary = toOptionalString(getValueByAliases(parsed, ['summary', 'reason', 'notes'])) ?? null

      return {
        ok: true,
        value: {
          commands,
          summary,
        },
        normalizedContent: JSON.stringify(summary
          ? { commands, summary }
          : { commands }),
        repairApplied: candidate !== rawTrimmed,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: looksLikePromptEcho(rawContent)
      ? 'Final test command output echoed the prompt instead of returning a <FINAL_TEST_COMMANDS> artifact'
      : lastError,
    repairApplied: false,
    repairWarnings,
  }
}
