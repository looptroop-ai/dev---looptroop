export const GLOBAL_RULES = `
CRITICAL OUTPUT RULE:
Your response must contain ONLY the requested artifact in the exact format specified.
Do not include explanations, commentary, or meta-discussion outside the artifact.
If you need to communicate issues, use structured fields within the artifact format.

CONTEXT REFRESH:
You are operating in a fresh session with no prior conversation history.
All context needed for this task is provided in this prompt.
Do not reference or assume any prior interactions.
`.trim()
