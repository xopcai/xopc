# Agent Capability Manifest

Agent runtime configuration is manifest-first. Each runnable agent is a structured object under `agents.list[]`; shared behavior is factored into `agents.capabilityPresets`.

## Manifest Shape

```json
{
  "id": "main",
  "extends": ["safe-coder"],
  "identity": {
    "name": "Main",
    "role": "General assistant",
    "language": "en",
    "tone": "direct"
  },
  "responsibilities": {
    "primary": ["Help the user complete tasks"],
    "outOfScope": ["Actions forbidden by user or policy"]
  },
  "workspace": { "root": "~/.xopc/workspace/main" },
  "models": {
    "defaultRole": "deep",
    "roles": {
      "deep": { "model": "anthropic/claude-sonnet-4-5" },
      "small": { "model": "openai/gpt-4o-mini" }
    }
  },
  "tools": {
    "builtin": {
      "shell": { "mode": "confirm", "scope": "workspace" }
    }
  },
  "skills": { "mode": "all" },
  "memory": {
    "mode": "confirmWrite",
    "sources": ["session", "curated"],
    "writePolicy": { "curated": "confirm" }
  },
  "workflows": {},
  "boundaries": {
    "requiresConfirmation": [],
    "forbidden": [],
    "escalation": []
  }
}
```

## Resolution Rules

- `agents.default` selects the default manifest id.
- `agents.list[]` is the only runnable agent registry.
- `extends` applies named `agents.capabilityPresets` before the manifest's own fields.
- There is no `agents.defaults` layer and no implicit compatibility merge.
- Model roles are named slots. Runtime code asks for a role id, then resolves it to `provider/model`.
- Tool policy uses explicit `allow`, `confirm`, or `deny` modes instead of disable lists.

## Product Surface

The gateway console manages manifests from `/agents`. Removed settings pages such as `/settings/agent-defaults` and `/settings/agent-browser` redirect to `/agents`.
