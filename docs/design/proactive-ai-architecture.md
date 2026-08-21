# Proactive AI architecture

> Status: proposed architecture; no implementation commitment until review.

## 1. System boundaries

The proactive subsystem is an application layer between domain facts and user attention.

```text
Domain services                 Proactive core                         User surfaces
---------------                 --------------                         -------------
projects  tasks  goals     ->   event store -> router -> batches  ->  insight history
notes  automations              eligibility -> context -> runner      Proactive Inbox
sessions  connectors            validation -> value policy            digest / push
                                delivery outbox -> feedback
```

Dependencies point inward:

- Domain modules depend only on the event publisher contract.
- Proactive scenarios depend on domain-neutral context-provider interfaces.
- Context-provider adapters may depend on domain read services.
- Gateway, Web, and Mobile depend on proactive application services and DTOs.
- Delivery adapters depend on the delivery outbox, never directly on domain events.

This keeps the event pipeline open for new domains while preventing scenario logic from leaking into project, task, or automation services.

## 2. Canonical contracts

The interfaces below are logical contracts. Exact TypeScript placement is part of implementation planning.

```ts
type EventSensitivity = 'public' | 'personal' | 'confidential' | 'restricted';

interface EventEnvelope<TPayload = unknown> {
  id: string;
  type: string;                 // e.g. task.status_changed.v1
  schemaVersion: number;
  source: { kind: string; id: string; deviceId?: string };
  subject: { kind: string; id: string };
  actor: { kind: 'user' | 'agent' | 'system' | 'integration'; id?: string };
  scope: { workspaceId: string; projectId?: string; agentId?: string };
  occurredAt: string;
  observedAt: string;
  correlationId: string;
  causationId?: string;
  dedupeKey: string;
  sensitivity: EventSensitivity;
  payload: TPayload;
}

interface ScenarioDefinition {
  id: string;
  key: string;
  version: number;
  enabled: boolean;
  trigger: TriggerPolicy;
  context: ContextPolicy;
  execution: ExecutionPolicy;
  outputSchemaKey: string;
  valuePolicy: ValuePolicy;
  deliveryPolicy: DeliveryPolicy;
  activePromptRevisionId: string;
}

interface TriggerPolicy {
  eventTypes: string[];
  conditions: Condition[];      // allow-listed operators and event fields
  aggregationKey: 'subject' | 'project' | 'workspace' | string;
  debounceSeconds: number;
  maxWindowSeconds: number;
  cooldownSeconds: number;
  minimumEvents?: number;
  fallbackSchedule?: string;
}

interface ContextRequest {
  runId: string;
  providerKey: string;
  subjectRefs: Array<{ kind: string; id: string }>;
  since?: string;
  until: string;
  limit: number;
  authorization: AuthorizationSnapshot;
}

interface ContextProvider<T = unknown> {
  readonly key: string;
  load(request: ContextRequest): Promise<ContextResult<T>>;
}

interface ContextResult<T> {
  data: T;
  evidence: EvidenceRef[];
  truncated: boolean;
  contentHash: string;
  capturedAt: string;
}

interface PromptRevision {
  id: string;
  scenarioId: string;
  revision: number;
  status: 'draft' | 'published' | 'retired';
  baseTemplateVersion: number;
  userInstructions: string;
  createdAt: string;
  publishedAt?: string;
}

interface InsightCandidate {
  kind: 'observation' | 'risk' | 'recommendation' | 'decision' | 'question';
  title: string;
  summary: string;
  observations: string[];
  inferences: string[];
  recommendation?: { text: string; rationale: string };
  decision?: { question: string; options: DecisionOption[] };
  evidence: EvidenceRef[];
  features: ValueFeatures;
}
```

Event type names include their schema major version. Payloads evolve compatibly within that version; incompatible changes publish a new type. Consumers ignore unknown fields and reject unknown major versions.

## 3. Durable pipeline

Every stage is independently retryable and idempotent.

1. **Ingest:** accept a typed local publisher call or connector event.
2. **Normalize:** assign identity, timestamps, scope, sensitivity, correlation, and dedupe key.
3. **Persist:** transactionally insert the immutable event; duplicate dedupe keys return the existing event.
4. **Route:** match enabled scenario subscriptions using indexed type/scope fields and allow-listed conditions.
5. **Aggregate:** append the event to a scenario/aggregation-key window; debounce bursts into one batch.
6. **Eligibility:** enforce enablement, scope consent, cooldown, quiet policy, budgets, and recursion guards.
7. **Snapshot:** call authorized context providers and record hashes, evidence references, truncation, and authorization version.
8. **Compose:** assemble protected platform instructions, scenario base prompt, user instructions, runtime context, and protected output schema.
9. **Execute:** create a leased run and invoke the existing Agent/Automation runtime with fixed tools, timeout, model role, and budget.
10. **Validate:** parse the schema, reject unsupported evidence, detect prompt injection indicators, and bound all fields.
11. **Score:** compute final value and disposition from validated features plus product policy.
12. **Persist insight:** store useful analysis independently from its Inbox projection.
13. **Project Inbox:** create at most one active item for the insight and decision fingerprint.
14. **Deliver:** enqueue channel-specific deliveries; workers retry independently.
15. **Learn:** convert user feedback and tasks into events and evaluation data, not direct prompt mutation.

The pipeline must never hold an open database transaction across context loading or model execution.

## 4. Storage model

All timestamps are UTC ISO strings. JSON columns are validated at repository boundaries. Foreign keys and uniqueness constraints enforce idempotency rather than relying only on in-memory guards.

### `proactive_events`

| Column | Notes |
|---|---|
| `id` | primary key |
| `type`, `schema_version` | routable event identity |
| `source_kind`, `source_id`, `device_id` | producer identity |
| `subject_kind`, `subject_id` | primary object |
| `workspace_id`, `project_id`, `agent_id` | authorization/routing scope |
| `actor_kind`, `actor_id` | originator |
| `occurred_at`, `observed_at` | business and ingestion time |
| `correlation_id`, `causation_id` | trace and loop control |
| `dedupe_key` | globally unique |
| `sensitivity`, `payload_json` | policy and typed content |

Indexes: `(type, observed_at)`, `(subject_kind, subject_id, occurred_at)`, `(project_id, occurred_at)`, `correlation_id`; unique `dedupe_key`.

### `proactive_scenarios` and `proactive_scenario_subscriptions`

The scenario table stores product-owned definitions and current active version. Subscriptions store user/workspace-specific enablement, scopes, trigger overrides, context-source choices, value thresholds, delivery settings, and active prompt revision. This separation allows product scenario upgrades without overwriting user choices.

Unique keys: scenario `key`; subscription `(scenario_id, workspace_id, scope_kind, scope_id)`.

### `proactive_prompt_revisions`

Stores immutable published revisions and mutable drafts. Fields include scenario/subscription, revision number, base-template version, user instructions, status, author, created/published timestamps, and content hash. Only one published revision is active per subscription. Publishing and pointer update happen in one transaction.

### `proactive_signal_batches` and `proactive_batch_events`

A batch stores scenario/subscription, aggregation key, window bounds, ready time, status, event fingerprint, ignored reason, and timestamps. The join table preserves exact event membership. Unique event membership `(batch_id, event_id)` and unique run identity `(subscription_id, event_fingerprint, prompt_revision_id)` prevent duplicate analysis.

### `proactive_runs`

Fields: batch, scenario version, prompt revision, state, attempts, next-attempt time, lease owner/expiry, context snapshot id, model role/ref, budget, tokens/cost, automation run id, started/finished time, error code, and bounded error message.

### `proactive_context_snapshots`

Stores provider manifests, evidence references, hashes, truncation flags, authorization version, and optionally encrypted/bounded context according to retention policy. Restricted raw personal content should default to ephemeral execution input; its snapshot records provenance and hash rather than body.

### `proactive_insights` and `proactive_insight_evidence`

The insight stores structured content, kind, scenario/run identity, subject, feature scores, final value, disposition, content fingerprint, created/expired timestamps, and supersession link. Evidence rows point to events or authorized domain objects with labels and observed versions.

Unique `(scenario_id, subject_kind, subject_id, content_fingerprint)` within the configured novelty window prevents semantically identical active insights.

### `proactive_inbox_items` and `proactive_decisions`

Inbox items project an insight into lane `information` or `decision`, with type, status, priority, snooze/expiry, read/resolved timestamps, and display payload. Decision rows store question, immutable option set, selected option, rationale, and decision timestamp. The insight remains valid if an Inbox item is archived.

### `proactive_delivery_outbox`

Each row identifies Inbox item/insight, channel, target, state, attempts, lease, next retry, provider receipt, and last error. Unique `(insight_id, channel, target, delivery_revision)` prevents replayed pushes.

### `proactive_feedback`

Stores useful/not-useful, reason code, optional bounded comment, user action, scenario/prompt revision, and task links. Feedback is append-only.

## 5. State machines

### Signal batch

```text
collecting -> ready -> processing -> processed
     |          |          |-> ignored
     |          |          |-> failed_retryable -> ready
     |          |          `-> failed_permanent
     `-> expired
```

Only the aggregator may move `collecting -> ready`; only a leased runner may move `ready -> processing`. A stale processing lease returns to `ready` with an incremented attempt.

### Run

```text
queued -> leased -> running -> succeeded
   ^         |         |      -> discarded
   |         |         |      -> failed_permanent
   `---------+---------`------> failed_retryable
```

Cancellation is allowed before external model invocation; after invocation the result may be ignored but the run remains auditable. Maximum attempts and retryable error classes are deterministic.

### Insight and Inbox

```text
insight: active -> superseded | expired | withdrawn

inbox: unread -> read -> resolved | archived
          |         |
          `-> snoozed -> unread
```

Reading never mutates insight value. Listing Inbox items must not perform hidden writes; a maintenance worker explicitly resurfaces due snoozes.

### Delivery

```text
pending -> sending -> delivered
              |----> retryable_failed -> pending
              `----> permanent_failed
```

## 6. Prompt lifecycle and user optimization

Prompt composition has five ordered layers:

1. **Platform safety** — protected: authorization, tool boundaries, evidence rules, injection handling.
2. **Scenario base** — product-owned: job, definitions, reasoning checklist, negative criteria.
3. **User instructions** — editable: priorities, ignored cases, preferred perspective, notification bar, format, decision ownership.
4. **Runtime context** — generated: batch facts, context snapshots, prior open insights, time and scope.
5. **Output schema** — protected: machine-readable structure and field limits.

The UI never exposes the system prompt or a scenario administration page. A user can submit a natural-language correction on a concrete Inbox judgment. That explicit action appends the correction to the subscription's user-instruction layer and publishes an auditable revision; platform safety, tools, context authorization, and output schema remain immutable.

Internal revision workflow:

```text
judgment feedback -> validate -> publish revision -> monitor
```

Runs always pin both scenario base version and user prompt revision. Historical evaluation remains an internal quality workflow and cannot create live Inbox items or deliveries.

## 7. Trigger conditions

Phase one supports a deliberately small condition algebra:

- equality/inequality on allow-listed envelope and payload fields;
- membership in a bounded literal list;
- numeric and timestamp comparison;
- `changed(field)` when producers include before/after values;
- boolean `all`, `any`, and `not` with depth/term limits.

Conditions are JSON data evaluated by product code. No `eval`, SQL fragments, JavaScript, regex supplied by users, or model-authored executable triggers. Temporal patterns are expressed by aggregation windows and context providers, not a general CEP engine.

## 8. Value and delivery policy

The model returns bounded features with evidence; product code computes disposition.

```text
benefit = relevance * max(impact, urgency) * confidence
decisionUtility = actionability * decisionReadiness
penalty = interruptionCost + duplicationRisk + uncertaintyPenalty
finalValue = clamp(weighted(benefit, decisionUtility, novelty) - penalty)
```

Exact weights are scenario-versioned configuration, not prompt text. Hard gates run first:

- no valid evidence -> discard;
- outside authorized scope -> discard and security audit;
- duplicate active fingerprint -> update/supersede or discard;
- no material change -> quiet record at most;
- unresolved required user decision -> eligible for Decision Inbox;
- high impact and time sensitivity -> eligible for push, subject to quiet hours and rate limits.

Dispositions are `discard`, `record`, `digest`, `inbox`, or `push`. `push` always also creates an Inbox record so the notification is not the source of truth.

## 9. API surface

### Events and operations

- `POST /api/internal/proactive/events` — trusted event ingestion and diagnostics.
- `GET /api/internal/proactive/events` — operator diagnostics with redaction.
- `GET /api/internal/proactive/batches`
- `GET /api/internal/proactive/health`
- `GET /api/internal/proactive/scenarios`
- `GET /api/internal/proactive/insights`

### User judgment Inbox

- `GET /api/inbox/judgments`
- `POST /api/inbox/judgments/:itemId/transition`
- `POST /api/inbox/judgments/:itemId/decisions`
- `POST /api/inbox/judgments/:itemId/feedback`
- `POST /api/inbox/judgments/:itemId/instructions`

`GET /api/home` projects active judgments into the same cross-product decision feed used by Web and Mobile. Scenario management and raw prompt editing are intentionally absent from the user API.

## 10. Reliability and scheduling

- Event delivery is at-least-once; persistence and downstream effects are idempotent.
- SQLite workers claim bounded batches with short leases. Work is committed before model calls.
- A scheduler persists next-run timestamps; renderer timers may wake it but are never authoritative.
- Retries use bounded exponential backoff with jitter and classified errors.
- Poison inputs become permanent failures after the attempt limit and remain inspectable.
- A correlation/causation guard prevents insight, Inbox, feedback, and action events from recursively triggering the same scenario without an explicit subscription.
- Backpressure first delays low-priority fallback scans, then digest-only scenarios; user-requested scans and decision-impacting runs keep priority.

## 11. Security and privacy

- Consent is source- and scope-specific, versioned, revocable, and checked at eligibility, context load, and tool execution.
- Context providers receive an authorization snapshot and return provenance for every item.
- Tool manifests are product-owned. Phase-one proactive runs are read-only.
- Source content is treated as untrusted data and delimited from instructions. Detected injection attempts become evidence/security telemetry, not executable instructions.
- Sensitive prompt/context bodies follow retention and encryption policy; logs include IDs, hashes, counts, and bounded previews only.
- Prompt previews redact secrets and restricted context.
- User deletion cascades through derived snapshots and presentation records according to retention policy while preserving minimal non-content operational audit where required.

## 12. Observability

Every log and metric carries `eventId`, `batchId`, `runId`, `scenarioId`, `promptRevisionId`, `correlationId`, and subject scope when applicable.

Key metrics:

- ingest/routing/batch rates and dedupe ratio;
- ready queue depth and oldest age;
- eligibility rejection reasons;
- context latency, truncation, and authorization failures by provider;
- run success/discard/failure, attempts, latency, token and cost;
- schema/evidence rejection rate;
- disposition distribution and duplicate suppression;
- Inbox open, decision, snooze, dismiss, useful, and action-completion rates;
- delivery success, retry, permanent failure, and push rate per user/day.

Tracing should reconstruct `event -> batch -> run -> insight -> Inbox -> delivery -> feedback` without logging raw sensitive context.

## 13. Extension contracts

New domains implement:

- event schemas and a publisher adapter;
- optional context providers with explicit authorization and evidence mapping;
- no direct dependency on prompt, insight, Inbox, or delivery modules.

New scenarios register a declarative definition, product base prompt, output schema, value policy, evaluator set, and UI metadata. New delivery channels consume outbox records through a common adapter and report canonical receipts/errors.

## 14. Proposed module structure

```text
src/proactive/
  events/          envelope, schemas, publisher, repository
  routing/         subscriptions, conditions, aggregator
  scenarios/       registry, definitions, prompt revisions
  context/         provider contract and domain adapters
  execution/       leases, scheduler, composer, runner
  validation/      output, evidence, safety checks
  insights/        repository, fingerprints, value policy
  inbox/           projections, decisions, lifecycle
  delivery/        outbox, workers, channel adapters
  feedback/        events and evaluation capture
  application/     use cases and DTO mapping
src/gateway/hono/routes/proactive.ts
```

Repositories expose narrow interfaces; application services orchestrate transactions; route handlers only validate/authenticate/map. Scenario definitions are data plus pure policies, not classes with unrelated lifecycle responsibilities.

## 15. Current implementation disposition

No destructive reset happens before an approved migration commit.

### Keep

- Activity event persistence and domain emission points as producer inputs.
- Automation execution/runs, model resolution, agent tooling, and read-only boundaries.
- SQLite migrations, transaction helpers, repository patterns, and gateway lifecycle.
- Existing source-consent adapters and personal-context authorization state.
- Realtime broadcasting, Expo push adapter, device preferences, and useful UI primitives.
- Focus insight evidence, feedback, snooze, and investigation concepts where their behavior matches the generic model.
- Existing tests as regression evidence until replacement coverage exists.

### Replace directly

- Replace `AutomationProductEvent` and proactive Activity consumers with `EventEnvelope` publishers.
- Replace Focus monitors, processors, prompts, and Insights with scenario subscriptions, generic runs, and generic insights.
- Replace proactive Home/mobile decision summaries with Proactive Inbox projections.
- Replace direct proactive gateway notification mapping with delivery outbox consumers.
- Replace Focus scheduling with the durable scenario scheduler.

### Remove before new pipeline integration

- Direct Activity-to-Focus invocation.
- Focus as the central owner of event routing, Prompt execution, scoring, and notification.
- Domain-specific proactive push paths.
- In-memory-only listener/dedupe mechanisms as delivery guarantees.
- Model-provided final value score directly selecting push priority.
- Read/list APIs that mutate snooze state.
- Renderer timers as the authoritative background scheduler.
- Parallel user-facing decision lists outside Proactive Inbox.

### Replacement sequence

1. Delete uncommitted proactive implementation and committed legacy proactive Focus paths in scope.
2. Remove their routes, UI surfaces, scheduler hooks, notification mappings, tests, and obsolete schema objects.
3. Introduce the new event tables and interfaces with no compatibility adapters or dual writes.
4. Implement the project scenario using historical evaluation and the new pipeline only.
5. Add blocked-work and automation-impact scenarios.
6. Add Proactive Inbox and delivery projections from generic insights only.

Historical replay and evaluation mode remain product-quality tools, but they compare prompt/scenario revisions inside the new architecture; they do not execute or compare a legacy runtime.

## 16. Implementation stages and review gates

### Stage A — event spine

Deliver envelope schemas, store, producer adapter, routing, batches, replay tests, and diagnostics. Review: duplicate/restart/concurrency/security tests and domain dependency audit.

### Stage B — scenario and prompt control plane

Deliver definitions, subscriptions, revisions, preview, historical dry evaluation, protected composition, and Scenario Center APIs. Review: permission-bypass tests, revision pinning, rollback, and UX contract.

### Stage C — background execution and insight gate

Deliver scheduler, leases, context providers, runner, validation, evidence checks, fingerprints, value policy, and shadow mode. Review: crash recovery, cost bounds, malformed/injected output, and golden evaluation set.

### Stage D — Inbox and delivery

Deliver insight lifecycle, decision records, Inbox projection, snooze worker, outbox, push adapter, preferences, and rate limits. Review: exactly-once user-visible effects, quiet hours, accessibility, and mobile/web consistency.

### Stage E — product hardening and cleanup

Harden scenarios, remove experimental scaffolding, and update docs. Review: rollback of new schema/code, dead-code/dependency scan, full test/build suite, and user task metrics.

Each stage requires a written self-review with defects fixed before the next begins. SOLID applies at contracts and dependency direction; KISS and Occam's razor apply by rejecting infrastructure and abstraction that current requirements do not justify.

## 17. Architecture self-review

### Strengths

- It creates one durable spine while keeping domain ownership intact.
- Prompt customization is first-class and versioned without becoming a permission escape hatch.
- Insight persistence, attention projection, and delivery reliability are separated.
- Local-first operation uses existing SQLite/Agent/Automation capabilities.
- Quality can be evaluated before live delivery through historical replay and shadow mode.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Event vocabulary becomes inconsistent | schema registry, naming rules, compatibility tests, small ownership review |
| Scenario definitions become a hidden workflow engine | bounded condition algebra; code-owned context and value policies |
| Too many low-value runs | aggregation, eligibility gates, budgets, fallback-scan priority, shadow metrics |
| User prompt lowers quality | protected base/schema, preview, offline replay, rollback, feature bounds |
| Evidence points to changed/deleted data | store event/version references and render stale evidence explicitly |
| SQLite worker contention | short claim transactions, bounded leases/batches, metrics before adding infrastructure |
| Removing Focus changes existing surfaces | delete the entire dependency slice together and verify route, navigation, database, and test references |

### Simplifications made after review

- One scenario definition plus per-scope subscription replaces separate monitor types.
- One generic run state machine replaces scenario-specific processors.
- Inbox is a projection, avoiding duplicated analytical content.
- Rule evaluation remains deliberately small instead of introducing a DSL.
- Feedback is captured first; automatic prompt rewriting is deferred until evidence supports it.
