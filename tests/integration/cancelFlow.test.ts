import { describe, it, expect } from 'vitest'
import { createActor } from 'xstate'
import { ticketMachine } from '../../server/machines/ticketMachine'

const defaultInput = {
  ticketId: 'test-1',
  projectId: 1,
  externalId: 'TEST-1',
  title: 'Test Ticket',
}

describe('Cancel Flow Integration', () => {
  it('cancels from DRAFT', () => {
    const actor = createActor(ticketMachine, { input: defaultInput })
    actor.start()
    actor.send({ type: 'CANCEL' })
    expect(actor.getSnapshot().value).toBe('CANCELED')
    actor.stop()
  })

  it('cancels after START', () => {
    const actor = createActor(ticketMachine, { input: defaultInput })
    actor.start()
    actor.send({ type: 'START' })
    actor.send({ type: 'CANCEL' })
    expect(actor.getSnapshot().value).toBe('CANCELED')
    actor.stop()
  })
})
