import { db, sqlite } from './index'
import { profiles, projects, tickets, phaseArtifacts, opencodeSessions } from './schema'

console.log('🌱 Seeding database...')

// Delete all existing data (order matters for FK constraints)
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
  { name: 'MoneyBank', shortname: 'MBNK', icon: '🏦', color: '#0ea5e9', folderPath: '/mnt/d/moneybank', profileId, ticketCounter: 4 },
  { name: 'GameForge', shortname: 'GMFRG', icon: '🎮', color: '#8b5cf6', folderPath: '/mnt/d/gameforge', profileId, ticketCounter: 3 },
  { name: 'CloudOps', shortname: 'CLDOP', icon: '☁️', color: '#10b981', folderPath: '/mnt/d/cloudops', profileId, ticketCounter: 3 },
]).returning().all()
const moneybank = projectRows[0]!
const gameforge = projectRows[1]!
const cloudops = projectRows[2]!

console.log(`  ✅ Created ${3} projects`)

// Create tickets
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString()

const ticketRows = db.insert(tickets).values([
  { externalId: 'MBNK-1', projectId: moneybank.id, title: 'Implement user authentication', priority: 1, status: 'COMPLETED', branchName: 'feat/mbnk-1-user-auth', percentComplete: 100, startedAt: ago(72), description: 'Implement JWT-based user authentication with login, signup, and password reset flows.' },
  { externalId: 'MBNK-2', projectId: moneybank.id, title: 'Add payment gateway integration', priority: 1, status: 'CODING', branchName: 'feat/mbnk-2-payment-gateway', currentBead: 3, totalBeads: 8, percentComplete: 37.5, startedAt: ago(24), description: 'Integrate Stripe payment gateway for processing credit card and ACH transactions.' },
  { externalId: 'MBNK-3', projectId: moneybank.id, title: 'Create account dashboard', priority: 2, status: 'WAITING_PRD_APPROVAL', startedAt: ago(12), description: 'Build a comprehensive account dashboard showing balances, recent transactions, and spending analytics.' },
  { externalId: 'MBNK-4', projectId: moneybank.id, title: 'Fix transaction rounding errors', priority: 1, status: 'DRAFT', description: 'Investigate and fix floating point rounding errors in transaction amount calculations.' },
  { externalId: 'GMFRG-1', projectId: gameforge.id, title: 'Design game lobby UI', priority: 2, status: 'WAITING_INTERVIEW_ANSWERS', startedAt: ago(8), description: 'Design and implement the multiplayer game lobby with room creation, player lists, and chat.' },
  { externalId: 'GMFRG-2', projectId: gameforge.id, title: 'Implement multiplayer sync', priority: 1, status: 'DRAFTING_BEADS', startedAt: ago(18), description: 'Build real-time game state synchronization using WebSockets with conflict resolution.' },
  { externalId: 'GMFRG-3', projectId: gameforge.id, title: 'Add leaderboard system', priority: 3, status: 'DRAFT', description: 'Create a global leaderboard system with ranking algorithms and seasonal resets.' },
  { externalId: 'CLDOP-1', projectId: cloudops.id, title: 'Setup CI/CD pipeline', priority: 2, status: 'COMPLETED', branchName: 'feat/cldop-1-cicd', percentComplete: 100, startedAt: ago(96), description: 'Configure GitHub Actions CI/CD pipeline with staging and production deployment targets.' },
  { externalId: 'CLDOP-2', projectId: cloudops.id, title: 'Implement auto-scaling', priority: 1, status: 'BLOCKED_ERROR', branchName: 'feat/cldop-2-autoscaling', currentBead: 2, totalBeads: 6, percentComplete: 25, startedAt: ago(36), errorMessage: 'Terraform apply failed: AWS IAM role permission denied for autoscaling:CreateAutoScalingGroup', description: 'Implement Kubernetes HPA and cluster auto-scaling based on CPU/memory metrics.' },
  { externalId: 'CLDOP-3', projectId: cloudops.id, title: 'Add monitoring dashboard', priority: 4, status: 'CANCELED', startedAt: ago(48), description: 'Build a Grafana-based monitoring dashboard for infrastructure and application metrics.' },
]).returning().all()

console.log(`  ✅ Created ${ticketRows.length} tickets`)

// Helper to build ticket lookup
type TicketRow = typeof ticketRows[number]
const ticketMap: Record<string, TicketRow> = {}
for (const t of ticketRows) ticketMap[t.externalId] = t
function t(id: string) { return ticketMap[id]!.id }

// Phase artifacts for non-DRAFT tickets
const artifacts: { ticketId: number; phase: string; artifactType: string; content: string }[] = []

// MBNK-1 (COMPLETED) — all phases done
artifacts.push(
  { ticketId: t('MBNK-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What authentication method should we use?', a: 'JWT with refresh tokens, stored in httpOnly cookies.' },
      { q: 'Should we support OAuth providers?', a: 'Not in the initial implementation. Focus on email/password first.' },
      { q: 'What password requirements?', a: 'Minimum 8 chars, at least one uppercase, one number, one special character.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('MBNK-1'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'User Authentication PRD',
    overview: 'Implement a secure JWT-based authentication system supporting signup, login, logout, and password reset.',
    requirements: [
      'Users can register with email and password',
      'Login returns JWT access token (15min) and refresh token (7d)',
      'Password reset via email verification link',
      'Rate limiting on auth endpoints (5 attempts per minute)',
    ],
    technicalApproach: 'Use bcrypt for hashing, jose library for JWT, Redis for refresh token storage.',
    status: 'approved',
  }) },
  { ticketId: t('MBNK-1'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Setup auth module structure', status: 'completed' },
      { id: 2, title: 'Implement signup endpoint', status: 'completed' },
      { id: 3, title: 'Implement login endpoint', status: 'completed' },
      { id: 4, title: 'Add refresh token rotation', status: 'completed' },
      { id: 5, title: 'Password reset flow', status: 'completed' },
    ],
  }) },
)

// MBNK-2 (CODING) — interview, prd, beads all done
artifacts.push(
  { ticketId: t('MBNK-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which payment provider?', a: 'Stripe — they support both card and ACH.' },
      { q: 'Do we need subscription billing?', a: 'Not yet, only one-time payments for now.' },
      { q: 'PCI compliance strategy?', a: 'Use Stripe Elements so card data never touches our servers.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('MBNK-2'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Payment Gateway Integration PRD',
    overview: 'Integrate Stripe to process credit card and ACH payments with proper error handling.',
    requirements: [
      'Accept Visa, Mastercard, Amex via Stripe Elements',
      'Support ACH bank transfers for amounts over $500',
      'Webhook handler for payment status updates',
      'Idempotent payment creation to prevent double charges',
    ],
    technicalApproach: 'Stripe SDK v14, webhook signature verification, database transaction logging.',
    status: 'approved',
  }) },
  { ticketId: t('MBNK-2'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Setup Stripe SDK and config', status: 'completed' },
      { id: 2, title: 'Payment intent creation API', status: 'completed' },
      { id: 3, title: 'Stripe Elements frontend integration', status: 'in_progress' },
      { id: 4, title: 'Webhook handler', status: 'pending' },
      { id: 5, title: 'ACH payment support', status: 'pending' },
      { id: 6, title: 'Payment history and receipts', status: 'pending' },
      { id: 7, title: 'Error handling and retry logic', status: 'pending' },
      { id: 8, title: 'E2E payment flow tests', status: 'pending' },
    ],
  }) },
)

// MBNK-3 (WAITING_PRD_APPROVAL) — interview done, prd drafted
artifacts.push(
  { ticketId: t('MBNK-3'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What key metrics should the dashboard show?', a: 'Account balance, monthly spending, recent transactions, savings goals progress.' },
      { q: 'Should it support multiple accounts?', a: 'Yes, users can have checking, savings, and investment accounts.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('MBNK-3'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Account Dashboard PRD',
    overview: 'Build a dashboard with account balances, transaction history, and spending analytics.',
    requirements: [
      'Display aggregate balance across all accounts',
      'Show last 30 transactions with search and filter',
      'Monthly spending breakdown by category (pie chart)',
      'Savings goal progress bars',
    ],
    technicalApproach: 'React components with TanStack Query, recharts for visualizations, virtual scrolling for transaction list.',
    status: 'pending_approval',
  }) },
)

// GMFRG-1 (WAITING_INTERVIEW_ANSWERS) — interview in progress
artifacts.push(
  { ticketId: t('GMFRG-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What is the maximum number of players per lobby?', a: null },
      { q: 'Should the lobby support spectators?', a: null },
      { q: 'What chat features are needed?', a: 'Text chat with emoji support, no voice.' },
    ],
    status: 'awaiting_answers',
  }) },
)

// GMFRG-2 (DRAFTING_BEADS) — interview and prd done, beads being drafted
artifacts.push(
  { ticketId: t('GMFRG-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What is the target tick rate?', a: '60 ticks per second for action games, 20 for turn-based.' },
      { q: 'How should conflicts be resolved?', a: 'Server-authoritative model with client-side prediction.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('GMFRG-2'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Multiplayer Sync PRD',
    overview: 'Real-time game state synchronization using WebSockets with server-authoritative conflict resolution.',
    requirements: [
      'WebSocket connection with automatic reconnection',
      'Server-authoritative game state at 60 ticks/sec',
      'Client-side prediction with server reconciliation',
      'Delta compression for bandwidth optimization',
    ],
    technicalApproach: 'Custom WebSocket protocol, binary message format with MessagePack, ring buffer for state history.',
    status: 'approved',
  }) },
)

// CLDOP-1 (COMPLETED) — all phases done
artifacts.push(
  { ticketId: t('CLDOP-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which CI platform?', a: 'GitHub Actions — already used for other repos.' },
      { q: 'What environments?', a: 'Staging (auto-deploy on PR merge) and production (manual approval).' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-1'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'CI/CD Pipeline PRD',
    overview: 'GitHub Actions pipeline with lint, test, build, and deploy stages for staging and production.',
    requirements: [
      'Run lint and tests on every PR',
      'Auto-deploy to staging on merge to main',
      'Manual approval gate for production deployments',
      'Slack notifications for deploy status',
    ],
    technicalApproach: 'GitHub Actions reusable workflows, Docker multi-stage builds, AWS ECS deployment.',
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-1'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Setup GitHub Actions workflow files', status: 'completed' },
      { id: 2, title: 'Configure Docker builds', status: 'completed' },
      { id: 3, title: 'Staging auto-deploy', status: 'completed' },
      { id: 4, title: 'Production deploy with approval', status: 'completed' },
      { id: 5, title: 'Slack notification integration', status: 'completed' },
    ],
  }) },
)

// CLDOP-2 (BLOCKED_ERROR) — interview, prd, beads done but stuck during coding
artifacts.push(
  { ticketId: t('CLDOP-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What metrics should trigger scaling?', a: 'CPU > 70% and memory > 80%, with a 3-minute cooldown.' },
      { q: 'Min/max instance counts?', a: 'Min 2, max 20 for production. Min 1, max 3 for staging.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-2'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Auto-scaling PRD',
    overview: 'Kubernetes HPA and cluster auto-scaling based on CPU and memory metrics.',
    requirements: [
      'Horizontal pod autoscaler with CPU/memory targets',
      'Cluster autoscaler for node group management',
      'Per-environment scaling policies',
      'Cost alerts when scaling exceeds budget thresholds',
    ],
    technicalApproach: 'Terraform for infrastructure, Kubernetes metrics-server, custom Prometheus metrics for advanced scaling.',
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-2'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Terraform HPA module', status: 'completed' },
      { id: 2, title: 'Cluster autoscaler configuration', status: 'failed' },
      { id: 3, title: 'Scaling policies per environment', status: 'pending' },
      { id: 4, title: 'Prometheus custom metrics', status: 'pending' },
      { id: 5, title: 'Cost alert integration', status: 'pending' },
      { id: 6, title: 'Load testing and validation', status: 'pending' },
    ],
  }) },
)

// CLDOP-3 (CANCELED) — interview done, then canceled
artifacts.push(
  { ticketId: t('CLDOP-3'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which monitoring stack?', a: 'Grafana with Prometheus data source.' },
      { q: 'What dashboards are needed?', a: 'Infrastructure health, application performance, and error rate dashboards.' },
    ],
    status: 'approved',
  }) },
)

db.insert(phaseArtifacts).values(artifacts).run()

console.log(`  ✅ Created ${artifacts.length} phase artifacts`)

// Close the database cleanly
sqlite.close()
console.log('\n🎉 Seed complete!')
