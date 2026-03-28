/** Default council member response timeout (20 minutes) */
export const COUNCIL_RESPONSE_TIMEOUT_MS = 1_200_000
/** Default bead execution timeout (10 minutes) */
export const BEAD_EXECUTION_TIMEOUT_MS = 600_000
/** Delay before retry after OpenCode adapter error */
export const ADAPTER_RETRY_DELAY_MS = 2000
/** Default SDK operation timeout */
export const SDK_OPERATION_TIMEOUT_MS = 5000
/** Force-kill process delay */
export const FORCE_KILL_DELAY_MS = 5000
/** SQLite busy timeout */
export const SQLITE_BUSY_TIMEOUT_MS = 5000
/** Default context window limit for provider catalog */
export const DEFAULT_CONTEXT_WINDOW_LIMIT = 200_000
/** Max SSE event buffer size */
export const MAX_SSE_BUFFER_SIZE = 1000
/** Max SSE replay buffer bytes per ticket */
export const MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024
/** Max UI state payload size in bytes (2MB) */
export const MAX_UI_STATE_BYTES = 2_097_152
/** Max interview questions per batch */
export const MAX_INTERVIEW_BATCH_SIZE = 3
/** Max options for single_choice interview questions */
export const MAX_SINGLE_CHOICE_OPTIONS = 10
/** Max options for multiple_choice interview questions */
export const MAX_MULTIPLE_CHOICE_OPTIONS = 15
/** Max total chars for relevant file content */
export const MAX_RELEVANT_FILES_CHARS = 160_000
/** Max session list limit */
export const SESSION_LIST_LIMIT = 1000
/** Max message list limit */
export const MESSAGE_LIST_LIMIT = 10_000
/** Max model IDs in catalog request */
export const MAX_CATALOG_MODEL_IDS = 50
/** Max reason text display length */
export const MAX_REASON_DISPLAY_LENGTH = 56
export const TRUNCATED_REASON_LENGTH = 53
/** Max output preview length */
export const MAX_OUTPUT_PREVIEW_LENGTH = 160
/** Max file content preview length */
export const MAX_FILE_CONTENT_PREVIEW_LENGTH = 200
