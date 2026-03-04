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
  { name: 'MoneyBank', shortname: 'MBNK', icon: '🏦', color: '#0ea5e9', folderPath: '/mnt/d/moneybank', profileId, ticketCounter: 8 },
  { name: 'GameForge', shortname: 'GMFRG', icon: '🎮', color: '#8b5cf6', folderPath: '/mnt/d/gameforge', profileId, ticketCounter: 6 },
  { name: 'CloudOps', shortname: 'CLDOP', icon: '☁️', color: '#10b981', folderPath: '/mnt/d/cloudops', profileId, ticketCounter: 6 },
]).returning().all()
const moneybank = projectRows[0]!
const gameforge = projectRows[1]!
const cloudops = projectRows[2]!

console.log(`  ✅ Created 3 projects`)

// Helpers
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString()
const council = JSON.stringify(['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.5-pro'])

// Create 20 tickets across various statuses
const ticketRows = db.insert(tickets).values([
  // === MoneyBank (8 tickets) ===
  // 1. COMPLETED — user auth
  { externalId: 'MBNK-1', projectId: moneybank.id, title: 'Implement user authentication', priority: 1, status: 'COMPLETED', branchName: 'feat/mbnk-1-user-auth', percentComplete: 100, startedAt: ago(168), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(192), updatedAt: ago(144), description: 'Implement JWT-based user authentication with login, signup, and password reset flows.' },
  // 2. CODING — payment gateway (bead 3/8)
  { externalId: 'MBNK-2', projectId: moneybank.id, title: 'Add payment gateway integration', priority: 1, status: 'CODING', branchName: 'feat/mbnk-2-payment-gateway', currentBead: 3, totalBeads: 8, percentComplete: 37.5, startedAt: ago(48), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(72), updatedAt: ago(2), description: 'Integrate Stripe payment gateway for processing credit card and ACH transactions.' },
  // 3. WAITING_PRD_APPROVAL — account dashboard
  { externalId: 'MBNK-3', projectId: moneybank.id, title: 'Create account dashboard', priority: 2, status: 'WAITING_PRD_APPROVAL', startedAt: ago(24), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(48), updatedAt: ago(6), description: 'Build a comprehensive account dashboard showing balances, recent transactions, and spending analytics.' },
  // 4. DRAFT — rounding errors
  { externalId: 'MBNK-4', projectId: moneybank.id, title: 'Fix transaction rounding errors', priority: 1, status: 'DRAFT', createdAt: ago(36), updatedAt: ago(36), description: 'Investigate and fix floating point rounding errors in transaction amount calculations.' },
  // 5. COUNCIL_DELIBERATING — notifications
  { externalId: 'MBNK-5', projectId: moneybank.id, title: 'Build notification system', priority: 2, status: 'COUNCIL_DELIBERATING', startedAt: ago(3), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, createdAt: ago(24), updatedAt: ago(3), description: 'Implement push notifications for transaction alerts, low balance warnings, and security events.' },
  // 6. DRAFTING_PRD — export feature
  { externalId: 'MBNK-6', projectId: moneybank.id, title: 'Add CSV/PDF export for statements', priority: 3, status: 'DRAFTING_PRD', startedAt: ago(10), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(30), updatedAt: ago(4), description: 'Allow users to export account statements as CSV or PDF with date range filters.' },
  // 7. DRAFT — 2FA
  { externalId: 'MBNK-7', projectId: moneybank.id, title: 'Add two-factor authentication', priority: 2, status: 'DRAFT', createdAt: ago(12), updatedAt: ago(12), description: 'Implement TOTP-based two-factor authentication with backup codes and recovery flow.' },
  // 8. WAITING_INTERVIEW_APPROVAL — rate limiting
  { externalId: 'MBNK-8', projectId: moneybank.id, title: 'Implement API rate limiting', priority: 2, status: 'WAITING_INTERVIEW_APPROVAL', startedAt: ago(8), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(20), updatedAt: ago(5), description: 'Add sliding window rate limiting per user/IP with configurable thresholds and Redis backing.' },

  // === GameForge (6 tickets) ===
  // 9. WAITING_INTERVIEW_ANSWERS — lobby UI
  { externalId: 'GMFRG-1', projectId: gameforge.id, title: 'Design game lobby UI', priority: 2, status: 'WAITING_INTERVIEW_ANSWERS', startedAt: ago(14), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(36), updatedAt: ago(6), description: 'Design and implement the multiplayer game lobby with room creation, player lists, and chat.' },
  // 10. DRAFTING_BEADS — multiplayer sync
  { externalId: 'GMFRG-2', projectId: gameforge.id, title: 'Implement multiplayer sync', priority: 1, status: 'DRAFTING_BEADS', startedAt: ago(32), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(60), updatedAt: ago(8), description: 'Build real-time game state synchronization using WebSockets with conflict resolution.' },
  // 11. DRAFT — leaderboard
  { externalId: 'GMFRG-3', projectId: gameforge.id, title: 'Add leaderboard system', priority: 3, status: 'DRAFT', createdAt: ago(18), updatedAt: ago(18), description: 'Create a global leaderboard system with ranking algorithms and seasonal resets.' },
  // 12. RUNNING_FINAL_TEST — inventory system
  { externalId: 'GMFRG-4', projectId: gameforge.id, title: 'Build player inventory system', priority: 2, status: 'RUNNING_FINAL_TEST', branchName: 'feat/gmfrg-4-inventory', currentBead: 5, totalBeads: 5, percentComplete: 95, startedAt: ago(56), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, createdAt: ago(72), updatedAt: ago(1), description: 'Implement in-game inventory with drag-and-drop, item stacking, and equipment slots.' },
  // 13. WAITING_BEADS_APPROVAL — matchmaking
  { externalId: 'GMFRG-5', projectId: gameforge.id, title: 'Implement matchmaking algorithm', priority: 1, status: 'WAITING_BEADS_APPROVAL', startedAt: ago(20), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, createdAt: ago(40), updatedAt: ago(7), description: 'Build ELO-based matchmaking with skill brackets, queue management, and party support.' },
  // 14. VERIFYING_INTERVIEW_COVERAGE — achievements
  { externalId: 'GMFRG-6', projectId: gameforge.id, title: 'Add achievement system', priority: 4, status: 'VERIFYING_INTERVIEW_COVERAGE', startedAt: ago(5), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(15), updatedAt: ago(3), description: 'Create an achievement/trophy system with unlock conditions, progress tracking, and badge display.' },

  // === CloudOps (6 tickets) ===
  // 15. COMPLETED — CI/CD
  { externalId: 'CLDOP-1', projectId: cloudops.id, title: 'Setup CI/CD pipeline', priority: 2, status: 'COMPLETED', branchName: 'feat/cldop-1-cicd', percentComplete: 100, startedAt: ago(240), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(264), updatedAt: ago(192), description: 'Configure GitHub Actions CI/CD pipeline with staging and production deployment targets.' },
  // 16. BLOCKED_ERROR — auto-scaling
  { externalId: 'CLDOP-2', projectId: cloudops.id, title: 'Implement auto-scaling', priority: 1, status: 'BLOCKED_ERROR', branchName: 'feat/cldop-2-autoscaling', currentBead: 2, totalBeads: 6, percentComplete: 25, startedAt: ago(72), lockedMainImplementer: 'gpt-4o', lockedCouncilMembers: council, errorMessage: 'Terraform apply failed: AWS IAM role permission denied for autoscaling:CreateAutoScalingGroup', createdAt: ago(96), updatedAt: ago(18), description: 'Implement Kubernetes HPA and cluster auto-scaling based on CPU/memory metrics.' },
  // 17. CANCELED — monitoring
  { externalId: 'CLDOP-3', projectId: cloudops.id, title: 'Add monitoring dashboard', priority: 4, status: 'CANCELED', startedAt: ago(120), createdAt: ago(144), updatedAt: ago(96), description: 'Build a Grafana-based monitoring dashboard for infrastructure and application metrics.' },
  // 18. COMPLETED — secret management
  { externalId: 'CLDOP-4', projectId: cloudops.id, title: 'Setup secret management with Vault', priority: 1, status: 'COMPLETED', branchName: 'feat/cldop-4-vault', percentComplete: 100, startedAt: ago(192), lockedMainImplementer: 'claude-sonnet-4-20250514', lockedCouncilMembers: council, createdAt: ago(216), updatedAt: ago(168), description: 'Integrate HashiCorp Vault for managing application secrets, database credentials, and API keys.' },
  // 19. BLOCKED_ERROR — log aggregation
  { externalId: 'CLDOP-5', projectId: cloudops.id, title: 'Implement centralized log aggregation', priority: 2, status: 'BLOCKED_ERROR', branchName: 'feat/cldop-5-logging', currentBead: 1, totalBeads: 4, percentComplete: 10, startedAt: ago(28), lockedMainImplementer: 'gemini-2.5-pro', lockedCouncilMembers: council, errorMessage: 'OpenSearch cluster health RED: 2 of 5 shards unassigned, disk watermark exceeded on data-node-03', createdAt: ago(48), updatedAt: ago(12), description: 'Set up ELK stack for centralized logging with structured log parsing and retention policies.' },
  // 20. DRAFT — disaster recovery
  { externalId: 'CLDOP-6', projectId: cloudops.id, title: 'Design disaster recovery plan', priority: 3, status: 'DRAFT', createdAt: ago(8), updatedAt: ago(8), description: 'Create automated disaster recovery procedures including database backups, cross-region failover, and RTO/RPO targets.' },
]).returning().all()

console.log(`  ✅ Created ${ticketRows.length} tickets`)

// Helper to build ticket lookup
type TicketRow = typeof ticketRows[number]
const ticketMap: Record<string, TicketRow> = {}
for (const tr of ticketRows) ticketMap[tr.externalId] = tr
function t(id: string) { return ticketMap[id]!.id }

// Phase artifacts for non-DRAFT tickets
const artifacts: { ticketId: number; phase: string; artifactType: string; content: string }[] = []

// ── MBNK-1 (COMPLETED) — all phases done ──
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

// ── MBNK-2 (CODING bead 3/8) — interview, prd, beads all done ──
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

// ── MBNK-3 (WAITING_PRD_APPROVAL) — interview done, prd drafted ──
artifacts.push(
  { ticketId: t('MBNK-3'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What key metrics should the dashboard show?', a: 'Account balance, monthly spending, recent transactions, savings goals progress.' },
      { q: 'Should it support multiple accounts?', a: 'Yes, users can have checking, savings, and investment accounts.' },
      { q: 'Any accessibility requirements?', a: 'Must meet WCAG 2.1 AA, screen reader support for all data.' },
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

// ── MBNK-5 (COUNCIL_DELIBERATING) — just started, no artifacts yet ──

// ── MBNK-6 (DRAFTING_PRD) — interview done, prd being drafted ──
artifacts.push(
  { ticketId: t('MBNK-6'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What export formats are required?', a: 'CSV and PDF initially. Consider OFX later for bank import compatibility.' },
      { q: 'What date range options?', a: 'Custom range, last 30/60/90 days, current/previous month, current year.' },
      { q: 'Should exports include running balance?', a: 'Yes, include running balance column in both CSV and PDF.' },
    ],
    status: 'approved',
  }) },
)

// ── MBNK-8 (WAITING_INTERVIEW_APPROVAL) — interview done, awaiting approval ──
artifacts.push(
  { ticketId: t('MBNK-8'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What rate limit thresholds per endpoint class?', a: 'Auth: 5/min, Read: 100/min, Write: 30/min, Search: 20/min.' },
      { q: 'Should rate limits be per-user or per-IP?', a: 'Both: per-user for authenticated requests, per-IP for unauthenticated.' },
      { q: 'How should we respond when rate limited?', a: 'HTTP 429 with Retry-After header and remaining quota in response headers.' },
      { q: 'Do we need a bypass mechanism?', a: 'Yes, internal services should have higher limits via service API keys.' },
    ],
    status: 'pending_approval',
  }) },
)

// ── GMFRG-1 (WAITING_INTERVIEW_ANSWERS) — interview in progress ──
artifacts.push(
  { ticketId: t('GMFRG-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What is the maximum number of players per lobby?', a: null },
      { q: 'Should the lobby support spectators?', a: null },
      { q: 'What chat features are needed?', a: 'Text chat with emoji support, no voice.' },
      { q: 'Should there be a ready-check before game starts?', a: null },
    ],
    status: 'awaiting_answers',
  }) },
)

// ── GMFRG-2 (DRAFTING_BEADS) — interview and prd done, beads in progress ──
artifacts.push(
  { ticketId: t('GMFRG-2'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What is the target tick rate?', a: '60 ticks per second for action games, 20 for turn-based.' },
      { q: 'How should conflicts be resolved?', a: 'Server-authoritative model with client-side prediction.' },
      { q: 'Max supported concurrent players in one session?', a: 'Start with 8, plan architecture for 32.' },
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

// ── GMFRG-4 (RUNNING_FINAL_TEST) — all phases complete, final testing ──
artifacts.push(
  { ticketId: t('GMFRG-4'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What inventory slot types?', a: 'Equipment (head, chest, legs, feet, weapon, shield), backpack (6x8 grid), and quick-bar (10 slots).' },
      { q: 'Should items be stackable?', a: 'Consumables stack to 99, equipment does not stack.' },
      { q: 'Item rarity system?', a: 'Common, Uncommon, Rare, Epic, Legendary with color-coded borders.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('GMFRG-4'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Player Inventory System PRD',
    overview: 'Grid-based inventory with equipment slots, item stacking, drag-and-drop, and rarity tiers.',
    requirements: [
      'Drag-and-drop between inventory grid and equipment slots',
      'Stackable consumables with split-stack support',
      'Item tooltip with stats comparison to equipped items',
      'Inventory persistence across sessions',
    ],
    technicalApproach: 'React DnD Kit for drag-and-drop, Canvas overlay for ghost items, SQLite for persistence.',
    status: 'approved',
  }) },
  { ticketId: t('GMFRG-4'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Inventory data model and DB schema', status: 'completed' },
      { id: 2, title: 'Grid-based inventory UI component', status: 'completed' },
      { id: 3, title: 'Drag-and-drop with DnD Kit', status: 'completed' },
      { id: 4, title: 'Equipment slot system', status: 'completed' },
      { id: 5, title: 'Item stacking and splitting logic', status: 'completed' },
    ],
  }) },
)

// ── GMFRG-5 (WAITING_BEADS_APPROVAL) — interview, prd done, beads drafted ──
artifacts.push(
  { ticketId: t('GMFRG-5'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What ranking system?', a: 'Modified Glicko-2 with skill brackets: Bronze, Silver, Gold, Platinum, Diamond.' },
      { q: 'How long should queue times be?', a: 'Target under 60 seconds, relax skill range after 30s.' },
      { q: 'Party queue support?', a: 'Yes, parties of 2-4 matched as a unit. Use average MMR with a variance penalty.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('GMFRG-5'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Matchmaking Algorithm PRD',
    overview: 'ELO/Glicko-2 matchmaking with skill brackets, queue management, and party support.',
    requirements: [
      'Glicko-2 rating with placement matches (10 games)',
      'Dynamic queue widening after 30-second wait',
      'Party matchmaking using weighted average MMR',
      'Anti-smurf detection for new accounts',
    ],
    technicalApproach: 'Redis sorted sets for queue, background worker for match formation, WebSocket notifications.',
    status: 'approved',
  }) },
  { ticketId: t('GMFRG-5'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Glicko-2 rating calculation module', status: 'pending' },
      { id: 2, title: 'Redis queue and match finder worker', status: 'pending' },
      { id: 3, title: 'Party queue aggregation', status: 'pending' },
      { id: 4, title: 'Placement match flow', status: 'pending' },
      { id: 5, title: 'Anti-smurf heuristics', status: 'pending' },
      { id: 6, title: 'Queue UI and status notifications', status: 'pending' },
    ],
    status: 'pending_approval',
  }) },
)

// ── GMFRG-6 (VERIFYING_INTERVIEW_COVERAGE) — interview done, being verified ──
artifacts.push(
  { ticketId: t('GMFRG-6'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'What types of achievements?', a: 'Progress-based (collect 100 items), skill-based (win 10 matches), discovery (find all hidden areas).' },
      { q: 'Should achievements grant rewards?', a: 'Yes, cosmetic rewards like titles, borders, and emotes. No gameplay advantages.' },
      { q: 'Achievement notification style?', a: 'Toast notification with sound effect, plus achievement log in profile.' },
    ],
    status: 'approved',
  }) },
)

// ── CLDOP-1 (COMPLETED) — all phases done ──
artifacts.push(
  { ticketId: t('CLDOP-1'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which CI platform?', a: 'GitHub Actions — already used for other repos.' },
      { q: 'What environments?', a: 'Staging (auto-deploy on PR merge) and production (manual approval).' },
      { q: 'Docker registry preference?', a: 'GitHub Container Registry (ghcr.io) for simplicity.' },
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

// ── CLDOP-2 (BLOCKED_ERROR) — stuck during coding ──
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

// ── CLDOP-3 (CANCELED) — interview done, then canceled ──
artifacts.push(
  { ticketId: t('CLDOP-3'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which monitoring stack?', a: 'Grafana with Prometheus data source.' },
      { q: 'What dashboards are needed?', a: 'Infrastructure health, application performance, and error rate dashboards.' },
    ],
    status: 'approved',
  }) },
)

// ── CLDOP-4 (COMPLETED) — all phases done ──
artifacts.push(
  { ticketId: t('CLDOP-4'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which secret management solution?', a: 'HashiCorp Vault with auto-unseal via AWS KMS.' },
      { q: 'What secrets need management?', a: 'DB credentials, API keys, TLS certs, and service-to-service tokens.' },
      { q: 'Rotation policy?', a: 'DB passwords rotate every 30 days, API keys every 90 days, certs via ACME auto-renewal.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-4'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Secret Management PRD',
    overview: 'HashiCorp Vault integration for secrets, credentials, and certificate management with rotation.',
    requirements: [
      'Vault HA cluster with auto-unseal via AWS KMS',
      'Dynamic database credentials with TTL',
      'AppRole auth for services, OIDC for developers',
      'Automated secret rotation with zero-downtime',
    ],
    technicalApproach: 'Terraform Vault provider, Kubernetes Vault Agent sidecar injection, custom rotation Lambda.',
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-4'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'Vault cluster Terraform module', status: 'completed' },
      { id: 2, title: 'AWS KMS auto-unseal config', status: 'completed' },
      { id: 3, title: 'Database dynamic credentials engine', status: 'completed' },
      { id: 4, title: 'Kubernetes sidecar injection', status: 'completed' },
      { id: 5, title: 'Secret rotation automation', status: 'completed' },
    ],
  }) },
)

// ── CLDOP-5 (BLOCKED_ERROR) — stuck during coding ──
artifacts.push(
  { ticketId: t('CLDOP-5'), phase: 'interview', artifactType: 'interview_draft', content: JSON.stringify({
    questions: [
      { q: 'Which log aggregation stack?', a: 'OpenSearch (AWS managed) with Fluentd collectors.' },
      { q: 'What log retention period?', a: '30 days hot, 90 days warm, 1 year cold (S3 archive).' },
      { q: 'Structured logging format?', a: 'JSON with fields: timestamp, level, service, traceId, message, metadata.' },
    ],
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-5'), phase: 'prd', artifactType: 'prd_draft', content: JSON.stringify({
    title: 'Centralized Log Aggregation PRD',
    overview: 'OpenSearch-based log aggregation with Fluentd collectors, structured logging, and tiered retention.',
    requirements: [
      'Fluentd DaemonSet on all Kubernetes nodes',
      'Structured JSON log parsing with field extraction',
      'Cross-service trace correlation via traceId',
      'Alert rules for error rate spikes and log volume anomalies',
    ],
    technicalApproach: 'AWS OpenSearch Service, Fluentd with custom parsers, OpenSearch Dashboards for visualization.',
    status: 'approved',
  }) },
  { ticketId: t('CLDOP-5'), phase: 'beads', artifactType: 'beads_plan', content: JSON.stringify({
    beads: [
      { id: 1, title: 'OpenSearch cluster provisioning', status: 'failed' },
      { id: 2, title: 'Fluentd DaemonSet configuration', status: 'pending' },
      { id: 3, title: 'Log parsing and index templates', status: 'pending' },
      { id: 4, title: 'Alert rules and notification channels', status: 'pending' },
    ],
  }) },
)

db.insert(phaseArtifacts).values(artifacts).run()

console.log(`  ✅ Created ${artifacts.length} phase artifacts`)

// Close the database cleanly
sqlite.close()
console.log('\n🎉 Seed complete!')
