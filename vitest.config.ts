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
          maxWorkers: 6,
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
          maxWorkers: 4,
          isolate: false,
          sequence: { groupOrder: 1 },
          setupFiles: ['./server/test/setup.ts'],
          include: ['server/**/*.test.ts', 'tests/**/*.test.ts', 'shared/**/*.test.ts'],
          exclude: [
            'server/git/__tests__/github.test.ts',
            'server/log/__tests__/executionLog.test.ts',
            'server/phases/verification/__tests__/manual.test.ts',
            'server/phases/execution/__tests__/executor.test.ts',
            'server/phases/interview/__tests__/qa.test.ts',
            'server/routes/__tests__/tickets.*.test.ts',
            'server/ticket/__tests__/initialize.test.ts',
            'server/workflow/__tests__/beadsDraftPhase.test.ts',
            'server/workflow/__tests__/beadsRefinePhase.test.ts',
            'server/workflow/__tests__/beadsVotePhase.test.ts',
            'server/workflow/__tests__/executionPhase.test.ts',
            'server/workflow/__tests__/integrationPhase.test.ts',
            'server/workflow/__tests__/interviewCompilePhase.test.ts',
            'server/workflow/__tests__/openCodeLogCanonicalization.test.ts',
            'server/workflow/__tests__/prdDraftPhase.test.ts',
            'server/workflow/__tests__/prdRefinePhase.test.ts',
            'server/workflow/__tests__/relevantFilesScan.test.ts',
            'server/workflow/__tests__/runner.test.ts',
            'server/workflow/__tests__/verificationFinalTestPhase.test.ts',
          ],
          testTimeout: 15000,
          hookTimeout: 20000,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-isolated',
          environment: 'node',
          pool: 'forks',
          fileParallelism: true,
          maxWorkers: 6,
          isolate: true,
          sequence: { groupOrder: 2 },
          setupFiles: ['./server/test/setup.ts'],
          include: [
            'server/git/__tests__/github.test.ts',
            'server/log/__tests__/executionLog.test.ts',
            'server/phases/verification/__tests__/manual.test.ts',
            'server/phases/execution/__tests__/executor.test.ts',
            'server/phases/interview/__tests__/qa.test.ts',
            'server/routes/__tests__/tickets.*.test.ts',
            'server/ticket/__tests__/initialize.test.ts',
            'server/workflow/__tests__/beadsDraftPhase.test.ts',
            'server/workflow/__tests__/beadsRefinePhase.test.ts',
            'server/workflow/__tests__/beadsVotePhase.test.ts',
            'server/workflow/__tests__/executionPhase.test.ts',
            'server/workflow/__tests__/integrationPhase.test.ts',
            'server/workflow/__tests__/interviewCompilePhase.test.ts',
            'server/workflow/__tests__/openCodeLogCanonicalization.test.ts',
            'server/workflow/__tests__/prdDraftPhase.test.ts',
            'server/workflow/__tests__/prdRefinePhase.test.ts',
            'server/workflow/__tests__/relevantFilesScan.test.ts',
            'server/workflow/__tests__/runner.test.ts',
            'server/workflow/__tests__/verificationFinalTestPhase.test.ts',
          ],
          testTimeout: 15000,
          hookTimeout: 20000,
          env: sharedEnv,
        },
      },
    ],
  },
})
