export const EXECUTION_BAND_STATUSES = [
  'PRE_FLIGHT_CHECK',
  'CODING',
  'RUNNING_FINAL_TEST',
  'INTEGRATING_CHANGES',
  'WAITING_MANUAL_VERIFICATION',
  'CLEANING_ENV',
] as const

export function isExecutionBandStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && EXECUTION_BAND_STATUSES.includes(status as (typeof EXECUTION_BAND_STATUSES)[number])
}
