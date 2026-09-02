# Agent configuration

xopc uses one global Agent configuration and a small override object per Agent. Runtime resolution is always:

```text
effective agent = agents.defaults + agents.list[id]
```

There are no reusable preset graphs, multiple inheritance, locks, or generic deep-merge rules.

## Shape

```json
{
  "agents": {
    "default": "main",
    "defaults": {
      "models": {
        "chat": { "primary": "openai/gpt-5", "fallbacks": [] },
        "intents": {
          "fast": { "primary": "openai/gpt-5-mini", "fallbacks": [] },
          "review": { "primary": "anthropic/claude-sonnet-4", "fallbacks": [] }
        }
      },
      "skills": { "mode": "all-enabled", "exclude": [] },
      "tools": {
        "browser_use": { "mode": "ask" }
      },
      "workflows": {},
      "runtime": {}
    },
    "list": [
      {
        "id": "main",
        "profile": {
          "name": "Main",
          "instructions": "Be direct and pragmatic."
        }
      },
      {
        "id": "coder",
        "profile": { "name": "Coder" },
        "models": {
          "intents": {
            "coding": { "primary": "openai/gpt-5-codex", "fallbacks": [] }
          }
        }
      }
    ]
  }
}
```

## Resolution rules

- `models.chat` is atomic: an Agent-provided route replaces the global route.
- `models.intents` merges by one of the fixed keys: `fast`, `reasoning`, `coding`, `review`, `vision`, or `understanding`. `null` removes an optional inherited intent.
- `skills` either inherits, applies an explicit `merge` add/remove delta, or uses `replace` with a complete include list.
- `tools` merges by exact tool id. A local `allow`, `ask`, or `deny` policy replaces the global policy for that tool.
- `workflows` and `runtime` merge only their documented fields.
- `profile` and `workspace` are Agent-owned. An omitted workspace resolves to the Agent's standard workspace directory.

The resolver returns source metadata (`system`, `global`, or `agent`) for UI explanation. The stored Agent entry remains a compact override rather than a copied effective configuration.

## Product surface

- **Settings → Agent defaults** edits the one global object.
- **Agents** creates an Agent from a name and optional personality, then exposes only explicit overrides.
- Empty override fields visibly inherit their global value.
- Gateway APIs use `GET/PATCH /api/global-defaults` and `GET /api/agents/:id/effective-config`.
