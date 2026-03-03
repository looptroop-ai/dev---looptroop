import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync, rmSync } from 'fs'

const TEST_DB_PATH = resolve(process.cwd(), '.looptroop/test-db.sqlite')

describe('SQLite Database', () => {
  let db: Database.Database

  beforeAll(() => {
    mkdirSync(resolve(process.cwd(), '.looptroop'), { recursive: true })
    db = new Database(TEST_DB_PATH)

    // Apply WAL hardening pragmas
    db.pragma('journal_mode=WAL')
    db.pragma('locking_mode=NORMAL')
    db.pragma('synchronous=NORMAL')
    db.pragma('busy_timeout=5000')
    db.pragma('wal_autocheckpoint=1000')

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        icon TEXT DEFAULT '👤',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        shortname TEXT NOT NULL,
        icon TEXT DEFAULT '📁',
        color TEXT DEFAULT '#3b82f6',
        folder TEXT NOT NULL,
        ticket_counter INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        xstate_snapshot TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS opencode_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        ticket_id INTEGER REFERENCES tickets(id),
        phase TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  })

  afterAll(() => {
    db.close()
    try { rmSync(TEST_DB_PATH, { force: true }) } catch { /* ignore */ }
    try { rmSync(TEST_DB_PATH + '-wal', { force: true }) } catch { /* ignore */ }
    try { rmSync(TEST_DB_PATH + '-shm', { force: true }) } catch { /* ignore */ }
  })

  it('should have WAL journal mode', () => {
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
  })

  it('should have correct busy_timeout', () => {
    const timeout = db.pragma('busy_timeout', { simple: true })
    expect(timeout).toBe(5000)
  })

  it('should have NORMAL synchronous mode', () => {
    const sync = db.pragma('synchronous', { simple: true })
    // SQLite returns 1 for NORMAL
    expect(sync).toBe(1)
  })

  it('should create all 4 tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[]
    const tableNames = tables.map(t => t.name).sort()
    expect(tableNames).toEqual(['opencode_sessions', 'profiles', 'projects', 'tickets'])
  })

  it('should insert and query a project', () => {
    const stmt = db.prepare('INSERT INTO projects (name, shortname, folder) VALUES (?, ?, ?)')
    const result = stmt.run('Test Project', 'TEST', '/tmp/test')
    expect(result.lastInsertRowid).toBeTruthy()

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>
    expect(project.name).toBe('Test Project')
    expect(project.shortname).toBe('TEST')
  })

  it('should insert and query a ticket', () => {
    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: number }
    const stmt = db.prepare('INSERT INTO tickets (external_id, project_id, title) VALUES (?, ?, ?)')
    const result = stmt.run('TEST-1', project.id, 'First Ticket')
    expect(result.lastInsertRowid).toBeTruthy()

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>
    expect(ticket.external_id).toBe('TEST-1')
    expect(ticket.status).toBe('DRAFT')
  })

  it('should enforce unique external_id on tickets', () => {
    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: number }
    expect(() => {
      db.prepare('INSERT INTO tickets (external_id, project_id, title) VALUES (?, ?, ?)').run('TEST-1', project.id, 'Duplicate')
    }).toThrow()
  })
})
