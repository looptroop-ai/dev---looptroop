import { createActor } from 'xstate'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketContext, TicketEvent } from '../machines/types'
import { CancelledError } from '../council/types'
import { isMockOpenCodeMode } from '../opencode/factory'

// Import from phase modules
import {
  // State
  runningPhases,
  interviewQASessions,
  phaseIntermediate,
  cancelTicket,
  getOrCreateAbortSignal,

  // Helpers
  emitPhaseLog,
  tryRecoverPhaseIntermediate,

  // Interview phase
  handleInterviewDeliberate,
  handleInterviewVote,
  handleInterviewCompile,
  handleInterviewQAStart,
  handleInterviewQABatch,
  processInterviewBatchAsync,
  skipAllInterviewQuestionsToApproval,
  handleMockCouncilDeliberate,
  handleMockInterviewVote,
  handleMockInterviewCompile,
  handleMockInterviewQAStart,

  // PRD phase
  handlePrdDraft,
  handlePrdVote,
  handlePrdRefine,
  handleMockPrdDraft,
  handleMockPrdVote,
  handleMockPrdRefine,

  // Beads phase
  handleBeadsDraft,
  handleBeadsVote,
  handleBeadsRefine,
  handleMockBeadsDraft,
  handleMockBeadsVote,
  handleMockBeadsRefine,

  // Execution phase
  handleCoding,
  handleMockExecutionUnsupported,

  // Verification phase
  handleRelevantFilesScan,
  handleCoverageVerification,
  handlePreFlight,
  handleFinalTest,
  handleMockCoverage,

  // Integration phase
  handleIntegration,
  handleCreatePullRequest,

  // Cleanup phase
  handleCleanup,
} from './phases'

// Re-export public API for external callers
export {
  cancelTicket,
  handleInterviewQABatch,
  processInterviewBatchAsync,
  skipAllInterviewQuestionsToApproval,
  handleRelevantFilesScan,
}

async function handleMockLifecycleState(
  ticketId: string,
  context: TicketContext,
  state: string,
  sendEvent: (event: TicketEvent) => void,
) {
  switch (state) {
    case 'SCANNING_RELEVANT_FILES':
      sendEvent({ type: 'RELEVANT_FILES_READY' })
      return
    case 'COUNCIL_DELIBERATING':
      await handleMockCouncilDeliberate(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_INTERVIEW':
      await handleMockInterviewVote(ticketId, context, sendEvent)
      return
    case 'COMPILING_INTERVIEW':
      await handleMockInterviewCompile(ticketId, context, sendEvent)
      return
    case 'WAITING_INTERVIEW_ANSWERS':
      if (!interviewQASessions.has(ticketId)) {
        await handleMockInterviewQAStart(ticketId, context)
      }
      return
    case 'VERIFYING_INTERVIEW_COVERAGE':
      await handleMockCoverage(ticketId, context, 'interview', sendEvent)
      return
    case 'DRAFTING_PRD':
      await handleMockPrdDraft(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_PRD':
      await handleMockPrdVote(ticketId, context, sendEvent)
      return
    case 'REFINING_PRD':
      await handleMockPrdRefine(ticketId, context, sendEvent)
      return
    case 'VERIFYING_PRD_COVERAGE':
      await handleMockCoverage(ticketId, context, 'prd', sendEvent)
      return
    case 'DRAFTING_BEADS':
      await handleMockBeadsDraft(ticketId, context, sendEvent)
      return
    case 'COUNCIL_VOTING_BEADS':
      await handleMockBeadsVote(ticketId, context, sendEvent)
      return
    case 'REFINING_BEADS':
      await handleMockBeadsRefine(ticketId, context, sendEvent)
      return
    case 'VERIFYING_BEADS_COVERAGE':
      await handleMockCoverage(ticketId, context, 'beads', sendEvent)
      return
    case 'PRE_FLIGHT_CHECK':
      await handleMockExecutionUnsupported(ticketId, context, 'PRE_FLIGHT_CHECK', sendEvent)
      return
    case 'CODING':
      await handleMockExecutionUnsupported(ticketId, context, 'CODING', sendEvent)
      return
    case 'RUNNING_FINAL_TEST':
      await handleMockExecutionUnsupported(ticketId, context, 'RUNNING_FINAL_TEST', sendEvent)
      return
    case 'INTEGRATING_CHANGES':
      await handleMockExecutionUnsupported(ticketId, context, 'INTEGRATING_CHANGES', sendEvent)
      return
    case 'CREATING_PULL_REQUEST':
      await handleMockExecutionUnsupported(ticketId, context, 'CREATING_PULL_REQUEST', sendEvent)
      return
    case 'CLEANING_ENV':
      await handleMockExecutionUnsupported(ticketId, context, 'CLEANING_ENV', sendEvent)
      return
  }
}

function resolveSnapshotState(
  snapshot: ReturnType<ReturnType<typeof createActor<typeof ticketMachine>>['getSnapshot']>,
) {
  return typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
}

function startCodingPhase(
  ticketId: string,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
  sendEvent: (event: TicketEvent) => void,
) {
  const snapshot = actor.getSnapshot()
  const state = resolveSnapshotState(snapshot)
  const key = `${ticketId}:CODING`

  if (state !== 'CODING' || runningPhases.has(key)) return

  const signal = getOrCreateAbortSignal(ticketId)
  const context = snapshot.context

  runningPhases.add(key)
  handleCoding(ticketId, context, sendEvent, signal)
    .catch(err => {
      if (err instanceof CancelledError) return
      const errMsg = err instanceof Error ? err.message : String(err)
      emitPhaseLog(ticketId, context.externalId, 'CODING', 'error', errMsg)
      sendEvent({ type: 'ERROR', message: errMsg, codes: ['CODING_FAILED'] })
    })
    .finally(() => {
      runningPhases.delete(key)

      // CODING self-transitions after each successful bead. Re-check the actor
      // once the current pass unwinds so the next bead can start.
      queueMicrotask(() => {
        startCodingPhase(ticketId, actor, sendEvent)
      })
    })
}

export function attachWorkflowRunner(
  ticketId: string,
  actor: ReturnType<typeof createActor<typeof ticketMachine>>,
  sendEvent: (event: TicketEvent) => void,
) {
  actor.subscribe((snapshot) => {
    const state = resolveSnapshotState(snapshot)
    const context = snapshot.context
    const key = `${ticketId}:${state}`

    // When the ticket reaches CANCELED, abort all running work
    if (state === 'CANCELED') {
      cancelTicket(ticketId)
      return
    }

    if (runningPhases.has(key)) return

    const signal = getOrCreateAbortSignal(ticketId)

    if (isMockOpenCodeMode()) {
      const mockHandledStates = new Set([
        'SCANNING_RELEVANT_FILES',
        'COUNCIL_DELIBERATING',
        'COUNCIL_VOTING_INTERVIEW',
        'COMPILING_INTERVIEW',
        'WAITING_INTERVIEW_ANSWERS',
        'VERIFYING_INTERVIEW_COVERAGE',
        'DRAFTING_PRD',
        'COUNCIL_VOTING_PRD',
        'REFINING_PRD',
        'VERIFYING_PRD_COVERAGE',
        'DRAFTING_BEADS',
        'COUNCIL_VOTING_BEADS',
        'REFINING_BEADS',
        'VERIFYING_BEADS_COVERAGE',
        'PRE_FLIGHT_CHECK',
        'CODING',
        'RUNNING_FINAL_TEST',
        'INTEGRATING_CHANGES',
        'CREATING_PULL_REQUEST',
        'CLEANING_ENV',
      ])

      if (mockHandledStates.has(state)) {
        runningPhases.add(key)
        handleMockLifecycleState(ticketId, context, state, sendEvent)
          .catch((err: unknown) => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, state, 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['MOCK_LIFECYCLE_FAILED'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
        return
      }
    }

    if (state === 'SCANNING_RELEVANT_FILES') {
      runningPhases.add(key)
        handleRelevantFilesScan(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'SCANNING_RELEVANT_FILES', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['RELEVANT_FILES_SCAN_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_DELIBERATING') {
      runningPhases.add(key)
      handleInterviewDeliberate(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          const isOpenCode = errMsg.includes('OpenCode server is not running')
          const isWorkspace = errMsg.includes('Ticket workspace not initialized')
          const codes = isOpenCode
            ? ['OPENCODE_UNREACHABLE']
            : isWorkspace
              ? ['WORKSPACE_NOT_INITIALIZED']
              : ['QUORUM_NOT_MET']
          emitPhaseLog(ticketId, context.externalId, 'COUNCIL_DELIBERATING', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_INTERVIEW') {
      if (phaseIntermediate.has(`${ticketId}:interview`) || tryRecoverPhaseIntermediate(ticketId, context, 'interview', false)) {
        runningPhases.add(key)
        handleInterviewVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_INTERVIEW', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run deliberation.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'COMPILING_INTERVIEW') {
      if (phaseIntermediate.has(`${ticketId}:interview`) || tryRecoverPhaseIntermediate(ticketId, context, 'interview', true)) {
        runningPhases.add(key)
        handleInterviewCompile(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'COMPILING_INTERVIEW', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run deliberation.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'WAITING_INTERVIEW_ANSWERS') {
      // Start PROM4 session if not already running
      const qaInitKey = `${ticketId}:interview_qa_init`
      if (!interviewQASessions.has(ticketId) && !runningPhases.has(qaInitKey)) {
        runningPhases.add(qaInitKey)
        handleInterviewQAStart(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'WAITING_INTERVIEW_ANSWERS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['PROM4_INIT_FAILED'] })
          })
          .finally(() => {
            runningPhases.delete(qaInitKey)
          })
      }
    } else if (state === 'VERIFYING_INTERVIEW_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'interview', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_INTERVIEW_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'DRAFTING_PRD') {
      runningPhases.add(key)
      handlePrdDraft(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'DRAFTING_PRD', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_PRD') {
      if (phaseIntermediate.has(`${ticketId}:prd`) || tryRecoverPhaseIntermediate(ticketId, context, 'prd', false)) {
        runningPhases.add(key)
        handlePrdVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_PRD', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run PRD drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'REFINING_PRD') {
      if (phaseIntermediate.has(`${ticketId}:prd`) || tryRecoverPhaseIntermediate(ticketId, context, 'prd', true)) {
        runningPhases.add(key)
        handlePrdRefine(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'REFINING_PRD', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run PRD drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'VERIFYING_PRD_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'prd', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_PRD_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'DRAFTING_BEADS') {
      runningPhases.add(key)
      handleBeadsDraft(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'DRAFTING_BEADS', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'COUNCIL_VOTING_BEADS') {
      if (phaseIntermediate.has(`${ticketId}:beads`) || tryRecoverPhaseIntermediate(ticketId, context, 'beads', false)) {
        runningPhases.add(key)
        handleBeadsVote(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'COUNCIL_VOTING_BEADS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg, codes: ['QUORUM_NOT_MET'] })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run beads drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'REFINING_BEADS') {
      if (phaseIntermediate.has(`${ticketId}:beads`) || tryRecoverPhaseIntermediate(ticketId, context, 'beads', true)) {
        runningPhases.add(key)
        handleBeadsRefine(ticketId, context, sendEvent, signal)
          .catch(err => {
            if (err instanceof CancelledError) return
            const errMsg = err instanceof Error ? err.message : String(err)
            emitPhaseLog(ticketId, context.externalId, 'REFINING_BEADS', 'error', errMsg)
            sendEvent({ type: 'ERROR', message: errMsg })
          })
          .finally(() => {
            runningPhases.delete(key)
          })
      } else {
        sendEvent({ type: 'ERROR', message: 'Council data lost after restart. Retry to re-run beads drafting.', codes: ['INTERMEDIATE_DATA_LOST'] })
      }
    } else if (state === 'VERIFYING_BEADS_COVERAGE') {
      runningPhases.add(key)
      handleCoverageVerification(ticketId, context, sendEvent, 'beads', signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'VERIFYING_BEADS_COVERAGE', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['COVERAGE_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'PRE_FLIGHT_CHECK') {
      runningPhases.add(key)
      handlePreFlight(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'PRE_FLIGHT_CHECK', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['PREFLIGHT_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'CODING') {
      startCodingPhase(ticketId, actor, sendEvent)
    } else if (state === 'RUNNING_FINAL_TEST') {
      runningPhases.add(key)
      handleFinalTest(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'RUNNING_FINAL_TEST', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['TESTS_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'INTEGRATING_CHANGES') {
      runningPhases.add(key)
      handleIntegration(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'INTEGRATING_CHANGES', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['INTEGRATION_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'CREATING_PULL_REQUEST') {
      runningPhases.add(key)
      handleCreatePullRequest(ticketId, context, sendEvent, signal)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'CREATING_PULL_REQUEST', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['PULL_REQUEST_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    } else if (state === 'CLEANING_ENV') {
      runningPhases.add(key)
      handleCleanup(ticketId, context, sendEvent)
        .catch(err => {
          if (err instanceof CancelledError) return
          const errMsg = err instanceof Error ? err.message : String(err)
          emitPhaseLog(ticketId, context.externalId, 'CLEANING_ENV', 'error', errMsg)
          sendEvent({ type: 'ERROR', message: errMsg, codes: ['CLEANUP_FAILED'] })
        })
        .finally(() => {
          runningPhases.delete(key)
        })
    }
  })
}
