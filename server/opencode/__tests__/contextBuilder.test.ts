import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildMinimalContext,
  clearContextCache,
  contextCache,
  PHASE_ALLOWLISTS,
  type TicketState,
} from '../contextBuilder'

describe('buildMinimalContext', () => {
  const baseTicketState: TicketState = {
    ticketId: 'test-ticket-1',
    title: 'Test Ticket',
    description: 'A test description',
    codebaseMap: '# Project structure\nsrc/ lib/ tests/',
    interview: 'Q: What? A: Something.',
    prd: '# PRD\n## Overview\nBuild feature X',
    beads: '# Beads\n- bead-1: setup\n- bead-2: implement',
    drafts: ['Draft 1 content', 'Draft 2 content'],
    votes: ['Vote 1: Draft 1 wins', 'Vote 2: Draft 2 wins'],
    beadData: 'Current bead implementation data',
    beadNotes: ['Note 1: error in tests', 'Note 2: fixed imports'],
  }

  beforeEach(() => {
    contextCache.clear()
  })

  describe('phase allowlist enforcement', () => {
    it('interview_draft should only include codebase_map and ticket_details', () => {
      const parts = buildMinimalContext('interview_draft', baseTicketState)
      expect(parts).toHaveLength(2)
      expect(parts[0]!.source).toBe('ticket_details')
      expect(parts[0]!.content).toContain('## Primary User Requirement For This Ticket')
      expect(parts[0]!.content).toContain('# Ticket: Test Ticket')
      expect(parts[1]!.source).toBe('codebase_map')
      expect(parts[1]!.content).toContain('Project structure')
    })

    it('interview_vote should include codebase_map, ticket_details, and drafts', () => {
      const parts = buildMinimalContext('interview_vote', baseTicketState)
      // codebase_map + ticket_details + 2 drafts = 4
      expect(parts).toHaveLength(4)
    })

    it('interview_refine should include drafts but not votes', () => {
      const parts = buildMinimalContext('interview_refine', baseTicketState)
      // codebase_map + ticket_details + 2 drafts = 4
      expect(parts).toHaveLength(4)
    })

    it('coding phase should only include bead_data and bead_notes', () => {
      const parts = buildMinimalContext('coding', baseTicketState, 'bead-1')
      // bead_data + active_bead + 2 bead_notes = 4
      expect(parts).toHaveLength(4)
      expect(parts.some((p) => p.content.includes('Active bead: bead-1'))).toBe(true)
      // Should NOT include codebase_map or ticket_details
      expect(parts.some((p) => p.content.includes('# Ticket:'))).toBe(false)
    })

    it('prd_draft should include interview but not drafts/votes', () => {
      const parts = buildMinimalContext('prd_draft', baseTicketState)
      // codebase_map + ticket_details + interview = 3
      expect(parts).toHaveLength(3)
      expect(parts.some((p) => p.content.includes('Q: What?'))).toBe(true)
    })

    it('final_test should include ticket_details, interview, prd, beads', () => {
      const parts = buildMinimalContext('final_test', baseTicketState)
      // ticket_details + interview + prd + beads = 4
      expect(parts).toHaveLength(4)
    })
  })

  describe('unknown phase', () => {
    it('should throw error for unknown phase', () => {
      expect(() => buildMinimalContext('nonexistent_phase', baseTicketState)).toThrow(
        'Unknown phase: nonexistent_phase',
      )
    })

    it('error message should list valid phases', () => {
      try {
        buildMinimalContext('bad_phase', baseTicketState)
      } catch (err) {
        expect((err as Error).message).toContain('interview_draft')
        expect((err as Error).message).toContain('coding')
      }
    })
  })

  describe('token budget trimming', () => {
    it('should trim content when exceeding budget', () => {
      // Create massive content that exceeds 100k tokens (400k chars)
      const hugeState: TicketState = {
        ticketId: 'big-ticket',
        title: 'Big Ticket',
        description: 'x'.repeat(200000), // 50k tokens
        codebaseMap: 'y'.repeat(200000), // 50k tokens
        interview: 'z'.repeat(200000), // 50k tokens
      }

      const parts = buildMinimalContext('prd_draft', hugeState)
      // Should have fewer parts than if no trimming occurred
      // prd_draft allows: codebase_map, ticket_details, interview
      // Total would be ~150k tokens, exceeding 100k budget
      const totalChars = parts.reduce((sum, p) => sum + p.content.length, 0)
      // After trimming at least one source, total should be less than original
      expect(totalChars).toBeLessThan(600000)
    })
  })

  describe('cache behavior', () => {
    it('should cache codebase_map on second call', () => {
      buildMinimalContext('interview_draft', baseTicketState)
      // Second call should use cached codebase_map
      const parts2 = buildMinimalContext('interview_draft', baseTicketState)
      expect(parts2).toHaveLength(2)
      expect(parts2.some((p) => p.content.includes('Project structure'))).toBe(true)
    })

    it('clearContextCache should invalidate ticket cache', () => {
      buildMinimalContext('interview_draft', baseTicketState)
      clearContextCache('test-ticket-1')
      // Should still work after cache clear
      const parts = buildMinimalContext('interview_draft', baseTicketState)
      expect(parts).toHaveLength(2)
    })
  })

  describe('empty context handling', () => {
    it('should handle missing optional fields', () => {
      const minimalState: TicketState = {
        ticketId: 'minimal',
      }
      const parts = buildMinimalContext('interview_draft', minimalState)
      expect(parts).toHaveLength(2)
      expect(parts[0]!.source).toBe('ticket_details')
      expect(parts[0]!.content).toContain('Untitled')
      expect(parts[1]!.source).toBe('codebase_map')
      expect(parts[1]!.content).toContain('not yet generated')
    })

    it('should skip empty interview content', () => {
      const stateNoInterview: TicketState = {
        ticketId: 'no-interview',
        title: 'Test',
      }
      const parts = buildMinimalContext('prd_draft', stateNoInterview)
      // codebase_map + ticket_details (interview is empty so skipped) = 2
      expect(parts).toHaveLength(2)
    })

    it('should skip empty drafts array', () => {
      const stateNoDrafts: TicketState = {
        ticketId: 'no-drafts',
        title: 'Test',
        drafts: [],
      }
      const parts = buildMinimalContext('interview_vote', stateNoDrafts)
      // codebase_map + ticket_details = 2 (no drafts to add)
      expect(parts).toHaveLength(2)
    })

    it('coding phase with no bead data returns empty', () => {
      const stateNoBead: TicketState = {
        ticketId: 'no-bead',
      }
      const parts = buildMinimalContext('coding', stateNoBead)
      expect(parts).toHaveLength(0)
    })
  })

  describe('all phases are defined', () => {
    it('PHASE_ALLOWLISTS should cover all expected phases', () => {
      const expectedPhases = [
        'interview_draft',
        'interview_vote',
        'interview_refine',
        'interview_qa',
        'interview_coverage',
        'prd_draft',
        'prd_vote',
        'prd_refine',
        'prd_coverage',
        'beads_draft',
        'beads_vote',
        'beads_refine',
        'beads_expand',
        'beads_coverage',
        'coding',
        'context_wipe',
        'final_test',
        'preflight',
      ]
      for (const phase of expectedPhases) {
        expect(PHASE_ALLOWLISTS[phase]).toBeDefined()
      }
    })
  })
})
