import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { ensureProjectStorageDirs, getProjectDbPath } from '../storage/paths'
import { SQLITE_BUSY_TIMEOUT_MS } from '../lib/constants'

interface ProjectDatabase {
  sqlite: Database.Database
  db: BetterSQLite3Database<typeof schema>
}

const projectDbCache = new Map<string, ProjectDatabase>()

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  if (columns.some((entry) => entry.name === column)) return
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function initializeProjectSqlite(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      shortname TEXT NOT NULL,
      icon TEXT DEFAULT '📁',
      color TEXT DEFAULT '#3b82f6',
      folder_path TEXT NOT NULL,
      profile_id INTEGER,
      council_members TEXT,
      max_iterations INTEGER,
      per_iteration_timeout INTEGER,
      council_response_timeout INTEGER,
      min_council_quorum INTEGER,
      interview_questions INTEGER,
      ticket_counter INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      xstate_snapshot TEXT,
      branch_name TEXT,
      current_bead INTEGER,
      total_beads INTEGER,
      percent_complete REAL,
      error_message TEXT,
      locked_main_implementer TEXT,
      locked_main_implementer_variant TEXT,
      locked_council_members TEXT,
      locked_council_member_variants TEXT,
      locked_interview_questions INTEGER,
      locked_coverage_follow_up_budget_percent INTEGER,
      locked_max_coverage_passes INTEGER,
      started_at TEXT,
      planned_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phase_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      phase TEXT NOT NULL,
      artifact_type TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS opencode_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ticket_id INTEGER REFERENCES tickets(id),
      phase TEXT NOT NULL,
      phase_attempt INTEGER DEFAULT 1,
      member_id TEXT,
      bead_id TEXT,
      iteration INTEGER,
      state TEXT NOT NULL DEFAULT 'active',
      last_event_id TEXT,
      last_event_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticket_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      previous_status TEXT,
      new_status TEXT NOT NULL,
      reason TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_project_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_project_tickets_external_id ON tickets(external_id);
    CREATE INDEX IF NOT EXISTS idx_phase_artifacts_ticket ON phase_artifacts(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_ticket_phase ON opencode_sessions(ticket_id, phase, state);
  `)

  ensureColumn(sqlite, 'tickets', 'locked_interview_questions', 'INTEGER')
  ensureColumn(sqlite, 'tickets', 'locked_coverage_follow_up_budget_percent', 'INTEGER')
  ensureColumn(sqlite, 'tickets', 'locked_max_coverage_passes', 'INTEGER')
  ensureColumn(sqlite, 'tickets', 'locked_main_implementer_variant', 'TEXT')
  ensureColumn(sqlite, 'tickets', 'locked_council_member_variants', 'TEXT')
}

export function getProjectDatabase(projectRoot: string): ProjectDatabase {
  const cached = projectDbCache.get(projectRoot)
  if (cached) return cached

  ensureProjectStorageDirs(projectRoot)
  const sqlite = new Database(getProjectDbPath(projectRoot))
  sqlite.pragma('journal_mode=WAL')
  sqlite.pragma('locking_mode=NORMAL')
  sqlite.pragma('synchronous=NORMAL')
  sqlite.pragma(`busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`)
  initializeProjectSqlite(sqlite)

  const projectDb: ProjectDatabase = {
    sqlite,
    db: drizzle(sqlite, { schema }),
  }
  projectDbCache.set(projectRoot, projectDb)
  return projectDb
}

export function clearProjectDatabaseCache() {
  for (const [, entry] of projectDbCache) {
    entry.sqlite.close()
  }
  projectDbCache.clear()
}
