# xopc Shared Understanding v2

Status: Implemented  
Date: 2026-08-30  
Scope: product model, context governance, extraction, retrieval, privacy, evaluation, and staged migration

## Decision summary

xopc should present one product concept—**Shared Understanding**—while retaining specialized storage and lifecycle models for profile fields, collaboration rules, user understandings, and active focuses.

The immediate priority is correctness and governance, not a vector database or a general-purpose knowledge graph. The current SQLite, FTS5, lexical retrieval, evidence, versioning, consent, and trace foundation is sound. The highest-value work is to make every injected object obey the same policy, budget, evidence, audit, feedback, and deletion contract.

The v2 design makes five decisions:

1. Treat the transcript and connected-source items as evidence, not as ready-to-use memory.
2. Treat summaries and relationship maps as projections, not as the source of truth.
3. Make inferred context a reviewable belief with provenance, time, scope, and confidence.
4. Put profile fields, rules, understandings, and focuses through one planner contract.
5. Add embeddings or graph traversal only after an xopc-specific evaluation shows a material gain under the same token, latency, privacy, and cost budget.

## Why now

xopc already has four adjacent systems:

- generic memory records and provider routing;
- structured user profile, collaboration rules, understandings, evidence, consent, and feedback;
- current and long-term user focuses;
- connector- and transcript-derived candidates.

Each is useful, but their governance is uneven. In particular:

- active focuses are injected on every private turn, up to five items, without participating in the normal result count, pre-assembly budget check, trace items, consent, or feedback;
- background transcript review can implicitly reuse the last captured evidence ID for the session instead of linking the exact supporting turns;
- `processingPolicy` is persisted on source grants but is not a universal gate before a model sees source content;
- connector learning has both deterministic and semantic derivation paths that can create overlapping context objects;
- source revocation handles evidence-backed understandings but not focuses with equivalent semantics;
- the Shared Understanding relationship map is a useful navigation view, but its current client-side scope/token-overlap heuristics should not be presented as a factual knowledge graph.

These are product-trust and correctness issues. They should be fixed before expanding automatic inference.

## Product model

The user-facing promise is:

> xopc gradually understands you without treating guesses as facts. You can always see what it used, why it used it, where it came from, and correct, pause, or delete it.

### About me

User-authored, high-stability information that is normally safe to keep available: preferred name, primary role, main goal, language, timezone, and accessibility preferences.

Sensitive facts should not be added as ordinary profile fields. They should use the understanding lifecycle and, where appropriate, `ask_before_reference`.

### How to work with me

The collaboration contract contains communication, execution, boundary, routine, and proactivity rules. Explicit rules outrank inferred preferences.

Rules can be global or scoped by workspace, project, session, channel, and agent. Agent conditions are necessary because a user may want different interaction styles from a coding agent and a coaching agent without creating multiple user identities.

### What xopc understands

Atomic, evidence-backed beliefs such as preferences, relationships, routines, project context, task lessons, and derived insights.

Each item exposes:

- statement and kind;
- explicit, observed, or inferred origin;
- scope and disclosure policy;
- confidence and current lifecycle status;
- source summary and evidence details;
- validity, last verification, and recent-use information;
- correction, rejection, scope-change, and deletion actions.

### What matters now

Focus is time-bounded work state, not permanent memory. It has a primary/secondary role, horizon, project or workspace scope, validity, evidence, and lifecycle.

Only the pinned primary focus or the top one to three focuses relevant to the current task, project, or query should enter model context. Merely being active is not sufficient.

### Sources and privacy

Each source shows its access mode, retention policy, processing policy, last successful run, and derived objects.

Revocation offers explicit choices:

- stop future access;
- delete or retain derived understanding;
- delete or retain bounded raw content.

Before executing the action, the UI shows an impact preview. Objects with independent active evidence survive; source-only objects are removed from planning immediately and deleted or recomputed asynchronously.

## Core interactions

### Response-level provenance

Every personalized response exposes a **Used understanding** entry. It lists the actual profile fields, rules, focuses, and understandings selected for that turn, together with the selection reason and source label.

Feedback actions are consistent across object types:

- Helpful
- Wrong
- Outdated
- Too personal
- Do not use in this scope

### Evidence-first review

Review cards lead with the supporting evidence and its trust level, then show the proposed inference. Accept, edit, reject, merge, and change-scope actions are available from the same queue.

External content never becomes an active rule, boundary, or procedural lesson without explicit user confirmation.

### Temporary sessions

A temporary session:

- does not read shared understanding;
- does not write or update shared understanding;
- does not participate in cross-session chat retrieval;
- is visibly marked for the entire session.

Session configuration should eventually represent read and write controls separately, even if the first UI continues to expose a single temporary-mode switch.

### Natural-language control

The supported interaction contract includes:

- remember this;
- update or correct this;
- forget this;
- what do you know about me;
- why did you use this;
- do not use this in this project or with this agent.

A memory summary can provide a convenient high-level view, but it is generated from atomic objects. Editing the summary produces typed patches to those objects rather than replacing the evidence-backed store.

## Target architecture

```text
Conversation / Connectors / Files / Tasks / User edits
                │
                ▼
        Evidence ledger
  exact source, trust, policy, time, hash, redaction
                │
                ▼
     Extractor registry + write admission gate
 explicit | deterministic | transcript | connector semantic
 versioned, idempotent, source-policy-aware
                │
                ▼
       Candidate reconciliation
 dedupe, contradiction, temporal update, scope,
 sensitivity, corroboration, review routing
                │
                ▼
 Governed context objects in specialized stores
 profile | rule | understanding | focus
                │
                ▼
       Unified context planner
 policy → lifecycle → scope → consent → ranking
 → diversification → budget → trace
                │
                ▼
      Model context + response provenance
                │
                ▼
 Feedback / repair / consolidation / forgetting
```

## Shared governance envelope

The specialized repositories expose one adapter contract:

```ts
type GovernedContextObject = {
  objectType: 'profile_field' | 'rule' | 'understanding' | 'focus';
  objectId: string;
  versionId: string;
  principalId: string;
  scope: {
    type: 'global' | 'agent' | 'workspace' | 'project' | 'session';
    id?: string;
  };
  authority:
    | 'user_explicit'
    | 'user_observed'
    | 'system_inferred'
    | 'external_untrusted';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  disclosure: 'silent' | 'referenceable' | 'ask_before_reference';
  status:
    | 'candidate'
    | 'active'
    | 'needs_review'
    | 'stale'
    | 'archived'
    | 'rejected';
  confidence: number;
  validFrom?: number;
  validTo?: number;
  reviewAt?: number;
  evidenceIds: string[];
};
```

This is initially an adapter or SQL view plus additive schema changes. It is not a request to collapse every object into one table. Profile, rule, understanding, and focus have meaningfully different update and lifecycle behavior.

## Evidence ledger

`context_evidence` should gain or expose:

- `principal_id`;
- `source_run_id`;
- exact `source_item_id` or `session_id + turn_id + message_id`;
- `content_hash`;
- `trust_level`;
- `retention_policy` and `processing_policy`;
- `extractor_id` and `extractor_version`;
- `observed_at` and `ingested_at`;
- optional redacted or encrypted excerpt.

Background transcript review must link the exact messages that support each candidate. `MemoryManager.applyUnderstandingCandidates` must not implicitly reuse an old session evidence item for a later background synthesis.

Focuses need normal evidence links and versions instead of only JSON evidence references.

## Extractor registry

Every extraction path declares:

- supported input kinds;
- required processing policy;
- maximum trust and automatic-activation level;
- candidate kinds it may produce;
- idempotency key;
- extractor and prompt version;
- timeout and cost budget.

The processing order is:

1. explicit command extractor, synchronous and user-authoritative;
2. deterministic signal extractor, synchronous or asynchronous and observed;
3. transcript synthesis, asynchronous with exact evidence spans;
4. connector structural extractor, asynchronous and externally untrusted;
5. connector semantic extractor, allowed only when all selected inputs are `remote_allowed` or a local model is available.

The same source item and extractor version can produce one candidate set. Overlap between extractors is resolved by reconciliation, not independent upserts.

## Reconciliation and temporal updates

Memory writes are state transitions, not append-only events:

- exact canonical duplicate: retain the object and link new evidence;
- semantic near-duplicate: propose a merge;
- explicit correction: create a version and supersede the old version;
- inferred contradiction: create a candidate or mark for review, never overwrite an explicit active item;
- time-bounded state: close the previous assertion with `validTo` and activate the supported current state;
- single-source external inference: remain a candidate unless the user confirms it or an independent evidence policy is satisfied;
- boundary and collaboration rule: only explicit user authority can make them active.

The first implementation can keep natural-language statements plus typed payloads. A later typed assertion layer is justified only for relationship, current-state, routine, and project-status objects where temporal and relational queries matter.

## Planner v2

The planner uses four candidate tiers:

1. pinned: core profile fields and global hard boundaries;
2. contract: explicit rules matching scope, channel, and agent;
3. focus: the pinned primary focus or top one to three task-relevant focuses;
4. understanding: top query-relevant beliefs.

All tiers pass through a shared sequence:

```text
policy filter
  → lifecycle and temporal validity
  → scope and agent/channel match
  → consent
  → relevance and authority ranking
  → redundancy/source diversification
  → section and total budgets
  → complete selection/rejection trace
```

A ranking model can combine:

```text
relevance
+ authority weight
+ scope match
+ temporal fit
+ corroboration
+ positive feedback
- staleness
- source risk
- redundancy
```

The default remains deterministic sparse retrieval: SQLite FTS5, lexical and CJK matching, identifiers, typed filters, time-aware query expansion, and source diversity. A local embedding generator can be an optional candidate source behind a feature flag. Graph traversal is reserved for entity and relationship queries.

Every injected character is budgeted before context assembly. `context_run_items` supports profile fields and focuses, not only rules and understandings. The response provenance UI reads the same trace.

## Security and privacy model

### Write-time admission

Connected documents, mail, web content, repositories, and tool results are untrusted data. Instructions found in them cannot be written as collaboration rules, boundaries, tool policies, or procedural lessons.

Source trust places a ceiling on object type and lifecycle state. An external source can suggest a candidate project context; it cannot silently grant itself durable authority.

### Processing-policy enforcement

Before every synthesis model call, the runtime computes the effective policy of all selected evidence. If any input is `local_only`, remote dispatch is prohibited. The runtime chooses a configured local model, a deterministic extractor, or a clear skipped result.

The policy decision and model destination are recorded on the extraction run without storing raw private input in logs.

### Read-time enforcement

Externally inferred context cannot change tool authority, safety boundaries, confirmation policies, or secrets handling. These restrictions are enforced structurally, not by a natural-language warning inside the retrieved context.

### Repair and deletion

Consolidation preserves provenance and trust. A derived summary cannot launder an untrusted source into a trusted memory.

Selective repair can roll back by source, extractor, run, or version. Objects with independent evidence remain valid.

Deletion removes an object from the planner immediately, then asynchronously clears projections, FTS rows, caches, and bounded raw content. Audit records retain only non-reversible identifiers and the deletion action.

The current implementation does not appear to provide application-level SQLite encryption. Until optional SQLCipher or equivalent keychain-managed encryption is implemented, product documentation should state the dependency on operating-system full-disk protection.

## API direction

Suggested endpoints:

```text
GET  /api/you/context-objects?view=current|review|history&scope=...
GET  /api/turns/:turnId/personalization
POST /api/context-objects/:type/:id/feedback
POST /api/context-objects/batch-review
GET  /api/understanding/sources/:grantId/impact
DELETE /api/understanding/sources/:grantId?derived=delete|retain&raw=delete|retain
POST /api/sessions/:key/temporary
```

The turn-personalization response returns the actual origin and evidence metadata for each selected object. It must not label explicit user content as inferred.

## Additive migration plan

### Migration A: planner consistency

- add focus scope, sensitivity, disclosure, validity, review, principal, and explicitness;
- add `user_focus_versions` and `user_focus_evidence_links`;
- add profile-field and focus object types to context runs and feedback;
- extend evidence with exact source, extractor, policy, and hash fields;
- expose a governed context-object adapter or view.

### Migration B: unified extraction

- add `context_extraction_runs` and versioned outputs;
- add extractor idempotency and prompt/algorithm versions;
- add a small `context_object_relations` table for `supersedes`, `supports`, `contradicts`, and explicitly non-factual `related_to` edges.

### Migration C: evaluated temporal assertions

- add typed assertions and entity aliases for the limited kinds that require time and relationship reasoning;
- keep the first version in SQLite;
- consider an external temporal graph only after scale and benchmark evidence justify the operational cost.

## Delivery plan

### Phase 0: correctness and privacy, 1–2 weeks

- make focus participate in relevance, scope, budget, trace, consent, and feedback;
- select only the relevant top one to three focuses;
- fix background evidence attribution and remove the implicit fallback;
- enforce processing policy at the model-call boundary;
- cascade or recompute focuses on source revocation;
- relabel the UI map as possible relationships and show the heuristic explanation;
- add regression, privacy, and revocation tests.

Exit criteria:

- no cross-scope focus injection;
- no remote call containing `local_only` evidence;
- every candidate has exact evidence;
- source revocation tests cover understandings and focuses;
- all context sections are represented in the turn trace.

### Phase 1: product control loop, 3–5 weeks

- ship the governed context-object API and unified review queue;
- add response-level Used understanding with source and why-used details;
- add evidence-first review cards and natural-language update commands;
- add temporary sessions that neither read nor write context;
- support agent conditions on collaboration rules;
- generate an editable summary projection.

Exit criteria:

- a user can inspect, correct, or prohibit an item within two actions;
- every personalized response explains its selected context;
- profile, rule, understanding, and focus feedback use one contract.

### Phase 2: unified write path and temporal state, 4–6 weeks

- ship the extractor registry and idempotent extraction runs;
- centralize candidate reconciliation;
- add limited typed temporal assertions;
- preserve provenance across consolidation;
- provide selective repair by source, extractor, run, and version.

Exit criteria:

- repeated extraction does not create duplicates;
- inferred information never silently replaces explicit information;
- temporal update and abstention evaluation gates pass.

### Phase 3: retrieval and connected intelligence, evaluation-driven

- add time-aware expansion, redundancy reduction, and source diversity;
- shadow-test optional local embeddings;
- add relationship/entity traversal where it improves measured outcomes;
- scale connector cold start, imports, exports, and source governance.

Exit criteria:

- the new path materially outperforms the deterministic baseline under matched context, latency, privacy, and cost budgets;
- security precision does not regress.

## Implementation record

The four delivery phases are implemented in schema versions 126–130 and the current runtime/UI:

- v126 unifies focus policy, scope, validity, trace, feedback, exact evidence use, and source revocation;
- v127 adds true response provenance, the governed context-object views, batch review, and temporary session mode;
- v128 adds idempotent extraction runs/outputs, typed temporal assertions, object relations, and selective repair;
- v129 adds focus versions and standard evidence links;
- v130 expands the evidence ledger with exact message/source identity, hashes, processing and retention policy, extractor versions, and ingestion time.

The planner now performs deterministic time-aware retrieval, lifecycle/scope/consent enforcement, source diversification, exact final-block budgeting, and complete selection/rejection tracing. Temporary chats have a dedicated creation action and remain visibly marked. Source revocation provides an impact preview and explicit delete-or-retain handling; retained source-only objects leave planning until reviewed.

Optional embeddings and an external graph were deliberately not added. The bilingual temporal/scope/abstention suite shows a material Recall@3 improvement over the matched SQLite FTS baseline with perfect precision and abstention on the checked fixtures, so another storage or retrieval subsystem would add complexity without measured benefit.

## Evaluation

The offline suite adopts the LongMemEval categories—information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention—and adds xopc-specific cases:

- Chinese and English explicit capture;
- project, workspace, session, and agent isolation;
- focus relevance and expiration;
- collaboration-rule precedence;
- sensitive information exclusion and consent;
- source revoke and delete completeness;
- indirect prompt injection and memory poisoning;
- multi-agent rule isolation.

Baselines:

- full history;
- current FTS and lexical planner;
- planner v2;
- planner v2 plus optional local embeddings;
- limited temporal assertion traversal.

Metrics:

- write precision, acceptance rate, duplicate rate, and wrong-source rate;
- Recall@k, Precision@k, answer accuracy, and abstention accuracy;
- contradiction resolution, stale-active rate, and scope leakage;
- helpful, wrong, outdated, and too-personal feedback rates;
- correction latency and revoke/delete completeness;
- memory-poisoning write, activation, and end-to-end success rates;
- planner p50/p95 latency, injected tokens, and synthesis cost.

Initial launch gates:

- explicit capture precision at least 0.98;
- inferred active precision at least 0.90, with other candidates remaining reviewable;
- zero scope leakage in the deterministic suite;
- zero remote dispatch of `local_only` evidence;
- zero wrong-source attribution;
- revoked context excluded from planning within one second at p95;
- intrusive or harmful personalization feedback below 1%.

## Build versus buy

xopc should own the governance envelope, source and evidence model, scope, planner, trace, feedback, and deletion semantics. These are tightly coupled to xopc's local-first runtime, agent manifests, projects, tasks, and connector permissions.

Embeddings, generic memory providers, and an optional temporal graph can remain replaceable adapters. No external provider should become the user-visible source of truth.

Replacing the current structured context with Mem0 or Zep is not recommended now. It would discard existing consent, scope, version, and audit advantages while adding a remote dependency. Those systems can be evaluated as shadow sidecars against the same suite before any adoption decision.

## Evidence and references

Internal implementation:

- [Current memory architecture](./memory-architecture.md)
- [Proactive context and connectors](../proactive-ai-context-and-connectors.md)
- `src/user-context/domain.ts`
- `src/user-context/planner.ts`
- `src/user-context/retriever.ts`
- `src/agent/memory/understanding/service.ts`
- `src/agent/background-review/run-background-review.ts`
- `src/agent/memory/manager.ts`
- `src/user-context/sources/`
- `src/connectors/connected-source-understanding.ts`
- `src/connectors/learning-coordinator.ts`
- `src/storage/sqlite/user-context-repository.ts`

External primary sources:

- [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-and-controls-faq)
- [Claude chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- [Gemini personalization](https://blog.google/products-and-platforms/products/gemini/gemini-personalization/)
- [Gemini Temporary Chats](https://blog.google/products-and-platforms/products/gemini/temporary-chats-privacy-controls/)
- [Microsoft Copilot memory](https://support.microsoft.com/en-us/Microsoft-365-Copilot/personalize-what-microsoft-365-copilot-remembers)
- [Kimi memory space](https://www.kimi.ai/zh-hans/help/features/memory-space)
- [Doubao memory FAQ](https://www.doubao.com/legal/memory_faq)
- [LangGraph memory overview](https://docs.langchain.com/oss/python/concepts/memory)
- [Letta stateful agents](https://docs.letta.com/v1-sdk/concepts/stateful-agents)
- [MemGPT](https://arxiv.org/abs/2310.08560)
- [Mem0 memory types and update pipeline](https://docs.mem0.ai/core-concepts/memory-types)
- [Zep temporal graph](https://help.getzep.com/graph-overview)
- [Zep graph creation and contradiction handling](https://help.getzep.com/how-graph-creation-works)
- [Hindsight structured agent memory](https://aclanthology.org/2026.acl-demo.27/)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [Hidden in Memory](https://arxiv.org/abs/2605.15338)
- [When Agents Remember Too Much](https://arxiv.org/abs/2607.06595)

## Validation note

Validation covers phase-specific regression suites, the full repository test suite, backend and web type checks, ESLint, whitespace checks, and production builds. The implementation also includes explicit regressions for scope isolation, processing policy, exact evidence, focus authority, idempotency, temporal replacement, selective repair, source-revoke impact, source diversity, exact character budgets, temporary sessions, and bilingual abstention.
