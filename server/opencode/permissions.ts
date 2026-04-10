import type { OpenCodePermissionRule } from './types'

export const OPENCODE_EXECUTION_YOLO_PERMISSIONS: ReadonlyArray<OpenCodePermissionRule> = Object.freeze([
  {
    permission: '*',
    pattern: '*',
    action: 'allow',
  },
])
