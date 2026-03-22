import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { safeAtomicWrite } from '../atomicWrite'
import { safeAtomicAppend } from '../atomicAppend'
import { recoverOrphanTmpFiles, fixTrailingLineCorruption } from '../recovery'
import { readJsonl, writeJsonl, appendJsonl } from '../jsonl'
import { readYamlFile, writeYamlFile } from '../yaml'

const TEST_DIR = `/tmp/looptroop-test-${process.pid}-${Date.now()}`

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('safeAtomicWrite', () => {
  it('writes file correctly', () => {
    const filePath = join(TEST_DIR, 'test.txt')
    safeAtomicWrite(filePath, 'hello world')
    expect(readFileSync(filePath, 'utf-8')).toBe('hello world')
  })

  it('overwrites existing file', () => {
    const filePath = join(TEST_DIR, 'overwrite.txt')
    safeAtomicWrite(filePath, 'first')
    safeAtomicWrite(filePath, 'second')
    expect(readFileSync(filePath, 'utf-8')).toBe('second')
  })

  it('creates nested directories', () => {
    const filePath = join(TEST_DIR, 'nested', 'deep', 'file.txt')
    safeAtomicWrite(filePath, 'nested content')
    expect(readFileSync(filePath, 'utf-8')).toBe('nested content')
  })

})

describe('safeAtomicAppend', () => {
  it('appends to a new file', () => {
    const filePath = join(TEST_DIR, 'append.txt')
    safeAtomicAppend(filePath, 'line 1')
    expect(readFileSync(filePath, 'utf-8')).toBe('line 1\n')
  })

  it('appends to an existing file', () => {
    const filePath = join(TEST_DIR, 'append2.txt')
    safeAtomicAppend(filePath, 'line 1')
    safeAtomicAppend(filePath, 'line 2')
    expect(readFileSync(filePath, 'utf-8')).toBe('line 1\nline 2\n')
  })

  it('handles files without trailing newline', () => {
    const filePath = join(TEST_DIR, 'no-newline.txt')
    writeFileSync(filePath, 'existing', 'utf-8')
    safeAtomicAppend(filePath, 'appended')
    expect(readFileSync(filePath, 'utf-8')).toBe('existing\nappended\n')
  })

  it('creates parent directories before appending', () => {
    const filePath = join(TEST_DIR, 'nested', 'logs', 'append.txt')
    safeAtomicAppend(filePath, 'line 1')
    safeAtomicAppend(filePath, 'line 2')
    expect(readFileSync(filePath, 'utf-8')).toBe('line 1\nline 2\n')
  })
})

describe('recoverOrphanTmpFiles', () => {
  it('promotes orphan .tmp files', () => {
    const tmpFile = join(TEST_DIR, 'data.json.tmp')
    writeFileSync(tmpFile, '{"key": "value"}', 'utf-8')

    const recovered = recoverOrphanTmpFiles(TEST_DIR)
    expect(recovered).toContain(join(TEST_DIR, 'data.json'))
    expect(existsSync(join(TEST_DIR, 'data.json'))).toBe(true)
    expect(existsSync(tmpFile)).toBe(false)
  })

  it('handles nested .tmp files', () => {
    const nestedDir = join(TEST_DIR, 'sub')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(nestedDir, 'file.txt.tmp'), 'content', 'utf-8')

    const recovered = recoverOrphanTmpFiles(TEST_DIR)
    expect(recovered).toContain(join(nestedDir, 'file.txt'))
  })

})

describe('fixTrailingLineCorruption', () => {
  it('fixes corrupt last line in JSONL', () => {
    const filePath = join(TEST_DIR, 'corrupt.jsonl')
    writeFileSync(filePath, '{"a":1}\n{"b":2}\n{corrupt\n', 'utf-8')

    const fixed = fixTrailingLineCorruption(filePath)
    expect(fixed).toBe(true)

    const content = readFileSync(filePath, 'utf-8')
    expect(content).toBe('{"a":1}\n{"b":2}\n')
  })

  it('leaves valid JSONL untouched', () => {
    const filePath = join(TEST_DIR, 'valid.jsonl')
    writeFileSync(filePath, '{"a":1}\n{"b":2}\n', 'utf-8')

    const fixed = fixTrailingLineCorruption(filePath)
    expect(fixed).toBe(false)
  })

})

describe('JSONL read/write/append', () => {
  it('writes and reads JSONL', () => {
    const filePath = join(TEST_DIR, 'data.jsonl')
    const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]

    writeJsonl(filePath, items)
    const result = readJsonl<{ name: string }>(filePath)
    expect(result).toEqual(items)
  })

  it('appends to JSONL', () => {
    const filePath = join(TEST_DIR, 'append.jsonl')
    appendJsonl(filePath, { id: 1 })
    appendJsonl(filePath, { id: 2 })

    const result = readJsonl<{ id: number }>(filePath)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('skips malformed lines', () => {
    const filePath = join(TEST_DIR, 'mixed.jsonl')
    writeFileSync(filePath, '{"a":1}\nnot-json\n{"b":2}\n', 'utf-8')

    const result = readJsonl<{ a?: number; b?: number }>(filePath)
    expect(result).toEqual([{ a: 1 }, { b: 2 }])
  })

})

describe('YAML read/write', () => {
  it('writes and reads YAML content', () => {
    const filePath = join(TEST_DIR, 'config.yaml')
    const content = 'name: test\nversion: 1.0\n'

    writeYamlFile(filePath, content)
    const result = readYamlFile(filePath)
    expect(result).toBe(content)
  })

  it('returns null for non-existent file', () => {
    expect(readYamlFile(join(TEST_DIR, 'missing.yaml'))).toBeNull()
  })
})
