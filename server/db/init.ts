import { sqlite } from './index'
import { logIfVerbose } from '../runtime'

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

    CREATE TABLE IF NOT EXISTS attached_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  logIfVerbose('[db] App database initialized')
}
