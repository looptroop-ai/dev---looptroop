import { db, sqlite } from './index'
import { profiles, projects, tickets, phaseArtifacts, opencodeSessions, ticketStatusHistory } from './schema'

console.log('🌱 Seeding database...')

// Delete all existing data (order matters for FK constraints)
db.delete(ticketStatusHistory).run()
db.delete(phaseArtifacts).run()
db.delete(opencodeSessions).run()
db.delete(tickets).run()
db.delete(projects).run()

// Ensure a profile exists
const existingProfile = db.select().from(profiles).get()
const profileId = existingProfile?.id ?? db.insert(profiles).values({
  username: 'developer',
  icon: '👤',
  councilMembers: JSON.stringify(['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.5-pro']),
  minCouncilQuorum: 2,
  maxIterations: 5,
}).returning().get()!.id

console.log(`  ✅ Profile ready (id: ${profileId})`)

// Create projects
const projectRows = db.insert(projects).values([
  { name: 'TravelHub', shortname: 'TRVL', icon: '✈️', color: '#FF6B6B', folderPath: '/mnt/d/travelhub', profileId, ticketCounter: 7 },
  { name: 'MediFlow', shortname: 'MEDI', icon: '🏥', color: '#4ECDC4', folderPath: '/mnt/d/mediflow', profileId, ticketCounter: 7 },
  { name: 'FinAnalytics', shortname: 'FIN', icon: '📊', color: '#95E1D3', folderPath: '/mnt/d/finanalytics', profileId, ticketCounter: 6 },
]).returning().all()
const travelhub = projectRows[0]!
const mediflow = projectRows[1]!
const finanalytics = projectRows[2]!

console.log(`  ✅ Created 3 projects`)

// Helpers
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString()
const council = JSON.stringify(['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.5-pro'])

// Create 20 tickets across various statuses
const ticketRows = db.insert(tickets).values([
  // === TravelHub (7 tickets) ===
  { externalId: 'TRVL-1', projectId: travelhub.id, title: 'Implement user authentication', priority: 1, status: 'COMPLETED', branchName: 'feat/trvl-1-user-auth', percentComplete: 100, startedAt: ago(168), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(192), updatedAt: ago(144), description: 'Implement OAuth and email/password authentication for user sign-up and login.' },
  { externalId: 'TRVL-2', projectId: travelhub.id, title: 'Build flight search engine', priority: 1, status: 'CODING', branchName: 'feat/trvl-2-flight-search', currentBead: 3, totalBeads: 6, percentComplete: 50, startedAt: ago(48), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(72), updatedAt: ago(2), description: 'Implement flight search with filters for date, price, duration, and stops.' },
  { externalId: 'TRVL-3', projectId: travelhub.id, title: 'Create booking engine', priority: 2, status: 'WAITING_PRD_APPROVAL', startedAt: ago(24), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(48), updatedAt: ago(6), description: 'Build the complete booking workflow with seat selection and payment integration.' },
  { externalId: 'TRVL-4', projectId: travelhub.id, title: 'Integrate hotel booking API', priority: 2, status: 'DRAFT', createdAt: ago(36), updatedAt: ago(36), description: 'Connect to major hotel booking APIs for availability and pricing data.' },
  { externalId: 'TRVL-5', projectId: travelhub.id, title: 'Build trip itinerary planner', priority: 2, status: 'RUNNING_FINAL_TEST', branchName: 'feat/trvl-5-itinerary', currentBead: 4, totalBeads: 4, percentComplete: 100, startedAt: ago(56), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, createdAt: ago(72), updatedAt: ago(1), description: 'Allow users to create and manage multi-city trip itineraries with day-by-day plans.' },
  { externalId: 'TRVL-6', projectId: travelhub.id, title: 'Add destination reviews system', priority: 4, status: 'CANCELED', startedAt: ago(120), createdAt: ago(144), updatedAt: ago(96), description: 'Community-driven reviews and ratings for hotels, flights, and destinations.' },
  { externalId: 'TRVL-7', projectId: travelhub.id, title: 'Setup payment gateway integration', priority: 1, status: 'BLOCKED_ERROR', branchName: 'feat/trvl-7-payments', currentBead: 1, totalBeads: 3, percentComplete: 25, startedAt: ago(28), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, errorMessage: 'Stripe API rate limit exceeded during testing, need higher tier plan', createdAt: ago(48), updatedAt: ago(12), description: 'Integrate Stripe for payment processing with support for multiple currencies.' },

  // === MediFlow (7 tickets) ===
  { externalId: 'MEDI-1', projectId: mediflow.id, title: 'Setup patient authentication', priority: 1, status: 'COMPLETED', branchName: 'feat/medi-1-patient-auth', percentComplete: 100, startedAt: ago(240), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(264), updatedAt: ago(192), description: 'Implement secure authentication with HIPAA compliance for patient access.' },
  { externalId: 'MEDI-2', projectId: mediflow.id, title: 'Build appointment scheduler', priority: 2, status: 'WAITING_INTERVIEW_ANSWERS', startedAt: ago(14), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(36), updatedAt: ago(6), description: 'Create appointment booking system with doctor availability and automated reminders.' },
  { externalId: 'MEDI-3', projectId: mediflow.id, title: 'Implement patient records system', priority: 1, status: 'DRAFTING_BEADS', startedAt: ago(32), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(60), updatedAt: ago(8), description: 'Build comprehensive electronic health records with version history and access control.' },
  { externalId: 'MEDI-4', projectId: mediflow.id, title: 'Create prescription management', priority: 2, status: 'COUNCIL_DELIBERATING', startedAt: ago(3), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, createdAt: ago(24), updatedAt: ago(3), description: 'Manage prescription creation, renewal, and pharmacy integration with e-signature support.' },
  { externalId: 'MEDI-5', projectId: mediflow.id, title: 'Add telemedicine video calls', priority: 3, status: 'DRAFTING_PRD', startedAt: ago(10), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(30), updatedAt: ago(4), description: 'Integrate video conferencing for remote consultations with screen sharing for medical images.' },
  { externalId: 'MEDI-6', projectId: mediflow.id, title: 'Integrate lab results system', priority: 2, status: 'DRAFT', createdAt: ago(12), updatedAt: ago(12), description: 'Connect to laboratory information systems for automated lab results delivery.' },
  { externalId: 'MEDI-7', projectId: mediflow.id, title: 'Build notification system', priority: 2, status: 'WAITING_BEADS_APPROVAL', startedAt: ago(20), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(40), updatedAt: ago(7), description: 'Multi-channel notifications for appointments, prescriptions, and lab results via SMS/email/push.' },

  // === FinAnalytics (6 tickets) ===
  { externalId: 'FIN-1', projectId: finanalytics.id, title: 'Setup ETL data pipeline', priority: 1, status: 'COMPLETED', branchName: 'feat/fin-1-etl-pipeline', percentComplete: 100, startedAt: ago(240), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(264), updatedAt: ago(192), description: 'Build ETL pipeline for ingesting financial data from multiple sources.' },
  { externalId: 'FIN-2', projectId: finanalytics.id, title: 'Design analytics dashboard', priority: 1, status: 'CODING', branchName: 'feat/fin-2-dashboard', currentBead: 4, totalBeads: 7, percentComplete: 57, startedAt: ago(60), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(84), updatedAt: ago(3), description: 'Create interactive dashboard with real-time financial metrics and customizable charts.' },
  { externalId: 'FIN-3', projectId: finanalytics.id, title: 'Build automated report generation', priority: 2, status: 'VERIFYING_INTERVIEW_COVERAGE', startedAt: ago(5), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(15), updatedAt: ago(3), description: 'Generate PDF and Excel reports with custom formatting and scheduled delivery.' },
  { externalId: 'FIN-4', projectId: finanalytics.id, title: 'Add predictive analytics models', priority: 3, status: 'DRAFT', createdAt: ago(20), updatedAt: ago(20), description: 'Implement ML models for trend prediction and anomaly detection in financial data.' },
  { externalId: 'FIN-5', projectId: finanalytics.id, title: 'Implement data validation layer', priority: 1, status: 'BLOCKED_ERROR', branchName: 'feat/fin-5-validation', currentBead: 2, totalBeads: 4, percentComplete: 25, startedAt: ago(14), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, errorMessage: 'Schema conflicts between source systems, requiring data mapping rules', createdAt: ago(32), updatedAt: ago(10), description: 'Create comprehensive data validation and transformation rules for data quality.' },
  { externalId: 'FIN-6', projectId: finanalytics.id, title: 'Implement role-based access control', priority: 2, status: 'WAITING_INTERVIEW_APPROVAL', startedAt: ago(8), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(20), updatedAt: ago(5), description: 'Add fine-grained permissions system with role hierarchies and data scoping.' },
]).returning().all()

console.log(`  ✅ Created 20 tickets`)

// Helper to build ticket lookup
type TicketRow = typeof ticketRows[number]
const ticketMap: Record<string, TicketRow> = {}
for (const tr of ticketRows) ticketMap[tr.externalId] = tr
function t(id: string) { return ticketMap[id]!.id }

// Status history for each ticket tracking progression through workflow
const statusHistories: { ticketId: number; previousStatus: string | null; newStatus: string; reason: string; changedAt: string }[] = []

// TRVL-1: DRAFT → COUNCIL_DELIBERATING → RUNNING_FINAL_TEST → COMPLETED
statusHistories.push(
  { ticketId: t('TRVL-1'), previousStatus: 'DRAFT', newStatus: 'COUNCIL_DELIBERATING', reason: 'Interview completed, submitted for council review', changedAt: ago(190) },
  { ticketId: t('TRVL-1'), previousStatus: 'COUNCIL_DELIBERATING', newStatus: 'RUNNING_FINAL_TEST', reason: 'Council approved, moved to testing', changedAt: ago(170) },
  { ticketId: t('TRVL-1'), previousStatus: 'RUNNING_FINAL_TEST', newStatus: 'COMPLETED', reason: 'All tests passed', changedAt: ago(145) },
)

// TRVL-2: DRAFT → WAITING_INTERVIEW_ANSWERS → DRAFTING_PRD → CODING
statusHistories.push(
  { ticketId: t('TRVL-2'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Ticket created, awaiting interview', changedAt: ago(70) },
  { ticketId: t('TRVL-2'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'DRAFTING_PRD', reason: 'Interview answers received', changedAt: ago(65) },
  { ticketId: t('TRVL-2'), previousStatus: 'DRAFTING_PRD', newStatus: 'CODING', reason: 'PRD approved, coding started', changedAt: ago(50) },
)

// TRVL-3: DRAFT → DRAFTING_BEADS → WAITING_PRD_APPROVAL
statusHistories.push(
  { ticketId: t('TRVL-3'), previousStatus: 'DRAFT', newStatus: 'DRAFTING_BEADS', reason: 'Planning initiated', changedAt: ago(46) },
  { ticketId: t('TRVL-3'), previousStatus: 'DRAFTING_BEADS', newStatus: 'WAITING_PRD_APPROVAL', reason: 'Beads drafted, awaiting PRD review', changedAt: ago(25) },
)

// TRVL-4: DRAFT (no status change)
statusHistories.push(
  { ticketId: t('TRVL-4'), previousStatus: null, newStatus: 'DRAFT', reason: 'Ticket created', changedAt: ago(36) },
)

// TRVL-5: DRAFT → WAITING_INTERVIEW_ANSWERS → DRAFTING_BEADS → RUNNING_FINAL_TEST
statusHistories.push(
  { ticketId: t('TRVL-5'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Awaiting interview answers', changedAt: ago(68) },
  { ticketId: t('TRVL-5'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'DRAFTING_BEADS', reason: 'PRD approved, planning beads', changedAt: ago(62) },
  { ticketId: t('TRVL-5'), previousStatus: 'DRAFTING_BEADS', newStatus: 'RUNNING_FINAL_TEST', reason: 'Beads approved, final testing', changedAt: ago(57) },
)

// TRVL-6: DRAFT → COUNCIL_DELIBERATING → CANCELED
statusHistories.push(
  { ticketId: t('TRVL-6'), previousStatus: 'DRAFT', newStatus: 'COUNCIL_DELIBERATING', reason: 'Submitted to council', changedAt: ago(140) },
  { ticketId: t('TRVL-6'), previousStatus: 'COUNCIL_DELIBERATING', newStatus: 'CANCELED', reason: 'Council decision: feature out of scope for current release', changedAt: ago(98) },
)

// TRVL-7: DRAFT → WAITING_INTERVIEW_APPROVAL → CODING → BLOCKED_ERROR
statusHistories.push(
  { ticketId: t('TRVL-7'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_APPROVAL', reason: 'Interview completed', changedAt: ago(45) },
  { ticketId: t('TRVL-7'), previousStatus: 'WAITING_INTERVIEW_APPROVAL', newStatus: 'CODING', reason: 'Approved, coding started', changedAt: ago(30) },
  { ticketId: t('TRVL-7'), previousStatus: 'CODING', newStatus: 'BLOCKED_ERROR', reason: 'Stripe rate limiting issue encountered', changedAt: ago(13) },
)

// MEDI-1: DRAFT → COUNCIL_DELIBERATING → RUNNING_FINAL_TEST → COMPLETED
statusHistories.push(
  { ticketId: t('MEDI-1'), previousStatus: 'DRAFT', newStatus: 'COUNCIL_DELIBERATING', reason: 'Interview and PRD complete', changedAt: ago(260) },
  { ticketId: t('MEDI-1'), previousStatus: 'COUNCIL_DELIBERATING', newStatus: 'RUNNING_FINAL_TEST', reason: 'Council approved beads plan', changedAt: ago(245) },
  { ticketId: t('MEDI-1'), previousStatus: 'RUNNING_FINAL_TEST', newStatus: 'COMPLETED', reason: 'All tests passed, HIPAA compliance verified', changedAt: ago(195) },
)

// MEDI-2: DRAFT → WAITING_INTERVIEW_ANSWERS
statusHistories.push(
  { ticketId: t('MEDI-2'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Ticket submitted for interview', changedAt: ago(35) },
)

// MEDI-3: DRAFT → WAITING_INTERVIEW_ANSWERS → DRAFTING_BEADS
statusHistories.push(
  { ticketId: t('MEDI-3'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Interview scheduled', changedAt: ago(58) },
  { ticketId: t('MEDI-3'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'DRAFTING_BEADS', reason: 'Interview completed, planning implementation', changedAt: ago(33) },
)

// MEDI-4: DRAFT → WAITING_INTERVIEW_APPROVAL → COUNCIL_DELIBERATING
statusHistories.push(
  { ticketId: t('MEDI-4'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_APPROVAL', reason: 'Interview completed', changedAt: ago(22) },
  { ticketId: t('MEDI-4'), previousStatus: 'WAITING_INTERVIEW_APPROVAL', newStatus: 'COUNCIL_DELIBERATING', reason: 'Approved, council is deliberating approach', changedAt: ago(4) },
)

// MEDI-5: DRAFT → DRAFTING_PRD
statusHistories.push(
  { ticketId: t('MEDI-5'), previousStatus: 'DRAFT', newStatus: 'DRAFTING_PRD', reason: 'Interview complete, drafting PRD', changedAt: ago(28) },
)

// MEDI-6: DRAFT (no status change)
statusHistories.push(
  { ticketId: t('MEDI-6'), previousStatus: null, newStatus: 'DRAFT', reason: 'Ticket created', changedAt: ago(12) },
)

// MEDI-7: DRAFT → WAITING_INTERVIEW_ANSWERS → WAITING_BEADS_APPROVAL
statusHistories.push(
  { ticketId: t('MEDI-7'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Interview scheduled', changedAt: ago(38) },
  { ticketId: t('MEDI-7'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'WAITING_BEADS_APPROVAL', reason: 'PRD approved, beads drafted', changedAt: ago(8) },
)

// FIN-1: DRAFT → COUNCIL_DELIBERATING → RUNNING_FINAL_TEST → COMPLETED
statusHistories.push(
  { ticketId: t('FIN-1'), previousStatus: 'DRAFT', newStatus: 'COUNCIL_DELIBERATING', reason: 'Interview and PRD complete', changedAt: ago(260) },
  { ticketId: t('FIN-1'), previousStatus: 'COUNCIL_DELIBERATING', newStatus: 'RUNNING_FINAL_TEST', reason: 'Council approved implementation plan', changedAt: ago(245) },
  { ticketId: t('FIN-1'), previousStatus: 'RUNNING_FINAL_TEST', newStatus: 'COMPLETED', reason: 'Data pipeline validated and tested', changedAt: ago(195) },
)

// FIN-2: DRAFT → WAITING_INTERVIEW_ANSWERS → DRAFTING_PRD → CODING
statusHistories.push(
  { ticketId: t('FIN-2'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Interview scheduled', changedAt: ago(82) },
  { ticketId: t('FIN-2'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'DRAFTING_PRD', reason: 'Interview answers received', changedAt: ago(76) },
  { ticketId: t('FIN-2'), previousStatus: 'DRAFTING_PRD', newStatus: 'CODING', reason: 'PRD approved, coding started', changedAt: ago(61) },
)

// FIN-3: DRAFT → WAITING_INTERVIEW_ANSWERS → VERIFYING_INTERVIEW_COVERAGE
statusHistories.push(
  { ticketId: t('FIN-3'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_ANSWERS', reason: 'Interview in progress', changedAt: ago(13) },
  { ticketId: t('FIN-3'), previousStatus: 'WAITING_INTERVIEW_ANSWERS', newStatus: 'VERIFYING_INTERVIEW_COVERAGE', reason: 'Interview complete, verifying coverage', changedAt: ago(4) },
)

// FIN-4: DRAFT (no status change)
statusHistories.push(
  { ticketId: t('FIN-4'), previousStatus: null, newStatus: 'DRAFT', reason: 'Ticket created', changedAt: ago(20) },
)

// FIN-5: DRAFT → WAITING_INTERVIEW_APPROVAL → CODING → BLOCKED_ERROR
statusHistories.push(
  { ticketId: t('FIN-5'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_APPROVAL', reason: 'Interview completed', changedAt: ago(30) },
  { ticketId: t('FIN-5'), previousStatus: 'WAITING_INTERVIEW_APPROVAL', newStatus: 'CODING', reason: 'Interview approved, coding started', changedAt: ago(15) },
  { ticketId: t('FIN-5'), previousStatus: 'CODING', newStatus: 'BLOCKED_ERROR', reason: 'Schema mapping conflicts encountered', changedAt: ago(10) },
)

// FIN-6: DRAFT → WAITING_INTERVIEW_APPROVAL
statusHistories.push(
  { ticketId: t('FIN-6'), previousStatus: 'DRAFT', newStatus: 'WAITING_INTERVIEW_APPROVAL', reason: 'Interview scheduled', changedAt: ago(18) },
)

db.insert(ticketStatusHistory).values(statusHistories).run()

console.log(`  ✅ Created ${statusHistories.length} status history entries`)

// Phase artifacts for non-DRAFT tickets (simplified - just 1-2 artifacts per ticket)
const artifacts: { ticketId: number; phase: string; artifactType: string; content: string }[] = []

// TravelHub artifacts
artifacts.push(
  { ticketId: t('TRVL-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which OAuth providers should we support?', a: 'Google, GitHub, and Apple for MVP.' },
      { q: 'How should sessions be managed?', a: 'JWT with 24-hour expiration and refresh token rotation.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('TRVL-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What search backends exist?', a: 'Amadeus and Sabre for flight availability.' },
      { q: 'How to handle price caching?', a: '5-minute TTL for price quotes before expiration.' },
    ],
    status: 'pending_approval',
  }) },
  { ticketId: t('TRVL-3'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Booking Engine PRD',
    overview: 'Complete checkout flow with seat selection and payment',
    status: 'pending_approval',
  }) },
  { ticketId: t('TRVL-5'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'UI layout design', status: 'completed' },
      { id: 2, title: 'Day planner component', status: 'completed' },
      { id: 3, title: 'Activity integration', status: 'completed' },
      { id: 4, title: 'Export to PDF/calendar', status: 'completed' },
    ],
  }) },
)

// MediFlow artifacts
artifacts.push(
  { ticketId: t('MEDI-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'HIPAA compliance approach?', a: 'End-to-end encryption and audit logging.' },
      { q: 'Patient ID system?', a: 'Medical Record Number (MRN) with SSN fallback.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('MEDI-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Scheduling buffer time?', a: '15-minute increments, 24-hour advance booking.' },
      { q: 'Cancellation policy?', a: 'Free cancellation up to 24 hours before.' },
    ],
    status: 'awaiting_answers',
  }) },
  { ticketId: t('MEDI-4'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'E-signature provider?', a: 'DocuSign for legal compliance.' },
      { q: 'Pharmacy connectivity?', a: 'NCPDP SCRIPT standard.' },
    ],
    status: 'pending_approval',
  }) },
)

// FinAnalytics artifacts
artifacts.push(
  { ticketId: t('FIN-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Data sources?', a: 'APIs from NYSE, NASDAQ, and crypto exchanges.' },
      { q: 'Pipeline frequency?', a: 'Real-time for crypto, daily batch for stocks.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('FIN-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Dashboard frameworks?', a: 'D3.js and ECharts for charts.' },
      { q: 'Real-time updates?', a: 'WebSocket for live price updates.' },
    ],
    status: 'awaiting_answers',
  }) },
  { ticketId: t('FIN-3'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Report formats?', a: 'PDF, Excel, and CSV exports.' },
      { q: 'Scheduling?', a: 'Daily, weekly, monthly via cron or UI.' },
    ],
    status: 'pending_approval',
  }) },
)

db.insert(phaseArtifacts).values(artifacts).run()

console.log(`  ✅ Created ${artifacts.length} phase artifacts`)

// Close the database cleanly
sqlite.close()
console.log('\n🎉 Seed complete!')
