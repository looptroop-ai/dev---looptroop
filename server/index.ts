import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { startupSequence } from './startup'
import { health } from './routes/health'
import { profileRouter } from './routes/profiles'
import { projectRouter } from './routes/projects'
import { ticketRouter } from './routes/tickets'
import { streamRouter } from './routes/stream'
import { modelsRouter } from './routes/models'
import { filesRouter } from './routes/files'
import { beadsRouter } from './routes/beads'
import { validateJson } from './middleware/validation'
import { getBackendPort, getFrontendOrigin } from '../shared/appConfig'
import { workflowRouter } from './routes/workflow'

const app = new Hono()

// Global middleware
app.use('/api/*', cors({
  origin: getFrontendOrigin(),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'Last-Event-ID'],
}))
app.use('/api/*', validateJson)

// Mount routes
app.route('/api', health)
app.route('/api', profileRouter)
app.route('/api', projectRouter)
app.route('/api', ticketRouter)
app.route('/api', streamRouter)
app.route('/api', modelsRouter)
app.route('/api', filesRouter)
app.route('/api', beadsRouter)
app.route('/api', workflowRouter)

// Startup sequence: DB init, WAL checkpoint, hydrate actors
startupSequence()

const port = getBackendPort()
console.log(`[server] LoopTroop backend starting on port ${port}`)

serve({ fetch: app.fetch, port })

console.log(`[server] LoopTroop backend running on http://localhost:${port}`)

export default app
export { app }
