import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getBackendOrigin, getDocsOrigin } from './shared/appConfig'

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

const clientNodeTests = [
  'src/components/workspace/__tests__/phaseArtifactTypes.test.ts',
  'src/hooks/__tests__/ticketStatusCache.test.ts',
  'src/hooks/__tests__/useTickets.test.ts',
  'src/lib/__tests__/workflowMeta.test.ts',
] as const

// Keep the fast server bucket focused on pure logic. The integration bucket
// also carries a small set of isolation-sensitive tests that historically
// depended on per-file module state.
const serverIntegrationTests = [
  'server/errors/__tests__/errors.test.ts',
  'server/git/__tests__/github.test.ts',
  'server/io/__tests__/atomicIO.test.ts',
  'server/log/__tests__/executionLog.test.ts',
  'server/opencode/__tests__/sessionManager.test.ts',
  'server/phases/execution/__tests__/executor.test.ts',
  'server/phases/execution/__tests__/gitOps.test.ts',
  'server/phases/executionSetup/__tests__/storage.test.ts',
  'server/phases/finalTest/__tests__/generator.test.ts',
  'server/phases/integration/__tests__/squash.test.ts',
  'server/phases/interview/__tests__/qa.test.ts',
  'server/phases/verification/__tests__/manual.test.ts',
  'server/routes/__tests__/*.test.ts',
  'server/storage/__tests__/ticketRuntimeProjection.test.ts',
  'server/storage/__tests__/tickets.test.ts',
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
  'server/workflow/__tests__/runOpenCodePrompt.test.ts',
  'server/workflow/__tests__/runner.test.ts',
  'server/workflow/__tests__/skipAllInterviewQuestionsToApproval.test.ts',
  'server/workflow/__tests__/verificationFinalTestPhase.test.ts',
] as const

export default defineConfig({
  resolve: sharedResolve,
  define: {
    __LOOPTROOP_DEV_BACKEND_ORIGIN__: JSON.stringify(getBackendOrigin()),
    __LOOPTROOP_DOCS_ORIGIN__: JSON.stringify(getDocsOrigin()),
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'client-dom',
          environment: 'jsdom',
          pool: 'forks',
          fileParallelism: true,
          maxWorkers: 6,
          isolate: false,
          sequence: { groupOrder: 0 },
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...clientNodeTests],
          css: false,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'client-node',
          environment: 'node',
          pool: 'threads',
          fileParallelism: true,
          maxWorkers: 6,
          isolate: false,
          sequence: { groupOrder: 0 },
          include: [...clientNodeTests],
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-pure',
          environment: 'node',
          pool: 'threads',
          fileParallelism: true,
          maxWorkers: 6,
          isolate: false,
          sequence: { groupOrder: 0 },
          setupFiles: ['./server/test/setup.ts'],
          include: ['server/**/*.test.ts', 'tests/**/*.test.ts', 'shared/**/*.test.ts'],
          exclude: [...serverIntegrationTests],
          testTimeout: 15000,
          hookTimeout: 20000,
          env: sharedEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'server-integration',
          environment: 'node',
          pool: 'forks',
          fileParallelism: true,
          maxWorkers: 6,
          isolate: true,
          sequence: { groupOrder: 0 },
          setupFiles: ['./server/test/setup.ts'],
          include: [...serverIntegrationTests],
          testTimeout: 20000,
          hookTimeout: 30000,
          env: sharedEnv,
        },
      },
    ],
  },
})
