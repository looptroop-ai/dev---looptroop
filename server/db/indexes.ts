import { sqlite } from './index'

export function createIndexes() {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_attached_projects_folder_path
      ON attached_projects(folder_path);
  `)
}
