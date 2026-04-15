import { sqlite } from './index'
import { PROFILE_DEFAULTS } from './defaults'
import { logIfVerbose } from '../runtime'

function ensureColumn(table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  if (columns.some((entry) => entry.name === column)) return
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function listColumns(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
    .flatMap((entry) => typeof entry.name === 'string' ? [entry.name] : [])
}

function selectLegacyProfileColumn(columns: Set<string>, column: string): string {
  return columns.has(column) ? column : 'NULL'
}

function selectLegacyProfileValue(columns: Set<string>, column: string, defaultValue: number): string {
  if (!columns.has(column)) return String(defaultValue)
  return `COALESCE(${column}, ${defaultValue})`
}

function selectLegacyProfileExpression(columns: Set<string>, column: string, defaultSql: string): string {
  if (!columns.has(column)) return defaultSql
  return `COALESCE(${column}, ${defaultSql})`
}

function migrateLegacyProfilesTable() {
  const columns = listColumns('profiles')
  if (columns.length === 0) return

  const hasLegacyProfileFields = ['username', 'icon', 'background'].some((column) => columns.includes(column))
  if (!hasLegacyProfileFields) return
  const columnSet = new Set(columns)

  const migrate = sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE profiles_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        main_implementer TEXT,
        council_members TEXT,
        min_council_quorum INTEGER DEFAULT ${PROFILE_DEFAULTS.minCouncilQuorum},
        per_iteration_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.perIterationTimeout},
        execution_setup_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.executionSetupTimeout},
        council_response_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.councilResponseTimeout},
        interview_questions INTEGER DEFAULT ${PROFILE_DEFAULTS.interviewQuestions},
        coverage_follow_up_budget_percent INTEGER DEFAULT ${PROFILE_DEFAULTS.coverageFollowUpBudgetPercent},
        max_coverage_passes INTEGER DEFAULT ${PROFILE_DEFAULTS.maxCoveragePasses},
        max_iterations INTEGER DEFAULT ${PROFILE_DEFAULTS.maxIterations},
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO profiles_next (
        id,
        main_implementer,
        council_members,
        min_council_quorum,
        per_iteration_timeout,
        execution_setup_timeout,
        council_response_timeout,
        interview_questions,
        coverage_follow_up_budget_percent,
        max_coverage_passes,
        max_iterations,
        created_at,
        updated_at
      )
      SELECT
        id,
        ${selectLegacyProfileColumn(columnSet, 'main_implementer')},
        ${selectLegacyProfileColumn(columnSet, 'council_members')},
        ${selectLegacyProfileValue(columnSet, 'min_council_quorum', PROFILE_DEFAULTS.minCouncilQuorum)},
        ${selectLegacyProfileValue(columnSet, 'per_iteration_timeout', PROFILE_DEFAULTS.perIterationTimeout)},
        ${selectLegacyProfileValue(columnSet, 'execution_setup_timeout', PROFILE_DEFAULTS.executionSetupTimeout)},
        ${selectLegacyProfileValue(columnSet, 'council_response_timeout', PROFILE_DEFAULTS.councilResponseTimeout)},
        ${selectLegacyProfileValue(columnSet, 'interview_questions', PROFILE_DEFAULTS.interviewQuestions)},
        ${selectLegacyProfileValue(columnSet, 'coverage_follow_up_budget_percent', PROFILE_DEFAULTS.coverageFollowUpBudgetPercent)},
        ${selectLegacyProfileValue(columnSet, 'max_coverage_passes', PROFILE_DEFAULTS.maxCoveragePasses)},
        ${selectLegacyProfileValue(columnSet, 'max_iterations', PROFILE_DEFAULTS.maxIterations)},
        ${selectLegacyProfileExpression(columnSet, 'created_at', "datetime('now')")},
        ${selectLegacyProfileExpression(columnSet, 'updated_at', "datetime('now')")}
      FROM profiles;

      DROP TABLE profiles;
      ALTER TABLE profiles_next RENAME TO profiles;
    `)
  })

  migrate()
}

export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      main_implementer TEXT,
      council_members TEXT,
      min_council_quorum INTEGER DEFAULT ${PROFILE_DEFAULTS.minCouncilQuorum},
      per_iteration_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.perIterationTimeout},
      execution_setup_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.executionSetupTimeout},
      council_response_timeout INTEGER DEFAULT ${PROFILE_DEFAULTS.councilResponseTimeout},
      interview_questions INTEGER DEFAULT ${PROFILE_DEFAULTS.interviewQuestions},
      coverage_follow_up_budget_percent INTEGER DEFAULT ${PROFILE_DEFAULTS.coverageFollowUpBudgetPercent},
      max_coverage_passes INTEGER DEFAULT ${PROFILE_DEFAULTS.maxCoveragePasses},
      max_iterations INTEGER DEFAULT ${PROFILE_DEFAULTS.maxIterations},
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attached_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateLegacyProfilesTable()
  ensureColumn('profiles', 'coverage_follow_up_budget_percent', `INTEGER DEFAULT ${PROFILE_DEFAULTS.coverageFollowUpBudgetPercent}`)
  ensureColumn('profiles', 'max_coverage_passes', `INTEGER DEFAULT ${PROFILE_DEFAULTS.maxCoveragePasses}`)
  ensureColumn('profiles', 'execution_setup_timeout', `INTEGER DEFAULT ${PROFILE_DEFAULTS.executionSetupTimeout}`)
  ensureColumn('profiles', 'main_implementer_variant', 'TEXT')
  ensureColumn('profiles', 'council_member_variants', 'TEXT')

  logIfVerbose('[db] App database initialized')
}
