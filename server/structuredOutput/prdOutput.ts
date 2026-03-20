import { createHash } from 'node:crypto'
import type { PrdDocument, StructuredOutputResult } from './types'
import {
  isRecord,
  collectStructuredCandidates,
  unwrapExplicitWrapperRecord,
  parseYamlOrJsonCandidate,
  toStringArray,
  getValueByAliases,
  getNestedRecord,
  getRequiredString,
  buildYamlDocument,
} from './yamlUtils'

function hashContent(content: string | undefined): string {
  return createHash('sha256').update(content ?? '').digest('hex')
}

function normalizeVerification(record: Record<string, unknown>): { required_commands: string[] } {
  const verification = getNestedRecord(record, ['verification'])
  return {
    required_commands: toStringArray(getValueByAliases(verification, ['requiredcommands', 'required_commands', 'commands'])),
  }
}

function normalizeUserStory(value: unknown, index: number): PrdDocument['epics'][number]['user_stories'][number] {
  if (!isRecord(value)) throw new Error(`Epic user story at index ${index} is not an object`)

  return {
    id: getRequiredString(value, ['id', 'storyid'], `user story id at index ${index}`),
    title: getRequiredString(value, ['title', 'name'], `user story title at index ${index}`),
    acceptance_criteria: toStringArray(getValueByAliases(value, ['acceptancecriteria', 'acceptance_criteria'])),
    implementation_steps: toStringArray(getValueByAliases(value, ['implementationsteps', 'implementation_steps', 'steps'])),
    verification: normalizeVerification(value),
  }
}

function normalizeEpic(value: unknown, index: number): PrdDocument['epics'][number] {
  if (!isRecord(value)) throw new Error(`Epic at index ${index} is not an object`)
  const rawStories = getValueByAliases(value, ['userstories', 'user_stories', 'stories'])
  const userStories = Array.isArray(rawStories)
    ? rawStories.map((story, storyIndex) => normalizeUserStory(story, storyIndex))
    : []

  if (userStories.length === 0) {
    throw new Error(`Epic at index ${index} is missing user stories`)
  }

  return {
    id: getRequiredString(value, ['id', 'epicid'], `epic id at index ${index}`),
    title: getRequiredString(value, ['title', 'name'], `epic title at index ${index}`),
    objective: getRequiredString(value, ['objective', 'goal'], `epic objective at index ${index}`),
    implementation_steps: toStringArray(getValueByAliases(value, ['implementationsteps', 'implementation_steps', 'steps'])),
    user_stories: userStories,
  }
}

export function normalizePrdYamlOutput(
  rawContent: string,
  options: {
    ticketId: string
    interviewContent?: string
  },
): StructuredOutputResult<PrdDocument> {
  const repairWarnings: string[] = []
  const candidates = collectStructuredCandidates(rawContent, {
    topLevelHints: ['schema_version', 'artifact', 'product', 'scope', 'epics'],
  })
  let lastError = 'No PRD content found'

  for (const candidate of candidates) {
    try {
      const parsed = unwrapExplicitWrapperRecord(parseYamlOrJsonCandidate(candidate), [
        'prd',
        'document',
        'output',
        'result',
        'data',
      ])
      if (!isRecord(parsed)) throw new Error('PRD output is not a YAML/JSON object')

      const product = getNestedRecord(parsed, ['product'])
      const scope = getNestedRecord(parsed, ['scope'])
      const technicalRequirements = getNestedRecord(parsed, ['technicalrequirements', 'technical_requirements'])
      const sourceInterview = getNestedRecord(parsed, ['sourceinterview', 'source_interview'])
      const approval = getNestedRecord(parsed, ['approval'])
      const rawEpics = getValueByAliases(parsed, ['epics'])
      const epics = Array.isArray(rawEpics)
        ? rawEpics.map((epic, index) => normalizeEpic(epic, index))
        : []

      if (epics.length === 0) {
        throw new Error('PRD is missing epics')
      }

      const document: PrdDocument = {
        schema_version: Number(getValueByAliases(parsed, ['schemaversion', 'schema_version']) ?? 1),
        ticket_id: typeof getValueByAliases(parsed, ['ticketid', 'ticket_id']) === 'string'
          ? String(getValueByAliases(parsed, ['ticketid', 'ticket_id'])).trim()
          : options.ticketId,
        artifact: 'prd',
        status: typeof getValueByAliases(parsed, ['status']) === 'string'
          ? String(getValueByAliases(parsed, ['status'])).trim()
          : 'draft',
        source_interview: {
          content_sha256: typeof getValueByAliases(sourceInterview, ['contentsha256', 'content_sha256']) === 'string'
            ? String(getValueByAliases(sourceInterview, ['contentsha256', 'content_sha256'])).trim()
            : hashContent(options.interviewContent),
        },
        product: {
          problem_statement: getRequiredString(product, ['problemstatement', 'problem_statement'], 'product.problem_statement'),
          target_users: toStringArray(getValueByAliases(product, ['targetusers', 'target_users'])),
        },
        scope: {
          in_scope: toStringArray(getValueByAliases(scope, ['inscope', 'in_scope'])),
          out_of_scope: toStringArray(getValueByAliases(scope, ['outofscope', 'out_of_scope'])),
        },
        technical_requirements: {
          architecture_constraints: toStringArray(getValueByAliases(technicalRequirements, ['architectureconstraints', 'architecture_constraints'])),
          data_model: toStringArray(getValueByAliases(technicalRequirements, ['datamodel', 'data_model'])),
          api_contracts: toStringArray(getValueByAliases(technicalRequirements, ['apicontracts', 'api_contracts'])),
          security_constraints: toStringArray(getValueByAliases(technicalRequirements, ['securityconstraints', 'security_constraints'])),
          performance_constraints: toStringArray(getValueByAliases(technicalRequirements, ['performanceconstraints', 'performance_constraints'])),
          reliability_constraints: toStringArray(getValueByAliases(technicalRequirements, ['reliabilityconstraints', 'reliability_constraints'])),
          error_handling_rules: toStringArray(getValueByAliases(technicalRequirements, ['errorhandlingrules', 'error_handling_rules'])),
          tooling_assumptions: toStringArray(getValueByAliases(technicalRequirements, ['toolingassumptions', 'tooling_assumptions'])),
        },
        epics,
        risks: toStringArray(getValueByAliases(parsed, ['risks'])),
        approval: {
          approved_by: typeof getValueByAliases(approval, ['approvedby', 'approved_by']) === 'string'
            ? String(getValueByAliases(approval, ['approvedby', 'approved_by'])).trim()
            : '',
          approved_at: typeof getValueByAliases(approval, ['approvedat', 'approved_at']) === 'string'
            ? String(getValueByAliases(approval, ['approvedat', 'approved_at'])).trim()
            : '',
        },
      }

      if (!document.ticket_id) {
        document.ticket_id = options.ticketId
        repairWarnings.push('Filled missing ticket_id from runtime context.')
      }

      return {
        ok: true,
        value: document,
        normalizedContent: buildYamlDocument(document),
        repairApplied: candidate !== rawContent.trim() || repairWarnings.length > 0,
        repairWarnings,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: false,
    error: lastError,
    repairApplied: false,
    repairWarnings: [],
  }
}
