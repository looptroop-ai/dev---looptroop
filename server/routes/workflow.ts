import { Hono } from 'hono'
import { WORKFLOW_GROUPS, WORKFLOW_PHASES } from '../../shared/workflowMeta'

const workflowRouter = new Hono()

workflowRouter.get('/workflow/meta', (c) => {
  return c.json({
    groups: WORKFLOW_GROUPS,
    phases: WORKFLOW_PHASES,
  })
})

export { workflowRouter }
