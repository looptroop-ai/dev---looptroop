import { sqlite } from './index'

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
      council_response_timeout INTEGER DEFAULT 900000,
      interview_questions INTEGER DEFAULT 50,
      max_iterations INTEGER DEFAULT 5,
      disable_analogies INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      shortname TEXT NOT NULL,
      icon TEXT DEFAULT '📁',
      color TEXT DEFAULT '#3b82f6',
      folder_path TEXT NOT NULL,
      profile_id INTEGER REFERENCES profiles(id),
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
      locked_council_members TEXT,
      started_at TEXT,
      planned_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phase_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      phase TEXT NOT NULL,
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
  `)

  // Migrate: add locked model columns if missing
  try {
    sqlite.exec(`ALTER TABLE tickets ADD COLUMN locked_main_implementer TEXT`)
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE tickets ADD COLUMN locked_council_members TEXT`)
  } catch { /* column already exists */ }

  // Migrate: backfill started_at for non-DRAFT tickets that are missing it
  try {
    sqlite.exec(`UPDATE tickets SET started_at = created_at WHERE status != 'DRAFT' AND started_at IS NULL`)
  } catch { /* ignore */ }

  // Verify WAL mode
  const walMode = sqlite.pragma('journal_mode', { simple: true })
  console.log(`[db] Journal mode: ${walMode}`)

  console.log('[db] Database initialized with all tables')
}
