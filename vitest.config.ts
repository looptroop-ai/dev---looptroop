import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const sharedResolve = {
  alias: {
    '@': resolve(__dirname, './src'),
    '@server': resolve(__dirname, './server'),
  },
}

const sharedEnv = {
  NODE_ENV: 'test',
  LOOPTROOP_OPENCODE_MODE: 'mock',
  LOOPTROOP_TEST_SILENT: '1',
}

const serialServerTests = [
  'server/routes/__tests__/routes.test.ts',
]

export default defineConfig({
  resolve: sharedResolve,
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          fileParallelism: false,
          isolate: false,
          sequence: { groupOrder: 0 },
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          css: true,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-unit',
          environment: 'node',
          sequence: { groupOrder: 1 },
          setupFiles: ['./server/test/setup.ts'],
          include: ['server/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: serialServerTests,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-integration',
          environment: 'node',
          sequence: { groupOrder: 2 },
          setupFiles: ['./server/test/setup.ts'],
          include: serialServerTests,
          fileParallelism: false,
          env: sharedEnv,
        },
      },
    ],
  },
})
