# Structured User Context

xopc stores its understanding of the user as structured SQLite data. Markdown remains the right format for agent identity and project instructions, but it is not a user database.

## Domain model

The model deliberately separates three concepts:

| Concept | Meaning | Authority |
|---|---|---|
| Profile | Direct facts such as preferred name, pronouns, timezone, and locale | User-authored only |
| Understanding | Reviewable beliefs learned from explicit statements, observations, or inference | Candidate or active lifecycle |
| Collaboration rule | Explicit instructions for how xopc should communicate and execute | User-authored only; outranks inferred understanding |

Supporting tables store immutable understanding versions, evidence links, suppressions, consent, per-turn context runs, selected and rejected items, and feedback. `user_profiles`, `user_understandings`, and `collaboration_rules` are the current projections.

The optional Dreaming job is a deterministic daily review over these same tables. In its default `review` mode it marks expired items stale and sends sufficiently corroborated candidates, contradictory evidence, or due active items to `needs_review`. It never auto-activates inferred understanding. Runs and decisions are stored in `context_consolidation_runs` and `context_consolidation_decisions`; `off` disables the schedule.

## Turn lifecycle

For every enabled user turn:

1. Read the structured profile, active collaboration rules, and understanding candidates.
2. Apply status, scope, validity, sensitivity, conflict, consent, relevance, count, and character-budget filters.
3. Persist every selection or rejection in `context_runs` and `context_run_items`; the run stores a query fingerprint rather than raw query text.
4. Inject only the selected subset into the model message.
5. After the answer, capture explicit “remember” statements and durable review candidates with linked evidence.
6. Attribute user feedback and explicit corrections to the exact prior turn and understanding version.

Secret and regulated candidates are never persisted as understanding. Rejected understanding creates a suppression so the same canonical statement is not repeatedly relearned.

Relevance retrieval is deterministic and embedding-free: SQLite FTS5 and shared lexical/CJK/identifier features produce candidates, then kind, explicitness, confidence, scope, and bounded repeated feedback refine their order. Policy filters remain authoritative and cannot be bypassed by ranking feedback.

## API

The gateway exposes one non-legacy resource model:

```text
GET    /api/you
GET    /api/you/profile
PATCH  /api/you/profile

POST   /api/you/understandings
PATCH  /api/you/understandings/:id
DELETE /api/you/understandings/:id
GET    /api/you/understandings/:id/evidence

POST   /api/you/rules
PATCH  /api/you/rules/:id
DELETE /api/you/rules/:id

GET    /api/you/turns/:turnId/personalization
POST   /api/you/turns/:turnId/feedback
PATCH  /api/you/consents/:id
```

There is no Markdown profile endpoint, import projection, playbook compatibility layer, `user_claims` staging model, or generic `/api/you/memories` surface.

## Product surface

`/you` has six focused tabs:

- **Profile** — direct facts with a simple structured editor.
- **Understanding** — active and needs-review items, with provenance language, confirm, correct, reject, and delete actions.
- **Working agreement** — explicit collaboration rules that can be enabled or disabled.
- **Sources** — installed-source status with a direct path to connector permissions and management.
- **Background review** — Dreaming on/off, daily time, timezone, evidence threshold, scan limit, and latest consolidation status.
- **Privacy** — the sensitive-write policy for generic memory providers, alongside the stricter invariant that secret and regulated content never enters structured user understanding.

Chat answers can show which understanding influenced the turn. Feedback is recorded against the normalized context run instead of a free-form trace blob.

## SQLite rationale

SQLite is appropriate because this is local, transactional, relational state rather than a document-editing problem. It provides atomic revisions, foreign-key integrity, indexed filtering, FTS, inspectable evidence lineage, and a single backup unit without adding a server process. The model can evolve through migrations while the UI and runtime share the same source of truth.
