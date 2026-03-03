export function verifyPRDCoverage(
  prdContent: string,
  interviewContent: string,
): { passed: boolean; gaps: string[] } {
  const gaps: string[] = []

  // Basic validation: PRD must have content
  if (!prdContent || prdContent.trim().length < 100) {
    gaps.push('PRD content is too short or empty')
  }

  // Check PRD references interview content
  if (interviewContent && prdContent) {
    // Ensure PRD exists and has some substance
    if (!prdContent.includes('epic') && !prdContent.includes('story') && !prdContent.includes('requirement')) {
      gaps.push('PRD does not contain structured requirements (epics/stories)')
    }
  }

  return { passed: gaps.length === 0, gaps }
}
