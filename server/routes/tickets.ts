import { Hono } from 'hono'
import {
  handleListTickets,
  handleGetTicket,
  handleGetUiState,
  handlePutUiState,
  handleCreateTicket,
  handlePatchTicket,
  handleDeleteTicket,
  handleStartTicket,
  handleApproveTicket,
  handleCancelTicket,
  handleAnswerTicket,
  handleSkipTicket,
  handleAnswerBatch,
  handleEditAnswer,
  handleApproveInterview,
  handleApprovePrd,
  handleApproveBeads,
  handleApproveExecutionSetupPlan,
  handleMergeTicket,
  handleCloseUnmergedTicket,
  handleVerifyTicket,
  handleRetryTicket,
  handleListOpenCodeQuestions,
  handleReplyOpenCodeQuestion,
  handleRejectOpenCodeQuestion,
  handleDevEvent,
  handleGetInterview,
  handleGetExecutionSetupPlan,
  handlePutInterview,
  handlePutInterviewAnswers,
  handlePutExecutionSetupPlan,
  handleRegenerateExecutionSetupPlan,
  handleGetArtifacts,
  handleListPhaseAttempts,
} from './ticketHandlers'

const ticketRouter = new Hono()

ticketRouter.get('/tickets', (c) => handleListTickets(c))
ticketRouter.get('/tickets/:id', (c) => handleGetTicket(c))
ticketRouter.get('/tickets/:id/ui-state', (c) => handleGetUiState(c))
ticketRouter.put('/tickets/:id/ui-state', async (c) => handlePutUiState(c))
ticketRouter.post('/tickets', async (c) => handleCreateTicket(c))
ticketRouter.patch('/tickets/:id', async (c) => handlePatchTicket(c))
ticketRouter.delete('/tickets/:id', async (c) => handleDeleteTicket(c))
ticketRouter.post('/tickets/:id/start', async (c) => handleStartTicket(c))
ticketRouter.post('/tickets/:id/approve', (c) => handleApproveTicket(c))
ticketRouter.post('/tickets/:id/cancel', (c) => handleCancelTicket(c))
ticketRouter.post('/tickets/:id/answer', async (c) => handleAnswerTicket(c))
ticketRouter.post('/tickets/:id/skip', async (c) => handleSkipTicket(c))
ticketRouter.post('/tickets/:id/answer-batch', async (c) => handleAnswerBatch(c))
ticketRouter.patch('/tickets/:id/edit-answer', async (c) => handleEditAnswer(c))
ticketRouter.put('/tickets/:id/interview', async (c) => handlePutInterview(c))
ticketRouter.put('/tickets/:id/interview-answers', async (c) => handlePutInterviewAnswers(c))
ticketRouter.get('/tickets/:id/execution-setup-plan', (c) => handleGetExecutionSetupPlan(c))
ticketRouter.put('/tickets/:id/execution-setup-plan', async (c) => handlePutExecutionSetupPlan(c))
ticketRouter.post('/tickets/:id/regenerate-execution-setup-plan', async (c) => handleRegenerateExecutionSetupPlan(c))
ticketRouter.post('/tickets/:id/approve-interview', (c) => handleApproveInterview(c))
ticketRouter.post('/tickets/:id/approve-prd', (c) => handleApprovePrd(c))
ticketRouter.post('/tickets/:id/approve-beads', (c) => handleApproveBeads(c))
ticketRouter.post('/tickets/:id/approve-execution-setup-plan', (c) => handleApproveExecutionSetupPlan(c))
ticketRouter.post('/tickets/:id/merge', (c) => handleMergeTicket(c))
ticketRouter.post('/tickets/:id/close-unmerged', (c) => handleCloseUnmergedTicket(c))
ticketRouter.post('/tickets/:id/verify', (c) => handleVerifyTicket(c))
ticketRouter.post('/tickets/:id/retry', (c) => handleRetryTicket(c))
ticketRouter.get('/tickets/:id/opencode/questions', (c) => handleListOpenCodeQuestions(c))
ticketRouter.post('/tickets/:id/opencode/questions/:requestId/reply', (c) => handleReplyOpenCodeQuestion(c))
ticketRouter.post('/tickets/:id/opencode/questions/:requestId/reject', (c) => handleRejectOpenCodeQuestion(c))
ticketRouter.post('/tickets/:id/dev-event', async (c) => handleDevEvent(c))
ticketRouter.get('/tickets/:id/interview', (c) => handleGetInterview(c))
ticketRouter.get('/tickets/:id/artifacts', (c) => handleGetArtifacts(c))
ticketRouter.get('/tickets/:id/phases/:phase/attempts', (c) => handleListPhaseAttempts(c))

export { ticketRouter }
