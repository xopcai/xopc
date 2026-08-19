# Session Routing

How inbound traffic maps to **session keys**, **agents**, and optional **identity links** across channels.

## Session Key Format

```
agent:{agentId}:{rest}
```

The first segment is always `agent`. The second segment selects the agent manifest. The remaining path depends on scope and channel.

### Examples

```
agent:main:main
agent:main:telegram:default:direct:123456
agent:main:telegram:group:-100123456
agent:main:gateway:direct:chat_abc123
agent:main:cli:direct:cli
```

## Configuration

Routing is configured in **`~/.xopc/xopc.json`** (override path with `XOPC_CONFIG`). Use JSON — not YAML.

### Agents and bindings

Register agents under `agents.list`. **Binding rules** (`bindings`) are evaluated in **priority order** (higher `priority` wins first). Each `match` requires an exact **`channel`** id (e.g. `telegram`, `gateway`) — matching is case-insensitive and **does not** support `*` for “all channels”. Use one rule per channel, or rely on the **default agent** when nothing matches: optional top-level **`agents.default`**, else first **enabled** entry in `agents.list`, else `main`.

### Effective runtime profile

For a session key `agentId:…`, the agent runtime resolves the matching **enabled** manifest in **`agents.list`** and applies any declared **`agents.capabilityPresets`** from `extends`. If `agentId` is unknown or disabled, resolution falls back to the **default agent** id above. On-disk layout under `~/.xopc/agents/<id>/` follows the same config-driven resolution — gateway behavior is **`config.json`** only.

`match.peerId` supports simple `*` glob patterns (e.g. `-100*` for Telegram supergroups).

```json
{
  "agents": {
    "default": "main",
    "capabilityPresets": {},
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant", "language": "en", "tone": "direct" },
        "responsibilities": { "primary": ["Help the user"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": { "defaultRole": "deep", "roles": { "deep": { "model": "anthropic/claude-sonnet-4-5" } } },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      },
      {
        "id": "coder",
        "identity": { "name": "Coder", "role": "Software assistant", "language": "en", "tone": "direct" },
        "responsibilities": { "primary": ["Help with code tasks"] },
        "workspace": { "root": "~/.xopc/workspace/coder" },
        "models": { "defaultRole": "deep", "roles": { "deep": { "model": "anthropic/claude-sonnet-4-5" } } },
        "tools": { "builtin": { "shell": { "mode": "confirm", "scope": "workspace" } } },
        "skills": { "mode": "all" },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "coder",
      "priority": 100,
      "match": {
        "channel": "telegram",
        "peerId": "-100*"
      }
    }
  ],
  "session": {
    "identityLinks": {
      "alice": ["telegram:123456789", "discord:987654321"]
    }
  }
}
```

### Identity links (cross-platform aliases)

`session.identityLinks` maps a **canonical** id to a list of **`channel:peerId`** aliases so routing can treat the same person across channels consistently. See [Configuration](/configuration) for `session.dmScope` and other session options.

## API

### Generate Session Key

```typescript
import { buildSessionKey } from '@xopcai/xopc/routing/index.js';

const sessionKey = buildSessionKey({
  agentId: 'main',
  source: 'telegram',
  accountId: 'default',
  peerKind: 'dm',
  peerId: '123456',
});
```

### Route Resolution

```typescript
import { resolveRoute } from '@xopcai/xopc/routing/index.js';

const route = resolveRoute({
  config,
  channel: 'telegram',
  accountId: 'default',
  peerKind: 'dm',
  peerId: '123456',
});

console.log(route.sessionKey); // e.g. main:telegram:default:dm:123456 (depends on dmScope)
console.log(route.agentId); // default agent when no binding matches (e.g. main)
```

## Related Files

- **Core routing** — session keys, bindings, and rule evaluation inside xopc.
- **Telegram** — contributes channel-specific routing hooks when the Telegram channel is enabled.
