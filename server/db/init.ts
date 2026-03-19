import { sqlite } from './index'
import { logIfVerbose } from '../runtime'

function ensureColumn(table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  if (columns.some((entry) => entry.name === column)) return
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      icon TEXT DEFAULT '👤',
      background TEXT,
      main_implementer TEXT,
      council_members TEXT,
      min_council_quorum INTEGER DEFAULT 2,
      per_iteration_timeout INTEGER DEFAULT 1200000,
      council_response_timeout INTEGER DEFAULT 300000,
      interview_questions INTEGER DEFAULT 50,
      coverage_follow_up_budget_percent INTEGER DEFAULT 20,
      max_coverage_passes INTEGER DEFAULT 2,
      max_iterations INTEGER DEFAULT 5,
      disable_analogies INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attached_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  ensureColumn('profiles', 'coverage_follow_up_budget_percent', 'INTEGER DEFAULT 20')
  ensureColumn('profiles', 'max_coverage_passes', 'INTEGER DEFAULT 2')

  logIfVerbose('[db] App database initialized')
}
