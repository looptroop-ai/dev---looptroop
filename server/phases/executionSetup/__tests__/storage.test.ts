import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createExecutionSetupPathSnapshot,
  removeExecutionSetupPathViolations,
  validateExecutionSetupPaths,
} from '../storage'

function createGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'execution-setup-storage-'))
  execFileSync('git', ['-C', dir, 'init'], { stdio: 'pipe' })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'pipe' })
  writeFileSync(join(dir, 'hello.ts'), 'export const hello = 1\n')
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'pipe' })
  execFileSync('git', ['-C', dir, 'commit', '-m', 'initial'], { stdio: 'pipe' })
  return dir
}

describe('execution setup storage safety', () => {
  const repoDirs: string[] = []

  function makeFreshRepo(): string {
    const dir = createGitRepo()
    repoDirs.push(dir)
    return dir
  }

  afterAll(() => {
    for (const dir of repoDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when setup changes tracked repository files outside allowed runtime paths', () => {
    const dir = makeFreshRepo()
    writeFileSync(join(dir, 'hello.ts'), 'export const hello = 2\n')

    const validation = validateExecutionSetupPaths(dir)

    expect(validation.ok).toBe(false)
    expect(validation.violations).toContain('hello.ts')
  })

  it('fails when setup creates non-ignored untracked files outside allowed runtime paths', () => {
    const dir = makeFreshRepo()
    writeFileSync(join(dir, 'scratch.ts'), 'temporary\n')

    const validation = validateExecutionSetupPaths(dir)

    expect(validation.ok).toBe(false)
    expect(validation.violations).toContain('scratch.ts')
  })

  it('catches newly created ignored outputs outside the allowed runtime paths', () => {
    const dir = makeFreshRepo()
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    execFileSync('git', ['-C', dir, 'add', '.gitignore'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'commit', '-m', 'ignore node_modules'], { stdio: 'pipe' })
    const baseline = createExecutionSetupPathSnapshot(dir)

    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')

    const validation = validateExecutionSetupPaths(dir, baseline)

    expect(validation.ok).toBe(false)
    expect(validation.violations.some((path) => path.includes('node_modules/pkg/index.js'))).toBe(true)
  })

  it('removes new ignored violations while preserving allowed execution runtime paths', () => {
    const dir = makeFreshRepo()
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    execFileSync('git', ['-C', dir, 'add', '.gitignore'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'commit', '-m', 'ignore node_modules'], { stdio: 'pipe' })
    const baseline = createExecutionSetupPathSnapshot(dir)

    mkdirSync(join(dir, '.ticket', 'runtime', 'execution-setup'), { recursive: true })
    writeFileSync(join(dir, '.ticket', 'runtime', 'execution-log.jsonl'), '{"message":"keep"}\n')
    writeFileSync(join(dir, '.ticket', 'runtime', 'execution-setup-profile.json'), '{"status":"ready"}\n')
    writeFileSync(join(dir, '.ticket', 'runtime', 'execution-setup', 'cache.txt'), 'warm\n')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')

    const removed = removeExecutionSetupPathViolations(dir, baseline)

    expect(removed.some((path) => path.includes('node_modules/pkg/index.js'))).toBe(true)
    expect(existsSync(join(dir, 'node_modules', 'pkg', 'index.js'))).toBe(false)
    expect(readFileSync(join(dir, '.ticket', 'runtime', 'execution-log.jsonl'), 'utf8')).toContain('"keep"')
    expect(readFileSync(join(dir, '.ticket', 'runtime', 'execution-setup-profile.json'), 'utf8')).toContain('"ready"')
    expect(readFileSync(join(dir, '.ticket', 'runtime', 'execution-setup', 'cache.txt'), 'utf8')).toBe('warm\n')
  })
})
