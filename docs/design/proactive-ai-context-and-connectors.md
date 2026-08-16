# Proactive AI: connected-source sync and context architecture

> Status: MVP implementation completed; the broader target architecture below remains the evolution plan.
> Scope: scheduled connector scanning, internal context expansion, cross-source reasoning, and attention delivery.

## Implementation status (2026-08-15)

The first production-shaped vertical slice is implemented:

- per-connection scan and proactive-use policy, scheduled through the existing durable connector-learning jobs;
- content-free, idempotent source-change events with independent consumer watermarks;
- authorized and bounded external, goal, note, project, automation, and user-understanding context providers;
- durable internal product-event bridging for goals, notes, workflows, and sessions;
- calendar-derived 24-hour and 2-hour meeting-preparation triggers, with related internal context selected by term overlap;
- connector policy API and Web controls, plus seven-day content-fingerprint duplicate suppression;
- reuse of the existing Inbox lifecycle, feedback, decisions, and durable outbox instead of a parallel delivery stack.

To keep the first milestone small and reversible, it deliberately reuses `connector_learning_jobs` rather than adding a second sync queue, and stores policy per connection rather than per stream. Stream-level policy/jobs, reconciliation projections, entity links and derived facts, commitment-risk evaluation, digest/quiet-hours/push policy, diagnostics, and large-dataset performance qualification remain follow-up work. Sections below describe that target architecture and should not be read as already shipped behavior.

## 1. Decision summary

The next proactive milestone should extend the existing pipeline instead of introducing a second scheduler, event bus, or knowledge store.

The implementation has three new application components:

1. **Connected Source Sync** owns durable per-connection schedules and invokes the existing knowledge ingestion adapters.
2. **Source Change Publisher** consumes the existing `knowledge_source_changes` journal and publishes durable proactive events.
3. **Context Resolver** combines authorized external evidence with internal domain state for a scenario run.

The target data flow is:

```text
connector policy / webhook
          |
          v
connected-source sync job
          |
          v
KnowledgeIngestionService
  cursor + content hash + tombstone
          |
          v
knowledge_source_changes
          |
          v
SourceChangePublisher -----> ProactiveEventService
                                  |
internal domain events ----------+----> scenario batch
                                       |
                                       v
                                ContextResolver
                         external + internal + history
                                       |
                                       v
                          read-only proactive Agent
                                       |
                                       v
                  discard / record / digest / inbox / push
```

## 2. Existing assets and gaps

### Reuse without replacement

- `KnowledgeIngestionService` already persists source cursors, compares content hashes, creates tombstones, and records created/modified/deleted changes.
- `knowledge_source_items` already carries source identity, normalized text, payload references, metadata, sensitivity, retention, synthesis state, and deletion state.
- `knowledge_source_changes` is an ordered journal with a sequence number.
- `knowledge_consumer_watermarks` already supports independently retryable journal consumers.
- Connector Learning already provides bootstrap/incremental modes, durable jobs, retry, pause, and self-scheduling.
- `ProactiveEventService` already normalizes, deduplicates, persists, routes, and aggregates events.
- Proactive execution already pins scenario/prompt revisions, stores context snapshots, and runs an isolated read-only Agent.
- Project, work-item, automation, goal, note, workflow, and session paths already have partial product-event emission points.

### Gaps to close

- Connector scheduling is coupled to user-understanding derivation and hard-coded toolkit plans.
- A knowledge-source change does not currently become a proactive event.
- Connector authorization does not separately express permission for background scanning and proactive use.
- The proactive context registry only exposes event batches, project state, and automation state.
- Internal product events are not all durably bridged into the proactive event spine.
- Time-window conditions such as “meeting in 24 hours” need durable temporal signals, not renderer timers.
- Value disposition, novelty suppression, digest, quiet hours, and push ceilings are incomplete.

## 3. Component boundaries

```text
src/connectors/sync/
  types.ts                 sync policy, stream, job, and health contracts
  plan-registry.ts         product defaults per connector toolkit
  repository.ts            SQLite policy/job access
  coordinator.ts           due-job claiming, recovery, wake-up, backpressure
  executor.ts              invokes connected-source ingestion per stream
  change-publisher.ts      journal -> proactive event bridge

src/proactive/context/
  types.ts                 request, section, evidence, authorization contracts
  resolver.ts              provider selection, policy checks, budgets, snapshot
  providers/
    connected-source.ts
    project.ts
    work-items.ts
    goals.ts
    notes.ts
    sessions.ts
    user-understanding.ts
    relationships.ts
    execution-state.ts
    attention-history.ts

src/proactive/events/
  domain-bridge.ts         internal product events -> EventEnvelope

src/proactive/temporal/
  worker.ts                due-window and stale-state signals
  repository.ts            durable sweep checkpoints

src/proactive/insights/
  value-policy.ts          product-owned scoring and disposition
  fingerprint.ts           novelty and supersession
```

The existing files remain compatibility entry points during migration. New code depends on narrow repository and publisher interfaces, not `GatewayService`.

## 4. Connected Source Sync

### 4.1 Policy model

A sync policy is stored per connection and stream, because one connector can have streams with different cost and freshness requirements.

```ts
export interface ConnectedSourceSyncPolicy {
  connectionId: string;
  streamKey: string;
  enabled: boolean;
  mode: 'automatic' | 'manual' | 'paused';
  intervalMinutes: number;
  bootstrapWindowDays: number;
  maxItemsPerRun: number;
  understandingEnabled: boolean;
  proactiveEnabled: boolean;
  allowedScenarioKeys: string[];
  retentionClass: KnowledgeRetentionClass;
  nextRunAt?: string;
  lastSuccessfulRunAt?: string;
  consecutiveFailures: number;
  revision: number;
}
```

Product defaults continue to live in code. User choices and operational state live in SQLite. Defaults are applied only when a policy is created; a product upgrade must not overwrite an explicit user choice.

Initial defaults:

| Source | Streams | Interval |
|---|---|---:|
| Gmail | recent messages | 15 minutes |
| Google Calendar | events | 15 minutes |
| Linear | assigned/relevant issues | 15 minutes |
| GitHub | repositories, authored work | 30 minutes |
| Google Drive | files | 60 minutes |
| Notion | pages | 60 minutes |
| Slack | relevant messages/threads; channel inventory separately | 15 / 360 minutes |

Webhook support is an early wake-up optimization. A webhook enqueues the same durable sync job and never bypasses ingestion, change detection, policy, or event deduplication.

### 4.2 Job model

```ts
export interface ConnectedSourceSyncJob {
  id: string;
  idempotencyKey: string;
  connectionId: string;
  streamKey: string;
  mode: 'bootstrap' | 'incremental' | 'reconcile';
  priority: 'user' | 'event' | 'schedule';
  status: 'queued' | 'leased' | 'running' | 'succeeded'
    | 'failed_retryable' | 'failed_permanent' | 'cancelled';
  attemptCount: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
}
```

Idempotency keys:

- scheduled: `sync:<connection>:<stream>:<time-bucket>`
- webhook: `sync:<connection>:<stream>:webhook:<delivery-id>`
- manual: generated request id
- reconcile: `sync:<connection>:<stream>:reconcile:<date-bucket>`

The worker uses short SQLite claim transactions and performs remote I/O after commit. A stale lease returns to `queued`. The scheduler applies bounded exponential backoff with jitter. Authentication or revoked-permission failures pause the affected policy; transient provider and rate-limit failures retry.

Only one unfinished job may exist for a `(connectionId, streamKey)`. A webhook arriving during a run marks the stream as needing another pass rather than creating an unbounded queue.

### 4.3 Execution

The executor resolves the connector definition and verified read action, then calls the existing `ingestComposioConnectedSource` / `KnowledgeIngestionService` path.

Required behavior:

1. Read the persisted cursor.
2. Pull a bounded page or snapshot.
3. Normalize external content into `KnowledgeSourceItemInput`.
4. Upsert by `(sourceInstanceId, collectionScope, externalId)`.
5. Record only actual hash/deletion changes in `knowledge_source_changes`.
6. Advance the cursor only after item persistence succeeds.
7. Complete the sync run and schedule the next run.
8. Wake journal consumers only when created/updated/deleted counts are non-zero.

Understanding synthesis remains a separate consumer. A no-change scan performs no synthesis and no proactive model invocation.

## 5. Source Change Publisher

### 5.1 Delivery semantics

`SourceChangePublisher` is an at-least-once journal consumer with consumer id `proactive-connected-source-v1`.

For each active source instance:

1. Read its consumer watermark.
2. Load ordered changes after the watermark, in bounded batches.
3. Load the referenced source item and sync/proactive policy.
4. Skip content not authorized for proactive use, but still advance this consumer's watermark.
5. Publish a durable `EventEnvelope` through `ProactiveEventService`.
6. Advance the watermark only after publish returns successfully.

If the process crashes after event publication but before watermark advancement, retry is safe because the event dedupe key is stable.

### 5.2 Event vocabulary

```text
connected_source.item_created.v1
connected_source.item_updated.v1
connected_source.item_deleted.v1
connected_source.sync_failed.v1
connected_source.sync_stale.v1
```

Example payload:

```ts
{
  type: 'connected_source.item_updated.v1',
  schemaVersion: 1,
  source: { kind: 'connector', id: connectionId },
  subject: { kind: 'knowledge_source_item', id: sourceItemId },
  actor: { kind: 'integration', id: connectorId },
  scope: { workspaceId, agentId },
  occurredAt: sourceUpdatedAt ?? changedAt,
  dedupeKey: `knowledge-change:${sequence}`,
  sensitivity: mapMemorySensitivity(item.sensitivity),
  payload: {
    sourceInstanceId,
    collectionScope,
    itemType,
    changeKind,
    sourceItemId,
    contentHash,
  },
}
```

Event payloads do not carry raw message, email, document, or calendar content. Context providers dereference `sourceItemId` after repeating authorization checks.

Sensitivity mapping is monotonic:

```text
normal -> personal
personal -> personal
secret -> confidential
regulated -> restricted
```

## 6. Internal event integration

### 6.1 Durable domain bridge

Introduce `ProactiveDomainEventBridge` at gateway startup. It maps the existing internal product events into versioned durable proactive events.

Initial mappings:

| Product event | Proactive event |
|---|---|
| `goal.created` | `goal.created.v1` |
| `goal.status_changed` | `goal.status_changed.v1` |
| `note.created` | `note.created.v1` |
| `note.updated` | `note.updated.v1` |
| `workflow.run.completed` | `workflow.run_completed.v1` |
| completed user/agent turn | `session.turn_completed.v1` |
| explicit judgment decision | `decision.recorded.v1` |
| proactive feedback | `proactive.feedback_recorded.v1` |

Projects, work items, and automation failures that already publish directly keep their current durable path.

The bridge payload contains identifiers, status transitions, bounded metadata, and hashes. Domain detail remains in the domain repository and is loaded by a provider.

### 6.2 Reconciliation

Events are the primary internal path. A low-frequency reconciliation worker protects against imports, migrations, or old write paths that bypass publishers.

Every 6 hours it computes stable hashes for active projects, work items, goals, scheduled automations, and open judgments. A changed hash publishes `domain.snapshot_changed.v1` with an idempotent key containing domain, subject, and hash.

Reconciliation does not invoke a model and does not publish events when hashes are unchanged.

## 7. Context Resolver

### 7.1 Contract

Replace the current unbounded `Record<string, unknown>` collection contract with explicit sections, evidence, authorization, and budgets.

```ts
export interface ProactiveContextRequest {
  runId: string;
  scenarioKey: string;
  scope: { workspaceId: string; projectId?: string; agentId?: string };
  eventIds: string[];
  subjectRefs: Array<{ kind: string; id: string }>;
  authorization: AuthorizationSnapshot;
  budget: {
    maxSections: number;
    maxItems: number;
    maxCharacters: number;
    maxAgeDays: number;
  };
}

export interface ProactiveContextSection<T = unknown> {
  id: string;
  data: T;
  evidence: EvidenceRef[];
  sensitivity: EventSensitivity;
  capturedAt: string;
  contentHash: string;
  truncated: boolean;
}

export interface ProactiveContextProvider {
  readonly id: string;
  supports(request: ProactiveContextRequest): boolean;
  collect(request: ProactiveContextRequest): Promise<ProactiveContextSection>;
}
```

The resolver performs these checks before returning a section:

- workspace, project, agent, and source-account scope;
- connector `proactiveEnabled` and scenario allow-list;
- maximum allowed sensitivity for the scenario/subscription;
- retention/deletion state;
- item count, age, and character budgets;
- stable evidence identifiers for every model-visible fact.

Provider output is saved to the existing proactive context snapshot before model execution. Restricted bodies should remain ephemeral; the snapshot stores provenance and hashes unless the retention policy explicitly permits content retention.

### 7.2 Providers

MVP providers:

- `ConnectedSourceContextProvider`: knowledge items referenced by source-change events plus bounded related items.
- `GoalContextProvider`: goal status, acceptance criteria, progress, blockers, and active session.
- `NoteContextProvider`: title, kind, status, tags, linked project, bounded relevant excerpt.
- `SessionContextProvider`: recent LLM-safe messages, summaries, decisions, and commitments; it must use the existing session context builder rather than raw transcript parsing.
- `UserUnderstandingContextProvider`: active claims, preferences, routines, and relationship records relevant to the scenario.
- `ExecutionStateContextProvider`: automation, workflow, and persistent-goal runs already in flight.
- `AttentionHistoryContextProvider`: prior active/resolved/snoozed insights and feedback for novelty control.

Every external text section is wrapped as untrusted content before reaching the Agent. External text can provide evidence but cannot define instructions, tools, output schemas, or authorization.

### 7.3 Derived facts and entity links

Do not copy all domain data into a generic EAV store. Domain tables and knowledge items remain authoritative.

Add derived storage only for cross-source concepts that have no single authoritative owner:

- commitments and deadlines;
- person/project/resource links;
- waiting-for relationships;
- external-to-internal status mappings;
- explicit user corrections to inferred links.

Proposed tables:

```text
context_facts
  fact_id, workspace_id, agent_id
  subject_kind, subject_id, predicate, value_json
  confidence, sensitivity, state
  fingerprint, observed_at, valid_until, created_at, updated_at

context_fact_evidence
  fact_id, evidence_kind, evidence_id, relation, observed_at

context_entity_links
  link_id, workspace_id
  from_kind, from_id, to_kind, to_id, relation
  confidence, source, state, created_at, updated_at
```

`fingerprint` is unique within workspace/agent scope. New contradictory evidence updates or retracts a fact and keeps evidence history. User-confirmed links override inferred links until explicitly changed.

## 8. Temporal signals

Change events alone cannot trigger “24 hours before a meeting” or “waiting for a reply for three days.” Add a durable `TemporalSignalWorker`.

The worker runs every 15 minutes and evaluates only indexed deadlines/windows. It publishes events such as:

```text
calendar.meeting_window_entered.v1
commitment.due_window_entered.v1
conversation.response_overdue.v1
goal.stalled.v1
```

Example dedupe keys:

```text
temporal:meeting:<item-id>:24h:<event-start>
temporal:commitment:<fact-id>:due:<due-date>
temporal:goal:<goal-id>:stalled:<seven-day-bucket>
```

Persist the last completed sweep boundary. On restart, scan from the previous boundary to now with a bounded look-back. The worker never uses in-memory timers as the source of truth.

## 9. Scenario execution

### Meeting preparation

Triggers:

- calendar item created/updated;
- `calendar.meeting_window_entered.v1` at 24 hours and, if still useful, 2 hours.

Context:

- calendar source item;
- attendees and relationship context;
- linked project, work items, goals, notes, and recent decisions;
- recent relevant messages and prior meeting outcome;
- existing active judgment for the same meeting.

Aggregation key: calendar external event identity. A content fingerprint prevents a rescan from creating a second unchanged preparation.

### Commitment and deadline risk

Triggers:

- commitment fact created/updated;
- linked goal/work-item status change;
- commitment due window entered.

Context:

- commitment evidence;
- owner/counterparty relationship;
- linked work item or goal;
- recent execution and communication state.

Hard gate: no explicit or evidence-backed deadline/obligation means no judgment.

### External/internal drift

Triggers:

- GitHub/Linear item update;
- project/work-item update.

Context:

- confirmed/inferred entity link;
- both current states and their observed times;
- previous sync decision.

Hard gate: insufficient entity-link confidence yields a quiet link suggestion, not a status recommendation.

## 10. Value, novelty, and delivery

Add a product-owned `ValuePolicyEvaluator` after output/evidence validation.

```ts
export interface ValueFeatures {
  impact: number;
  urgency: number;
  actionability: number;
  relevance: number;
  confidence: number;
  novelty: number;
  interruptionCost: number;
}

export type InsightDisposition =
  | 'discard'
  | 'record'
  | 'digest'
  | 'inbox'
  | 'push';
```

Required hard gates:

- no valid evidence: discard;
- unauthorized or deleted evidence: discard and security telemetry;
- unchanged active content fingerprint: record or discard;
- low confidence and no reversible user decision: record;
- high impact plus time sensitivity: eligible for push, subject to preference and rate limits.

Persist `content_fingerprint`, `novelty_key`, `disposition`, `expires_at`, and policy feature JSON on insights. `projectInsightsToInbox` projects only `inbox` and `push`; a digest worker collects `digest`; `record` remains available to future context without occupying attention.

## 11. Permission model

Connector authority is separated into four layers:

1. account connected;
2. background scanning allowed;
3. use for understanding and/or proactive reasoning allowed;
4. external write action allowed.

Connecting an account does not imply layers 2–4. Existing accounts can retain their current understanding scans, but proactive use defaults off until the user accepts the new purpose.

Authorization is checked at:

- job enqueue and claim;
- connector tool execution;
- journal-to-event publication;
- scenario eligibility;
- context provider dereference;
- proactive Agent tool execution;
- delivery.

Revocation immediately pauses policies and excludes source items from new context. Deletion/revocation creates tombstones or retracts derived facts; historical operational rows retain only non-content identifiers and hashes as allowed by retention policy.

## 12. SQLite migrations

Migration numbers below are provisional and must be rebased on the current migration head at implementation time.

### 075 — connected-source sync control

- `connected_source_sync_policies`
- `connected_source_sync_jobs`
- unique job idempotency key
- due-job, lease-expiry, connection/stream indexes
- backfill policies for active supported connections

### 076 — cross-source context projections

- `context_facts`
- `context_fact_evidence`
- `context_entity_links`
- fingerprint, subject, validity, and evidence indexes

### 077 — temporal checkpoints

- `proactive_temporal_checkpoints`
- indexes for active context-fact deadlines and source-item occurrence time

### 078 — insight disposition and novelty

- add insight fingerprint, novelty key, disposition, expiry, policy features
- partial indexes for active duplicate detection
- delivery preference/quiet-hour state if not already represented by device preferences

Migrations do not rewrite existing source items, proactive events, runs, insights, or Inbox data.

## 13. API and UI contracts

### Connector sync

```text
GET   /api/connectors/connections/:id/sync
PATCH /api/connectors/connections/:id/sync
POST  /api/connectors/connections/:id/sync/run
GET   /api/connectors/connections/:id/sync/runs
```

The response exposes stream-level schedule, scopes, next run, last success, counts, cursor health, and bounded failure codes. It never exposes raw credentials or provider payloads.

### Proactive preferences

```text
GET   /api/proactive/preferences
PATCH /api/proactive/preferences
```

Preferences include source consent, scenario source allow-list, digest window, quiet hours, push ceiling, and sensitivity ceiling.

### Diagnostics

Extend internal proactive health with:

- due/leased/failed sync jobs;
- oldest sync lag by connector/stream;
- journal backlog by consumer/source;
- event publication lag;
- context authorization rejection counts;
- temporal sweep lag;
- disposition and duplicate-suppression counts.

## 14. Reliability and backpressure

- Delivery semantics are at-least-once; user-visible effects are deduplicated.
- SQLite transactions contain only claims and writes, never connector or model calls.
- User-triggered sync outranks webhook, which outranks scheduled background sync.
- When backlogged, defer inventory streams before calendar/message/issue activity streams.
- Bound each connector pull, journal batch, context section, model input, and worker loop.
- Apply provider-aware concurrency limits; one failing account must not block other accounts.
- Use typed error codes: `auth_revoked`, `rate_limited`, `provider_unavailable`, `invalid_cursor`, `policy_denied`, `malformed_payload`, `internal`.
- An invalid cursor performs a bounded reconcile/bootstrap only after policy approval; it does not silently fetch unlimited history.

## 15. Security requirements

- Only curated verified read actions are allowed for background ingestion.
- External text is untrusted data and must use the existing external-content delimiter/sanitizer before model exposure.
- Prompt instructions, tools, schema, and authority never come from connector content.
- Raw external content is absent from proactive event payloads and logs.
- Logs use ids, counts, hashes, phases, and bounded previews with normal logger redaction.
- Evidence access repeats authorization at render time so revoked data is not silently displayed.
- Restricted data is excluded unless the scenario subscription explicitly permits it.
- External write operations remain outside this milestone and continue to require their existing confirmation policy.

## 16. Observability

Structured log context should include:

```text
connectionId, connectorId, streamKey, syncJobId, syncRunId,
sourceInstanceId, sourceChangeSequence, eventId, batchId, runId,
scenarioKey, contextProvider, disposition
```

Primary metrics:

- sync success rate and p50/p95 lag;
- no-change ratio and items changed per scan;
- journal backlog and publish latency;
- proactive runs per changed item;
- context latency, size, truncation, and authorization rejection;
- duplicate suppression and disposition distribution;
- Inbox decision, snooze, dismiss, useful, and accepted-action rates;
- connector/model cost per useful judgment.

No-change scans should approach zero proactive runs. Every live judgment must reconstruct `source change -> event -> batch -> context evidence -> insight -> Inbox/delivery`.

## 17. Test plan

### Unit

- schedule resolution, jitter, pause/resume, and policy revision;
- idempotent enqueue and one-unfinished-job coalescing;
- retry classification, backoff, stale lease recovery;
- sensitivity mapping and proactive-consent filtering;
- change journal mapping and stable event dedupe key;
- watermark advances only after successful publication;
- context provider scope, sensitivity, age, count, and character budgets;
- entity-link precedence and fact retraction;
- temporal-window dedupe and restart catch-up;
- value disposition and content-fingerprint suppression.

### Integration

Use fake connector adapters to cover:

1. bootstrap creates items and proactive events;
2. identical incremental scan creates no changes and no proactive run;
3. update and deletion create one event each;
4. crash after publish/before watermark does not duplicate an insight;
5. gateway restart recovers stale jobs and temporal checkpoints;
6. revoked proactive consent stops publication and context dereference;
7. two connector accounts remain isolated;
8. meeting-prep scenario combines external and internal evidence;
9. prompt-injection text in a source item remains quoted evidence and cannot alter tools/output;
10. disconnected source retracts or hides derived facts.

### Migration and performance

- migrate an existing database with connector learning jobs and proactive Inbox data;
- verify no duplicate bootstrap after policy backfill;
- exercise 100,000 source items, 50 active streams, and a 10,000-change backlog;
- measure SQLite claim contention and context queries before adding any non-SQLite infrastructure.

## 18. Delivery sequence

### Increment 1 — change-to-event vertical slice

- Add sync policy/job repositories while continuing to use existing ingestion.
- Add `SourceChangePublisher` using existing changes and watermarks.
- Publish connected-source events in shadow mode with no live scenario subscriptions.
- Ship diagnostics and restart/idempotency tests.

Exit gate: repeated scans and crash recovery produce exactly one durable event per actual source change.

### Increment 2 — internal context resolver

- Extract the current context registry behind the new contract.
- Add goal, note, session, user-understanding, execution, attention-history, and connected-source providers.
- Add the durable internal domain bridge and reconciliation hashes.
- Run existing scenarios against the new resolver without changing their user-visible output.

Exit gate: all evidence is authorized, bounded, and replayable from a saved context snapshot.

### Increment 3 — cross-source scenarios

- Add temporal worker.
- Launch meeting preparation and commitment risk in shadow mode.
- Add entity links and derived commitment facts.
- Review sampled outputs and tune scenario-specific hard gates.

Exit gate: useful-rate target is met in shadow evaluation and duplicate/no-evidence judgments stay below thresholds.

### Increment 4 — live attention policy

- Add dispositions, fingerprints, digest, quiet hours, and push ceilings.
- Enable scenarios progressively by connection/workspace.
- Add Web/Mobile source evidence and preference controls.

Exit gate: live delivery is reversible per source/scenario, push is rate-limited, and every judgment explains why it appeared.

## 19. Acceptance criteria

- Every automatic connector stream persists its next run and recovers after restart.
- Incremental cursors, hashes, and tombstones prevent repeated processing.
- A no-change scan causes zero proactive model runs.
- Source changes publish idempotent, versioned events without raw content.
- Internal and external evidence can be selected under one authorization and budget contract.
- Meeting preparation and commitment risk run end-to-end from connector/internal signals to Work/Inbox.
- 100% of live judgments contain valid evidence references.
- Active duplicate judgment rate is below 5%.
- Initial useful/accepted judgment rate target is at least 60%.
- Existing project-risk, blocked-work, automation-impact, connector learning, and Inbox behavior remains compatible throughout rollout.

## 20. Explicit non-goals

- No new message broker, vector database, or remote scheduling service.
- No general-purpose rule language or complex event-processing engine.
- No model call on every connector scan or every source item.
- No autonomous connector write actions in this milestone.
- No duplication of all domain records into `context_facts`.
- No raw external content in proactive events, metrics, or ordinary logs.
