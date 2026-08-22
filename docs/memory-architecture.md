# Memory and user context architecture

xopc deliberately separates generic memory from its understanding of the user. Both are stored in SQLite, but they have different schemas, policies, and runtime paths.

## Two data domains

| Domain | Purpose | Source of truth |
|---|---|---|
| Generic memory | Searchable session, workspace, agent-profile, and provider-backed content | `memory_records` and provider stores |
| Structured user context | Profile, reviewable understanding, collaboration rules, evidence, consent, and feedback | `user_profiles`, `user_understandings`, `collaboration_rules`, and related context tables |

Generic memory is document-like retrieval data. It may contain project facts, session material, or external-provider results. It is exposed through `memory_search` and `memory_get`.

Structured user context is governed product state. It is not stored as tagged generic memory and is not projected to Markdown. The runtime reads it through the user-context planner and the `/api/you` resource model.

## Structured user context lifecycle

Understanding has an explicit lifecycle:

```text
candidate -> needs_review -> active -> stale / archived
                    \-> rejected
```

- Explicit user statements may become active immediately.
- Observed or inferred items remain candidates.
- Independent evidence may move a candidate to `needs_review`, never directly to `active`.
- Expired items become stale.
- A rejected canonical claim creates a suppression so it is not repeatedly relearned.
- Corrections create a new version and archive the superseded item.

Each understanding version can link to normalized evidence. Scope, validity, sensitivity, disclosure policy, conflicts, and consent are first-class fields rather than conventions embedded in prose.

## Per-turn planning

For each enabled turn, the planner:

1. Loads the direct user profile, active collaboration rules, and relevant understanding.
2. Applies channel, scope, lifecycle, validity, sensitivity, conflict, and consent policies.
3. Ranks eligible understanding against the current task.
4. Enforces count and character budgets.
5. Injects only the selected subset into the model input.
6. Records selections and exclusions in `context_runs` and `context_run_items`.

Explicit collaboration rules outrank inferred understanding. Channel-specific rules receive the parsed channel from the session key. Secret and regulated candidates are not persisted.

## Dreaming: deterministic consolidation

Dreaming is the product name for one small structured consolidation job. It does not invoke an LLM and does not use Light, Deep, or REM phases.

The job scans `candidate` and `active` understanding and performs only two automatic transitions:

- expired understanding -> `stale`;
- candidate with enough supporting evidence, understanding with contradictory evidence, or active understanding whose review date is due -> `needs_review`.

It never auto-activates an inference. Every run and transition is recorded in `context_consolidation_runs` and `context_consolidation_decisions`.

Default configuration:

```json
{
  "userContext": {
    "dreaming": {
      "mode": "review",
      "schedule": { "time": "03:00" },
      "minEvidenceSources": 2,
      "limit": 500
    }
  }
}
```

`review` creates one daily built-in automation in the configured timezone, or the host timezone when omitted. `off` disables it. Existing explicit `off` configuration stays off.

## Generic memory policy

`userContext.memory` controls only generic memory and external memory providers. Its `understanding` source name means unscoped generic memory records; it does not refer to the structured `user_understandings` domain. Structured user understanding is controlled by `userContext.enabled` and `userContext.understanding` and does not depend on the generic memory source list.

The generic memory subsystem follows provider routing and write policy. Local records remain scope-filtered, and external writes require explicit provider permission.

## Why SQLite

This state needs atomic revisions, relational integrity, indexed policy filtering, evidence lineage, and auditable per-turn decisions. SQLite provides those properties without a separate service and keeps backup and migration boundaries simple. Markdown remains appropriate for agent identity, project instructions, and user-authored documents, not as the database for evolving beliefs about a person.

See [Structured User Context](./user-understanding.md) for the API and product surface.
