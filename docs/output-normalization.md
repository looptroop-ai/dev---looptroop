# Output Normalization

Every structured artifact that an AI council member produces goes through a normalization pipeline before LoopTroop trusts its content. This page catalogs all automatic repairs, cleanups, and semantic adjustments — what triggers each one and what the pipeline does about it.

Repairs produce `repairWarnings` that are stored on the run record and surfaced in the diagnostics view. A repair being applied never silently discards data; it always records what changed.

---

## Universal Repairs

These are applied to every structured artifact regardless of type, before any artifact-specific validation runs.

### Candidate Extraction

Raw model output is rarely just the artifact. The pipeline extracts one or more *candidate strings* to try parsing.

#### Transcript prefix stripping

Models that receive a conversation history sometimes echo the `[assistant]` / `[user]` / `[system]` role prefixes onto their output lines.

**Trigger:** Lines starting with `[assistant/…]`, `[user]`, `[system]`, `[sys]`, `[tool]`, `[model]`, `[error]` (with optional sub-segments like `[assistant/gpt-4o]`).

**Repair:** The prefix is stripped from each line before every parse attempt.

#### Candidate collection from surrounding prose

Artifacts are sometimes wrapped in explanation text, markdown headings, or other content.

**Trigger:** The raw output does not parse as a standalone artifact.

**Repair:** The pipeline builds multiple candidate strings from the raw output and tries each in order:
1. The raw output as-is.
2. The output after transcript-prefix stripping.
3. The inner content of any ` ```yaml ` / ` ```yml ` / ` ```json ` / ` ```jsonl ` code fence.
4. The inner content of any `<TAG>…</TAG>` XML envelope specified by the parser.
5. Everything from the first line matching a known top-level key (e.g. `schema_version:`, `beads:`, `epics:`) to the end of the output.

All variants with and without transcript-prefix stripping are tried. The first one that produces a valid artifact wins.

When the winning candidate is not the full raw output, a **Candidate Recovery** warning is recorded:
> *Recovered the structured artifact from surrounding transcript or wrapper text before validation.*

#### Tagged-candidate extraction (`<TAG>…</TAG>`)

Some artifacts (e.g. `<BEAD_STATUS>`) use an explicit XML envelope rather than a bare YAML block.

**Trigger:** The parser expects a tag-wrapped artifact.

**Repair:** All occurrences of `<TAG>…</TAG>` are extracted. If only an opening tag is found but no closing tag (truncated model output), everything after the last opening tag is used as a fallback candidate.

#### Trailing terminal noise

Model output piped through a terminal or TTY can accumulate ANSI escape sequences or bracketed-paste control codes at the end.

**Trigger:** Trailing bytes consisting solely of ANSI escape sequences (`ESC[…`), bracketed-paste markers (`[200~` / `[201~`), or non-printable control characters (codes 0–8, 11, 12, 14–31, 127).

**Repair:** For JSON candidates, the trailing noise after the balanced root JSON value is stripped. For YAML candidates, trailing lines that consist entirely of noise characters are dropped. An inline suffix of noise is also stripped.

**Warning:** *Trimmed trailing terminal noise after the complete structured artifact.*

#### Orphan closing code fence

**Trigger:** A candidate ends with a lone ` ``` ` line but has no matching opening ` ```yaml ` / ` ```json ` fence above it.

**Repair:** The orphan closing fence is stripped.

**Warning:** *Trimmed orphan trailing closing code fence after the structured artifact.*

---

### YAML Structural Repairs

After a candidate is selected, the pipeline tries to parse it. If parsing fails, repairs are applied in the order below and parsing is retried after each group. All repairs are idempotent.

#### 1. Nested mapping children repair

**Trigger:** A parent key (e.g. `generated_by:`) is emitted bare and its known child keys (`winner_model:`, `generated_at:`) appear at the *same* indentation level as the parent rather than indented under it.

**Example:**
```yaml
# Bad — children at parent level
generated_by:
winner_model: gpt-4o
generated_at: 2026-01-01T00:00:00Z

# Fixed
generated_by:
  winner_model: gpt-4o
  generated_at: 2026-01-01T00:00:00Z
```

**Warning:** *Repaired inconsistent YAML indentation for nested mapping children.*

The parent→child relationships are explicitly whitelisted per artifact type (e.g. `generated_by`, `summary`, `approval`, `progress`, `checks`).

#### 2. Inline sequence parent repair

**Trigger:** A collection-valued key has its first sequence item on the same line: `questions: - id: Q01 …`

**Example:**
```yaml
# Bad
questions: - id: Q01
             phase: foundation

# Fixed
questions:
  - id: Q01
    phase: foundation
```

#### 3. Inline keys repair

**Trigger:** Multiple mapping keys appear on a single line, e.g. `batch_number: 4 progress: current: 4 total: 17`.

**Repair:** Keys are tokenized and split onto separate lines with correct indentation. Nested parent→child relationships defined in the per-artifact whitelist are respected so that `progress: current: 4 total: 17` becomes a proper nested block.

**Warning:** *Repaired inline YAML sequence or mapping syntax before parsing.*

#### 4. Plain scalar colon repair

**Trigger:** A plain (unquoted) YAML scalar value contains `: ` (colon followed by space), which YAML interprets as a nested mapping entry. Example: `rationale: some rules: apply here`.

**Repair:** The value is wrapped in double quotes.

**Warning:** *Quoted YAML plain scalar values containing colon-space before reparsing.*

#### 5. Markdown code fence stripping

**Trigger:** The entire artifact is wrapped in a ` ```yaml ` … ` ``` ` block (or `json` / `yml` / `jsonl`).

**Repair:** The fence delimiters are removed, leaving only the inner content.

**Warning:** *Unwrapped markdown code fence wrapping the YAML payload.*

#### 6. Spurious XML tag stripping

**Trigger:** Lines that consist entirely of a bare XML-style tag (`<tag>`, `</tag>`, `<tag/>`).

**Repair:** Those lines are removed.

**Warning:** *Stripped XML-style tags `<tag>` from the payload before parsing.* (Lists the specific tags that were removed.)

#### 7. Free-text scalar quoting

**Trigger:** A `free_text:` field has an unquoted plain-scalar value. Such values are always strings in LoopTroop's schema but can start with backticks, look like booleans, or contain `: ` — all of which cause YAML to misinterpret them.

**Repair:** The value is wrapped in double quotes. Multi-line single-quoted values are converted to YAML block literals (`|-`).

#### 8. Missing list-dash space

**Trigger:** A list item starts with `-` immediately followed by a key letter: `-key: value` instead of `- key: value`.

**Repair:** A space is inserted after the dash.

#### 9. Duplicate key removal

**Trigger:** The same mapping key appears more than once with exactly the same line text (key + value).

**Repair:** The exact duplicate is dropped. If the duplicate opens a nested block (e.g. a second `options:` with the same list), the entire duplicate block is skipped. Ambiguous duplicates with *different* values are left for js-yaml to report as an error.

#### 10. Invalid double-quoted escape repair

**Trigger:** A double-quoted YAML scalar contains a backslash sequence that is not valid in YAML (e.g. `\+`, `\p`, `\s` from regex-like text). YAML only permits a specific set of escape sequences (`\n`, `\t`, `\\`, `\"`, `\uXXXX`, etc.).

**Repair:** Invalid escape sequences are doubled: `\+` → `\\+` so the backslash becomes a literal character.

**Warning:** *Escaped invalid YAML double-quoted scalar backslash sequences before reparsing.*

#### 11. Unclosed double-quote repair

**Trigger:** A `key: "value` line has an opening `"` with no matching closing `"`, and the next non-blank line is clearly a new YAML structural element (list item, sibling key, code fence, document marker `---`, or end of file).

**Repair:** A closing `"` is appended to the line.

#### 12. Quoted scalar fragment repair

Two sub-cases:

**a) Quoted fragment + trailing plain text:** Values like `"pink" is accepted` or `'pink' remains supported` where a closed quoted token is immediately followed by plain text on the same line. YAML rejects this.

**Repair:** The full visible scalar is wrapped in double quotes: `"\"pink\" is accepted"`.

**b) Quoted block-scalar indicator:** A block-scalar indicator like `|-` is incorrectly quoted as `"|-"` or `'|-'`.

**Repair:** The quotes are removed — the indicator is unquoted back to `|-` when the following lines clearly form an indented block body.

**Warning:** *Repaired improperly quoted YAML scalar value.*

#### 13. Type-union scalar repair

**Trigger:** Schema-like values such as `type: "epic" | "user_story"` or `- "unit" | "integration"`. YAML interprets the `|` as a block-scalar indicator after a quoted token.

**Repair:** The entire scalar is wrapped in double quotes.

#### 14. Reserved indicator scalar repair

**Trigger:** Plain scalars starting with `` ` `` (backtick) or `@`. YAML reserves these characters and rejects plain scalars that begin with them.

**Example:**
```yaml
# Bad
question: `repo_git_mutex` behavior?
- @trace/span-id

# Fixed
question: "`repo_git_mutex` behavior?"
- "@trace/span-id"
```

**Warning:** *Quoted plain YAML scalars that began with reserved indicator characters (`` ` `` or `@`) before reparsing.*

#### 15. Sequence entry indent drift repair

**Trigger:** After a block scalar (`>-`, `|`), subsequent sibling list items drift by 1–3 spaces relative to the first item in the sequence.

**Repair:** All sibling dashes are normalized to the indent of the first `- ` in each sequence level.

#### 16. Indentation repair

**Trigger:** Property lines inside a list item are indented by the wrong amount (off by 1–2 spaces relative to `dash_indent + 2`).

**Repair:** Property lines that are clearly siblings of the list item (deeper than the dash, within 2 spaces of the expected indent) are re-indented to `dash_indent + 2`.

---

### Wrapper Unwrapping

Models often add a wrapper key around the artifact, e.g. outputting `output: { … }` instead of the artifact directly.

**Trigger:** The parsed root object has a single recognized wrapper key.

**Repair:** The wrapper is stripped and the inner object is promoted to the root. A warning records which key was removed.

**Warning examples:**
- *Removed wrapper key "output" from top level.*
- *Removed wrapper key chain "result -> prd" from top level.*

Common wrapper keys accepted across artifacts: `output`, `result`, `data`, `document`, `artifact`. Artifact-specific wrappers are listed in the per-artifact sections below.

---

### Prompt Echo Detection

Before attempting to parse, the pipeline checks whether the model returned its own prompt instead of an artifact.

**Hard markers** (one of these alone is enough to flag the output, combined with at least one soft marker):
- `CRITICAL OUTPUT RULE:`
- `CONTEXT REFRESH:`

**Soft markers** (need at least 2 total hits including a hard marker):
- `## System Role`
- `## Task`
- `## Instructions`
- `## Expected Output Format`
- `## Context`

If the output starts with a recognized root key (e.g. `schema_version:`) *and* contains a structured prompt schema marker (e.g. `## Expected Output Format`, `### ticket_details`, `# Ticket:`), it is also rejected as a schema echo.

When detected, the run is failed immediately with an explicit error and a retry diagnostic rather than attempting repairs.

---

### Key Aliasing

All field lookups use `getValueByAliases`, which normalizes keys by lowercasing and stripping all non-alphanumeric characters before comparison. This makes field matching case-insensitive and symbol-insensitive.

Every field accepts multiple spelling variants. Common examples:

| Canonical key | Also accepted |
| --- | --- |
| `acceptance_criteria` | `acceptancecriteria` |
| `implementation_steps` | `implementationsteps`, `steps` |
| `prd_refs` | `prdrefs`, `prdreferences`, `prd_references` |
| `context_guidance` | `contextguidance`, `architecturalguidance`, `guidance` |
| `blocked_by` | `blockedby` |
| `test_commands` | `testcommands`, `commands` |
| `anti_patterns` | `antipatterns`, `anti-patterns`, `anti_patterns_list` |
| `problem_statement` | `problemstatement` |
| `target_users` | `targetusers` |
| `in_scope` | `inscope` |
| `out_of_scope` | `outofscope` |
| `architecture_constraints` | `architectureconstraints` |
| `data_model` | `datamodel` |
| `api_contracts` | `apicontracts` |
| `security_constraints` | `securityconstraints` |
| `performance_constraints` | `performanceconstraints` |
| `reliability_constraints` | `reliabilityconstraints` |
| `error_handling_rules` | `errorhandlingrules` |
| `tooling_assumptions` | `toolingassumptions` |
| `required_commands` | `requiredcommands`, `commands` |
| `approved_by` | `approvedby` |
| `approved_at` | `approvedat` |
| `schema_version` | `schemaversion` |
| `ticket_id` | `ticketid` |
| `source_interview` | `sourceinterview` |
| `content_sha256` | `contentsha256` |
| `user_stories` | `userstories`, `stories` |

---

## Artifact-Specific Normalizations

After the universal repairs succeed, each artifact type applies additional semantic normalizations.

### Interview Artifact

**Question ID normalization**

Any numeric or prefixed ID is normalized to the `Q##` format (zero-padded to 2 digits):

| Raw | Normalized |
| --- | --- |
| `1` | `Q01` |
| `q1` | `Q01` |
| `Q1` | `Q01` |
| `Q01` | `Q01` (unchanged) |
| `Q15` | `Q15` (unchanged) |

**Duplicate question ID renumbering**

If two questions share the same normalized ID, the duplicate is assigned the next integer above the current maximum ID in the batch.

**Warning:** *Renumbered duplicate question id Q01 at index 3 to Q05.*

**Phase normalization**

The `phase` field is accepted case-insensitively. Valid values: `foundation`, `structure`, `assembly`.

**Question reordering**

Questions are sorted by phase (foundation → structure → assembly), preserving relative order within each phase. This matches the expected interview structure regardless of the order the model emitted them.

**Coverage gap string list quoting**

When the coverage checker returns a list of gap strings, each item is wrapped in double quotes to prevent YAML from coercing values like `true`, `null`, or values containing `: `.

---

### PRD Artifact

**Status normalization**

Accepted values for `status`: `draft`, `approved`. Any unrecognized value is silently normalized to `draft`.

**Warning:** *Normalized unsupported PRD status "pending" to draft.*

**Schema version**

`schema_version` must be a positive integer. Any non-integer or non-positive value is replaced with `1`.

**Warning:** *Normalized invalid schema_version to 1.*

**`ticket_id` canonicalization**

The `ticket_id` in the artifact is compared to the runtime ticket ID.

- If missing: filled from runtime context.
  **Warning:** *Filled missing ticket_id from runtime context.*
- If present but mismatched: replaced with the runtime value.
  **Warning:** *Canonicalized ticket_id from `<old>` to `<new>`.*

**`source_interview.content_sha256` canonicalization**

The hash of the approved Interview Results artifact is computed at runtime. If the emitted hash differs, it is replaced with the correct value.

**Warning:** *Canonicalized source_interview.content_sha256 from the approved Interview Results artifact.*

**Missing or duplicate epic IDs**

- Missing ID → generated as `EPIC-{n}` (1-indexed).
  **Warning:** *Epic at index 0 was missing id. Filled with EPIC-1.*
- Duplicate ID → the duplicate is renamed to the next available `EPIC-{n}` above the current ceiling.
  **Warning:** *Renumbered duplicate epic id EPIC-1 to EPIC-3.*

**Missing or duplicate user story IDs**

- Missing ID → generated as `US-{epic_index}-{story_index}` (1-indexed).
  **Warning:** *User story at epic 1, index 0 was missing id. Filled with US-1-1.*
- Duplicate ID → renamed deterministically.
  **Warning:** *Renumbered duplicate user story id US-1-1 to US-1-3.*

**Nested artifact wrapper**

The model sometimes wraps the PRD inside `artifact: { prd: { … } }`. The inner `prd` object is promoted to the root and `artifact: prd` is set as a flat key.

**Accepted wrapper keys:** `prd`, `document`, `output`, `result`, `data`.

---

### Beads (Blueprint) Artifact

**Missing bead ID**

If a bead entry has no `id`, `beadid`, or `bead_id` key, the ID is generated as `bead-{index+1}`.

**Duplicate bead ID renumbering**

If two beads share an ID, the second is renamed by appending `-2`, `-3`, etc. until unique.

**Warning:** *Renumbered duplicate bead id "auth-module" to "auth-module-2".*

**Context guidance string → object conversion**

`context_guidance` must be an object with `patterns` and `anti_patterns` arrays. Models sometimes emit it as a plain string.

*Multi-line format:*
```
Patterns:
- Use X
Anti-patterns:
- Avoid Y
```
→ converted to `{ patterns: ["Use X"], anti_patterns: ["Avoid Y"] }`

*Inline format:*
```
Patterns: Use X Anti-patterns: Avoid Y
```
→ converted to `{ patterns: ["Use X"], anti_patterns: ["Avoid Y"] }`

**Warning:** *Canonicalized string context guidance at index 0 into patterns/anti_patterns object.*

**Empty `prdRefs` warning**

A bead with no PRD references is valid but unusual.

**Warning:** *Bead "auth-module" has no PRD references (prdRefs is empty).*

**Accepted wrapper keys:** `beads`, `tasks`, `items`, `issues`, `workitems`, `work_items`.

---

### Bead Completion Marker Artifact

The completion marker is extracted from a `<BEAD_STATUS>…</BEAD_STATUS>` XML envelope.

**Status normalization**

| Raw value | Normalized |
| --- | --- |
| `completed`, `complete`, `success`, `succeeded` | `done` |
| `failed`, `fail`, `error` | `error` |

**Check value normalization**

Each quality gate (`tests`, `lint`, `typecheck`, `qualitative`) accepts multiple representations:

| Raw value | Normalized |
| --- | --- |
| `"pass"`, `"passed"`, `"ok"`, `"success"`, `"complete"`, `"completed"`, `true`, `1` | `pass` |
| `"fail"`, `"failed"`, `"error"`, `"timeout"`, `"timedout"`, `"notrun"`, `"skipped"`, `"pending"`, `false`, `0` | `fail` |

Any other string value is kept as-is (lowercased).

**Accepted wrapper keys:** `beadstatus`, `bead_status`, `statusmarker`, `marker`, `result`, `output`, `data`.

**Key aliases for quality gates:**

| Canonical | Also accepted |
| --- | --- |
| `tests` | `test` |
| `lint` | `linter` |
| `typecheck` | `type_check`, `type-check`, `typechecks`, `typescript` |
| `qualitative` | `quality`, `qualitativereview`, `qualitative_review`, `review` |

---

### Refinement Changes (PRD, Beads, Interview)

When a council member proposes changes to an existing artifact draft, it emits a `changes:` list alongside the artifact. The changes are extracted before the artifact is validated (to avoid schema conflicts) and normalized separately.

**Invalid entries skipped**

- Non-object list entries: skipped.
  **Warning:** *Skipped non-object refinement change at index 2.*
- Entries with an unrecognized `type`: skipped.
  **Warning:** *Skipped refinement change at index 1 with invalid type.*

Valid `type` values: `modified`, `added`, `removed` (case-insensitive).

**Inspiration item lenient parsing**

The `inspiration` field (pointing to the losing draft that inspired the change) is parsed leniently:
- A bare string is accepted as the inspiration `label`, with `id` left empty.
- Partial objects (missing `id` or `label`) are accepted.
- The `alternative_draft` field accepts either a model ID string (matched against the losing draft roster) or an ordinal integer (1-indexed position in the roster).

Entries where `inspiration` is present but cannot be resolved are recorded with `attributionStatus: "invalid_unattributed"` rather than being dropped.

---

## Diagnostics and Observability

Every repair produces one or more entries in `repairWarnings`. These are stored on the run record and shown in the **Diagnostics** panel (see [Diagnostics](diagnostics.md)).

A `repairApplied: true` flag is set on any result where at least one repair warning was generated or where the winning candidate was not the raw output verbatim. This flag drives the amber repair indicator shown in the council log.

Repairs never silently drop required fields — if a required field cannot be recovered after all repairs, the parse fails and the run is retried with a structured retry prompt that explains the specific validation error.
