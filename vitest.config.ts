import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getBackendOrigin } from './shared/appConfig'

// Never add tests that hard-code ticket/project-specific fixture ids, refs, shortnames, or worktree names.
const __dirname = dirname(fileURLToPath(import.meta.url))

const sharedResolve = {
  alias: {
    '@': resolve(__dirname, './src'),
    '@server': resolve(__dirname, './server'),
    '@shared': resolve(__dirname, './shared'),
  },
}

const sharedEnv = {
  NODE_ENV: 'test',
  LOOPTROOP_OPENCODE_MODE: 'mock',
  LOOPTROOP_TEST_SILENT: '1',
}

export default defineConfig({
  resolve: sharedResolve,
  define: {
    __LOOPTROOP_DEV_BACKEND_ORIGIN__: JSON.stringify(getBackendOrigin()),
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          pool: 'forks',
          fileParallelism: true,
          maxWorkers: 2,
          isolate: false,
          sequence: { groupOrder: 0 },
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          css: false,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-unit',
          environment: 'node',
          pool: 'forks',
          fileParallelism: true,
          isolate: true,
          sequence: { groupOrder: 1 },
          setupFiles: ['./server/test/setup.ts'],
          include: ['server/**/*.test.ts', 'tests/**/*.test.ts', 'shared/**/*.test.ts'],
          testTimeout: 15000,
          hookTimeout: 20000,
          env: sharedEnv,
        },
      },
    ],
  },
})
