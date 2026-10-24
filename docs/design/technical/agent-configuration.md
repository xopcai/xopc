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
- `SOUL.md`, `AGENTS.md`, `TOOLS.md`, workspace content and private authentication files retain their filesystem/security lifecycles. Structured identity belongs in the catalog; runtime does not import retired identity Markdown files.

## Initialization and installed database upgrades

The database baseline is v259. Bootstrap opens that schema, initializes an empty Agent catalog with current defaults, and resumes current directory provisioning jobs. Installed databases at v202–v258 upgrade transactionally to v259 after a consistent pre-upgrade backup; Agent identities, current profile fields, and model/tool overrides survive the supported upgrade chain. Versions below v202 are rejected with recovery guidance. There is no legacy Agent JSON import, identity Markdown import, or import marker. On existing installations, the file reader discards the retired root `workflows` field before current-schema validation, and catalog initialization removes that field from stored Agent defaults and overrides. Current credentials, model/tool policy values and Agent identities are preserved. New configuration writes still use the strict current schema.

Current catalog operations still validate revisions, ready-only selection, historical reads after deletion and purge path boundaries. Durable provisioning recovery concerns current jobs and does not convert historical formats.
