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
