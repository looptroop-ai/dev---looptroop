# Configuration Reference

All configuration lives in your profile, accessible via the **Configuration** button in the LoopTroop UI. Changes take effect on the next phase that reads the value — you do not need to restart the server.

## Quick Reference

| Setting | Default | Range | Group |
| --- | --- | --- | --- |
| Main Implementer Model | _(required)_ | any available model | AI Models |
| Council Members | _(required, 1–3 additional)_ | any available models | AI Models |
| Council Response Timeout | 1200 s | 10–3600 s | AI Thinking |
| Min Council Quorum | 2 | 1–4 | AI Thinking |
| Max Interview Questions | 50 | 0–50 | AI Thinking |
| Coverage Follow-Up Budget | 20 % | 0–100 % | Coverage |
| Interview Coverage Passes | 2 | 1–10 | Coverage |
| PRD Coverage Passes | 5 | 2–20 | Coverage |
| Beads Coverage Passes | 5 | 2–20 | Coverage |
| Per-Iteration Timeout | 1200 s | 0–3600 s | Execution Phase |
| Execution Setup Timeout | 1200 s | 0–3600 s | Execution Phase |
| Max Bead Retries | 5 | 0–20 | Execution Phase |
| Tool Input Max Chars | 4,000 | 500–50,000 | Logging |
| Tool Output Max Chars | 12,000 | 1,000–100,000 | Logging |
| Tool Error Max Chars | 6,000 | 500–50,000 | Logging |

---

## AI Models

### Main Implementer Model

**Type:** model selector  
**Required:** yes

The main implementer is the primary model LoopTroop assigns to a ticket. It is locked-in at the moment the ticket enters `SCANNING_RELEVANT_FILES` and remains the ticket's execution owner for the entire lifecycle.

**What it does:**

- Runs the initial single-model groundwork (`SCANNING_RELEVANT_FILES`) before any council phase starts.
- Is automatically included in every council phase — it always participates in drafting and voting.
- Handles all coding iterations during `CODING`.
- Runs the final verification pass in `RUNNING_FINAL_TEST`.

**How to choose:**

Pick the model you trust most for sustained reasoning and code generation. Other council members exist to challenge the plan quality; the main implementer is the one writing and validating the code, so reliability matters more than pure creativity here.

If the model supports effort or thinking variants (see [Effort / Thinking Variant](#effort--thinking-variant)), prefer a higher-effort variant for complex tickets.

::: tip
You can change the main implementer between tickets. The choice is locked per-ticket once work starts, so adjustments to the profile only affect future tickets.
:::

**See also:** [LLM Council → Main Implementer](/llm-council#main-implementer)

---

### Council Members

**Type:** model selector (1–3 slots, in addition to the main implementer)  
**Required:** at least 1 additional member

Council members are the additional models that participate in independent drafting and structured voting during the interview, PRD, and beads planning phases.

**What they do:**

- Each member independently drafts an artifact (interview questions, PRD, or bead plan) without seeing other members' work.
- Each member votes on anonymized drafts using a structured rubric.
- The winning direction is refined and used as the planning artifact for the next phase.

**What they do not do:**

Council members do not participate in execution. Coding, final testing, and PR creation are all handled exclusively by the main implementer.

**How to choose:**

Diversity matters more than raw quality here. Mixing models from different families, sizes, or providers tends to surface more varied plans and catch more blind spots than stacking three instances of the same model.

The minimum viable council is the main implementer plus one additional member. The `Min Council Quorum` setting determines how many members must return a valid response before the pipeline trusts the result.

::: tip
Up to 3 council slots are available in addition to the main implementer, for a maximum council size of 4.
:::

**See also:** [LLM Council → Council Members](/llm-council#council-members)

---

### Effort / Thinking Variant

**Type:** variant selector (per model, optional)

Some models expose multiple effort or thinking modes (for example, low / medium / high reasoning effort, or extended thinking budget variants). When a model supports variants, an effort picker appears below the model selector for both the main implementer and each council member.

**What it does:**

The selected variant is passed as part of the model configuration when LoopTroop calls that model. Higher-effort variants generally produce better reasoning at the cost of slower responses and higher token usage.

**How to choose:**

- For the main implementer on complex or large-scope tickets, prefer a higher-effort variant.
- For council members, a balance of one high-effort and one lower-effort member often gives diverse results without making every planning phase slow.
- If a council member times out repeatedly under `Council Response Timeout`, lower its effort variant before increasing the timeout.

---

## AI Thinking

### Council Response Timeout

**Type:** integer (seconds)  
**Default:** 1200 s (20 minutes)  
**Range:** 10–3600 s

The maximum time LoopTroop will wait for a single model to return a response during any council phase (drafting, voting, coverage, or refinement).

**What happens when it expires:**

The request is abandoned. If this causes the valid response count to drop below `Min Council Quorum`, the phase enters `BLOCKED_ERROR` rather than silently proceeding with an incomplete council.

**Trade-offs:**

| Lower | Higher |
| --- | --- |
| Fail fast when a provider is stalled or slow | Tolerate larger context windows, heavy thinking variants, or slow providers |
| More likely to block on slow models | Less likely to block due to transient slowness |

**When to change:**

- Increase if you are using high-effort thinking variants and see frequent timeout blocks.
- Increase if your OpenCode provider has high network latency or rate-limited batches.
- Decrease if you want fast failure feedback when a model is unavailable instead of waiting 20 minutes.

**See also:** [LLM Council → Council Response Timeout](/llm-council#council-response-timeout)

---

### Min Council Quorum

**Type:** integer  
**Default:** 2  
**Range:** 1–4

The minimum number of valid council responses LoopTroop requires before it trusts a drafting or voting phase.

**What "valid" means:**

A model response is valid if it returns within the `Council Response Timeout` and its structured output can be parsed without terminal errors. Malformed or timed-out responses do not count toward quorum.

**What happens when quorum is not met:**

The phase enters `BLOCKED_ERROR`. This is intentional — a plan built from one draft when you configured two is not trustworthy, so LoopTroop refuses to advance silently.

**Trade-offs:**

| Lower (1) | Higher (3–4) |
| --- | --- |
| Survives when one model is unavailable | Requires all models to be healthy and responsive |
| Lower diversity guarantee | Stronger diversity guarantee |
| Useful if running a lean council | Only practical with a full council of that size |

::: warning
Setting quorum higher than your total council size guarantees permanent blocks. Keep quorum ≤ the number of configured council members (including the main implementer).
:::

**See also:** [LLM Council → Min Council Quorum](/llm-council#min-council-quorum)

---

### Max Interview Questions

**Type:** integer  
**Default:** 50  
**Range:** 0–50

Caps how many initial clarifying questions the compiled interview document can contain before the UI pauses and presents them to you.

**What it controls:**

After `COMPILING_INTERVIEW` finishes, the interview document can have up to this many questions in the first batch. Questions beyond the cap are not generated — this is a hard ceiling on initial intake depth, not a pagination setting.

**Trade-offs:**

| Lower | Higher |
| --- | --- |
| Faster intake for simple tickets | Richer context for the PRD and beads planning |
| May leave ambiguities unresolved | More questions to answer before planning can start |

**When to change:**

- Lower for routine or well-scoped tickets where you already know the requirements.
- Keep at maximum (50) for exploratory or large-scope work where ambiguity is costly later.
- Set to 0 to skip the interview question batch entirely and go straight to coverage (rarely useful unless you pre-fill answers externally).

**See also:** [Ticket Flow → Interview](/ticket-flow#interview)

---

## Coverage

Coverage settings control the self-checking loops that run after drafting. LoopTroop uses coverage passes to improve artifact completeness before you review and approve. All three domains (interview, PRD, beads) have independent pass budgets.

### Coverage Follow-Up Budget

**Type:** integer (percent)  
**Default:** 20 %  
**Range:** 0–100 %

Limits how many additional follow-up questions the `VERIFYING_INTERVIEW_COVERAGE` pass can add relative to the original interview size.

**Example:** With `Max Interview Questions = 50` and `Coverage Follow-Up Budget = 20 %`, the follow-up pass can add at most 10 extra questions (20 % of 50).

**What it controls:**

After your first answer round, the coverage pass checks whether important gaps remain. If it finds gaps, it generates targeted follow-up questions. This setting prevents an unbounded loop of "just a few more questions."

**Trade-offs:**

| Lower (0–10 %) | Higher (50–100 %) |
| --- | --- |
| Minimal extra questions after first round | Deep coverage at the cost of more follow-up rounds |
| Risks shipping a PRD with unresolved ambiguities | May feel exhaustive for simple tickets |

**When to change:**

- Raise for high-stakes tickets where missed requirements are expensive.
- Lower or zero for tickets where you trust your initial answers are complete.

**See also:** [Ticket Flow → Coverage Follow-Up Budget](/ticket-flow#coverage-follow-up-budget)

---

### Interview Coverage Passes

**Type:** integer  
**Default:** 2  
**Range:** 1–10

Caps how many times `VERIFYING_INTERVIEW_COVERAGE` may run follow-up cycles before LoopTroop stops extending the loop and advances to interview approval regardless of remaining gaps.

**What happens at the cap:**

When this limit is reached, LoopTroop moves to `WAITING_INTERVIEW_APPROVAL` with whatever coverage state exists. Any unresolved gaps are visible to you at approval time.

**Trade-offs:**

| Lower (1–2) | Higher (5–10) |
| --- | --- |
| Faster path to interview approval | More thorough gap-filling before approval |
| May leave small coverage gaps for you to notice at approval | Can feel slow on well-scoped tickets |

**See also:** [Ticket Flow → Interview Coverage Passes](/ticket-flow#interview-coverage-passes)

---

### PRD Coverage Passes

**Type:** integer  
**Default:** 5  
**Range:** 2–20

Caps how many revision cycles `VERIFYING_PRD_COVERAGE` may run while reconciling the PRD against the approved interview.

Each pass reads the current PRD candidate, identifies gaps relative to the approved interview, and rewrites the candidate in-place. When coverage is clean or the cap is reached, LoopTroop advances to `WAITING_PRD_APPROVAL`.

**What you see at approval:**

If the cap was reached before coverage was clean, unresolved gap warnings appear on the PRD approval screen. You can still approve as-is or edit the PRD manually.

**Trade-offs:**

| Lower (2–3) | Higher (10–20) |
| --- | --- |
| Faster PRD approval, smaller token cost | Higher chance of a complete PRD before you review |
| More manual editing may be needed at approval | Slower for large PRDs with many gaps |

**See also:** [Ticket Flow → PRD Coverage Passes](/ticket-flow#prd-coverage-passes)

---

### Beads Coverage Passes

**Type:** integer  
**Default:** 5  
**Range:** 2–20

Caps how many revision cycles `VERIFYING_BEADS_COVERAGE` may run while reconciling the semantic bead blueprint against the PRD.

Once coverage is clean or this cap is reached, LoopTroop advances to `EXPANDING_BEADS`, which is a separate step that converts the blueprint into execution-ready bead records.

::: tip
`EXPANDING_BEADS` runs independently after `VERIFYING_BEADS_COVERAGE` finishes. Increasing this setting does not affect the expansion step — it only controls the semantic blueprint revision loop.
:::

**Trade-offs:**

| Lower (2–3) | Higher (10–20) |
| --- | --- |
| Faster path to beads approval | Higher chance of a coverage-clean blueprint |
| More likely to miss PRD requirements in the bead plan | Slower for large or complex PRDs |

**See also:** [Ticket Flow → Beads Coverage Passes](/ticket-flow#beads-coverage-passes)

---

## Execution Phase

### Per-Iteration Timeout

**Type:** integer (seconds)  
**Default:** 1200 s (20 minutes)  
**Range:** 0–3600 s

The maximum runtime for a single bead attempt in `CODING`. If a coding session is still running when this deadline expires, LoopTroop treats it as a failed iteration and routes it through the standard retry path.

**What retry means here:**

LoopTroop generates a context wipe note summarizing the failure, resets the worktree to the bead's start snapshot, opens a fresh OpenCode session, and retries — up to `Max Bead Retries` times.

**Trade-offs:**

| Lower | Higher |
| --- | --- |
| Fails faster on stuck sessions | Allows more time for large beads or slow models |
| Wastes less time on runaway coding loops | Risk of waiting a long time before a stuck session is aborted |

**When to change:**

- Increase for beads that involve large test suite runs, slow builds, or high-latency tool calls.
- Decrease for projects where you want fast failure feedback and the model tends to get stuck.
- Setting to 0 disables the timeout (not recommended for production use).

**See also:** [Execution Loop → Per-Iteration Timeout](/execution-loop#per-iteration-timeout)

---

### Execution Setup Timeout

**Type:** integer (seconds)  
**Default:** 1200 s (20 minutes)  
**Range:** 0–3600 s

The maximum allowed runtime for the one-time `PREPARING_EXECUTION_ENV` phase, which runs after the setup plan is approved and before any coding begins.

**What execution setup does:**

The setup phase can install toolchains, warm caches, build native dependencies, or prepare repository-local runtime artifacts — anything the approved setup plan requires. It runs in the ticket's worktree exactly once per execution attempt.

**Trade-offs:**

| Lower | Higher |
| --- | --- |
| Fails fast if setup is stuck or misconfigured | Allows more time for heavy installs or slow network downloads |
| Fine for repos with no heavy setup step | Needed if setup involves large dependency downloads |

**When to change:**

- Increase for projects with heavyweight setup steps such as installing toolchains, running `docker pull`, or bootstrapping large `node_modules`.
- Leave at default for most repos where setup runs in seconds or is not needed.
- Setting to 0 disables the timeout for the setup phase specifically.

**See also:** [Execution Loop → Execution Setup Timeout](/execution-loop#execution-setup-timeout)

---

### Max Bead Retries

**Type:** integer  
**Default:** 5  
**Range:** 0–20

How many fresh-session re-attempts LoopTroop allows for a failing bead before it enters `BLOCKED_ERROR`. The same limit is also used for final-test retries in `RUNNING_FINAL_TEST`.

**What "fresh session" means:**

Each retry discards the polluted conversational state from the failed attempt, resets the worktree to the bead's start commit, opens a brand-new OpenCode session, and starts over with the context wipe note from the previous attempt as context. See [Execution Loop — Bounded Ralph-Style Retry](/execution-loop#bounded-ralph-style-retry) for the full design rationale.

**Trade-offs:**

| Lower (0–2) | Higher (10–20) |
| --- | --- |
| Fails fast, lower token cost | More attempts before giving up |
| Less tolerance for transient model failures | Useful for flaky tests or non-deterministic environments |
| 0 means zero retries — the first failure immediately blocks | High values can mask persistent coding problems |

**When to change:**

- Lower for tickets in well-understood codebases where repeated failures usually indicate a real problem, not a fluke.
- Raise for greenfield work, unstable test suites, or providers with high per-call variance.
- Setting to 0 effectively disables retry: any iteration failure immediately blocks the bead.

**See also:** [Execution Loop → Max Bead Retries](/execution-loop#max-bead-retries)

---

## Logging

These three settings control how much of each tool call is stored in the LoopTroop logs. They do not affect what the model sees during execution — only what is persisted for display in the UI and diagnostics.

### Tool Input Max Chars

**Type:** integer (characters)  
**Default:** 4,000  
**Range:** 500–50,000

Hard cap on the number of characters stored for tool inputs in the execution log. Input beyond this limit is truncated at log write time.

**When to change:**

- Increase if log entries for write-heavy tools (large file writes, bulk inserts) are being cut off and you need the full content for debugging.
- Decrease to reduce database size in long-running or high-throughput tickets.

---

### Tool Output Max Chars

**Type:** integer (characters)  
**Default:** 12,000  
**Range:** 1,000–100,000

Hard cap on the number of characters stored for tool outputs in the execution log.

Tool outputs are typically larger than inputs (think: test run output, command stdout, file read results), which is why the default is higher than the input cap.

**When to change:**

- Increase if you need to see the full output of long test suites or verbose build commands in the log.
- Decrease for projects where tool outputs are consistently short and you want to reduce storage pressure.

---

### Tool Error Max Chars

**Type:** integer (characters)  
**Default:** 6,000  
**Range:** 500–50,000

Hard cap on the number of characters stored for tool errors in the execution log.

Error output is usually more compact than stdout but often more important to preserve for debugging, which is why the default is between the input and output caps.

**When to change:**

- Increase if stack traces or compiler errors are being truncated in a way that makes debugging difficult.
- Decrease if error output is consistently short for your stack.

**See also:** [Execution Loop → Tool Log Truncation](/execution-loop#tool-log-truncation)
