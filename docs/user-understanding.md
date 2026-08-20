# User understanding

xopc implements user understanding as a native runtime capability. It is not an external memory plugin and it is not a larger prompt. The capability turns conversation and connected-source evidence into governed understanding records, then selects a small, relevant subset for each model turn.

## Runtime flow

```text
conversation ─────────────► UserUnderstandingService ──► governed user understanding

connected source ──► knowledge_source_items ──► ConnectedKnowledgePipeline ──► source facts + daily notes
                              │                            │                            │
                              ├── change ledger            └── memory_evidence ◄───────┘
                              └── cursor + sync run audit

user turn ──► UserContextPlanner ──► <user-context> ──► model turn
                    │
                    └── memory_trace_events + feedback
```

The write path and read path are deliberately separate:

- `UserUnderstandingService` extracts explicit instructions immediately and accepts typed candidates from background synthesis.
- Candidates are deduplicated by `canonicalKey`, stored as `candidate`, and linked to redacted source evidence. Secret and regulated candidates are rejected before provider writes, including when a reviewer model mislabeled the sensitivity.
- `UserContextPlanner` performs retrieval, policy filtering, reranking, sectioning, and character budgeting. It rejects expired, not-yet-valid, secret, regulated, and consent-gated records.
- Selected context is fenced as system-owned `<user-context>` data. It is never treated as a user instruction.

## Data model

SQLite schema version 29 adds:

- governance fields on `memory_records`: canonical key, explicitness, durability, importance, disclosure policy, validity interval, supersession, and conflict group;
- `knowledge_source_items`: normalized, content-addressed evidence from conversations and adapters;
- `knowledge_sync_runs` and `knowledge_source_state`: observable incremental ingestion with persistent cursors;
- `memory_evidence`: normalized provenance links;
- `memory_relations`: typed record-to-record relationships.

SQLite schema version 37 adds the connected-knowledge delivery layer:

- `knowledge_source_changes`: an ordered added/modified/deleted ledger so downstream consumers do not need to rescan source payloads;
- `knowledge_consumer_watermarks`: independent monotonic checkpoints for future indexes and synthesis consumers;
- explicit `user_understanding` versus `connected_knowledge` pipeline routing, plus synthesis attempts, leases, worker ownership, and bounded errors on `knowledge_source_items`;
- idempotent `(record, source item, relation)` evidence links.

SQLite schema versions 104–106 finalize the online learning loop:

- stable `turnId` linkage and normalized response/record feedback;
- auditable Dreaming runs and per-record decisions;
- reproducible Dreaming execution through algorithm versions and immutable config snapshots.

The normalized SQLite tables are the only runtime source of truth for understanding and recall. Runtime memory never reads, writes, scans, or projects Markdown. See [Unified memory and user-understanding architecture](./memory-architecture.md).

## Background synthesis

Background review has no storage mutation tool. Its pass produces strict JSON candidates. The runtime parses and validates those candidates, marks them as inferred, and sends them through the same understanding policy and evidence path as deterministic extraction.

This separation prevents a reviewer model from bypassing sensitivity checks, deduplication, provenance, or candidate approval.

Background review is configured once in top-level `userContext`. It is enabled by default for `confirmWrite` and `auto` memory modes, runs every 10 user turns, and is disabled for `off` and `readOnly`:

```json
{
  "userContext": {
    "memory": {
      "mode": "confirmWrite",
      "sources": ["session", "understanding"]
    },
    "understanding": {
      "enabled": true,
      "adaptiveCadence": true,
      "reviewIntervalTurns": 10,
      "maxHistoryMessages": 80,
      "maxDurationMs": 120000
    }
  }
}
```

Set `understanding.enabled` to `false` when model cost or data policy requires deterministic explicit extraction only.

With `adaptiveCadence` enabled, the configured interval is the fastest allowed cadence. xopc doubles the interval when the candidate inbox is backlogged, at least 10 review decisions have a low acceptance rate, or at least 10 recall ratings show low helpfulness. It never increases review frequency above the configured interval.

Quality is available from `GET /api/you/quality?windowDays=30`. Automatic Dreaming readiness is available from `GET /api/you/readiness` and the About You page.

## Response feedback attribution

Completed assistant responses expose helpful / needs-improvement controls. Every model turn has a stable `turnId` carried by context planning, traces, transcript rows, SSE, and the web message. The gateway resolves feedback by that exact id and updates it idempotently; it never guesses from timestamps.

- `GET /api/you/feedback/:turnId` resolves existing response-level and record-level feedback.
- `PUT /api/you/feedback/:turnId` records or replaces feedback for the exact turn.

Explicit corrections such as “你记错了我的偏好” or “I never said that about me” conservatively mark the previous selected-understanding trace as not helpful before planning the correction turn. Generic task feedback such as “the command failed” does not affect understanding quality. Correction traces store only a fixed reason code, not the user's correction text.

### Remediation lifecycle

Feedback remediation is deliberately conservative:

1. One ordinary negative rating is retained as a quality signal but does not mutate an understanding record.
2. An active `user-understanding` record moves to `needs_review` after at least two independent `not_helpful` inject traces and only while negative ratings outnumber helpful ratings. A conservatively detected explicit user correction is authoritative and pauses the selected old understanding immediately.
3. The transition reduces confidence by `0.2`, sets `reviewAfter`, immediately removes the record from normal active-only retrieval, and emits an auditable `remediation` trace. Replaying or replacing the same trace feedback is idempotent.
4. A concrete correction such as “你记错了我的偏好，我更喜欢详细解释” creates a new `candidate` linked with `supersedesRecordId`. A pure denial creates no replacement content.
5. The old record remains `needs_review` until the replacement is explicitly approved. Activating the replacement archives the old record and closes its validity interval.

`PUT /api/you/feedback/:turnId` includes a `remediation` result when feedback evaluation runs. The chat UI acknowledges when related understanding has been paused and queued for review.

## Connected sources

Implement `KnowledgeSourceAdapter.pull()` for a source and register it with `KnowledgeIngestionService`. Pulls are incremental and idempotent by `(sourceInstanceId, externalId)` plus `contentHash`. Cursors persist in SQLite by default, and every run records counts, warnings, failure state, and timing.

Gmail, Google Drive, Notion, and Slack Composio read actions use the same ingestion path. Results are normalized into bounded source items before synthesis; the runtime never writes the connector's raw response directly into memory. `ConnectedKnowledgePipeline` claims pending work with expiring leases, retries failed items, ignores secret and regulated content, and produces:

- one stable `workspace_fact` per external item;
- a bounded `daily_note` per source and day;
- normalized evidence links back to every contributing source item;
- archived records when an upstream item is deleted.

The gateway coordinator drains pending synthesis after startup and every minute. Manual connector memory-sync requests also process their own source immediately, so the existing endpoint remains synchronous from the caller's perspective. The About You source cards show indexed item count and latest sync status.

The gateway exposes read-only operational views:

- `GET /api/knowledge/source-items`
- `GET /api/knowledge/source-changes?afterSequence=...`
- `GET /api/knowledge/sync-runs`
- `/api/you/memories`, `/api/you/traces`, and turn feedback endpoints

## Dreaming and automatic-write readiness

Dreaming is managed from the Dreaming tab under About You. `off`, `observe`, `review`, and `automatic` are the only modes. Every phase writes a structured run and decision ledger in SQLite. The effective mode is capped by the global memory policy and by the automatic-write readiness gate. A requested automatic mode is downgraded to review until recent feedback and Dreaming reliability meet the published thresholds. REM insights always remain reviewable because they create new inferred beliefs.

## Safety defaults

- New understanding is a candidate until approved by an existing review workflow.
- Explicit statements receive higher confidence than inferred statements.
- Secrets and regulated data never enter model context.
- `ask_before_reference` records are excluded until a consent flow is present.
- Context is bounded to 6,000 characters and ranked by retrieval score, confidence, importance, explicitness, and freshness.
- Every context plan emits a trace with selected record IDs and rejection reasons.
