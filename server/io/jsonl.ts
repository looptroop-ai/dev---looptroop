import { readFileSync, existsSync } from 'fs'
import { safeAtomicWrite } from './atomicWrite'
import { safeAtomicAppend } from './atomicAppend'

export function readJsonl<T = Record<string, unknown>>(filePath: string): T[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim() !== '')
  const items: T[] = []

  for (const line of lines) {
    try {
      items.push(JSON.parse(line) as T)
    } catch {
      console.warn(`[jsonl] Skipping malformed line in ${filePath}`)
    }
  }

  return items
}

export function writeJsonl<T>(filePath: string, items: T[]): void {
  const content = items.map(item => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '')
  safeAtomicWrite(filePath, content)
}

export function appendJsonl<T>(filePath: string, item: T): void {
  safeAtomicAppend(filePath, JSON.stringify(item))
}
