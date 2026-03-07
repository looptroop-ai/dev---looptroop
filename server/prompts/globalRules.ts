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

export const CONVERSATIONAL_RULES = `
MULTI-TURN SESSION:
This is a multi-turn conversational session. You will receive user responses to your questions and should adapt your next output accordingly.

STRUCTURED OUTPUT RULE:
Each response must use the structured tag format specified in the instructions.
You may include brief conversational commentary inside the designated fields, but all questions and progress data must be wrapped in the specified tags.

Do not output raw YAML outside of the designated tags.
`.trim()
