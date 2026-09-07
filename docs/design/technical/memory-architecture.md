# Memory and user-model architecture

Status: implemented in schema version 148

Scope: user understanding, durable knowledge, temporal reasoning, maintenance, retrieval, and Agent execution context

Migration policy: one-way transactional cutover. There is no dual read, dual write, fallback schema, compatibility API, or legacy configuration alias.

## Decision

xopc stores five kinds of durable context:

1. **User assertions** describe identity, preferences, values, routines, capabilities, relationships, and current state.
2. **Goals** describe outcomes the user wants over time.
3. **Priority windows** identify what matters during a bounded interval.
4. **Collaboration rules** are explicit instructions that affect communication or execution.
5. **Knowledge items** hold distilled project facts, decisions, lessons, commitments, questions, and episodes that are useful to recall but are not claims about the user.

Source evidence is kept separately from these objects. SQLite is the source of truth and FTS5 generates lexical candidates. The runtime does not use an external graph database or require embeddings.

This separation is deliberate. A project deadline is knowledge. Wanting to ship a product is a goal. Making that goal primary this week is a priority window. Preferring concise updates is a user assertion. Requiring approval before an external send is a collaboration rule.

## Invariants

- A fact slot has a stable identity: principal, subject, predicate, scope, and scope id.
- The natural-language value is not part of slot identity.
- A correction is resolved before duplicate detection and creates a superseding assertion.
- A different value in a single-valued slot cannot become supporting evidence for the old value.
- Confidence and importance remain separate. Confidence estimates truth; importance estimates execution value.
- Scope and validity time are enforced before retrieval.
- Inferred and external evidence enters as a candidate. It cannot silently create an active rule or authority grant.
- Secret, regulated, review-required, conflicted, stale, archived, rejected, or expired assertions are excluded from execution context.
- Maintenance transitions are deterministic, bounded, idempotent, and audited.
- Prompts are a rendering of typed context. Tool-gate collaboration rules are also enforced in code.

## Storage model

### Evidence

`context_evidence` records a stable source identity and its current provenance: source type and instance, source reference, source run/item, session/turn/message, content hash, bounded excerpt, trust, retention, processing policy, extractor version, observation time, and ingestion time.

Repeated admission of the same source identity updates that provenance row. Assertions link to evidence through `user_assertion_evidence`, where the relation is `supports`, `contradicts`, or `supersedes`.

### Assertions

`user_assertion_slots` owns stable fact identity. `user_assertions` owns values and includes kind, structured value, user-readable statement, authority, lifecycle, confidence, importance, consequence, actionability, volatility, sensitivity, disclosure policy, applicability, valid/observed/recorded/review time, and an optional superseded assertion id.

`user_assertion_status_events` records every lifecycle transition. `user_assertions_fts` indexes statements.

Current values are resolved from lifecycle eligibility, valid-time containment, scope, authority, explicit supersession, and conflicts. Unresolved same-slot conflicts are withheld instead of selecting the newest row.

### Goals and priorities

`user_goals` contains goal lifecycle, scope, importance, target time, validity, authority, and confidence. User-visible content and success criteria are versioned in `user_goal_revisions`.

`user_priority_windows` links a goal, project, task, assertion, or topic to a rank and urgency during an explicit interval. This is the time dimension for “what matters now.” Expired windows remain auditable but do not enter current context.

### Collaboration rules

`collaboration_rules` and `collaboration_rule_revisions` store explicit communication, execution, boundary, routine, and proactive rules. Conditions may set enforcement to `prompt`, `planner`, or `tool_gate`. Only active, scope-visible rules are selected.

### Knowledge

`knowledge_items` stores two explicitly separated record classes. `memory` contains distilled project/workspace facts, decisions, task lessons, commitments, open questions, episodes, and notes. `source_index` contains bounded connector records used for retrieval and provenance; it is never presented as work memory. Each item has scope, canonical key, lifecycle, confidence, importance, validity/expiry/review time, origin class, and source provenance.

Canonical identity prevents duplicate current records. A connected source item that disappears is archived; if it returns, the same source-index id is reactivated and updated. Raw daily rollups are not created because they duplicate source records without adding semantic value.

### Audit

`execution_context_runs` records the turn, session, query hash, time, selection budget, and metrics. `execution_context_items` records selected object ids, scores, and reasons. `execution_context_feedback` stores `helpful` or `irrelevant` feedback against that exact turn.

`memory_maintenance_runs` and `memory_maintenance_decisions` record the algorithm version, configuration snapshot, result metrics, and every maintenance transition.

## Capture and reconciliation

Direct UI/API writes are authoritative `user_explicit` candidates and use the same reconciliation transaction as background capture.

Background review runs after eligible Agent turns at the configured interval. It receives bounded transcript history and emits typed assertion candidates with evidence, scope, time, authority, and sensitivity. Authorized connected sources use the same model: repeated owner-attributed preferences or routines can become assertion candidates; ongoing work becomes knowledge.

Reconciliation follows this order:

1. Validate subject, predicate, cardinality, scope, metrics, sensitivity, and time bounds.
2. Resolve or create the stable slot.
3. Apply an explicit correction target when present.
4. Deduplicate the same normalized value and attach evidence.
5. Supersede a lower-authority or explicitly corrected current value.
6. Preserve an authoritative current value when a weaker observation disagrees.
7. Create a conflict or review candidate when the result is ambiguous.

Current-state and event assertions require bounded validity. Default review time is derived from volatility; it does not turn an inference into an explicit fact.

## Execution context

`ExecutionContextCoordinator` builds context before each eligible private turn. It selects active scope-visible collaboration rules; active valid assertions ranked by relevance, importance, consequence, actionability, and urgency; active or proposed goals; active priority windows; and active current scope-visible knowledge found by FTS5.

The context is capped by `maxAssertions`, `maxKnowledge`, and `maxChars`, then prepended to the current model message. Temporary or disabled user-context sessions receive no shared context. Every selection is recorded before model execution.

The Agent can request exact additional information through `user_context_search`, `user_context_get`, `knowledge_search`, `knowledge_get`, `knowledge_write`, `session_recall`, and `session_search`.

## Deterministic maintenance

The Gateway reconciles three built-in system automations on startup and configuration reload. They use the configured timezone, or the host timezone when omitted.

| Job | Default | Current behavior |
| --- | --- | --- |
| Temporal sweep | hourly | marks assertions and knowledge stale when validity or expiry ends; marks priority windows expired; moves due active objects to review |
| Daily reconciliation | 03:00 | performs the temporal sweep, detects contradictory evidence, activates eligible candidates after the configured number of independent owner sources, and repairs missing FTS rows |
| Weekly knowledge | Sunday 04:00 | performs temporal transitions and archives stale knowledge older than `staleRetentionDays` |

Each run has a principal/job/time-bucket idempotency key and a bounded row limit. Repeating the same bucket returns the existing run. The jobs do not call an LLM and do not send routine notifications. Three consecutive automation failures disable that automation through the standard automation reliability policy.

Default policy:

```json
{
  "userContext": {
    "enabled": true,
    "userModel": {
      "enabled": true,
      "writePolicy": "confirm",
      "sensitiveWritePolicy": "confirm",
      "processingPolicy": "remote_allowed",
      "extraction": {
        "reviewIntervalTurns": 10,
        "maxHistoryMessages": 80,
        "maxDurationMs": 120000
      },
      "maintenance": {
        "enabled": true,
        "temporalSweepMinutes": 60,
        "dailyTime": "03:00",
        "weeklyDay": "sun",
        "weeklyTime": "04:00",
        "evidenceThreshold": 2,
        "limit": 1000,
        "staleRetentionDays": 30
      }
    },
    "knowledgeMemory": {
      "enabled": true,
      "writePolicy": "confirm",
      "sources": ["session", "workspace"],
      "searchStrategy": "fanout",
      "writeStrategy": "local-first",
      "allowExternalWrites": false
    },
    "contextPlanning": {
      "enabled": true,
      "maxAssertions": 20,
      "maxKnowledge": 12,
      "maxChars": 6000
    }
  }
}
```

The configuration schema is strict. Removed `memory`, `understanding`, and `dreaming` keys are rejected.

## API and UI

The Gateway exposes:

```text
GET    /api/user-model
GET    /api/user-model/assertions
GET    /api/user-model/assertions/:id
POST   /api/user-model/assertions
PATCH  /api/user-model/assertions/:id
PATCH  /api/user-model/assertions/:id/status
GET    /api/user-model/goals
POST   /api/user-model/goals
PATCH  /api/user-model/goals/:id/status
GET    /api/user-model/rules
POST   /api/user-model/rules
PATCH  /api/user-model/rules/:id/status
GET    /api/user-model/priorities
POST   /api/user-model/priorities
GET    /api/knowledge-memory
GET    /api/knowledge-memory/:id
PATCH  /api/knowledge-memory/:id/status
GET    /api/memory-maintenance/runs
GET    /api/turns/:turnId/execution-context
POST   /api/turns/:turnId/execution-context/feedback
```

The Gateway console route `/user-model` displays active/review facts, goals, priority windows, collaboration rules, knowledge, and the latest maintenance run. It supports confirmation, rejection, correction through source-review flows, lifecycle changes, and knowledge archival.

## Code ownership

```text
src/user-model/                  assertion, goal, priority, capture, time, importance
src/knowledge-memory/            knowledge lifecycle and retrieval
src/storage/sqlite/              evidence and collaboration-rule repositories
src/memory-maintenance/          deterministic maintenance and schedules
src/agent/context/               execution-context selection, rendering, audit
src/gateway/hono/routes/         user-model and knowledge API
web/src/features/user-model/     management UI
```

Routes, tools, connectors, compaction, projects, proactive context, voice context, and workflows call these domains. They do not read the removed tables.

## One-way migration

Migration 148 creates the target tables, migrates eligible profile fields and understandings into assertions, migrates generic memory records into knowledge, rebuilds FTS indexes, and drops the old tables. It also removes legacy dreaming automations.

The repository retains historical baseline SQL and migrations so installed databases can upgrade. That SQL is migration input only. After migration 148, the final database contains no `user_profiles`, `user_understandings`, `user_focuses`, or `memory_records` tables, and runtime code has no fallback path to them.

Removed runtime surfaces include the old understanding/consolidation/planner/focus modules, generic local memory provider, dreaming service and tool, `/api/you` routes, `memory_search` and `memory_get`, old configuration keys, and the old user-context UI.

## Verification

The implementation is covered by reconciliation, temporal validity, evidence threshold, maintenance idempotency, scope isolation, knowledge lifecycle, execution-context selection and audit, connected-source restoration, API, automation reconciliation, configuration rejection, migration, and UI tests.

Measured future additions are intentionally outside the current design: embeddings, a graph database, semantic merging, inferred sensitive attributes, and automatic rewriting of explicit user facts. They should be added only when representative evaluation shows a task-level gain under the same privacy, latency, and context budgets.
