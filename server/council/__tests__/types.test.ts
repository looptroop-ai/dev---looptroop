import { describe, expect, it } from 'vitest'
import { VOTING_RUBRIC_INTERVIEW } from '../types'

describe('VOTING_RUBRIC_INTERVIEW', () => {
  it('describes interview efficiency without encouraging budget filling', () => {
    const criterion = VOTING_RUBRIC_INTERVIEW.find(item => item.category === 'Minimal complexity / good decomposition')

    expect(criterion?.description).toContain('minimum necessary number of questions')
    expect(criterion?.description).not.toContain('efficient use of the max_initial_questions budget')
  })
})
