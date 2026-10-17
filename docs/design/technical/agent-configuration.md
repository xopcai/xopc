# Agent configuration

xopc stores the Agent catalog in `~/.xopc/xopc.db`. Runtime resolution has exactly two layers:

```text
effective Agent = catalog global defaults + Agent explicit overrides
```

There are no reusable preset graphs, multiple inheritance, locks, generic deep-merge rules, or JSON fallback paths.

## Storage model

The SQLite catalog owns:

- the global default Agent id and inherited capability defaults;
- Agent profile, workspace, enabled state, and explicit overrides;
- ordered channel routing bindings;
- per-surface defaults such as the TUI Agent;
- recoverable provisioning and purge work.

`xopc.json` does not contain Agent data. An upgrade from the former JSON shape runs before strict config validation, creates backups, imports the data transactionally, removes the retired JSON fields atomically, and records a durable migration marker. After completion, reintroduced legacy fields are rejected instead of merged back into SQLite.

## Resolution rules

- `models.chat` is atomic: an Agent-provided route replaces the global route.
- `models.intents` merges by one of the fixed keys: `fast`, `reasoning`, `coding`, `review`, `vision`, or `understanding`. `null` removes an optional inherited intent.
- `skills` either inherits, applies an explicit `merge` add/remove delta, or uses `replace` with a complete include list.
- `tools` merges by exact tool id. A local `allow`, `ask`, or `deny` policy replaces the global policy for that tool.
- `workflows` and `runtime` merge only their documented fields.
- `profile` and `workspace` are Agent-owned. An omitted workspace resolves to the Agent's standard workspace directory.

The resolver returns source metadata (`system`, `global`, or `agent`) for UI explanation. The stored Agent entry remains a compact override rather than a copied effective configuration.

## Product surfaces

- **Settings → Agent defaults** edits the inherited capability defaults.
- **Agents** creates and edits Agent profiles and explicit overrides.
- `xopc agents add|list|default|delete` provides terminal management.
- An Agent conversation uses `xopc_use` with `mode: "agent"`; writes are routed through idempotent `xopc.agents.*` capabilities rather than direct database access.
- Gateway APIs retain `GET/PATCH /api/global-defaults` and `/api/agents` routes, backed only by the catalog.

Create and update operations provision directories through durable jobs. Purge records its intent before deleting files, retries after restart, and refuses paths that could remove the xopc state root, an ancestor of it, or a workspace shared by another Agent.

## Catalog integrity and lifecycle

`agent_catalog_settings` owns the default Agent, global defaults and catalog revision. `agents` owns profile/overrides, enabled and provisioning state, revisions and soft deletion. Ordered `agent_bindings`, `agent_surface_defaults` and `agent_provisioning_jobs` keep routing, surface preferences and filesystem work in the same catalog boundary. JSON payloads remain schema-validated; they are not a second runtime configuration store.

- Repository mutations use SQLite write transactions and expected revisions; stale updates fail instead of overwriting newer data. Default and surface selections must refer to an enabled, ready, non-deleted Agent.
- REST, CLI and Agent capabilities share administration rules. Capability writes use stable idempotency keys; creation accepts profile and explicit capabilities together rather than briefly creating an unrestricted Agent before applying overrides.
- Directory provisioning and purge use durable post-commit jobs because filesystem changes cannot share a SQLite transaction. Pending/failed work can resume after restart; only ready Agents are eligible for new runs. Running turns keep their captured configuration; later turns resolve the updated catalog.
- Disable prevents new selection. Delete preserves historical Agent identities; default and binding references must be resolved explicitly. Purge is separate filesystem cleanup, with workspace deletion requiring an explicit request and safe-path checks. Historical sessions and runs must not be cascade-deleted when an Agent is removed.
- `SOUL.md`, `AGENTS.md`, `TOOLS.md`, workspace content and private authentication files retain their filesystem/security lifecycles. Structured identity belongs in the catalog: the one-time `IDENTITY.md` import prefers existing catalog fields and archives the original as `.identity-migration-backup`; runtime does not read that retired file.

## One-time JSON import and crash recovery

The retained import is implemented by `src/agent-catalog/migrations/legacy-config-cutover.ts`; it is distinct from historical database schema upgrades. The current database baseline is v217, and pre-baseline databases are not supported by the current migration runner.

Bootstrap must open the supported database and perform the import before strict parsing of the new configuration. The legacy shape is private to the importer: `agents`, ordered `bindings` and `tui.defaultAgent` are imported into the catalog. Other infrastructure configuration stays in `xopc.json`.

1. Validate the raw legacy payload and compute its canonical SHA-256 digest. Back up the configuration to `<config-path>.pre-agent-sqlite-v1.bak` and create a consistent database backup for a file-backed database.
2. Import the catalog and write the digest, backup paths and `db_committed` marker in one SQLite transaction. Existing catalog data blocks a fresh import rather than being overwritten.
3. Atomically replace the configuration after removing the retired fields, then mark the import `completed`.

| Interrupted stage | Recovery |
| --- | --- |
| Before the database commit | Original JSON remains available for a retry |
| Database committed, legacy JSON still present | Require the same payload digest and repeat only JSON cleanup |
| JSON cleaned, marker still `db_committed` | Complete the marker without reimporting Agents |
| Completed import followed by reintroduced legacy fields | Reject the configuration; do not merge it over SQLite |
| Directory provisioning or purge | Resume the durable job without reimporting the catalog |

Validation must cover crash/restart at both durable stages, digest conflicts, backup/write failures, duplicate import prevention, revision conflicts, ready-only selection, historical reads after deletion and purge path boundaries.
