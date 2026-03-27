import jsYaml from 'js-yaml'
import type {
  InterviewQuestionChangeAttributionStatus,
  ParsedInterviewQuestion,
} from './interviewQuestions'
import { extractInterviewQuestionPreviews } from './interviewQuestions'
import type { RefinementChangeAttributionStatus } from './refinementChanges'

export type UiRefinementDiffDomain = 'interview' | 'prd' | 'beads'
export type UiRefinementDiffChangeType = 'modified' | 'replaced' | 'added' | 'removed'
export type UiRefinementDiffAttributionStatus =
  | InterviewQuestionChangeAttributionStatus
  | RefinementChangeAttributionStatus

export interface UiRefinementDiffInspiration {
  memberId: string
  sourceId?: string
  sourceLabel: string
  sourceText?: string
}

export interface UiRefinementDiffEntry {
  key: string
  changeType: UiRefinementDiffChangeType
  itemKind: string
  label: string
  beforeId?: string
  afterId?: string
  beforeText?: string
  afterText?: string
  inspiration: UiRefinementDiffInspiration | null
  attributionStatus: UiRefinementDiffAttributionStatus
}

export interface UiRefinementDiffArtifact {
  domain: UiRefinementDiffDomain
  winnerId: string
  generatedAt: string
  entries: UiRefinementDiffEntry[]
}

interface DiffCandidateBlock {
  key: string
  itemKind: string
  label: string
  id?: string
  text: string
}

interface ParsedPrdUserStory {
  id?: string
  title?: string
  acceptance_criteria?: string[]
  implementation_steps?: string[]
  verification?: {
    required_commands?: string[]
  }
}

interface ParsedPrdEpic {
  id?: string
  title?: string
  objective?: string
  implementation_steps?: string[]
  user_stories?: ParsedPrdUserStory[]
}

interface ParsedPrdDocument {
  product?: {
    problem_statement?: string
    target_users?: string[]
  }
  scope?: {
    in_scope?: string[]
    out_of_scope?: string[]
  }
  technical_requirements?: {
    architecture_constraints?: string[]
    data_model?: string[]
    api_contracts?: string[]
    security_constraints?: string[]
    performance_constraints?: string[]
    reliability_constraints?: string[]
    error_handling_rules?: string[]
    tooling_assumptions?: string[]
  }
  epics?: ParsedPrdEpic[]
  risks?: string[]
}

interface ParsedBeadSubset {
  id?: string
  title?: string
  prdRefs?: string[]
  description?: string
  contextGuidance?: string
  acceptanceCriteria?: string[]
  tests?: string[]
  testCommands?: string[]
}

interface DiffSourceCandidate {
  memberId: string
  itemKind: string
  label: string
  id?: string
  text: string
}

const QUESTION_ID_FALLBACK_PREFIX = 'Q'
const PRD_TECHNICAL_SECTION_CONFIG: Array<{
  key: keyof NonNullable<ParsedPrdDocument['technical_requirements']>
  itemKind: string
  label: string
}> = [
  { key: 'architecture_constraints', itemKind: 'technical_requirements.architecture_constraints', label: 'Architecture Constraints' },
  { key: 'data_model', itemKind: 'technical_requirements.data_model', label: 'Data Model' },
  { key: 'api_contracts', itemKind: 'technical_requirements.api_contracts', label: 'API Contracts' },
  { key: 'security_constraints', itemKind: 'technical_requirements.security_constraints', label: 'Security Constraints' },
  { key: 'performance_constraints', itemKind: 'technical_requirements.performance_constraints', label: 'Performance Constraints' },
  { key: 'reliability_constraints', itemKind: 'technical_requirements.reliability_constraints', label: 'Reliability Constraints' },
  { key: 'error_handling_rules', itemKind: 'technical_requirements.error_handling_rules', label: 'Error Handling Rules' },
  { key: 'tooling_assumptions', itemKind: 'technical_requirements.tooling_assumptions', label: 'Tooling Assumptions' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readYamlRecord<T>(content: string): T | null {
  try {
    const parsed = jsYaml.load(content)
    return isRecord(parsed) ? parsed as T : null
  } catch {
    return null
  }
}

function readYamlArray<T>(content: string): T[] | null {
  try {
    const parsed = jsYaml.load(content)
    return Array.isArray(parsed)
      ? parsed as T[]
      : isRecord(parsed) && Array.isArray(parsed.beads)
        ? parsed.beads as T[]
        : null
  } catch {
    return null
  }
}

function normalizeStringArray(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
}

function renderList(values: string[] | undefined): string {
  const normalized = normalizeStringArray(values)
  return normalized.map((value) => `- ${value}`).join('\n').trim()
}

function renderNamedSection(label: string, body: string): string {
  const trimmed = body.trim()
  return trimmed ? `${label}:\n${trimmed}` : ''
}

function uniqueByKey<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const value of values) {
    const key = getKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(value)
  }
  return deduped
}

function buildSourceCandidates(
  drafts: Array<{ memberId: string; content: string }>,
  buildBlocks: (content: string) => DiffCandidateBlock[],
): DiffSourceCandidate[] {
  return drafts.flatMap((draft) =>
    buildBlocks(draft.content).map((block) => ({
      memberId: draft.memberId,
      itemKind: block.itemKind,
      label: block.label,
      id: block.id,
      text: block.text,
    })),
  )
}

function findDeterministicInspiration(
  target: { itemKind: string; text?: string | null },
  candidates: DiffSourceCandidate[],
): UiRefinementDiffInspiration | null {
  const text = target.text?.trim()
  if (!text) return null

  const matches = uniqueByKey(
    candidates.filter((candidate) => candidate.itemKind === target.itemKind && candidate.text.trim() === text),
    (candidate) => `${candidate.memberId}\u241f${candidate.itemKind}\u241f${candidate.id ?? ''}\u241f${candidate.text}`,
  )

  if (matches.length !== 1) return null

  const match = matches[0]!
  return {
    memberId: match.memberId,
    ...(match.id ? { sourceId: match.id } : {}),
    sourceLabel: match.label,
    sourceText: match.text,
  }
}

function buildDiffEntry(
  params: {
    key: string
    changeType: UiRefinementDiffChangeType
    itemKind: string
    label: string
    beforeId?: string
    afterId?: string
    beforeText?: string
    afterText?: string
  },
  sourceCandidates: DiffSourceCandidate[],
): UiRefinementDiffEntry {
  const inspiration = params.changeType === 'removed'
    ? null
    : findDeterministicInspiration(
        {
          itemKind: params.itemKind,
          text: params.afterText ?? null,
        },
        sourceCandidates,
      )

  return {
    ...params,
    inspiration,
    attributionStatus: inspiration ? 'inspired' : 'model_unattributed',
  }
}

function normalizeInterviewQuestions(content: string): ParsedInterviewQuestion[] {
  return extractInterviewQuestionPreviews(content)
    .map((question, index) => ({
      id: question.id?.trim() || `${QUESTION_ID_FALLBACK_PREFIX}${String(index + 1).padStart(2, '0')}`,
      phase: question.phase?.trim() || '',
      question: question.question.trim(),
    }))
    .filter((question) => question.question.length > 0)
}

function buildInterviewQuestionBlocks(content: string): DiffCandidateBlock[] {
  return normalizeInterviewQuestions(content).map((question) => ({
    key: `question:${question.id}`,
    itemKind: 'question',
    label: question.id,
    id: question.id,
    text: [question.phase ? `Phase: ${question.phase}` : '', question.question].filter(Boolean).join('\n'),
  }))
}

export function buildInterviewUiRefinementDiffArtifact(params: {
  winnerId: string
  winnerDraftContent: string
  refinedContent: string
  losingDrafts?: Array<{ memberId: string; content: string }>
  generatedAt?: string
}): UiRefinementDiffArtifact {
  const winnerQuestions = normalizeInterviewQuestions(params.winnerDraftContent)
  const refinedQuestions = normalizeInterviewQuestions(params.refinedContent)
  const losingDrafts = params.losingDrafts ?? []
  const sourceCandidates = buildSourceCandidates(losingDrafts, buildInterviewQuestionBlocks)

  const winnerById = new Map(winnerQuestions.map((question) => [question.id, question] as const))
  const consumedWinnerIds = new Set<string>()
  const consumedRefinedIds = new Set<string>()
  const entries: UiRefinementDiffEntry[] = []

  for (const refinedQuestion of refinedQuestions) {
    const winnerQuestion = winnerById.get(refinedQuestion.id)
    if (!winnerQuestion) continue
    consumedWinnerIds.add(winnerQuestion.id)
    consumedRefinedIds.add(refinedQuestion.id)

    if (
      winnerQuestion.question === refinedQuestion.question
      && (winnerQuestion.phase || '') === (refinedQuestion.phase || '')
    ) {
      continue
    }

    entries.push(
      buildDiffEntry(
        {
          key: `question:${refinedQuestion.id}:modified`,
          changeType: 'modified',
          itemKind: 'question',
          label: refinedQuestion.id,
          beforeId: winnerQuestion.id,
          afterId: refinedQuestion.id,
          beforeText: winnerQuestion.question,
          afterText: refinedQuestion.question,
        },
        sourceCandidates,
      ),
    )
  }

  const unmatchedWinner = winnerQuestions.filter((question) => !consumedWinnerIds.has(question.id))
  const unmatchedRefined = refinedQuestions.filter((question) => !consumedRefinedIds.has(question.id))
  const replacementCount = Math.min(unmatchedWinner.length, unmatchedRefined.length)

  for (let index = 0; index < replacementCount; index += 1) {
    const before = unmatchedWinner[index]!
    const after = unmatchedRefined[index]!
    entries.push(
      buildDiffEntry(
        {
          key: `question:${before.id}->${after.id}:replaced:${index}`,
          changeType: 'replaced',
          itemKind: 'question',
          label: after.id,
          beforeId: before.id,
          afterId: after.id,
          beforeText: before.question,
          afterText: after.question,
        },
        sourceCandidates,
      ),
    )
  }

  for (const [index, question] of unmatchedRefined.slice(replacementCount).entries()) {
    entries.push(
      buildDiffEntry(
        {
          key: `question:${question.id}:added:${index}`,
          changeType: 'added',
          itemKind: 'question',
          label: question.id,
          afterId: question.id,
          afterText: question.question,
        },
        sourceCandidates,
      ),
    )
  }

  for (const [index, question] of unmatchedWinner.slice(replacementCount).entries()) {
    entries.push(
      buildDiffEntry(
        {
          key: `question:${question.id}:removed:${index}`,
          changeType: 'removed',
          itemKind: 'question',
          label: question.id,
          beforeId: question.id,
          beforeText: question.question,
        },
        sourceCandidates,
      ),
    )
  }

  return {
    domain: 'interview',
    winnerId: params.winnerId.trim(),
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    entries,
  }
}

function parsePrdDocument(content: string): ParsedPrdDocument | null {
  return readYamlRecord<ParsedPrdDocument>(content)
}

function buildPrdBlocks(content: string): DiffCandidateBlock[] {
  const document = parsePrdDocument(content)
  if (!document) return []

  const blocks: DiffCandidateBlock[] = []

  if (typeof document.product?.problem_statement === 'string' && document.product.problem_statement.trim()) {
    blocks.push({
      key: 'product.problem_statement',
      itemKind: 'product.problem_statement',
      label: 'Problem Statement',
      text: document.product.problem_statement.trim(),
    })
  }

  if (normalizeStringArray(document.product?.target_users).length > 0) {
    blocks.push({
      key: 'product.target_users',
      itemKind: 'product.target_users',
      label: 'Target Users',
      text: renderList(document.product?.target_users),
    })
  }

  if (normalizeStringArray(document.scope?.in_scope).length > 0) {
    blocks.push({
      key: 'scope.in_scope',
      itemKind: 'scope.in_scope',
      label: 'In Scope',
      text: renderList(document.scope?.in_scope),
    })
  }

  if (normalizeStringArray(document.scope?.out_of_scope).length > 0) {
    blocks.push({
      key: 'scope.out_of_scope',
      itemKind: 'scope.out_of_scope',
      label: 'Out of Scope',
      text: renderList(document.scope?.out_of_scope),
    })
  }

  for (const section of PRD_TECHNICAL_SECTION_CONFIG) {
    if (normalizeStringArray(document.technical_requirements?.[section.key]).length === 0) continue
    blocks.push({
      key: section.itemKind,
      itemKind: section.itemKind,
      label: section.label,
      text: renderList(document.technical_requirements?.[section.key]),
    })
  }

  if (normalizeStringArray(document.risks).length > 0) {
    blocks.push({
      key: 'risks',
      itemKind: 'risks',
      label: 'Risks',
      text: renderList(document.risks),
    })
  }

  for (const epic of document.epics ?? []) {
    if (!epic?.id || !epic.title?.trim()) continue
    const epicText = [
      `Title: ${epic.title.trim()}`,
      epic.objective?.trim() ? `Objective: ${epic.objective.trim()}` : '',
      epic.implementation_steps?.length
        ? renderNamedSection('Implementation Steps', renderList(epic.implementation_steps))
        : '',
    ].filter(Boolean).join('\n\n')
    blocks.push({
      key: `epic:${epic.id}`,
      itemKind: 'epic',
      label: epic.title.trim(),
      id: epic.id,
      text: epicText,
    })

    for (const story of epic.user_stories ?? []) {
      if (!story?.id || !story.title?.trim()) continue
      const storyText = [
        `Title: ${story.title.trim()}`,
        story.acceptance_criteria?.length
          ? renderNamedSection('Acceptance Criteria', renderList(story.acceptance_criteria))
          : '',
        story.implementation_steps?.length
          ? renderNamedSection('Implementation Steps', renderList(story.implementation_steps))
          : '',
        story.verification?.required_commands?.length
          ? renderNamedSection('Verification Commands', renderList(story.verification.required_commands))
          : '',
      ].filter(Boolean).join('\n\n')
      blocks.push({
        key: `user_story:${story.id}`,
        itemKind: 'user_story',
        label: story.title.trim(),
        id: story.id,
        text: storyText,
      })
    }
  }

  return blocks
}

function buildBlockDiffEntries(
  beforeBlocks: DiffCandidateBlock[],
  afterBlocks: DiffCandidateBlock[],
  sourceCandidates: DiffSourceCandidate[],
): UiRefinementDiffEntry[] {
  const beforeByKey = new Map(beforeBlocks.map((block) => [block.key, block] as const))
  const afterByKey = new Map(afterBlocks.map((block) => [block.key, block] as const))
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])]
  const entries: UiRefinementDiffEntry[] = []

  for (const key of keys) {
    const before = beforeByKey.get(key)
    const after = afterByKey.get(key)
    if (before && after) {
      if (before.text.trim() === after.text.trim()) continue
      entries.push(
        buildDiffEntry(
          {
            key,
            changeType: 'modified',
            itemKind: after.itemKind,
            label: after.label,
            beforeId: before.id,
            afterId: after.id,
            beforeText: before.text,
            afterText: after.text,
          },
          sourceCandidates,
        ),
      )
      continue
    }

    if (after) {
      entries.push(
        buildDiffEntry(
          {
            key,
            changeType: 'added',
            itemKind: after.itemKind,
            label: after.label,
            afterId: after.id,
            afterText: after.text,
          },
          sourceCandidates,
        ),
      )
      continue
    }

    if (before) {
      entries.push(
        buildDiffEntry(
          {
            key,
            changeType: 'removed',
            itemKind: before.itemKind,
            label: before.label,
            beforeId: before.id,
            beforeText: before.text,
          },
          sourceCandidates,
        ),
      )
    }
  }

  return entries
}

export function buildPrdUiRefinementDiffArtifact(params: {
  winnerId: string
  winnerDraftContent: string
  refinedContent: string
  losingDrafts?: Array<{ memberId: string; content: string }>
  generatedAt?: string
}): UiRefinementDiffArtifact {
  const winnerBlocks = buildPrdBlocks(params.winnerDraftContent)
  const refinedBlocks = buildPrdBlocks(params.refinedContent)
  const sourceCandidates = buildSourceCandidates(params.losingDrafts ?? [], buildPrdBlocks)

  return {
    domain: 'prd',
    winnerId: params.winnerId.trim(),
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    entries: buildBlockDiffEntries(winnerBlocks, refinedBlocks, sourceCandidates),
  }
}

function parseBeadSubsetContent(content: string): ParsedBeadSubset[] {
  const parsed = readYamlArray<ParsedBeadSubset>(content)
  return Array.isArray(parsed) ? parsed : []
}

function buildBeadText(bead: ParsedBeadSubset): string {
  return [
    bead.title?.trim() ? `Title: ${bead.title.trim()}` : '',
    normalizeStringArray(bead.prdRefs).length
      ? renderNamedSection('PRD References', renderList(bead.prdRefs))
      : '',
    bead.description?.trim() ? `Description: ${bead.description.trim()}` : '',
    bead.contextGuidance?.trim() ? `Context Guidance: ${bead.contextGuidance.trim()}` : '',
    normalizeStringArray(bead.acceptanceCriteria).length
      ? renderNamedSection('Acceptance Criteria', renderList(bead.acceptanceCriteria))
      : '',
    normalizeStringArray(bead.tests).length
      ? renderNamedSection('Tests', renderList(bead.tests))
      : '',
    normalizeStringArray(bead.testCommands).length
      ? renderNamedSection('Test Commands', renderList(bead.testCommands))
      : '',
  ].filter(Boolean).join('\n\n')
}

function buildBeadBlocks(content: string): DiffCandidateBlock[] {
  return parseBeadSubsetContent(content)
    .filter((bead) => bead.id?.trim() && bead.title?.trim())
    .map((bead) => ({
      key: `bead:${bead.id!.trim()}`,
      itemKind: 'bead',
      label: bead.title!.trim(),
      id: bead.id!.trim(),
      text: buildBeadText(bead),
    }))
}

export function buildBeadsUiRefinementDiffArtifact(params: {
  winnerId: string
  winnerDraftContent: string
  refinedContent: string
  losingDrafts?: Array<{ memberId: string; content: string }>
  generatedAt?: string
}): UiRefinementDiffArtifact {
  const winnerBlocks = buildBeadBlocks(params.winnerDraftContent)
  const refinedBlocks = buildBeadBlocks(params.refinedContent)
  const sourceCandidates = buildSourceCandidates(params.losingDrafts ?? [], buildBeadBlocks)

  return {
    domain: 'beads',
    winnerId: params.winnerId.trim(),
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    entries: buildBlockDiffEntries(winnerBlocks, refinedBlocks, sourceCandidates),
  }
}

export function parseUiRefinementDiffArtifact(content: string | null | undefined): UiRefinementDiffArtifact | null {
  if (typeof content !== 'string' || !content.trim()) return null

  try {
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) return null
    if (parsed.domain !== 'interview' && parsed.domain !== 'prd' && parsed.domain !== 'beads') return null
    if (typeof parsed.winnerId !== 'string') return null
    if (typeof parsed.generatedAt !== 'string') return null
    if (!Array.isArray(parsed.entries)) return null

    const entries = parsed.entries
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .flatMap((entry) => {
        const changeType = entry.changeType
        if (
          changeType !== 'modified'
          && changeType !== 'replaced'
          && changeType !== 'added'
          && changeType !== 'removed'
        ) {
          return []
        }
        const itemKind = typeof entry.itemKind === 'string' ? entry.itemKind : ''
        const key = typeof entry.key === 'string' ? entry.key : ''
        const label = typeof entry.label === 'string' ? entry.label : ''
        const attributionStatus = entry.attributionStatus
        if (
          attributionStatus !== 'inspired'
          && attributionStatus !== 'model_unattributed'
          && attributionStatus !== 'synthesized_unattributed'
          && attributionStatus !== 'invalid_unattributed'
        ) {
          return []
        }
        const inspiration = isRecord(entry.inspiration) && typeof entry.inspiration.memberId === 'string' && typeof entry.inspiration.sourceLabel === 'string'
          ? {
              memberId: entry.inspiration.memberId,
              sourceLabel: entry.inspiration.sourceLabel,
              ...(typeof entry.inspiration.sourceId === 'string' ? { sourceId: entry.inspiration.sourceId } : {}),
              ...(typeof entry.inspiration.sourceText === 'string' ? { sourceText: entry.inspiration.sourceText } : {}),
            }
          : null

        return [{
          key,
          changeType,
          itemKind,
          label,
          ...(typeof entry.beforeId === 'string' ? { beforeId: entry.beforeId } : {}),
          ...(typeof entry.afterId === 'string' ? { afterId: entry.afterId } : {}),
          ...(typeof entry.beforeText === 'string' ? { beforeText: entry.beforeText } : {}),
          ...(typeof entry.afterText === 'string' ? { afterText: entry.afterText } : {}),
          inspiration,
          attributionStatus,
        } satisfies UiRefinementDiffEntry]
      })

    return {
      domain: parsed.domain,
      winnerId: parsed.winnerId,
      generatedAt: parsed.generatedAt,
      entries,
    }
  } catch {
    return null
  }
}
