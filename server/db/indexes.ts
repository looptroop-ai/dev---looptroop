import { sqlite } from './index'

export function createIndexes() {
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id)`)
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`)
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_external_id ON tickets(external_id)`)
}
