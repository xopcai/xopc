# Session Routing

How inbound traffic maps to **session keys**, **agents**, and optional **identity links** across channels.

## Session Key Format

```
{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
```

| Field | Description | Example |
|-------|-------------|---------|
| `agentId` | Agent identifier | `main`, `coder` |
| `source` | Message source | `telegram`, `gateway`, `cli` |
| `accountId` | Account identifier | `default`, `work` |
| `peerKind` | Conversation type | `dm`, `group`, `direct` |
| `peerId` | Conversation ID | `123456`, `-100123456` |

### Examples

```
main:telegram:default:dm:123456
main:telegram:default:group:-100123456
main:gateway:default:direct:chat_abc123
main:cli:default:direct:cli
```

## Configuration

Routing is configured in **`~/.xopc/xopc.json`** (override path with `XOPC_CONFIG`). Use JSON — not YAML.

### Agents and bindings

Register agents under `agents.list`. **Binding rules** (`bindings`) are evaluated in **priority order** (higher `priority` wins first). Each `match` requires an exact **`channel`** id (e.g. `telegram`, `gateway`) — matching is case-insensitive and **does not** support `*` for “all channels”. Use one rule per channel, or rely on the **default agent** when nothing matches: optional top-level **`agents.default`**, else first **enabled** entry in `agents.list`, else `main`.

### Effective runtime profile

For a session key `agentId:…`, the agent runtime merges **`agents.defaults`** with the matching **enabled** row in **`agents.list`** (per-agent `workspace`, `model`, `agentDir`, `tools.disable`, `systemPromptOverride`, `skills`, thinking defaults, etc.). If `agentId` is unknown or disabled in `list`, profile resolution falls back to the **default agent** id above. On-disk layout under `~/.xopc/agents/<id>/` follows the same config-driven resolution — gateway behavior is **`config.json`** only.

`match.peerId` supports simple `*` glob patterns (e.g. `-100*` for Telegram supergroups).

```json
{
  "agents": {
    "default": "main",
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "list": [
      { "id": "main", "name": "Main Assistant" },
      { "id": "coder", "name": "Coding Assistant" }
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
