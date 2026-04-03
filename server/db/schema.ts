import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { PROFILE_DEFAULTS } from './defaults'

export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mainImplementer: text('main_implementer'),
  mainImplementerVariant: text('main_implementer_variant'),
  councilMembers: text('council_members'), // JSON array of model IDs
  councilMemberVariants: text('council_member_variants'), // JSON map: { "provider/model": "variant" }
  minCouncilQuorum: integer('min_council_quorum').default(PROFILE_DEFAULTS.minCouncilQuorum),
  perIterationTimeout: integer('per_iteration_timeout').default(PROFILE_DEFAULTS.perIterationTimeout),
  councilResponseTimeout: integer('council_response_timeout').default(PROFILE_DEFAULTS.councilResponseTimeout),
  interviewQuestions: integer('interview_questions').default(PROFILE_DEFAULTS.interviewQuestions),
  coverageFollowUpBudgetPercent: integer('coverage_follow_up_budget_percent').default(PROFILE_DEFAULTS.coverageFollowUpBudgetPercent),
  maxCoveragePasses: integer('max_coverage_passes').default(PROFILE_DEFAULTS.maxCoveragePasses),
  maxIterations: integer('max_iterations').default(PROFILE_DEFAULTS.maxIterations),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const attachedProjects = sqliteTable('attached_projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  folderPath: text('folder_path').notNull().unique(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  shortname: text('shortname').notNull(),
  icon: text('icon').default('📁'),
  color: text('color').default('#3b82f6'),
  folderPath: text('folder_path').notNull(),
  profileId: integer('profile_id'),
  councilMembers: text('council_members'), // JSON array, nullable override
  maxIterations: integer('max_iterations'),
  perIterationTimeout: integer('per_iteration_timeout'),
  councilResponseTimeout: integer('council_response_timeout'),
  minCouncilQuorum: integer('min_council_quorum'),
  interviewQuestions: integer('interview_questions'),
  ticketCounter: integer('ticket_counter').default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull().unique(),
  projectId: integer('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  description: text('description'),
  priority: integer('priority').default(3),
  status: text('status').notNull().default('DRAFT'),
  xstateSnapshot: text('xstate_snapshot'), // JSON serialized XState snapshot
  branchName: text('branch_name'),
  currentBead: integer('current_bead'),
  totalBeads: integer('total_beads'),
  percentComplete: real('percent_complete'),
  errorMessage: text('error_message'),
  lockedMainImplementer: text('locked_main_implementer'),
  lockedMainImplementerVariant: text('locked_main_implementer_variant'),
  lockedCouncilMembers: text('locked_council_members'), // JSON array of model IDs, frozen at start
  lockedCouncilMemberVariants: text('locked_council_member_variants'), // JSON map frozen at start
  lockedInterviewQuestions: integer('locked_interview_questions'),
  lockedCoverageFollowUpBudgetPercent: integer('locked_coverage_follow_up_budget_percent'),
  lockedMaxCoveragePasses: integer('locked_max_coverage_passes'),
  startedAt: text('started_at'),
  plannedDate: text('planned_date'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const phaseArtifacts = sqliteTable('phase_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  phase: text('phase').notNull(),
  artifactType: text('artifact_type'),
  content: text('content').notNull(), // JSON stringified artifact
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const opencodeSessions = sqliteTable('opencode_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  ticketId: integer('ticket_id').references(() => tickets.id),
  phase: text('phase').notNull(),
  phaseAttempt: integer('phase_attempt').default(1),
  memberId: text('member_id'), // council member model ID
  beadId: text('bead_id'),
  iteration: integer('iteration'),
  step: text('step'), // optional sub-step when a phase owns multiple sessions
  state: text('state').notNull().default('active'), // active, completed, abandoned
  lastEventId: text('last_event_id'),
  lastEventAt: text('last_event_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const ticketStatusHistory = sqliteTable('ticket_status_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  reason: text('reason'),
  changedAt: text('changed_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const ticketErrorOccurrences = sqliteTable('ticket_error_occurrences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  occurrenceNumber: integer('occurrence_number').notNull(),
  blockedFromStatus: text('blocked_from_status').notNull(),
  errorMessage: text('error_message'),
  errorCodes: text('error_codes'),
  occurredAt: text('occurred_at').notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text('resolved_at'),
  resolutionStatus: text('resolution_status'),
  resumedToStatus: text('resumed_to_status'),
})
