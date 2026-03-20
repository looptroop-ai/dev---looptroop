import { readFileSync, existsSync } from 'fs'
import { safeAtomicWrite } from './atomicWrite'
import { safeAtomicAppend } from './atomicAppend'
import { warnIfVerbose } from '../runtime'

export function readJsonl<T = Record<string, unknown>>(filePath: string): T[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim() !== '')
  const items: T[] = []

  for (let i = 0; i < lines.length; i++) {
    try {
      items.push(JSON.parse(lines[i]!) as T)
    } catch {
      const preview = lines[i]!.length > 80 ? lines[i]!.slice(0, 80) + '…' : lines[i]
      warnIfVerbose(`[jsonl] Skipping malformed line ${i + 1} in ${filePath}: ${preview}`)
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
