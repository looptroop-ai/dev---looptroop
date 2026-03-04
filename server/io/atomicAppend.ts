import { readFileSync, existsSync } from 'fs'
import { safeAtomicWrite } from './atomicWrite'

export function safeAtomicAppend(filePath: string, line: string): void {
  let existing = ''
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf-8')
  }
  const newContent = existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + line + '\n'
  safeAtomicWrite(filePath, newContent)
}
