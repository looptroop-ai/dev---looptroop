import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generateCodebaseMapYaml } from '../codebaseMap'

describe('generateCodebaseMapYaml', () => {
  it('writes only the lean artifact fields and preserves file discovery rules', () => {
    const repoDir = mkdtempSync(resolve(tmpdir(), 'looptroop-codebase-map-'))

    try {
      mkdirSync(resolve(repoDir, 'src'), { recursive: true })
      mkdirSync(resolve(repoDir, 'node_modules', 'ignored-lib'), { recursive: true })
      writeFileSync(resolve(repoDir, 'package.json'), '{"name":"fixture"}\n')
      writeFileSync(resolve(repoDir, 'src', 'main.ts'), 'export const main = true\n')
      writeFileSync(resolve(repoDir, 'node_modules', 'ignored-lib', 'index.js'), 'module.exports = {}\n')

      const yaml = generateCodebaseMapYaml(repoDir, 'TEST-1')

      expect(yaml).toContain('ticket_id: "TEST-1"')
      expect(yaml).toContain('artifact: "codebase_map"')
      expect(yaml).toContain('manifests:')
      expect(yaml).toContain('files:')
      expect(yaml).toContain('"package.json"')
      expect(yaml).toContain('"src/main.ts"')
      expect(yaml).not.toContain('schema_version:')
      expect(yaml).not.toContain('generated_by:')
      expect(yaml).not.toContain('generated_at:')
      expect(yaml).not.toContain('source:')
      expect(yaml).not.toContain('summary:')
      expect(yaml).not.toContain('node_modules/ignored-lib/index.js')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
