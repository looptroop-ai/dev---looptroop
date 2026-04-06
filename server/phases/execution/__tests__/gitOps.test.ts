import { describe, expect, it } from 'vitest'
import { isAllowedFile, filterAllowedFiles } from '../gitOps'

describe('gitOps allowlist/denylist', () => {
  it('allows standard code extensions', () => {
    expect(isAllowedFile('src/app.ts')).toBe(true)
    expect(isAllowedFile('src/style.css')).toBe(true)
    expect(isAllowedFile('package.json')).toBe(true)
  })

  it('allows .jsonl files', () => {
    expect(isAllowedFile('issues.jsonl')).toBe(true)
    expect(isAllowedFile('.ticket/issues.jsonl')).toBe(true)
  })

  it('allows known ticket artifact paths', () => {
    expect(isAllowedFile('.ticket/interview.yaml')).toBe(true)
    expect(isAllowedFile('.ticket/prd.yaml')).toBe(true)
    expect(isAllowedFile('.ticket/codebase-map.yaml')).toBe(true)
  })

  it('blocks runtime/internal paths', () => {
    expect(isAllowedFile('.ticket/runtime/state.json')).toBe(false)
    expect(isAllowedFile('.ticket/locks/main.lock')).toBe(false)
    expect(isAllowedFile('.ticket/sessions/abc.json')).toBe(false)
    expect(isAllowedFile('.ticket/streams/live.json')).toBe(false)
    expect(isAllowedFile('.ticket/tmp/scratch.ts')).toBe(false)
    expect(isAllowedFile('node_modules/foo/bar.js')).toBe(false)
    expect(isAllowedFile('dist/bundle.js')).toBe(false)
  })

  it('blocks unknown extensions', () => {
    expect(isAllowedFile('data.bin')).toBe(false)
    expect(isAllowedFile('image.png')).toBe(false)
  })

  it('filterAllowedFiles returns only allowed files', () => {
    const files = ['src/app.ts', 'node_modules/foo.js', '.ticket/runtime/x.json', 'issues.jsonl']
    expect(filterAllowedFiles(files)).toEqual(['src/app.ts', 'issues.jsonl'])
  })
})
